#!/usr/bin/env node
/**
 * generate-world-positions.js
 *
 * 게임 엔진 월드 좌표 → 맵 이미지 좌표 변환 후 data/world-positions.json 생성
 *
 * 사용법:
 *   node scripts/generate-world-positions.js
 *
 * 데이터 소스:
 *   - Site/*.json (월드 좌표 location.x/y)
 *   - data/positions.json (기존 수동 배치 — 캘리브레이션 기준점)
 */

const fs = require('fs');
const path = require('path');

const SITE_DIR_BASE = 'E:/Project/LEBEN/Main/BlueClient2/Content/Data/JsonResult/Site';
const SITE_DIR_E01 = 'E:/Project/LEBEN/Main/BlueClient2/Plugins/GameFeatures/E01/Content/Data/JsonResult/Site';
const POSITIONS_PATH = path.resolve(__dirname, '../data/positions.json');
const SITES_JSON_PATH = path.resolve(__dirname, '../data/sites.json');
const OUTPUT_PATH = path.resolve(__dirname, '../data/world-positions.json');

function readJson(p) {
  const buf = fs.readFileSync(p);
  let str = buf[0] === 0xFF && buf[1] === 0xFE
    ? buf.toString('utf16le').replace(/^\uFEFF/, '')
    : buf.toString('utf8').replace(/^\uFEFF/, '');
  return JSON.parse(str);
}

/** 월드 좌표 읽기: siteId → {x, y} */
function loadWorldCoords(siteDir, filePrefix) {
  const map = {};
  const files = fs.readdirSync(siteDir).filter(f => f.startsWith(filePrefix));
  for (const f of files) {
    try {
      const d = readJson(path.join(siteDir, f));
      if (d.siteId && d.location) {
        map[d.siteId] = { x: d.location.x, y: d.location.y };
      }
    } catch (e) {}
  }
  return map;
}

/** 최소제곱법으로 아핀 변환 파라미터 추출 */
function solveAffineParam(pairs, targetKey) {
  const n = pairs.length;
  let s_xx = 0, s_yy = 0, s_xy = 0, s_x = 0, s_y = 0, s_xt = 0, s_yt = 0, s_t = 0;
  for (const p of pairs) {
    s_xx += p.wx * p.wx; s_yy += p.wy * p.wy; s_xy += p.wx * p.wy;
    s_x += p.wx; s_y += p.wy;
    s_xt += p.wx * p[targetKey]; s_yt += p.wy * p[targetKey]; s_t += p[targetKey];
  }
  const A = [[s_xx, s_xy, s_x], [s_xy, s_yy, s_y], [s_x, s_y, n]];
  const B = [s_xt, s_yt, s_t];
  function det3(m) {
    return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
      - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
      + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  }
  function rep(col, vals) { return A.map((r, i) => r.map((v, j) => j === col ? vals[i] : v)); }
  const D = det3(A);
  return [det3(rep(0, B)) / D, det3(rep(1, B)) / D, det3(rep(2, B)) / D];
}

/** 아웃라이어 제거 후 아핀 변환 fitting */
function fitAffine(pairs, maxIter = 3, threshold = 100) {
  let filtered = [...pairs];
  let params;
  for (let i = 0; i < maxIter; i++) {
    const [a, b, c] = solveAffineParam(filtered, 'mx');
    const [d, e, f] = solveAffineParam(filtered, 'my');
    params = { a, b, c, d, e, f };
    filtered = filtered.filter(p => {
      const err = Math.sqrt((a * p.wx + b * p.wy + c - p.mx) ** 2 + (d * p.wx + e * p.wy + f - p.my) ** 2);
      return err < threshold;
    });
  }
  // 최종 fit
  const [a, b, c] = solveAffineParam(filtered, 'mx');
  const [d, e, f] = solveAffineParam(filtered, 'my');
  return { a, b, c, d, e, f, usedCount: filtered.length, totalCount: pairs.length };
}

function applyAffine(t, wx, wy) {
  return {
    x: Math.round((t.a * wx + t.b * wy + t.c) * 10) / 10,
    y: Math.round((t.d * wx + t.e * wy + t.f) * 10) / 10
  };
}

