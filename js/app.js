// ============ VERSION / CHANGELOG ============
const APP_VERSION = '1.3.1';
const CHANGELOG = [
  { ver: '1.3.1', date: '2026-03-04', changes: [
    '통계 세부항목에 부지 ID 컬럼 추가',
  ] },
  { ver: '1.3.0', date: '2026-03-04', changes: [
    '통계 부지유형 그룹 테이블에 규격부지/비규격 행 추가',
  ] },
  { ver: '1.2.0', date: '2026-03-04', changes: [
    '통계 그룹 기준에 "규격 여부" 추가 (규격/비규격 그룹 분류)',
    '통계 세부항목 크기·가격·프리셋 컬럼 정렬 수정',
  ] },
  { ver: '1.1.0', date: '2026-03-04', changes: [
    '규격 부지 필터 추가 (📐 규격 칩으로 표준 규격 부지만 모아보기)',
  ] },
  { ver: '1.0.0', date: '2026-03-03', changes: [
    '버전 정보 모달 추가',
    '프리셋 ID 상세 뷰에 표시',
    '한국어 IME 입력 버그 수정',
    '통계 대시보드 추가',
    '메모 기능 (이미지 첨부 포함)',
    '지도 이미지 저장/불러오기',
    '다중 도시 지원 (도원, 블리스베이, 차하야)',
    '부지 배치 및 위치 공유',
  ] },
];

// ============ DATA (loaded from JSON files) ============
let SITES_DATA = [];
let PRESET_DATA = {};
let DETAIL_EXTRA = {};
let SITE_IMAGES = {};
let MEMOS_DATA = { Gangnam: [], RedCity: [], Cahaya: [] };


// ============ STATE ============
const state = {
  currentCity: 'Gangnam',
  sites: SITES_DATA,
  filters: new Set(['all']),
  search: '',
  selectedSiteId: null,
  placingId: null,
  // Map state per city
  maps: {}, // { cityName: { imageData, positions: { siteId: {x,y} }, panX, panY, zoom } }
  zoom: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  panStart: {x:0,y:0},
  isDraggingSite: false,
  dragSiteId: null,
  dragOffset: {x:0,y:0},
  // Stats
  statsMode: false,
  statsGroupBy: 'siteType',
  statsCityFilter: 'all',
  statsSortKey: 'count',
  statsSortDir: 'desc',
  statsSelectedGroup: null,
  detailSortKey: 'name',
  detailSortDir: 'asc',
  detailSearch: ''
};

// Init maps state
['Gangnam','RedCity','Cahaya'].forEach(c => {
  state.maps[c] = { imageData: null, positions: {}, panX: 0, panY: 0, zoom: 1 };
});

