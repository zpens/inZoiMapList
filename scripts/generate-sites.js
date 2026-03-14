#!/usr/bin/env node
/**
 * generate-sites.js
 *
 * Site.json + Blue_Data.po → data/sites.json 자동 생성 스크립트
 *
 * 사용법:
 *   node scripts/generate-sites.js
 *   node scripts/generate-sites.js --dry-run   (파일 쓰지 않고 diff만 출력)
 *
 * 데이터 소스:
 *   - E:\Project\LEBEN\Main\BlueClient2\Content\Data\JsonResult\Site.json
 *   - E:\Project\LEBEN\Main\BlueClient2\Content\Localization\Blue_Data\ko\Blue_Data.po
 *   - E:\Project\LEBEN\Main\BlueClient2\Content\Data\JsonResult\SiteDetailInfo.json
 */

const fs = require('fs');
const path = require('path');

// ─── 경로 설정 ───────────────────────────────────────────────
const JSONRESULT_BASE = 'E:/Project/LEBEN/Main/BlueClient2/Content/Data/JsonResult';
const JSONRESULT_E01 = 'E:/Project/LEBEN/Main/BlueClient2/Plugins/GameFeatures/E01/Content/Data/JsonResult';
const LOCALIZATION_PO = 'E:/Project/LEBEN/Main/BlueClient2/Content/Localization/Blue_Data/ko/Blue_Data.po';
const LOCALIZATION_E01_PO = 'E:/Project/LEBEN/Main/BlueClient2/Content/Localization/DLC_E01/ko/DLC_E01.po';
const SITES_JSON_PATH = path.resolve(__dirname, '../data/sites.json');

// ─── 필터링 설정 ─────────────────────────────────────────────

// 앱에서 사용하는 SiteType만 포함
const VALID_SITE_TYPES = new Set(['Residence', 'Public', 'Business', 'Override']);

// 제외할 ID 패턴 (테스트, Company 등)
const EXCLUDE_PATTERNS = [
  /^Company_/,           // 회사 내부 레벨
  /^Gangnam_Business_SBTest/,  // 자영업 테스트
  /^MiniRedCity_/,       // 미니 레드시티 테스트 부지
  /^PurpleCity2_/,       // PurpleCity2 중복 (PurpleCity만 사용)
];

// ─── 유틸 ─────────────────────────────────────────────────────

/** UTF-16LE BOM이 있는 JSON 파일 읽기 */
function readJsonResult(filePath) {
  const buf = fs.readFileSync(filePath);
  let str;
  if (buf[0] === 0xFF && buf[1] === 0xFE) {
    str = buf.toString('utf16le').replace(/^\uFEFF/, '');
  } else {
    str = buf.toString('utf8').replace(/^\uFEFF/, '');
  }
  return JSON.parse(str);
}

/** PO 파일에서 ST_Site 텍스트 맵 구축: textId → msgid(한글) */
function parsePO(poPath) {
  const content = fs.readFileSync(poPath, 'utf8');
  const map = {};
  const blocks = content.split(/\n(?=#\. Key:)/);
  for (const block of blocks) {
    const ctxMatch = block.match(/msgctxt\s+"ST_Site,([^"]+)"/);
    const msgMatch = block.match(/msgid\s+"([^"]*)"/);
    if (ctxMatch && msgMatch) {
      map[ctxMatch[1]] = msgMatch[1];
    }
  }
  return map;
}

/** Site ID에서 도시 추출 */
function deriveCity(id) {
  if (id.startsWith('Gangnam_')) return 'Gangnam';
  if (id.startsWith('RedCity_')) return 'RedCity';
  if (id.startsWith('MiniRedCity_')) return 'RedCity';
  if (id.startsWith('PurpleCity')) return 'Cahaya';
  if (id.startsWith('Cahaya_')) return 'Cahaya';
  return '';
}