// ─── 메인 ─────────────────────────────────────────────────────

function main() {
  console.log('데이터 로딩...');

  const sites = JSON.parse(fs.readFileSync(SITES_JSON_PATH, 'utf8'));
  const positions = JSON.parse(fs.readFileSync(POSITIONS_PATH, 'utf8'));

  // 월드 좌표 로드
  const gangnamWorld = loadWorldCoords(SITE_DIR_BASE, 'Gangnam_Map_');
  const redcityWorld = loadWorldCoords(SITE_DIR_BASE, 'RedCity_Map_');
  const cahayaWorld = loadWorldCoords(SITE_DIR_E01, 'Cahaya_Map_');
  // PurpleCity도 로드
  const purpleWorld = loadWorldCoords(SITE_DIR_BASE, 'PurpleCity_Map_');
  // PurpleCity2도 E01에서 로드
  const purple2World = loadWorldCoords(SITE_DIR_E01, 'PurpleCity2_Map_');

  console.log(`  Gangnam: ${Object.keys(gangnamWorld).length}, RedCity: ${Object.keys(redcityWorld).length}, Cahaya: ${Object.keys(cahayaWorld).length}, PurpleCity: ${Object.keys(purpleWorld).length}`);

  // 캘리브레이션: 기존 수동 배치(positions.json)와 월드 좌표 매칭
  function buildPairs(cityPositions, worldMap) {
    const pairs = [];
    for (const [siteId, mapPos] of Object.entries(cityPositions)) {
      const world = worldMap[siteId];
      if (world) {
        pairs.push({ id: siteId, mx: mapPos.x, my: mapPos.y, wx: world.x, wy: world.y });
      }
    }
    return pairs;
  }

  const gangnamPairs = buildPairs(positions.Gangnam || {}, gangnamWorld);
  const redcityPairs = buildPairs(positions.RedCity || {}, redcityWorld);
  const cahayaPairs = buildPairs(positions.Cahaya || {}, cahayaWorld);

  console.log(`  캘리브레이션 포인트 — Gangnam: ${gangnamPairs.length}, RedCity: ${redcityPairs.length}, Cahaya: ${cahayaPairs.length}`);

  // 아핀 변환 fitting
  const gangnamTransform = fitAffine(gangnamPairs);
  const redcityTransform = fitAffine(redcityPairs);
  const cahayaTransform = fitAffine(cahayaPairs);

  console.log(`  Gangnam fit: ${gangnamTransform.usedCount}/${gangnamTransform.totalCount}`);
  console.log(`  RedCity fit: ${redcityTransform.usedCount}/${redcityTransform.totalCount}`);
  console.log(`  Cahaya fit: ${cahayaTransform.usedCount}/${cahayaTransform.totalCount}`);

  // 전체 사이트에 좌표 적용
  const result = { Gangnam: {}, RedCity: {}, Cahaya: {} };
  let generated = 0, skipped = 0;

  for (const site of sites) {
    const id = site.id;
    const city = site.city;
    let world = null;
    let transform = null;

    if (city === 'Gangnam') {
      world = gangnamWorld[id];
      transform = gangnamTransform;
    } else if (city === 'RedCity') {
      world = redcityWorld[id];
      transform = redcityTransform;
    } else if (city === 'Cahaya') {
      world = cahayaWorld[id] || purpleWorld[id] || purple2World[id];
      transform = cahayaTransform;
    }

    if (world && transform) {
      const mapPos = applyAffine(transform, world.x, world.y);
      result[city][id] = mapPos;
      generated++;
    } else {
      skipped++;
    }
  }

  console.log(`\n결과: ${generated}개 좌표 생성, ${skipped}개 스킵 (월드 좌표 없음)`);
  for (const city of ['Gangnam', 'RedCity', 'Cahaya']) {
    console.log(`  ${city}: ${Object.keys(result[city]).length}개`);
  }

  // 저장
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`\n${OUTPUT_PATH} 저장 완료`);
}

main();