// ============ IndexedDB for large data (map images) ============
const IDB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('inzoi_maps', 1);
      req.onupgradeneeded = e => { e.target.result.createObjectStore('images'); };
      req.onsuccess = e => { IDB.db = e.target.result; resolve(); };
      req.onerror = e => { console.warn('IndexedDB failed', e); resolve(); };
    });
  },
  async saveImage(key, data) {
    if (!IDB.db) return;
    return new Promise((resolve) => {
      const tx = IDB.db.transaction('images', 'readwrite');
      tx.objectStore('images').put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },
  async loadImage(key) {
    if (!IDB.db) return null;
    return new Promise((resolve) => {
      const tx = IDB.db.transaction('images', 'readonly');
      const req = tx.objectStore('images').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  },
  async deleteImage(key) {
    if (!IDB.db) return;
    return new Promise((resolve) => {
      const tx = IDB.db.transaction('images', 'readwrite');
      tx.objectStore('images').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
};

// Load saved position/view data (small, fits localStorage)
try {
  const saved = localStorage.getItem('inzoi_map_data_v2');
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed.maps) {
      Object.keys(parsed.maps).forEach(c => {
        if (state.maps[c]) {
          state.maps[c].positions = parsed.maps[c].positions || {};
          state.maps[c].panX = parsed.maps[c].panX || 0;
          state.maps[c].panY = parsed.maps[c].panY || 0;
          state.maps[c].zoom = parsed.maps[c].zoom || 1;
        }
      });
    }
  }
} catch(e) { console.warn('Failed to load saved data', e); }

// Load images from IndexedDB after init
async function loadImagesFromDB() {
  await IDB.open();
  for (const c of ['Gangnam','RedCity','Cahaya']) {
    const img = await IDB.loadImage('map_' + c);
    if (img) state.maps[c].imageData = img;
  }
  loadMapForCity();
}

// ============ DOM ============
const $ = id => document.getElementById(id);
const canvasArea = $('canvasArea');
const canvasContainer = $('canvasContainer');
const mapImage = $('mapImage');
const siteListEl = $('siteList');
const detailContent = $('detailContent');
const detailEmpty = $('detailEmpty');
const modeIndicator = $('modeIndicator');
const toast_el = $('toast');
const contextMenu = $('contextMenu');

// ============ HELPERS ============
function toast(msg) {
  toast_el.textContent = msg;
  toast_el.classList.add('show');
  setTimeout(() => toast_el.classList.remove('show'), 2000);
}

function formatPrice(p) {
  if (!p || p <= 1) return '-';
  return '₦ ' + p.toLocaleString();
}

function currentMap() { return state.maps[state.currentCity]; }

function getFilteredSites() {
  const filters = state.filters;
  const hasStdFilter = filters.has('Standard');
  // For type checking, treat as 'all' if 'all' is set or only 'Standard' remains
  const typeFilters = new Set([...filters].filter(f => f !== 'Standard' && f !== 'all' && f !== 'Memo'));
  const isAll = filters.has('all') || typeFilters.size === 0;
  const q = state.search ? state.search.toLowerCase() : '';

  // Sites: include if 'all' or matching siteType is selected, plus optional standard-size filter
  const sites = state.sites.filter(s => {
    if (s.city !== state.currentCity) return false;
    if (!isAll && !typeFilters.has(s.siteType)) return false;
    if (hasStdFilter && !isStdSize(s)) return false;
    if (q && !s.name.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q) && !(s.displayType||'').toLowerCase().includes(q)) return false;
    return true;
  });

  // Memos: include if 'all' or 'Memo' is selected (but not when Standard filter is active)
  let memos = [];
  if (!hasStdFilter && (isAll || filters.has('Memo'))) {
    memos = (MEMOS_DATA[state.currentCity] || []).slice();
    if (q) memos = memos.filter(m => m.name.toLowerCase().includes(q) || (m.description||'').toLowerCase().includes(q));
  }

  return sites.concat(memos);
}

function saveState() {
  try {
    const data = { maps: {} };
    Object.keys(state.maps).forEach(c => {
      data.maps[c] = {
        positions: state.maps[c].positions,
        panX: state.maps[c].panX,
        panY: state.maps[c].panY,
        zoom: state.maps[c].zoom
        // imageData NOT included — stored in IndexedDB
      };
    });
    localStorage.setItem('inzoi_map_data_v2', JSON.stringify(data));
  } catch(e) { console.warn('Save failed', e); }
}

function saveMapImage(city) {
  const imgData = state.maps[city].imageData;
  if (imgData) IDB.saveImage('map_' + city, imgData);
  else IDB.deleteImage('map_' + city);
}

// ============ RENDER SITE LIST ============
function renderSiteList() {
  const items = getFilteredSites();
  const positions = currentMap().positions;
  let html = '';
  // Show "add memo" button when Memo filter is active (not when Standard filter is active)
  if (!state.filters.has('Standard') && (state.filters.has('all') || state.filters.has('Memo'))) {
    html += '<div class="memo-add-btn" onclick="addMemo()">+ 메모 추가</div>';
  }
  items.forEach(item => {
    const isMemo = item.id.startsWith('memo_');
    const placed = positions[item.id] ? ' placed' : '';
    const selected = state.selectedSiteId === item.id ? ' selected' : '';
    if (isMemo) {
      html += `<div class="site-item${placed}${selected}" data-id="${item.id}">
        <div class="site-dot Memo" style="font-size:14px;width:auto;height:auto;background:none">📝</div>
        <div class="site-info">
          <div class="site-name">${item.name}</div>
          <div class="site-meta">메모 · ${new Date(item.createdAt).toLocaleDateString('ko')}</div>
        </div>
        ${placed ? '<span class="site-badge">배치됨</span>' : ''}
        <div class="memo-delete" onclick="event.stopPropagation();deleteMemo('${item.id}')" title="삭제">✕</div>
      </div>`;
    } else {
      html += `<div class="site-item${placed}${selected}" data-id="${item.id}">
        <div class="site-dot ${item.siteType}" style="font-size:14px;width:auto;height:auto;background:none">${getIcon(item)}</div>
        <div class="site-info">
          <div class="site-name">${item.name}</div>
          <div class="site-meta">${item.displayType || item.siteType} · ${item.sizeX}×${item.sizeY}</div>
        </div>
        ${placed ? '<span class="site-badge">배치됨</span>' : ''}
      </div>`;
    }
  });
  siteListEl.innerHTML = html;
  $('siteCount').textContent = items.length + '개';
  const allCitySites = state.sites.filter(s => s.city === state.currentCity);
  const placedN = Object.keys(positions).length;
  $('placedCount').textContent = '배치: ' + placedN + '개';
  $('unplacedCount').textContent = '미배치: ' + (allCitySites.length - placedN) + '개';
}

// ============ RENDER DETAIL ============
function renderDetail(siteId) {
  // Check if it's a memo
  const memo = findMemo(siteId);
  if (memo) { renderMemoDetail(memo); return; }
  const s = state.sites.find(x => x.id === siteId);
  if (!s) { detailContent.style.display='none'; detailEmpty.style.display='flex'; return; }
  detailEmpty.style.display='none';
  detailContent.style.display='block';
  const pos = currentMap().positions[s.id];
  const desc = (s.description || '').replace(/_x000D_\\n/g, '<br>').replace(/\* /g, '• ');
  // Build candidate image paths (try multiple patterns)
  const imgCandidates = [];
  if (SITE_IMAGES[s.id]) imgCandidates.push('img/' + SITE_IMAGES[s.id].replace(/'/g,'') + '.PNG');
  imgCandidates.push('img/MapImage_' + s.id + '.PNG');
  // For lobby sites, try parent site image
  const parentId = s.id.replace(/_Lobby$/,'').replace(/_lobby$/,'');
  if (parentId !== s.id) imgCandidates.push('img/MapImage_' + parentId + '.PNG');
  
  const siteImgHtml = `<div class="site-thumb-wrap" id="siteThumb"><img id="siteThumbImg" src="${imgCandidates[0]}" style="width:100%;height:180px;object-fit:cover;display:block" onerror="tryNextThumb(this)"></div>`;
  // Store candidates for fallback
  window._thumbCandidates = imgCandidates;
  window._thumbIdx = 0;
  detailContent.innerHTML = `
    ${siteImgHtml}
    <div class="detail-header">
      <span class="detail-type-badge ${s.siteType}">${getIcon(s)} ${s.siteType}</span>
      <div class="detail-title">${s.name}</div>
      <div class="detail-id">${s.id}</div>
    </div>
    <div class="detail-section">
      <h3>기본 정보</h3>
      <div class="detail-grid">
        <div class="detail-field"><label>아이콘</label><value style="font-size:18px">${getIcon(s)} ${s.icon || '-'}</value></div>
        <div class="detail-field"><label>표시 유형</label><value>${s.displayType || '-'}</value></div>
        <div class="detail-field"><label>서브타입</label><value>${s.siteSubType}</value></div>
        <div class="detail-field"><label>크기 (X×Y)</label><value>${s.sizeX} × ${s.sizeY}${isStdSize(s) ? ' <span style="color:var(--accent);font-size:10px;font-weight:600;margin-left:4px">규격</span>' : ''}</value></div>
        <div class="detail-field"><label>표준 크기</label><value>${s.standardizedSize || '-'}</value></div>
        <div class="detail-field"><label>가격</label><value>${formatPrice(s.price)}</value></div>
        <div class="detail-field"><label>자영업 허용</label><value>${s.bizAllowed ? '✅ 가능' : '❌ 불가'}</value></div>
        ${s.residentMax ? `<div class="detail-field"><label>최소 거주</label><value>${s.residentMin}명</value></div>
        <div class="detail-field"><label>최대 거주</label><value>${s.residentMax}명</value></div>` : ''}
        ${s.operatingHours ? `<div class="detail-field" style="grid-column:1/-1"><label>운영 시간</label><value>${s.operatingHours}</value></div>` : ''}
        ${s.detailId ? `<div class="detail-field"><label>상세 ID</label><value>${s.detailId}</value></div>` : ''}
      </div>
    </div>
    ${desc ? `<div class="detail-section"><h3>설명</h3><div class="detail-desc">${desc}</div></div>` : ''}
    ${PRESET_DATA[s.id] ? `<div class="detail-section"><h3>🏗️ 건축 프리셋 (${PRESET_DATA[s.id].length}종)</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${PRESET_DATA[s.id].map((p,i) => `<div style="background:var(--bg);border-radius:6px;overflow:hidden;text-align:center"><img src="img/BuildPreset_${p}.PNG" alt="#${i+1}" style="width:100%;height:90px;object-fit:cover;display:block" onerror="this.style.display='none'"><div style="padding:3px 4px;font-size:10px;color:var(--text2)">${p}</div></div>`).join('')}</div></div>` : ''}
    ${s.detailId && DETAIL_EXTRA[s.detailId] && DETAIL_EXTRA[s.detailId].requiredObjects.length > 0 ? `<div class="detail-section"><h3>📦 필수 오브젝트</h3><div style="display:flex;flex-direction:column;gap:4px">${DETAIL_EXTRA[s.detailId].requiredObjects.map(o => `<div style="background:var(--bg);padding:4px 8px;border-radius:4px;font-size:11px;display:flex;justify-content:space-between"><span>${o.id}</span>${o.count ? `<span style="color:var(--accent)">×${o.count}</span>` : ''}</div>`).join('')}</div></div>` : ''}
    ${pos ? `<div class="detail-section"><h3>배치 위치</h3><div class="detail-grid">
      <div class="detail-field"><label>X</label><value>${Math.round(pos.x)}</value></div>
      <div class="detail-field"><label>Y</label><value>${Math.round(pos.y)}</value></div>
    </div></div>` : ''}
    <div class="detail-actions">
      ${!pos ? `<button class="btn btn-accent" onclick="startPlacing('${s.id}')">📌 지도에 배치</button>` : `<button class="btn" onclick="startPlacing('${s.id}')">📍 위치 이동</button><button class="btn" onclick="removePlacement('${s.id}')" style="color:#ef4444">🗑️ 배치 해제</button>`}
    </div>
  `;
}

// ============ ICON MAPPING ============
const ICON_EMOJI = {
  Building:'🏢', Shop:'🛒', Food:'🍽️', Play:'🎮', Bus:'🚌', Public:'🌳',
  House:'🏠', Lobby:'🚪', Park:'🌳', Beach:'🏖️', Cemetery:'⚰️', Temple:'⛩️',
  Fishing:'🎣', HouseholdBiz:'💼', Sports:'🏋️', Stage:'🎤', School:'🏫'
};
// Thumbnail fallback: try next candidate path on error
function tryNextThumb(img) {
  window._thumbIdx++;
  if (window._thumbIdx < window._thumbCandidates.length) {
    img.src = window._thumbCandidates[window._thumbIdx];
  } else {
    // All candidates failed, hide the container
    img.parentElement.style.display = 'none';
  }
}

function getIcon(s) {
  if (s.icon && ICON_EMOJI[s.icon]) return ICON_EMOJI[s.icon];
  // fallback by siteType
  const fallback = {Residence:'🏠',Business:'🏢',Public:'🌳',Override:'⭐'};
  return fallback[s.siteType] || '📍';
}

// ============ RENDER MAP SITES ============
function renderMapSites() {
  document.querySelectorAll('.placed-site').forEach(el => el.remove());
  const positions = currentMap().positions;
  const filtered = new Set(getFilteredSites().map(s=>s.id));
  const isFiltered = !state.filters.has('all') || state.filters.has('Standard');
  Object.keys(positions).forEach(id => {
    const s = state.sites.find(x=>x.id===id);
    const memo = !s ? findMemo(id) : null;
    if (!s && !memo) return;
    const pos = positions[id];
    const pinClass = memo ? 'Memo' : (s.icon || s.siteType);
    const el = document.createElement('div');
    el.className = `placed-site pin-${pinClass}`;
    if (state.selectedSiteId === id) el.classList.add('selected-on-map');
    if (!filtered.has(id)) el.style.opacity = '0.15';
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    const iconEmoji = memo ? '📝' : getIcon(s);
    const name = memo ? memo.name : s.name;
    // Always-visible label when filtered
    const showLabel = isFiltered && filtered.has(id);
    const labelHtml = showLabel
      ? `<div class="pin-label-fixed">${name}${s ? ` <span style="font-size:9px;opacity:.7">${s.sizeX}×${s.sizeY}</span>` : ''}</div>`
      : '';
    el.innerHTML = `<div class="pin-head">${iconEmoji}</div><div class="pin-tail"></div>${labelHtml}`;
    el.dataset.id = id;
    el.dataset.name = name;
    if (s) el.dataset.size = `${s.sizeX}×${s.sizeY}`;
    canvasContainer.appendChild(el);
  });
  // Re-apply counter-scale for zoom > 1
  const m = currentMap();
  if (m.zoom > 1) {
    const pinScale = 1 / m.zoom;
    document.querySelectorAll('.placed-site').forEach(el => {
      el.style.scale = pinScale;
    });
  }
}

// ============ ZOOM / PAN ============
function applyTransform() {
  const m = currentMap();
  canvasContainer.style.transform = `translate(${m.panX}px,${m.panY}px) scale(${m.zoom})`;
  $('zoomInfo').textContent = Math.round(m.zoom * 100) + '%';
  // Pin size fixed when zoom > 1: apply counter-scale
  const pinScale = m.zoom > 1 ? 1 / m.zoom : 1;
  document.querySelectorAll('.placed-site').forEach(el => {
    el.style.scale = pinScale;
  });
}

function zoomTo(newZoom, cx, cy) {
  const m = currentMap();
  const oldZoom = m.zoom;
  newZoom = Math.max(0.1, Math.min(5, newZoom));
  if (!cx) { cx = canvasArea.clientWidth/2; cy = canvasArea.clientHeight/2; }
  const wx = (cx - m.panX) / oldZoom;
  const wy = (cy - m.panY) / oldZoom;
  m.zoom = newZoom;
  m.panX = cx - wx * newZoom;
  m.panY = cy - wy * newZoom;
  applyTransform();
}

// Mouse wheel zoom
canvasArea.addEventListener('wheel', e => {
  // Don't intercept wheel events when stats dashboard is visible
  if (state.statsMode) return;
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  const rect = canvasArea.getBoundingClientRect();
  zoomTo(currentMap().zoom * factor, e.clientX - rect.left, e.clientY - rect.top);
}, {passive:false});

const PAN_STEP = 100;
$('panUp').onclick = () => { currentMap().panY += PAN_STEP; applyTransform(); saveState(); };
$('panDown').onclick = () => { currentMap().panY -= PAN_STEP; applyTransform(); saveState(); };
$('panLeft').onclick = () => { currentMap().panX += PAN_STEP; applyTransform(); saveState(); };
$('panRight').onclick = () => { currentMap().panX -= PAN_STEP; applyTransform(); saveState(); };

function fitToView() {
  const m = currentMap();
  const areaW = canvasArea.clientWidth;
  const areaH = canvasArea.clientHeight;
  if (!areaW || !areaH) return;

  let contentW = 0, contentH = 0;
  let offsetX = 0, offsetY = 0;

  // Always fit to placed sites if any exist
  const positions = m.positions;
  const ids = Object.keys(positions);
  if (ids.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach(id => {
      const p = positions[id];
      const s = state.sites.find(x => x.id === id);
      const w = s ? Math.max(s.sizeX * 0.6, 16) : 20;
      const h = s ? Math.max(s.sizeY * 0.6, 12) : 16;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + w);
      maxY = Math.max(maxY, p.y + h);
    });
    contentW = maxX - minX;
    contentH = maxY - minY;
    offsetX = minX;
    offsetY = minY;
  } else if (mapImage.naturalWidth && mapImage.style.display !== 'none') {
    // No placed sites — fall back to map image size
    contentW = mapImage.naturalWidth;
    contentH = mapImage.naturalHeight;
  }

  // Fallback if nothing to fit
  if (contentW <= 0 || contentH <= 0) {
    m.zoom = 1; m.panX = 0; m.panY = 0;
    applyTransform();
    return;
  }

  // Calculate zoom to fit with padding
  const padding = 60;
  const scaleX = (areaW - padding * 2) / contentW;
  const scaleY = (areaH - padding * 2) / contentH;
  m.zoom = Math.min(scaleX, scaleY, 3);
  m.zoom = Math.max(m.zoom, 0.05);

  // Center the content (offset accounts for sites not starting at 0,0)
  m.panX = (areaW - contentW * m.zoom) / 2 - offsetX * m.zoom;
  m.panY = (areaH - contentH * m.zoom) / 2 - offsetY * m.zoom;

  applyTransform();
  saveState();
}

$('zoomFit').onclick = fitToView;

// Map opacity control
$('mapOpacity').addEventListener('input', e => {
  const val = e.target.value;
  mapImage.style.opacity = val / 100;
  $('opacityValue').textContent = val + '%';
});

// Pin tooltip (fixed position, avoids overflow clipping)
const pinTooltip = document.createElement('div');
pinTooltip.className = 'pin-tooltip';
document.body.appendChild(pinTooltip);

canvasArea.addEventListener('mouseover', e => {
  const pin = e.target.closest('.placed-site');
  if (pin && pin.dataset.name && state.filters.has('all')) {
    const size = pin.dataset.size;
    pinTooltip.textContent = size ? `${pin.dataset.name}  ${size}` : pin.dataset.name;
    pinTooltip.classList.add('show');
  }
});
canvasArea.addEventListener('mouseout', e => {
  const pin = e.target.closest('.placed-site');
  if (pin) pinTooltip.classList.remove('show');
});
canvasArea.addEventListener('mousemove', e => {
  if (pinTooltip.classList.contains('show')) {
    pinTooltip.style.left = (e.clientX + 12) + 'px';
    pinTooltip.style.top = (e.clientY - 8) + 'px';
  }
});

// Pan with middle mouse button (wheel click)
canvasArea.addEventListener('mousedown', e => {
  // Middle button (1) = pan
  if (e.button === 1) {
    e.preventDefault();
    state.isPanning = true;
    state.panStart = { x: e.clientX - currentMap().panX, y: e.clientY - currentMap().panY };
    canvasArea.classList.add('dragging');
    return;
  }
  // Left button (0)
  if (e.button !== 0) return;
  if (state.placingId) return;
  // Check if clicking on a placed site — drag it
  const siteEl = e.target.closest('.placed-site');
  if (siteEl) {
    const id = siteEl.dataset.id;
    const m = currentMap();
    const pos = m.positions[id];
    if (pos) {
      state.isDraggingSite = true;
      state.dragSiteId = id;
      const rect = canvasArea.getBoundingClientRect();
      const mx = (e.clientX - rect.left - m.panX) / m.zoom;
      const my = (e.clientY - rect.top - m.panY) / m.zoom;
      state.dragOffset = { x: mx - pos.x, y: my - pos.y };
      siteEl.classList.add('dragging-site');
      selectSite(id);
    }
    return;
  }
});

canvasArea.addEventListener('mousemove', e => {
  if (state.isDraggingSite) {
    const m = currentMap();
    const rect = canvasArea.getBoundingClientRect();
    const mx = (e.clientX - rect.left - m.panX) / m.zoom;
    const my = (e.clientY - rect.top - m.panY) / m.zoom;
    m.positions[state.dragSiteId] = { x: mx - state.dragOffset.x, y: my - state.dragOffset.y };
    renderMapSites();
    return;
  }
  if (state.isPanning) {
    const m = currentMap();
    m.panX = e.clientX - state.panStart.x;
    m.panY = e.clientY - state.panStart.y;
    applyTransform();
  }
});

window.addEventListener('mouseup', e => {
  if (state.isDraggingSite) {
    state.isDraggingSite = false;
    state.dragSiteId = null;
    saveState();
    renderSiteList();
    if (state.selectedSiteId) renderDetail(state.selectedSiteId);
  }
  if (state.isPanning) {
    state.isPanning = false;
    canvasArea.classList.remove('dragging');
    saveState();
  }
});

// Click on canvas to place site
canvasArea.addEventListener('click', e => {
  if (state.placingId && !e.target.closest('.placed-site') && !e.target.closest('.zoom-controls')) {
    const m = currentMap();
    const rect = canvasArea.getBoundingClientRect();
    const x = (e.clientX - rect.left - m.panX) / m.zoom;
    const y = (e.clientY - rect.top - m.panY) / m.zoom;
    m.positions[state.placingId] = { x, y };
    const id = state.placingId;
    stopPlacing();
    saveState();
    renderMapSites();
    renderSiteList();
    selectSite(id);
    toast('부지가 배치되었습니다');
  }
  // Click placed site
  const siteEl = e.target.closest('.placed-site');
  if (siteEl && !state.placingId) {
    selectSite(siteEl.dataset.id);
  }
});

// Right click context menu (only on placed sites)
canvasArea.addEventListener('contextmenu', e => {
  e.preventDefault(); // always prevent default to allow right-drag panning
  const siteEl = e.target.closest('.placed-site');
  if (siteEl && !state.isPanning) {
    const id = siteEl.dataset.id;
    selectSite(id);
    contextMenu.style.display = 'block';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    $('ctxMoveSite').onclick = () => { contextMenu.style.display='none'; startPlacing(id); };
    $('ctxRemoveSite').onclick = () => { contextMenu.style.display='none'; removePlacement(id); };
  }
});
document.addEventListener('click', () => { contextMenu.style.display='none'; });

// URL auto-link helper
function linkifyText(text) {
  if (!text) return '';
  return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="memo-link">$1</a>');
}

// ============ MEMO FUNCTIONS ============
function findMemo(id) {
  if (!id || !id.startsWith('memo_')) return null;
  const memos = MEMOS_DATA[state.currentCity] || [];
  return memos.find(m => m.id === id) || null;
}

function renderMemoDetail(memo) {
  detailEmpty.style.display = 'none';
  detailContent.style.display = 'block';
  const pos = currentMap().positions[memo.id];
  const images = memo.images || [];
  const imagesHtml = images.length > 0
    ? `<div class="memo-images">${images.map((img, i) => `<div class="memo-img-wrap"><img src="${img}" class="memo-img"><div class="memo-img-del" onclick="deleteMemoImage('${memo.id}',${i})">✕</div></div>`).join('')}</div>`
    : '';
  detailContent.innerHTML = `
    <div class="detail-header">
      <span class="detail-type-badge Memo">📝 메모</span>
      <div class="detail-title">${memo.name}</div>
      <div class="detail-id">${memo.id}</div>
    </div>
    <div class="memo-form" id="memoForm">
      <label style="font-size:12px;color:var(--text2)">제목</label>
      <input type="text" id="memoName" value="${memo.name.replace(/"/g,'&quot;')}" placeholder="메모 제목">
      ${imagesHtml}
      <div class="memo-paste-hint">📋 이미지를 Ctrl+V로 붙여넣기 가능</div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <label style="font-size:12px;color:var(--text2)">설명</label>
        <span class="memo-edit-toggle" onclick="toggleMemoEdit()">${memo.description ? '편집' : '작성'}</span>
      </div>
      <textarea id="memoDesc" rows="6" placeholder="상세 설명을 입력하세요..." style="display:${memo.description ? 'none' : 'block'}">${memo.description || ''}</textarea>
      <div id="memoPreview" class="memo-preview" style="display:${memo.description ? 'block' : 'none'};cursor:pointer" onclick="toggleMemoEdit()">${memo.description ? linkifyText(memo.description.replace(/</g,'&lt;').replace(/>/g,'&gt;')).replace(/\n/g,'<br>') : ''}</div>
      <div style="font-size:11px;color:var(--text2)">생성: ${new Date(memo.createdAt).toLocaleString('ko')}</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" onclick="saveMemoDetail('${memo.id}')" style="flex:1">💾 저장</button>
        <button class="btn" onclick="deleteMemo('${memo.id}')" style="color:#ef4444">🗑️ 삭제</button>
      </div>
    </div>
    ${pos ? `<div class="detail-section" style="padding:0 16px"><h3>배치 위치</h3><div class="detail-grid">
      <div class="detail-field"><label>X</label><value>${Math.round(pos.x)}</value></div>
      <div class="detail-field"><label>Y</label><value>${Math.round(pos.y)}</value></div>
    </div></div>` : ''}
    <div class="detail-actions">
      ${!pos ? `<button class="btn btn-accent" onclick="startPlacing('${memo.id}')">📌 지도에 배치</button>` : `<button class="btn" onclick="startPlacing('${memo.id}')">📍 위치 이동</button><button class="btn" onclick="removePlacement('${memo.id}')" style="color:#ef4444">🗑️ 배치 해제</button>`}
    </div>
  `;
  // Attach paste listener for images
  const memoForm = $('memoForm');
  if (memoForm) {
    memoForm.addEventListener('paste', e => handleMemoPaste(e, memo.id));
  }
}

function addMemo() {
  const id = 'memo_' + Date.now();
  const memo = {
    id,
    name: '새 메모',
    city: state.currentCity,
    description: '',
    createdAt: new Date().toISOString()
  };
  if (!MEMOS_DATA[state.currentCity]) MEMOS_DATA[state.currentCity] = [];
  MEMOS_DATA[state.currentCity].push(memo);
  saveMemos();
  renderSiteList();
  selectSite(id);
  toast('메모가 추가되었습니다');
}

function resizeImage(dataUrl, maxSize) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w <= maxSize && h <= maxSize) { resolve(dataUrl); return; }
      if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
      else { w = Math.round(w * maxSize / h); h = maxSize; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = dataUrl;
  });
}

function handleMemoPaste(e, memoId) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = async ev => {
        const resized = await resizeImage(ev.target.result, 800);
        const memo = findMemo(memoId);
        if (!memo) return;
        if (!memo.images) memo.images = [];
        memo.images.push(resized);
        saveMemos();
        renderMemoDetail(memo);
        toast('이미지가 추가되었습니다');
      };
      reader.readAsDataURL(file);
      break;
    }
  }
}