/** 신규 사이트의 icon을 추론 */
function deriveIcon(site) {
  const d = site.DefaultInfo;
  const id = site.Id;

  // OverrideIconId가 있으면 그대로 사용
  if (d.OverrideIconId && d.OverrideIconId !== 'None') {
    return d.OverrideIconId;
  }

  // ID 패턴 기반
  if (id.includes('_Lobby')) return 'Lobby';

  // Tags 기반
  const tags = d.Tags || [];
  if (tags.includes('Temple')) return 'Temple';
  if (tags.includes('FishingShop') || id.includes('Fishing')) return 'Fishing';
  if (tags.includes('Swimwear_Keep') || tags.includes('RandomParty_Swimming')) {
    if (id.includes('Muscle') || id.includes('Gym')) return 'Sports';
    return 'Beach';
  }
  if (tags.includes('MuscleBeach') || id.includes('Gym') || id.includes('Basketball') || id.includes('Volleyball')) return 'Sports';
  if (tags.includes('RabbitHole') && id.includes('School')) return 'School';
  if (id.includes('Cemetery') || id.includes('Funeral')) return 'Cemetery';
  if (id.includes('Livestage') || id.includes('Stage')) return 'Stage';
  if (id.includes('Pier') || id.includes('Dock')) return 'Dock';
  if (id.includes('Flight') || id.includes('Airport')) return 'Flight';
  if (id.includes('Beach')) return 'Beach';
  if (id.includes('Park') || tags.includes('SiteTag_Park')) return 'Park';

  // SiteType 기반 기본값
  if (d.SiteType === 'Residence') return 'House';
  if (d.SiteType === 'Public') return 'Park';

  // BusinessSite (빈 부지)
  if (id.match(/BusinessSite\d+$/)) return 'HouseholdBiz';

  // Business/Override 기본
  return '';
}

// ─── 메인 ─────────────────────────────────────────────────────

