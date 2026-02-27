// ============ DATA (loaded from JSON files) ============
let SITES_DATA = [];
let PRESET_DATA = {};
let DETAIL_EXTRA = {};
let SITE_IMAGES = {};


// ============ STATE ============
const state = {
  currentCity: 'Gangnam',
  sites: SITES_DATA,
  filter: 'all',
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
  dragOffset: {x:0,y:0}
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
  return state.sites.filter(s => {
    if (s.city !== state.currentCity) return false;
    if (state.filter !== 'all' && s.siteType !== state.filter) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q) && !(s.displayType||'').toLowerCase().includes(q)) return false;
    }
    return true;
  });
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
  const sites = getFilteredSites();
  const positions = currentMap().positions;
  let html = '';
  sites.forEach(s => {
    const placed = positions[s.id] ? ' placed' : '';
    const selected = state.selectedSiteId === s.id ? ' selected' : '';
    html += `<div class="site-item${placed}${selected}" data-id="${s.id}">
      <div class="site-dot ${s.siteType}" style="font-size:14px;width:auto;height:auto;background:none">${getIcon(s)}</div>
      <div class="site-info">
        <div class="site-name">${s.name}</div>
        <div class="site-meta">${s.displayType || s.siteType} · ${s.sizeX}×${s.sizeY}</div>
      </div>
      ${placed ? '<span class="site-badge">배치됨</span>' : ''}
    </div>`;
  });
  siteListEl.innerHTML = html;
  $('siteCount').textContent = sites.length + '개';
  const allCitySites = state.sites.filter(s => s.city === state.currentCity);
  const placedN = Object.keys(positions).length;
  $('placedCount').textContent = '배치: ' + placedN + '개';
  $('unplacedCount').textContent = '미배치: ' + (allCitySites.length - placedN) + '개';
}

// ============ RENDER DETAIL ============
function renderDetail(siteId) {
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
        <div class="detail-field"><label>크기 (X×Y)</label><value>${s.sizeX} × ${s.sizeY}</value></div>
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
    ${PRESET_DATA[s.id] ? `<div class="detail-section"><h3>🏗️ 건축 프리셋 (${PRESET_DATA[s.id].length}종)</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${PRESET_DATA[s.id].map((p,i) => `<div style="background:var(--bg);border-radius:6px;overflow:hidden;text-align:center"><img src="img/BuildPreset_${p}.PNG" alt="#${i+1}" style="width:100%;height:90px;object-fit:cover;display:block" onerror="this.style.display='none'"><div style="padding:3px 4px;font-size:10px;color:var(--text2)">#${i+1}</div></div>`).join('')}</div></div>` : ''}
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
  const isFiltered = state.filter !== 'all';
  Object.keys(positions).forEach(id => {
    const s = state.sites.find(x=>x.id===id);
    if (!s) return;
    const pos = positions[id];
    const pinClass = s.icon || s.siteType;
    const el = document.createElement('div');
    el.className = `placed-site pin-${pinClass}`;
    if (state.selectedSiteId === id) el.classList.add('selected-on-map');
    if (!filtered.has(id)) el.style.opacity = '0.15';
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    const iconEmoji = getIcon(s);
    // When a specific type filter is active, show name+size label always for matching pins
    const showLabel = isFiltered && filtered.has(id);
    const labelText = showLabel
      ? `<div class="pin-label" style="opacity:1;pointer-events:none">${s.name}<br><span style="font-size:10px;opacity:.7">${s.sizeX}×${s.sizeY}</span></div>`
      : `<div class="pin-label">${s.name}</div>`;
    el.innerHTML = `<div class="pin-head">${iconEmoji}</div><div class="pin-tail"></div>${labelText}`;
    el.dataset.id = id;
    el.title = `${iconEmoji} ${s.name} (${s.displayType || s.siteType}) ${s.sizeX}×${s.sizeY}`;
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

  // Determine content bounds
  let contentW = 0, contentH = 0;

  // If map image is loaded, use its natural size
  if (mapImage.naturalWidth && mapImage.style.display !== 'none') {
    contentW = mapImage.naturalWidth;
    contentH = mapImage.naturalHeight;
  }

  // Also consider placed sites bounds (they might extend beyond image)
  const positions = m.positions;
  const ids = Object.keys(positions);
  if (ids.length > 0) {
    let maxX = contentW, maxY = contentH;
    let minX = Infinity, minY = Infinity;
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
    if (minX < 0) contentW = maxX - minX;
    else contentW = Math.max(contentW, maxX);
    if (minY < 0) contentH = maxY - minY;
    else contentH = Math.max(contentH, maxY);
  }

  // Fallback if nothing to fit
  if (contentW <= 0 || contentH <= 0) {
    m.zoom = 1; m.panX = 0; m.panY = 0;
    applyTransform();
    return;
  }

  // Calculate zoom to fit with padding
  const padding = 40;
  const scaleX = (areaW - padding * 2) / contentW;
  const scaleY = (areaH - padding * 2) / contentH;
  m.zoom = Math.min(scaleX, scaleY, 3); // cap at 3x
  m.zoom = Math.max(m.zoom, 0.05); // floor

  // Center the content
  m.panX = (areaW - contentW * m.zoom) / 2;
  m.panY = (areaH - contentH * m.zoom) / 2;

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

// ============ PLACE / REMOVE ============
function startPlacing(id) {
  state.placingId = id;
  canvasArea.classList.add('placing');
  modeIndicator.style.display = 'block';
  const s = state.sites.find(x=>x.id===id);
  modeIndicator.textContent = `📌 "${s?.name}" 배치 중 - 지도를 클릭하세요 (ESC 취소)`;
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
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.filter = chip.dataset.type;
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

// ============ EXPORT / IMPORT ============
$('btnExport').onclick = () => {
  const includeImages = confirm('지도 이미지도 함께 저장할까요?\n(이미지 포함 시 파일 크기가 커집니다)\n\n확인 = 이미지 포함 / 취소 = 위치 데이터만');
  const data = { version: 2, maps: {} };
  Object.keys(state.maps).forEach(c => {
    data.maps[c] = {
      positions: state.maps[c].positions
    };
    if (includeImages && state.maps[c].imageData) {
      data.maps[c].imageData = state.maps[c].imageData;
    }
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inzoi_map_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  toast('데이터가 저장되었습니다');
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

$('btnResetPositions').onclick = () => {
  if (confirm(`${({Gangnam:'도원',RedCity:'블리스베이',Cahaya:'차하야'})[state.currentCity]}의 모든 배치를 초기화할까요?`)) {
    currentMap().positions = {};
    saveState();
    renderMapSites();
    renderSiteList();
    if (state.selectedSiteId) renderDetail(state.selectedSiteId);
    toast('배치가 초기화되었습니다');
  }
};

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

  // Render initial views
  loadMapForCity();
  renderSiteList();
  renderMapSites();

  // Load map images from IndexedDB (async), then fit to view
  await loadImagesFromDB();
  renderMapSites();
  // Wait a tick for image to render, then fit
  setTimeout(() => {
    if (mapImage.complete && mapImage.naturalWidth) { fitToView(); }
    else if (currentMap().imageData) { mapImage.onload = () => { fitToView(); }; }
    else { applyTransform(); }
  }, 100);
}

// Start the app
init().catch(err => console.error('Failed to initialize:', err));