function deleteMemoImage(memoId, idx) {
  const memo = findMemo(memoId);
  if (!memo || !memo.images) return;
  memo.images.splice(idx, 1);
  saveMemos();
  renderMemoDetail(memo);
  toast('이미지가 삭제되었습니다');
}

function toggleMemoEdit() {
  const ta = $('memoDesc');
  const pv = $('memoPreview');
  if (!ta || !pv) return;
  const editing = ta.style.display !== 'none';
  if (editing) {
    // Switch to preview
    const text = ta.value.trim();
    pv.innerHTML = text ? linkifyText(text.replace(/</g,'&lt;').replace(/>/g,'&gt;')).replace(/\n/g,'<br>') : '<span style="color:var(--text2)">클릭하여 설명 작성...</span>';
    ta.style.display = 'none';
    pv.style.display = 'block';
  } else {
    // Switch to edit
    ta.style.display = 'block';
    pv.style.display = 'none';
    ta.focus();
  }
}

function deleteMemo(id) {
  const memos = MEMOS_DATA[state.currentCity] || [];
  const idx = memos.findIndex(m => m.id === id);
  if (idx === -1) return;
  memos.splice(idx, 1);
  // Remove from map if placed
  delete currentMap().positions[id];
  saveMemos();
  saveState();
  state.selectedSiteId = null;
  renderSiteList();
  renderDetail(null);
  renderMapSites();
  toast('메모가 삭제되었습니다');
}