function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('데이터 로딩...');

  // 1. Site.json + Site_E01.json 읽기 (E01 = 차하야/Cahaya DLC)
  const baseSiteData = readJsonResult(path.join(JSONRESULT_BASE, 'Site.json'));
  const e01SiteData = readJsonResult(path.join(JSONRESULT_E01, 'Site_E01.json'));
  // E01 데이터로 base를 덮어쓰기 (Cahaya 사이트는 E01이 원본)
  const baseMap = new Map(baseSiteData.map(s => [s.Id, s]));
  for (const s of e01SiteData) { baseMap.set(s.Id, s); }
  const rawSiteData = [...baseMap.values()];
  console.log(`  Site.json: ${baseSiteData.length}개 + Site_E01.json: ${e01SiteData.length}개 → 병합: ${rawSiteData.length}개`);

  // 2. PO 파일 파싱 (필터링에서 사용하므로 먼저 로드) — base + E01 병합
  const textMap = parsePO(LOCALIZATION_PO);
  const e01TextMap = parsePO(LOCALIZATION_E01_PO);
  Object.assign(textMap, e01TextMap);
  console.log(`  Blue_Data.po + DLC_E01.po: ${Object.keys(textMap).length}개 텍스트`);

  // 3. 필터링: 유효 SiteType + 제외 패턴
  const siteData = rawSiteData.filter(site => {
    const type = site.DefaultInfo.SiteType;
    if (!VALID_SITE_TYPES.has(type)) return false;
    if (EXCLUDE_PATTERNS.some(p => p.test(site.Id))) return false;
    if (!deriveCity(site.Id)) return false;
    // "(None)사용하지 않음" 등 미사용 표시된 사이트 제외
    const name = textMap[site.DefaultInfo.NameTextId] || '';
    if (name.includes('사용하지 않음')) return false;
    return true;
  });
  console.log(`  필터링 후: ${siteData.length}개 (${rawSiteData.length - siteData.length}개 제외)`);

  // 4. SiteDetailInfo 읽기 (residentMax/Min) — base + E01 병합
  const detailInfoArr = readJsonResult(path.join(JSONRESULT_BASE, 'SiteDetailInfo.json'));
  const detailInfoE01 = readJsonResult(path.join(JSONRESULT_E01, 'SiteDetailInfo_E01.json'));
  const detailInfoMap = {};
  detailInfoArr.forEach(d => { detailInfoMap[d.Id] = d; });
  detailInfoE01.forEach(d => { detailInfoMap[d.Id] = d; });
  console.log(`  SiteDetailInfo: ${detailInfoArr.length}개 + E01: ${detailInfoE01.length}개`);

  // 5. Site 레벨 파일에서 층수 제한 로드 (floorLevelLimit)
  const floorLimitMap = {};
  const siteLevelDirs = [
    { dir: path.join(JSONRESULT_BASE, 'Site'), prefixes: ['Gangnam_Map_', 'RedCity_Map_', 'PurpleCity_Map_'] },
    { dir: path.join(JSONRESULT_E01, 'Site'), prefixes: ['Cahaya_Map_', 'PurpleCity2_Map_'] },
  ];
  for (const { dir, prefixes } of siteLevelDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    for (const prefix of prefixes) {
      for (const f of files.filter(f => f.startsWith(prefix))) {
        try {
          const d = readJsonResult(path.join(dir, f));
          if (d.siteId && d.floorLevelLimit) {
            floorLimitMap[d.siteId] = {
              maxFloor: d.floorLevelLimit.y || 0,
              bFirstFloorLocked: d.bFirstFloorLocked || false,
              bBasementsLocked: d.bBasementsLocked || false,
            };
          }
        } catch (e) {}
      }
    }
  }
  console.log(`  층수 제한 데이터: ${Object.keys(floorLimitMap).length}개`);

  // 6. 기존 sites.json 읽기 (icon/addedDate 보존용)
  let existingSites = [];
  const existingMap = {};
  if (fs.existsSync(SITES_JSON_PATH)) {
    existingSites = JSON.parse(fs.readFileSync(SITES_JSON_PATH, 'utf8'));
    existingSites.forEach(s => { existingMap[s.id] = s; });
    console.log(`  기존 sites.json: ${existingSites.length}개 항목`);
  }

  // 6. 변환
  console.log('\n변환 중...');
  const results = [];
  const warnings = [];

  for (const site of siteData) {
    const d = site.DefaultInfo;
    const id = site.Id;
    const city = deriveCity(id);

    // 한글 텍스트 조회
    const name = textMap[d.NameTextId] || '';
    const displayType = textMap[d.DisplayType_TextId] || '';
    const description = textMap[d.DescriptionTextId] || '';
    const operatingHours = textMap[d.OperatingHoursTextId] || '';

    if (!name) {
      warnings.push(`이름 없음: ${id} (TextId: ${d.NameTextId})`);
    }

    // residentMax/Min from SiteDetailInfo
    const detailId = (d.SiteDetailInfoId && d.SiteDetailInfoId !== 'None') ? d.SiteDetailInfoId : '';
    const detail = detailInfoMap[detailId];
    let residentMax = null;
    let residentMin = null;
    if (detail && detail.ResidentMaxCount > 0) {
      residentMax = detail.ResidentMaxCount;
      residentMin = detail.ResidentMinCount;
    }

    // icon: 기존 값 보존, 없으면 추론
    const existing = existingMap[id];
    const icon = existing ? existing.icon : deriveIcon(site);

    // 층수 제한 (Site 레벨 파일에서)
    const floorInfo = floorLimitMap[id];
    const maxFloor = floorInfo ? floorInfo.maxFloor : null;

    const entry = {
      id,
      name,
      city,
      siteType: d.SiteType,
      siteSubType: d.SiteSubType,
      displayType,
      sizeX: d.Size.X,
      sizeY: d.Size.Y,
      standardizedSize: d.StandardizedSize || '',
      price: d.Price,
      description,
      bizAllowed: d.bAllowHouseholdBiz,
      detailId,
      residentMax,
      residentMin,
      operatingHours,
      disabled: d.bDisabled,
      devOnly: d.bDevOnly,
      icon,
      maxFloor
    };

    // 기존에 addedDate가 있었으면 보존
    if (existing?.addedDate) {
      entry.addedDate = existing.addedDate;
    }

    results.push(entry);
  }

  // 7. 기존 sites.json에만 있는 항목 유지 (수동 추가 항목: Bus, MiniRedCity 등)
  const generatedIds = new Set(results.map(s => s.id));
  const manualEntries = existingSites.filter(s => !generatedIds.has(s.id));
  if (manualEntries.length > 0) {
    console.log(`\n  수동 항목 유지 (${manualEntries.length}개):`);
    manualEntries.forEach(s => {
      console.log(`    ~ ${s.id} (${s.name})`);
      results.push(s);
    });
  }

  // 8. 정렬 (city → siteType → id 순)
  const cityOrder = { Gangnam: 0, RedCity: 1, Cahaya: 2 };
  const typeOrder = { Residence: 0, Business: 1, Public: 2, Override: 3, Bus: 4 };
  results.sort((a, b) => {
    const c = (cityOrder[a.city] ?? 9) - (cityOrder[b.city] ?? 9);
    if (c !== 0) return c;
    const t = (typeOrder[a.siteType] ?? 9) - (typeOrder[b.siteType] ?? 9);
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });

  // 9. 리포트
  console.log('\n결과:');
  console.log(`  총 ${results.length}개 사이트`);

  const byCityType = {};
  results.forEach(s => {
    const key = `${s.city}/${s.siteType}`;
    byCityType[key] = (byCityType[key] || 0) + 1;
  });
  Object.entries(byCityType).sort().forEach(([k, v]) => console.log(`    ${k}: ${v}`));

  // 신규/삭제 비교
  const newIds = new Set(results.map(s => s.id));
  const oldIds = new Set(existingSites.map(s => s.id));
  const added = results.filter(s => !oldIds.has(s.id));
  const removed = existingSites.filter(s => !newIds.has(s.id));

  if (added.length > 0) {
    console.log(`\n  신규 추가 (${added.length}개):`);
    added.forEach(s => console.log(`    + ${s.id} (${s.name || '이름없음'})`));
  }
  if (removed.length > 0) {
    console.log(`\n  제거됨 (${removed.length}개):`);
    removed.forEach(s => console.log(`    - ${s.id} (${s.name || '이름없음'})`));
  }

  // 변경된 필드 비교
  let changedCount = 0;
  const changedDetails = [];
  for (const s of results) {
    const old = existingMap[s.id];
    if (!old) continue;
    const diffs = [];
    for (const key of ['name', 'siteType', 'siteSubType', 'displayType', 'sizeX', 'sizeY',
      'standardizedSize', 'price', 'description', 'bizAllowed', 'detailId',
      'residentMax', 'residentMin', 'operatingHours', 'disabled', 'devOnly']) {
      if (JSON.stringify(s[key]) !== JSON.stringify(old[key])) {
        diffs.push(`${key}: ${JSON.stringify(old[key])} -> ${JSON.stringify(s[key])}`);
      }
    }
    if (diffs.length > 0) {
      changedCount++;
      changedDetails.push({ id: s.id, diffs });
    }
  }
  if (changedDetails.length > 0) {
    console.log(`\n  변경 (${changedCount}개):`);
    changedDetails.slice(0, 30).forEach(({ id, diffs }) => {
      console.log(`    ${id}:`);
      diffs.forEach(d => console.log(`      ${d}`));
    });
    if (changedCount > 30) console.log(`    ... 외 ${changedCount - 30}개`);
  }

  if (warnings.length > 0) {
    console.log(`\n경고 (${warnings.length}개):`);
    warnings.slice(0, 30).forEach(w => console.log(`  ${w}`));
    if (warnings.length > 30) console.log(`  ... 외 ${warnings.length - 30}개`);
  }

  // 10. 저장
  if (!dryRun) {
    fs.writeFileSync(SITES_JSON_PATH, JSON.stringify(results, null, 2) + '\n', 'utf8');
    console.log(`\n${SITES_JSON_PATH} 저장 완료`);
  } else {
    console.log('\n--dry-run 모드: 파일을 저장하지 않았습니다.');
  }
}

main();