function saveMemoDetail(id) {
  const memo = findMemo(id);
  if (!memo) return;
  const nameEl = $('memoName');
  const descEl = $('memoDesc');
  if (nameEl) memo.name = nameEl.value.trim() || '새 메모';
  if (descEl) memo.description = descEl.value.trim();
  saveMemos();
  renderSiteList();
  renderMapSites();
  toast('메모가 저장되었습니다');
}

async function saveMemos() {
  try {
    const res = await fetch('/save-memos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MEMOS_DATA)
    });
    if (!res.ok) {
      console.warn('메모 서버 저장 실패');
    }
  } catch (err) {
    console.warn('메모 서버 저장 실패:', err);
  }
}

// ============ PLACE / REMOVE ============
function startPlacing(id) {
  state.placingId = id;
  canvasArea.classList.add('placing');
  modeIndicator.style.display = 'block';
  const s = state.sites.find(x=>x.id===id);
  const memo = findMemo(id);
  const name = s ? s.name : (memo ? memo.name : id);
  modeIndicator.textContent = `📌 "${name}" 배치 중 - 지도를 클릭하세요 (ESC 취소)`;
  if (isMobile()) switchMobileTab('map');
}

function stopPlacing() {
  state.placingId = null;
  canvasArea.classList.remove('placing');
  modeIndicator.style.display = 'none';
}

function removePlacement(id) {
  delete currentMap().positions[id];
  saveState();
  renderMapSites();
  renderSiteList();
  if (state.selectedSiteId === id) renderDetail(id);
  toast('배치가 해제되었습니다');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') stopPlacing();
});

// ============ SELECT SITE ============
function selectSite(id) {
  state.selectedSiteId = id;
  renderSiteList();
  renderDetail(id);
  renderMapSites();
  // Scroll list to selected
  const el = siteListEl.querySelector(`[data-id="${id}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
  // Mobile: auto-switch to detail tab
  if (isMobile() && id) switchMobileTab('detail');
}

// Pan map so that a placed site is centered on screen
function panToSite(id) {
  const m = currentMap();
  const pos = m.positions[id];
  if (!pos) return;
  const areaW = canvasArea.clientWidth;
  const areaH = canvasArea.clientHeight;
  m.panX = areaW / 2 - pos.x * m.zoom;
  m.panY = areaH / 2 - pos.y * m.zoom;
  applyTransform();
}

// Site list click — select only
siteListEl.addEventListener('click', e => {
  const item = e.target.closest('.site-item');
  if (item) {
    selectSite(item.dataset.id);
  }
});
// Double click to place
siteListEl.addEventListener('dblclick', e => {
  const item = e.target.closest('.site-item');
  if (item) startPlacing(item.dataset.id);
});

// ============ CITY TABS ============
document.querySelectorAll('.city-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.city-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    if (tab.dataset.city === 'Stats') {
      state.statsMode = true;
      showStats();
      return;
    }

    state.statsMode = false;
    hideStats();
    state.currentCity = tab.dataset.city;
    state.selectedSiteId = null;
    loadMapForCity();
    renderSiteList();
    renderDetail(null);
    renderMapSites();
    // Auto fit: wait for image to load if present
    if (currentMap().imageData) {
      if (mapImage.complete && mapImage.naturalWidth) { fitToView(); }
      else { mapImage.onload = () => { fitToView(); }; }
    } else {
      const m = currentMap();
      m.zoom = 1; m.panX = 0; m.panY = 0;
      applyTransform();
    }
  });
});

// ============ FILTERS ============
function updateFilterChips() {
  document.querySelectorAll('.filter-chip').forEach(c => {
    c.classList.toggle('active', state.filters.has(c.dataset.type));
  });
}
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const type = chip.dataset.type;
    if (type === 'all') {
      // 'all' clicked: reset everything including Standard
      state.filters.clear();
      state.filters.add('all');
    } else if (type === 'Standard') {
      // Standard toggles independently as a cross-cutting filter
      if (state.filters.has('Standard')) {
        state.filters.delete('Standard');
      } else {
        state.filters.add('Standard');
      }
      // Ensure at least 'all' or a type filter remains
      const remaining = [...state.filters].filter(f => f !== 'Standard');
      if (remaining.length === 0) state.filters.add('all');
    } else {
      // Toggle specific type
      state.filters.delete('all');
      if (state.filters.has(type)) {
        state.filters.delete(type);
      } else {
        state.filters.add(type);
      }
      // If no type/memo filters remain, revert to 'all' (keep Standard if present)
      const remaining = [...state.filters].filter(f => f !== 'Standard');
      if (remaining.length === 0) state.filters.add('all');
    }
    updateFilterChips();
    renderSiteList();
    renderMapSites();
  });
});
$('searchInput').addEventListener('input', e => {
  state.search = e.target.value;
  renderSiteList();
  renderMapSites();
});

// ============ MAP IMAGE ============
function loadMapForCity() {
  const m = currentMap();
  if (m.imageData) {
    mapImage.src = m.imageData;
    mapImage.style.display = 'block';
    mapImage.style.opacity = $('mapOpacity').value / 100;
    $('mapPlaceholder').style.display = 'none';
  } else {
    mapImage.style.display = 'none';
    $('mapPlaceholder').style.display = 'block';
  }
}

function handleMapUpload(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => {
    const m = currentMap();
    m.imageData = e.target.result;
    loadMapForCity();
    saveMapImage(state.currentCity);
    saveState();
    $('uploadOverlay').classList.remove('active');
    // Auto fit after image loads
    mapImage.onload = () => { fitToView(); };
    toast('지도 이미지가 업로드되었습니다');
  };
  reader.readAsDataURL(file);
}

$('btnUploadMap').onclick = () => $('uploadOverlay').classList.toggle('active');
$('uploadBox').onclick = () => $('mapFileInput').click();
$('mapFileInput').onchange = e => { if (e.target.files[0]) handleMapUpload(e.target.files[0]); };

// Drag & drop on canvas
canvasArea.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
canvasArea.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleMapUpload(file);
});
// Drop on overlay
$('uploadOverlay').addEventListener('dragover', e => { e.preventDefault(); });
$('uploadOverlay').addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleMapUpload(file);
});
// Click outside upload box closes overlay
$('uploadOverlay').addEventListener('click', e => {
  if (e.target === $('uploadOverlay')) $('uploadOverlay').classList.remove('active');
});

// ============ VERSION MODAL ============
$('headerTitle').onclick = () => {
  const overlay = $('versionOverlay');
  // Render current version
  $('versionCurrent').innerHTML = `현재 버전: <strong>v${APP_VERSION}</strong>`;
  // Render changelog
  $('versionLog').innerHTML = CHANGELOG.map(entry => `
    <div class="version-entry">
      <div class="version-entry-head">
        <span class="version-entry-ver">v${entry.ver}</span>
        <span class="version-entry-date">${entry.date}</span>
      </div>
      <ul>${entry.changes.map(c => `<li>${c}</li>`).join('')}</ul>
    </div>
  `).join('');
  overlay.classList.add('active');
};
$('versionClose').onclick = () => $('versionOverlay').classList.remove('active');
$('versionOverlay').addEventListener('click', e => {
  if (e.target === $('versionOverlay')) $('versionOverlay').classList.remove('active');
});

// ============ EXPORT / IMPORT ============

// Save positions to server (shared with everyone)
$('btnSavePositions').onclick = async () => {
  const positions = {};
  Object.keys(state.maps).forEach(c => {
    positions[c] = state.maps[c].positions;
  });
  try {
    toast('위치 데이터 저장 중...');
    const res = await fetch('/save-positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(positions)
    });
    const result = await res.json();
    if (res.ok) {
      toast('위치가 저장되었습니다! (30초 후 배포 반영)');
    } else {
      toast('저장 실패: ' + (result.error || '알 수 없는 오류'));
    }
  } catch (err) {
    toast('저장 실패: 서버에 연결할 수 없습니다');
    console.error(err);
  }
};

// Save map images to local file
$('btnSaveImages').onclick = () => {
  const data = { version: 2, maps: {} };
  let hasImage = false;
  Object.keys(state.maps).forEach(c => {
    if (state.maps[c].imageData) {
      data.maps[c] = { imageData: state.maps[c].imageData };
      hasImage = true;
    }
  });
  if (!hasImage) { toast('저장된 지도 이미지가 없습니다'); return; }
  const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inzoi_map_images_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  toast('지도 이미지가 다운로드되었습니다');
};

// Full backup export (local download)
$('btnExport').onclick = () => {
  const data = { version: 2, maps: {} };
  Object.keys(state.maps).forEach(c => {
    data.maps[c] = {
      positions: state.maps[c].positions
    };
    if (state.maps[c].imageData) {
      data.maps[c].imageData = state.maps[c].imageData;
    }
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inzoi_map_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  toast('전체 백업이 다운로드되었습니다');
};

$('btnImport').onclick = () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.maps) {
          for (const c of Object.keys(data.maps)) {
            if (state.maps[c]) {
              state.maps[c].positions = data.maps[c].positions || {};
              if (data.maps[c].imageData) {
                state.maps[c].imageData = data.maps[c].imageData;
                await IDB.saveImage('map_' + c, data.maps[c].imageData);
              }
            }
          }
          saveState();
          loadMapForCity();
          renderSiteList();
          renderMapSites();
          toast('데이터를 불러왔습니다');
        }
      } catch(err) { toast('파일 형식이 올바르지 않습니다'); }
    };
    reader.readAsText(file);
  };
  inp.click();
};

// ============ STATS DASHBOARD ============
const STATS_GROUP_OPTIONS = [
  { value: 'siteType', label: '부지 유형' },
  { value: 'isStandard', label: '규격 여부' },
  { value: 'displayType', label: '표시 타입' },
  { value: 'icon', label: '아이콘' },
  { value: 'standardizedSize', label: '표준 크기' },
  { value: 'city', label: '도시별' }
];
const STATS_CITY_OPTIONS = [
  { value: 'all', label: '전체 도시' },
  { value: 'Gangnam', label: '도원' },
  { value: 'RedCity', label: '블리스베이' },
  { value: 'Cahaya', label: '차하야' }
];
const CITY_LABEL = { Gangnam: '도원', RedCity: '블리스베이', Cahaya: '차하야' };
const TYPE_LABEL = { Residence: '주거', Business: '비즈니스', Public: '공용', Bus: '버스', Override: '오버라이드' };

const STANDARD_SIZES = [[30,20],[40,30],[50,40],[60,50],[70,60],[80,40],[80,70]];
function isStdSize(s) {
  return STANDARD_SIZES.some(([w,h]) => (s.sizeX===w && s.sizeY===h) || (s.sizeX===h && s.sizeY===w));
}

function showStats() {
  $('statsDashboard').style.display = 'flex';
  renderStats();
}
function hideStats() {
  const d = $('statsDashboard');
  d.style.cssText = '';
  d.style.display = 'none';
  state.statsSelectedGroup = null;
}

function statsAvg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function renderStats() {
  const dashboard = $('statsDashboard');
  const groupBy = state.statsGroupBy;
  const cityFilter = state.statsCityFilter;
  const sortKey = state.statsSortKey;
  const sortDir = state.statsSortDir;

  // Filter sites
  let sites = state.sites;
  if (cityFilter !== 'all') sites = sites.filter(s => s.city === cityFilter);

  // Gather positions
  const allPositions = {};
  Object.keys(state.maps).forEach(c => {
    if (cityFilter === 'all' || cityFilter === c) {
      Object.assign(allPositions, state.maps[c].positions);
    }
  });

  // Drill-down view
  if (state.statsSelectedGroup) {
    const drillGroupBy = state.statsSelectedGroup.overrideGroupBy || groupBy;
    renderStatsDetail(dashboard, sites, allPositions, state.statsSelectedGroup, drillGroupBy);
    return;
  }

  // Summary stats
  const totalCount = sites.length;
  const totalArea = sites.reduce((sum, s) => sum + (s.sizeX || 0) * (s.sizeY || 0), 0);
  const pricedSites = sites.filter(s => s.price > 1);
  const avgPrice = pricedSites.length ? Math.round(statsAvg(pricedSites.map(s => s.price))) : 0;
  const placedCount = sites.filter(s => allPositions[s.id]).length;
  const stdCount = sites.filter(s => isStdSize(s)).length;
  const sitesWithPresets = sites.filter(s => PRESET_DATA[s.id]?.length).length;
  const totalPresets = sites.reduce((sum, s) => sum + (PRESET_DATA[s.id]?.length || 0), 0);
  const resCount = sites.filter(s => s.siteType === 'Residence').length;
  const bizCount = sites.filter(s => s.siteType === 'Business').length;
  const pubCount = sites.filter(s => s.siteType === 'Public').length;

  // Group
  const groups = {};
  sites.forEach(s => {
    const rawKey = groupBy === 'isStandard' ? (isStdSize(s) ? 'standard' : 'nonstandard') : (s[groupBy] || '(없음)');
    let key = rawKey;
    if (groupBy === 'city') key = CITY_LABEL[rawKey] || rawKey;
    else if (groupBy === 'siteType') key = TYPE_LABEL[rawKey] || rawKey;
    else if (groupBy === 'isStandard') key = rawKey === 'standard' ? '📐 규격' : '비규격';
    if (!groups[key]) groups[key] = { name: key, rawKey, count: 0, area: 0, prices: [], placed: 0, sizes: [], std: 0, presets: 0 };
    const g = groups[key];
    g.count++;
    const area = (s.sizeX || 0) * (s.sizeY || 0);
    g.area += area;
    g.sizes.push(area);
    if (s.price > 1) g.prices.push(s.price);
    if (allPositions[s.id]) g.placed++;
    if (isStdSize(s)) g.std++;
    g.presets += (PRESET_DATA[s.id]?.length || 0);
  });

  // Sort
  let rows = Object.values(groups);
  const maxCount = Math.max(...rows.map(r => r.count), 1);
  rows.sort((a, b) => {
    let va, vb;
    if (sortKey === 'name') { va = a.name; vb = b.name; return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1); }
    if (sortKey === 'count') { va = a.count; vb = b.count; }
    else if (sortKey === 'area') { va = a.area; vb = b.area; }
    else if (sortKey === 'avgArea') { va = a.count ? a.area / a.count : 0; vb = b.count ? b.area / b.count : 0; }
    else if (sortKey === 'avgPrice') { va = statsAvg(a.prices); vb = statsAvg(b.prices); }
    else if (sortKey === 'placed') { va = a.placed; vb = b.placed; }
    else if (sortKey === 'presets') { va = a.presets; vb = b.presets; }
    else { va = a.count; vb = b.count; }
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  // Sort indicator helper
  const sc = (key) => sortKey === key ? (sortDir === 'asc' ? ' sorted-asc' : ' sorted-desc') : '';

  // Controls HTML
  const groupOptions = STATS_GROUP_OPTIONS.map(o =>
    `<option value="${o.value}"${o.value === groupBy ? ' selected' : ''}>${o.label}</option>`
  ).join('');
  const cityOptions = STATS_CITY_OPTIONS.map(o =>
    `<option value="${o.value}"${o.value === cityFilter ? ' selected' : ''}>${o.label}</option>`
  ).join('');

  // Table row helper
  const buildRow = (r, maxC) => {
    const avgArea = r.count ? Math.round(r.area / r.count) : 0;
    const avgP = r.prices.length ? Math.round(statsAvg(r.prices)) : 0;
    const pctW = Math.round(r.count / maxC * 100);
    return `<tr style="cursor:pointer" data-rawkey="${r.rawKey}" ${r.groupByOverride ? `data-groupby="${r.groupByOverride}"` : ''}>
      <td><div class="stats-bar-cell"><span style="font-size:10px;color:var(--accent);margin-right:6px;flex-shrink:0">▶</span><span class="stats-bar-fill" style="width:${pctW}%"></span>${r.name}</div></td>
      <td class="num">${r.count}</td>
      <td class="num">${r.area.toLocaleString()}</td>
      <td class="num">${avgArea.toLocaleString()}</td>
      <td class="num">${avgP ? '₦' + avgP.toLocaleString() : '-'}</td>
      <td class="num">${r.std ? `<span style="color:var(--accent)">${r.std}</span>` : '-'}</td>
      <td class="num">${r.presets || '-'}</td>
    </tr>`;
  };
  const tableRows = rows.map(r => buildRow(r, maxCount)).join('');

  // Build virtual "규격부지" rows when groupBy is siteType
  let stdExtraRows = '';
  if (groupBy === 'siteType') {
    const stdSites = sites.filter(s => isStdSize(s));
    const nonStdSites = sites.filter(s => !isStdSize(s));
    const buildVirtual = (list, name, rawKey) => {
      const r = { name, rawKey, groupByOverride: 'isStandard', count: list.length, area: 0, prices: [], placed: 0, std: 0, presets: 0 };
      list.forEach(s => {
        r.area += (s.sizeX||0)*(s.sizeY||0);
        if (s.price > 1) r.prices.push(s.price);
        if (allPositions[s.id]) r.placed++;
        if (isStdSize(s)) r.std++;
        r.presets += (PRESET_DATA[s.id]?.length || 0);
      });
      return r;
    };
    const stdRow = buildVirtual(stdSites, '📐 규격부지', 'standard');
    const nonStdRow = buildVirtual(nonStdSites, '비규격', 'nonstandard');
    const virtMax = Math.max(stdRow.count, nonStdRow.count, 1);
    stdExtraRows = `<tr><td colspan="7" style="padding:2px 10px;border-bottom:2px solid var(--accent);opacity:.5;font-size:10px;color:var(--text2)">규격 여부</td></tr>` +
      buildRow(stdRow, virtMax) + buildRow(nonStdRow, virtMax);
  }

  dashboard.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:16px;font-weight:700">📊 부지 통계</h2>
      <div class="stats-controls">
        <span class="stats-label">그룹:</span>
        <select class="stats-select" id="statsGroupBy">${groupOptions}</select>
        <span class="stats-label">도시:</span>
        <select class="stats-select" id="statsCityFilter">${cityOptions}</select>
      </div>
    </div>
    <div class="stats-cards">
      <div class="stats-card"><div class="stats-card-value">${totalCount}</div><div class="stats-card-label">총 부지</div></div>
      <div class="stats-card"><div class="stats-card-value">${totalArea.toLocaleString()}</div><div class="stats-card-label">총 면적</div></div>
      <div class="stats-card"><div class="stats-card-value">${avgPrice ? '₦' + avgPrice.toLocaleString() : '-'}</div><div class="stats-card-label">평균 가격</div></div>
      <div class="stats-card"><div class="stats-card-value" style="color:var(--accent)">${stdCount}</div><div class="stats-card-label">📐 규격 부지</div></div>
      <div class="stats-card"><div class="stats-card-value">${sitesWithPresets}</div><div class="stats-card-label">🏗️ 프리셋 보유</div></div>
      <div class="stats-card"><div class="stats-card-value">${totalPresets}</div><div class="stats-card-label">🏗️ 총 프리셋 수</div></div>
      <div class="stats-card res"><div class="stats-card-value">${resCount}</div><div class="stats-card-label">🏠 주거</div></div>
      <div class="stats-card biz"><div class="stats-card-value">${bizCount}</div><div class="stats-card-label">🏢 비즈니스</div></div>
      <div class="stats-card pub"><div class="stats-card-value">${pubCount}</div><div class="stats-card-label">🌳 공용</div></div>
    </div>
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead><tr>
          <th data-sort="name" class="${sc('name')}">그룹</th>
          <th data-sort="count" class="${sc('count')}">개수</th>
          <th data-sort="area" class="${sc('area')}">총면적</th>
          <th data-sort="avgArea" class="${sc('avgArea')}">평균면적</th>
          <th data-sort="avgPrice" class="${sc('avgPrice')}">평균가격</th>
          <th>규격</th>
          <th data-sort="presets" class="${sc('presets')}">프리셋</th>
        </tr></thead>
        <tbody>${tableRows}${stdExtraRows}</tbody>
        <tfoot><tr style="font-weight:600;background:var(--panel)">
          <td>합계</td>
          <td class="num">${totalCount}</td>
          <td class="num">${totalArea.toLocaleString()}</td>
          <td class="num">${totalCount ? Math.round(totalArea / totalCount).toLocaleString() : 0}</td>
          <td class="num">${avgPrice ? '₦' + avgPrice.toLocaleString() : '-'}</td>
          <td class="num" style="color:var(--accent)">${stdCount}</td>
          <td class="num">${totalPresets}</td>
        </tr></tfoot>
      </table>
    </div>
  `;

  // Bind control events
  $('statsGroupBy').addEventListener('change', e => {
    state.statsGroupBy = e.target.value;
    state.statsSelectedGroup = null;
    renderStats();
  });
  $('statsCityFilter').addEventListener('change', e => {
    state.statsCityFilter = e.target.value;
    state.statsSelectedGroup = null;
    renderStats();
  });
  // Table header sort
  dashboard.querySelectorAll('.stats-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.statsSortKey === key) {
        state.statsSortDir = state.statsSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.statsSortKey = key;
        state.statsSortDir = key === 'name' ? 'asc' : 'desc';
      }
      renderStats();
    });
  });
  // Group row click → drill-down
  dashboard.querySelectorAll('.stats-table tbody tr[data-rawkey]').forEach(tr => {
    tr.addEventListener('click', () => {
      const rawKey = tr.dataset.rawkey;
      const name = tr.querySelector('td')?.textContent?.replace('▶', '').trim() || rawKey;
      const overrideGroupBy = tr.dataset.groupby || null;
      state.statsSelectedGroup = { rawKey, name, overrideGroupBy };
      renderStats();
    });
  });
}

function renderStatsDetail(dashboard, sites, allPositions, group, groupBy) {
  const cityFilter = state.statsCityFilter;
  const showCity = cityFilter === 'all';

  // Shared: filter+sort rows → HTML string
  const buildRows = () => {
    const q = state.detailSearch.trim().toLowerCase();
    const sk = state.detailSortKey;
    const sd = state.detailSortDir;
    const filtered = sites.filter(s => {
      if (groupBy === 'isStandard') {
        if (group.rawKey === 'standard' ? !isStdSize(s) : isStdSize(s)) return false;
      } else if ((s[groupBy] || '(없음)') !== group.rawKey) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
    });
    filtered.sort((a, b) => {
      let va, vb;
      if (sk === 'name') return sd === 'asc' ? a.name.localeCompare(b.name, 'ko') : b.name.localeCompare(a.name, 'ko');
      if (sk === 'id') return sd === 'asc' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
      if (sk === 'city') { va = CITY_LABEL[a.city]||a.city; vb = CITY_LABEL[b.city]||b.city; return sd === 'asc' ? va.localeCompare(vb,'ko') : vb.localeCompare(va,'ko'); }
      if (sk === 'size') { va = (a.sizeX||0)*(a.sizeY||0); vb = (b.sizeX||0)*(b.sizeY||0); }
      else if (sk === 'price') { va = a.price||0; vb = b.price||0; }
      else if (sk === 'presets') { va = PRESET_DATA[a.id]?.length||0; vb = PRESET_DATA[b.id]?.length||0; }
      return sd === 'asc' ? va - vb : vb - va;
    });
    return filtered.map(s => {
      const presets = PRESET_DATA[s.id]?.length || 0;
      const stdBadge = isStdSize(s) ? `<span style="color:var(--accent);font-size:10px;font-weight:600;margin-left:4px">규격</span>` : '';
      const cityTd = showCity ? `<td>${CITY_LABEL[s.city]||s.city}</td>` : '';
      return `<tr style="cursor:pointer" data-id="${s.id}"><td>${s.name}</td><td style="font-size:10px;color:var(--text2)">${s.id}</td>${cityTd}<td class="num" style="white-space:nowrap">${s.sizeX} × ${s.sizeY}${stdBadge}</td><td class="num" style="white-space:nowrap">${s.price>1?'₦'+s.price.toLocaleString():'-'}</td><td class="num">${presets||'-'}</td></tr>`;
    }).join('');
  };

  // Bind row click events
  const bindRows = () => {
    dashboard.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => { state.selectedSiteId = tr.dataset.id; renderDetail(tr.dataset.id); });
    });
  };

  const sc = (key) => state.detailSortKey === key ? (state.detailSortDir === 'asc' ? ' sorted-asc' : ' sorted-desc') : '';
  const cityHeader = showCity ? `<th data-sort="city" class="${sc('city')}" style="cursor:pointer">도시</th>` : '';
  const cityOptions = STATS_CITY_OPTIONS.map(o => `<option value="${o.value}"${o.value===cityFilter?' selected':''}>${o.label}</option>`).join('');

  // Full render
  dashboard.style.cssText = 'position:absolute;inset:0;background:var(--bg);z-index:20;overflow:hidden;';
  dashboard.innerHTML = `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;padding:20px;gap:12px;overflow:hidden;box-sizing:border-box;">
      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:12px">
          <button id="statsDrillBack" style="padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;font-size:12px;font-family:inherit;">← 뒤로</button>
          <h2 style="font-size:16px;font-weight:700">${group.name}</h2>
        </div>
        <div class="stats-controls">
          <input id="detailSearch" type="text" placeholder="부지명 또는 ID 검색..." value="${state.detailSearch}"
            style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:12px;font-family:inherit;outline:none;width:200px;">
          <span class="stats-label">도시:</span>
          <select class="stats-select" id="detailCityFilter">${cityOptions}</select>
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;min-height:0;">
        <table class="stats-table">
          <thead><tr>
            <th data-sort="name" class="${sc('name')}" style="cursor:pointer">부지명</th>
            <th data-sort="id" class="${sc('id')}" style="cursor:pointer">ID</th>
            ${cityHeader}
            <th data-sort="size" class="${sc('size')}" style="cursor:pointer;width:100px;text-align:right">크기</th>
            <th data-sort="price" class="${sc('price')}" style="cursor:pointer;width:100px;text-align:right">가격</th>
            <th data-sort="presets" class="${sc('presets')}" style="cursor:pointer;width:70px;text-align:right">프리셋</th>
          </tr></thead>
          <tbody>${buildRows()}</tbody>
        </table>
      </div>
    </div>
  `;
  bindRows();

  document.getElementById('statsDrillBack').addEventListener('click', () => {
    dashboard.style.cssText = '';
    state.statsSelectedGroup = null;
    state.detailSortKey = 'name';
    state.detailSortDir = 'asc';
    state.detailSearch = '';
    renderStats();
  });

  // Search: tbody만 교체 → input 요소 유지 → 한글 IME 정상 작동
  document.getElementById('detailSearch').addEventListener('input', e => {
    state.detailSearch = e.target.value;
    const tbody = dashboard.querySelector('tbody');
    if (tbody) { tbody.innerHTML = buildRows(); bindRows(); }
  });

  document.getElementById('detailCityFilter').addEventListener('change', e => {
    state.statsCityFilter = e.target.value;
    renderStats();
  });

  // Header sort
  dashboard.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.detailSortKey === key) {
        state.detailSortDir = state.detailSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.detailSortKey = key;
        state.detailSortDir = key === 'name' || key === 'city' ? 'asc' : 'desc';
      }
      renderStats();
    });
  });
}

// ============ MOBILE ============
function isMobile() { return window.innerWidth <= 768; }

function switchMobileTab(panel) {
  const tabBar = $('mobileTabBar');
  if (!tabBar) return;
  tabBar.querySelectorAll('.mobile-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.panel === panel);
  });
  document.querySelector('.left-panel').classList.toggle('mobile-show', panel === 'list');
  document.querySelector('.right-panel').classList.toggle('mobile-show', panel === 'detail');
  document.querySelector('.header-controls').classList.toggle('mobile-show', panel === 'menu');
}

// Tab bar clicks
const mobileTabBar = $('mobileTabBar');
if (mobileTabBar) {
  mobileTabBar.addEventListener('click', e => {
    const tab = e.target.closest('.mobile-tab');
    if (!tab) return;
    switchMobileTab(tab.dataset.panel);
  });
}

// Back button in detail panel
$('btnBackToList').addEventListener('click', () => {
  if (isMobile()) switchMobileTab('list');
});

// ============ TOUCH PAN / ZOOM ============
let touchStartX = 0, touchStartY = 0, touchPanStartX = 0, touchPanStartY = 0;
let touchZoomDist = 0;
let isTouchPanning = false;

canvasArea.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    const m = currentMap();
    touchPanStartX = m.panX;
    touchPanStartY = m.panY;
    isTouchPanning = true;
  } else if (e.touches.length === 2) {
    isTouchPanning = false;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    touchZoomDist = Math.hypot(dx, dy);
  }
}, { passive: false });

canvasArea.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 1 && isTouchPanning) {
    const m = currentMap();
    m.panX = touchPanStartX + (e.touches[0].clientX - touchStartX);
    m.panY = touchPanStartY + (e.touches[0].clientY - touchStartY);
    applyTransform();
  } else if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    if (touchZoomDist > 0) {
      const scale = dist / touchZoomDist;
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = canvasArea.getBoundingClientRect();
      zoomTo(currentMap().zoom * scale, cx - rect.left, cy - rect.top);
      touchZoomDist = dist;
    }
  }
}, { passive: false });

canvasArea.addEventListener('touchend', e => {
  if (e.touches.length === 0) {
    isTouchPanning = false;
    touchZoomDist = 0;
    saveState();
  }
});

// ============ INIT ============
async function init() {
  // Load data files
  const [sites, presets, detailExtra, siteImages] = await Promise.all([
    fetch('data/sites.json').then(r => r.json()),
    fetch('data/presets.json').then(r => r.json()),
    fetch('data/detail-extra.json').then(r => r.json()),
    fetch('data/site-images.json').then(r => r.json())
  ]);
  SITES_DATA = sites;
  PRESET_DATA = presets;
  DETAIL_EXTRA = detailExtra;
  SITE_IMAGES = siteImages;

  // Connect data to state
  state.sites = SITES_DATA;

  // Load memos from server (via Netlify Function for real-time data)
  try {
    const memosRes = await fetch('/get-memos');
    if (memosRes.ok) {
      const memos = await memosRes.json();
      MEMOS_DATA = memos;
    }
  } catch(e) { console.warn('Failed to load memos', e); }

  // Load map images from IndexedDB
  await loadImagesFromDB();

  // Load shared positions from server
  const hasPositions = Object.keys(state.maps).some(c =>
    Object.keys(state.maps[c].positions).length > 0
  );
  if (!hasPositions) {
    try {
      const res = await fetch('data/positions.json');
      if (res.ok) {
        const positions = await res.json();
        for (const c of Object.keys(positions)) {
          if (state.maps[c]) {
            state.maps[c].positions = positions[c] || {};
          }
        }
        saveState();
      }
    } catch(e) { console.warn('Failed to load positions', e); }
  }

  // Load map images from save file if not in IndexedDB
  const hasImages = Object.keys(state.maps).some(c => state.maps[c].imageData);
  if (!hasImages) {
    try {
      const res = await fetch('saves/inzoi_map_2026-02-26.json');
      if (res.ok) {
        const data = await res.json();
        if (data.maps) {
          for (const c of Object.keys(data.maps)) {
            if (state.maps[c] && data.maps[c].imageData) {
              state.maps[c].imageData = data.maps[c].imageData;
              await IDB.saveImage('map_' + c, data.maps[c].imageData);
            }
          }
        }
      }
    } catch(e) { console.warn('Failed to load map images', e); }
  }

  // Render views
  loadMapForCity();
  renderSiteList();
  renderMapSites();

  // Wait a tick for image to render, then fit
  setTimeout(() => {
    if (mapImage.complete && mapImage.naturalWidth) { fitToView(); }
    else if (currentMap().imageData) { mapImage.onload = () => { fitToView(); }; }
    else { applyTransform(); }
  }, 100);
}

// Start the app (called after authentication)
window.startApp = () => init().catch(err => console.error('Failed to initialize:', err));
