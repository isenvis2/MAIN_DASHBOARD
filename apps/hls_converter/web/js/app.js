function getRemoteHost() {
  return window.location.hostname || 'localhost';
}
function getHttpProtocol() {
  return window.location.protocol === 'https:' ? 'https:' : 'http:';
}
function serviceUrl(port, path = '/') {
  const cleanPath = String(path || '/').startsWith('/') ? String(path || '/') : `/${path}`;
  return `${getHttpProtocol()}//${getRemoteHost()}:${port}${cleanPath}`;
}
// v77.04: player stall diagnostics, player-only live-edge recovery, and status dedupe.
// v77.01: suppress restart storms after close/open; prefer local HLS recovery before server restart.
// v76.12: release state sync; close removes watchdog targets before ffmpeg termination.
// v76.09: track and remove camera connector polylines reliably when viewers close.
// v76.08: enforce one GIS HLS Viewer per camera and close all orphan viewers reliably.
// v76.07: conservative watchdog reconnect, resource guard, and last-frame viewer reconnect.
// v76.05: Hide the top GIS status message after HLS playback succeeds.
// v76.04: GIS HLS Viewer keeps stream ownership, clears preparing state on HLS.js playback, and makes close reliable.
// v76.02: GIS HLS Viewer uses fast-start readiness timing for newly selected RTSP streams.
// v75.38: GIS/HLS web app uses absolute server-host API URL and remote-safe CORS.
// v75.32: GIS HLS Viewer auto layout avoids all visible camera markers as protected areas.
// v75.31: GIS HLS Viewer uses free-space auto layout before falling back to drag positioning.
// v75.30: GIS HLS Viewer is draggable and connected to its camera by a red line.
// v75.28: cameras.json is single-sourced from shared/data/cameras.json.
// app.js
// v75.27: GIS HLS Viewer waits for real segment readiness and restarts playback on repeated 404.
// v75.25: GPU-configurable RTSP conversion, relaxed HLS segments, and immediate reload on segment/playlist 404.
// Kakao map dashboard + mixed stream source support (RTSP via converter / direct HLS)

const API = serviceUrl(8080, "").replace(/\/$/, "");

const statusText = document.getElementById("statusText");
const reloadBtn = document.getElementById("reloadBtn");
const toggleEditBtn = document.getElementById("toggleEditBtn");
const closeAllViewersBtn = document.getElementById("closeAllViewersBtn");
const expandedViewerLayer = document.getElementById("expandedViewerLayer");
const expandedViewerTitle = document.getElementById("expandedViewerTitle");
const expandedViewerVideo = document.getElementById("expandedViewerVideo");
const expandedViewerRestoreBtn = document.getElementById("expandedViewerRestoreBtn");
const expandedViewerCloseBtn = document.getElementById("expandedViewerCloseBtn");
let lastStatusMessage = "";
let lastStatusAt = 0;
function setStatus(t) {
  if (!statusText) return;
  const msg = t || "";
  const now = Date.now();
  // V77.04: avoid visible flicker caused by writing the same message repeatedly.
  if (msg === lastStatusMessage && now - lastStatusAt < 5000) return;
  lastStatusMessage = msg;
  lastStatusAt = now;
  statusText.textContent = msg;
}
function clearStatus(expectedText = null) {
  if (!statusText) return;
  if (expectedText !== null && statusText.textContent !== expectedText) return;
  statusText.textContent = "";
}
function anyViewerPreparing() {
  try {
    for (const item of camOverlays.values()) {
      if (item && !item.isClosed && !item.isReady) return true;
    }
  } catch {}
  return false;
}
function clearStatusWhenAllViewersReady(delayMs = 0) {
  const run = () => { if (!anyViewerPreparing()) clearStatus(); };
  if (delayMs > 0) setTimeout(run, delayMs);
  else run();
}

let map;
let dashboardConfig = null;
let cameras = [];
let cameraMarkers = new Map();
let sites = [];
let sitePolygons = new Map();
let editMode = false;
let drawing = false;
let deleteMode = false;
let formOpen = false;
let drawingPoints = [];
let previewLine = null;
let previewPoly = null;
let ctxOverlay = null;
let infoOverlay = null;
let formOverlay = null;
const camOverlays = new Map();
const releasedCameraIds = new Set();
const openingCameraIds = new Set();
// v76.09: Kakao Polyline objects are not DOM nodes, so keep a separate registry.
// This prevents red connector lines from remaining when a Viewer is closed or an orphan Viewer is removed.
const cameraConnectorRegistry = new Map();
const MAX_CAM_OVERLAYS = 20;
let suppressMapClickUntil = 0;
let pendingFocusCamId = null;
let gisBootReady = false;
let lastFocusedCamId = null;
let lastFocusAt = 0;
let expandedViewer = null;
let viewerZIndexSeq = 9000;
function suppressMapClick(ms = 250) { suppressMapClickUntil = Date.now() + ms; }

(function injectViewerDedupStyle(){
  if (document.getElementById('viewer-dedup-style')) return;
  const style = document.createElement('style');
  style.id = 'viewer-dedup-style';
  style.textContent = `.viewer-focus-pulse{box-shadow:0 0 0 4px rgba(255,80,80,.35),0 10px 26px rgba(0,0,0,.25)!important;}`;
  document.head?.appendChild(style);
})();




function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeDashboardConfig(raw) {
  const base = raw && typeof raw === "object" ? raw : {};
  const mapCfg = base.map && typeof base.map === "object" ? base.map : {};

  const centerLat = toFiniteNumber(mapCfg.centerLat ?? mapCfg.lat ?? base.centerLat ?? base.lat, 37.5662952);
  const centerLng = toFiniteNumber(mapCfg.centerLng ?? mapCfg.lng ?? base.centerLng ?? base.lng, 126.9779451);
  const levelRaw = toFiniteNumber(mapCfg.level ?? base.level, 4);
  const level = Math.max(1, Math.min(14, Math.round(levelRaw)));

  return {
    version: 1,
    map: { centerLat, centerLng, level }
  };
}

function normalizeCameraSource(cam) {
  const sourceType = typeof cam?.sourceType === "string" ? cam.sourceType.trim().toLowerCase() : "";
  const sourceUrl = typeof cam?.sourceUrl === "string" ? cam.sourceUrl.trim() : "";

  if (sourceType && sourceUrl && (sourceType === "rtsp" || sourceType === "rtsp+" || sourceType === "hls")) {
    return { type: sourceType, url: sourceUrl };
  }
  if (typeof cam?.rtsp === "string" && cam.rtsp.trim()) {
    return { type: "rtsp", url: cam.rtsp.trim() };
  }
  if (typeof cam?.hls === "string" && cam.hls.trim()) {
    return { type: "hls", url: cam.hls.trim() };
  }
  return { type: null, url: "" };
}

function getCameraDisplayLabel(cam) {
  const source = normalizeCameraSource(cam);
  if (source.type === "rtsp+") return "RTSP+ 상시 HLS";
  if (source.type === "rtsp") return "RTSP→HLS";
  if (source.type === "hls") return "Direct HLS";
  return "소스 미정";
}

toggleEditBtn?.addEventListener("click", () => {
  editMode = !editMode;

  if (!editMode) {
    deleteMode = false;
    cancelDrawing();
    hideContextMenu();
    hideFormOverlay();
    setStatus("편집모드 OFF");
  } else {
    setStatus("편집모드 ON (지도 우클릭 메뉴)");
  }
});

reloadBtn?.addEventListener("click", async () => {
  try {
    await loadAll();
    renderSites();
    renderCameras();
    setStatus("재로딩 완료");
  } catch (e) {
    console.error(e);
    setStatus("재로딩 실패 (콘솔 확인)");
  }
});

closeAllViewersBtn?.addEventListener("click", async () => {
  try {
    await closeAllCameraOverlays(true);
    lastFocusedCamId = null;
    lastFocusAt = 0;
    pendingFocusCamId = null;
    setStatus("전체 HLS Viewer 닫기 완료");
    notifyParent('gis-viewers-closed');
  } catch (e) {
    console.error(e);
    setStatus(`전체 HLS Viewer 닫기 실패: ${e.message}`);
  }
});

async function apiGet(url) {
  const r = await fetch(`${API}${url}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${url} failed`);
  return r.json();
}
async function apiPut(url, body) {
  const r = await fetch(`${API}${url}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `PUT ${url} failed`);
  return data;
}
async function apiPost(url, body) {
  const r = await fetch(`${API}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data?.precheck?.reason ? ` (${data.precheck.reason})` : "";
    const err = new Error(`${data?.error || `POST ${url} failed`}${detail}`);
    err.data = data;
    err.precheck = data?.precheck || null;
    throw err;
  }
  return data;
}

function hideContextMenu() {
  if (ctxOverlay) { try { ctxOverlay.setMap(null); } catch {} ctxOverlay = null; }
}
function hideInfoOverlay() {
  if (infoOverlay) { try { infoOverlay.setMap(null); } catch {} infoOverlay = null; }
}
function hideFormOverlay() {
  if (formOverlay) { try { formOverlay.setMap(null); } catch {} formOverlay = null; }
  formOpen = false;
}

function createCardBase() {
  const div = document.createElement("div");
  div.style.cssText = `
    background:#fff3a0;
    border:2px solid #2c2c2c;
    border-radius:10px;
    padding:10px;
    width:320px;
    box-shadow:0 10px 26px rgba(0,0,0,.25);
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  `;
  return div;
}
function createTitle(text) {
  const t = document.createElement("div");
  t.textContent = text;
  t.style.cssText = "font-weight:900; font-size:16px; margin-bottom:8px; color:#111;";
  return t;
}

function buildContextMenuElement() {
  const div = document.createElement("div");
  div.style.cssText = `
    background:#1f1f1f; color:#fff; border-radius:10px; overflow:hidden;
    box-shadow:0 8px 24px rgba(0,0,0,.35); font-size:14px; min-width:170px;
    user-select:none;
  `;
  const itemStyle = `padding:10px 12px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,.08);`;
  div.innerHTML = `
    <div data-act="start" style="${itemStyle}">🟢 그리기 시작</div>
    <div data-act="finish" style="${itemStyle}">🟡 그리기 완료</div>
    <div data-act="cancel" style="${itemStyle}">🔴 그리기 취소</div>
    <div data-act="delete" style="padding:10px 12px; cursor:pointer;">🗑 SITE 삭제</div>
  `;
  return div;
}

function showContextMenu(latlng) {
  hideContextMenu();
  if (!editMode) return;

  const div = buildContextMenuElement();

  ctxOverlay = new kakao.maps.CustomOverlay({
    content: div,
    position: latlng,
    xAnchor: 0,
    yAnchor: 0,
    zIndex: 9999
  });
  ctxOverlay.setMap(map);

  div.addEventListener("mousedown", (e) => e.stopPropagation());
  div.addEventListener("click", (e) => {
    e.stopPropagation();
    const act = e.target?.dataset?.act;
    if (!act) return;

    hideContextMenu();

    if (act === "start") {
      startDrawing();
    } else if (act === "finish") {
      finishDrawing();
    } else if (act === "cancel") {
      cancelDrawing();
    } else if (act === "delete") {
      deleteMode = true;
      drawing = false;
      hideFormOverlay();
      hideInfoOverlay();
      setStatus("삭제 모드: 삭제할 SITE 영역을 클릭하세요");
    }
  });
}

function clearPreview() {
  if (previewLine) { try { previewLine.setMap(null); } catch {} previewLine = null; }
  if (previewPoly) { try { previewPoly.setMap(null); } catch {} previewPoly = null; }
}
function startDrawing() {
  if (!editMode) return;

  deleteMode = false;
  hideInfoOverlay();
  hideFormOverlay();
  hideContextMenu();
  clearPreview();

  drawing = true;
  drawingPoints = [];
  setStatus("경계 입력: 지도 좌클릭으로 점 추가 → 우클릭 메뉴에서 '그리기 완료'");
}
function cancelDrawing() {
  drawing = false;
  drawingPoints = [];
  clearPreview();
  if (editMode) setStatus("편집 대기 (우클릭 메뉴)");
}
function updatePreview() {
  if (drawingPoints.length >= 2) {
    if (!previewLine) {
      previewLine = new kakao.maps.Polyline({
        path: drawingPoints,
        strokeWeight: 3,
        strokeColor: "#00D1FF",
        strokeOpacity: 1
      });
      previewLine.setMap(map);
    } else {
      previewLine.setPath(drawingPoints);
    }
  }
  if (drawingPoints.length >= 3) {
    if (!previewPoly) {
      previewPoly = new kakao.maps.Polygon({
        path: drawingPoints,
        strokeWeight: 4,
        strokeColor: "#00D1FF",
        strokeOpacity: 1,
        fillColor: "#00D1FF",
        fillOpacity: 0.15,
        clickable: false
      });
      previewPoly.setMap(map);
    } else {
      previewPoly.setPath(drawingPoints);
    }
  }
}

async function loadSiteTemplate() {
  try {
    const r = await fetch(`${API}/data/SiteInfoTemplate.txt`, { cache: "no-store" });
    if (!r.ok) return "";
    return await r.text();
  } catch {
    return "";
  }
}

async function showSiteForm(latlng, initialName = "", initialMemo = "", onSave, onCancel) {
  hideFormOverlay();
  formOpen = true;

  const wrap = createCardBase();
  wrap.appendChild(createTitle("사업장 정보 입력"));

  const nameLabel = document.createElement("div");
  nameLabel.textContent = "SITE 명";
  nameLabel.style.cssText = "font-weight:800; margin-top:6px; color:#111;";
  wrap.appendChild(nameLabel);

  const nameInput = document.createElement("input");
  nameInput.value = initialName;
  nameInput.placeholder = "예: 서울역 현장";
  nameInput.style.cssText = "width:100%; padding:8px; border-radius:8px; border:1px solid #666; margin-top:6px; background:#fff;";
  wrap.appendChild(nameInput);

  const memoLabel = document.createElement("div");
  memoLabel.textContent = "메모";
  memoLabel.style.cssText = "font-weight:800; margin-top:10px; color:#111;";
  wrap.appendChild(memoLabel);

  const memoArea = document.createElement("textarea");
  memoArea.rows = 7;
  memoArea.value = initialMemo || "";
  memoArea.style.cssText = "width:100%; padding:8px; border-radius:8px; border:1px solid #666; margin-top:6px; white-space:pre-wrap; background:#fff;";
  wrap.appendChild(memoArea);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex; gap:8px; justify-content:flex-end; margin-top:10px;";
  btnRow.innerHTML = `
    <button id="btnSave" style="padding:8px 12px; border-radius:8px; border:1px solid #333; background:#2ecc71; color:#fff; font-weight:800; cursor:pointer;">저장</button>
    <button id="btnCancel" style="padding:8px 12px; border-radius:8px; border:1px solid #333; background:#aaa; color:#111; font-weight:800; cursor:pointer;">취소</button>
  `;
  wrap.appendChild(btnRow);

  drawing = false;

  formOverlay = new kakao.maps.CustomOverlay({
    content: wrap,
    position: latlng,
    xAnchor: 0.5,
    yAnchor: 1.2,
    zIndex: 9998
  });
  formOverlay.setMap(map);

  wrap.addEventListener("mousedown", (e) => e.stopPropagation());
  wrap.addEventListener("click", (e) => e.stopPropagation());

  wrap.querySelector("#btnSave").onclick = () => {
    const name = nameInput.value.trim();
    const memo = memoArea.value ?? "";
    if (!name) { alert("SITE 명은 필수입니다."); return; }
    hideFormOverlay();
    onSave({ name, memo });
  };
  wrap.querySelector("#btnCancel").onclick = () => {
    hideFormOverlay();
    onCancel?.();
  };

  if (!memoArea.value) {
    const tpl = await loadSiteTemplate();
    if (tpl) memoArea.value = tpl;
  }

  setTimeout(() => nameInput.focus(), 0);
  setStatus("SITE 정보 입력: 저장/취소");
}

async function finishDrawing() {
  if (!editMode) return;
  if (formOpen) return;

  if (drawingPoints.length < 3) {
    setStatus("오류: 점을 3개 이상 찍어야 합니다 (우클릭→그리기 시작 후 좌클릭으로 점 추가)");
    return;
  }

  const anchor = drawingPoints[0];
  const tpl = await loadSiteTemplate();

  await showSiteForm(anchor, "", tpl || "", async ({ name, memo }) => {
    try {
      const id = `site_${Date.now()}`;
      const newSite = {
        id,
        name,
        memo,
        style: { strokeColor: "#FF3300", strokeWeight: 4, fillColor: "#FF6600", fillOpacity: 0.25 },
        polygon: drawingPoints.map((ll) => [ll.getLat(), ll.getLng()]),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const payload = { version: 1, sites: [...sites, newSite] };
      await apiPut("/api/sites", payload);

      sites = payload.sites;
      renderSites();

      cancelDrawing();
      setStatus("SITE 저장 완료 (다음 SITE: 우클릭→그리기 시작)");
    } catch (e) {
      console.error(e);
      setStatus(`저장 실패: ${e.message}`);
    }
  }, () => {
    cancelDrawing();
    setStatus("SITE 입력 취소 (우클릭→그리기 시작)");
  });
}

function showSiteInfo(site) {
  hideInfoOverlay();

  const wrap = createCardBase();
  wrap.appendChild(createTitle(site.name));

  const memo = document.createElement("div");
  memo.textContent = site.memo || "";
  memo.style.cssText = "white-space:pre-wrap; font-size:13px; margin-top:6px; color:#111;";
  wrap.appendChild(memo);

  const hint = document.createElement("div");
  hint.textContent = "클릭하면 닫힘";
  hint.style.cssText = "margin-top:10px; font-size:12px; opacity:.7; text-align:right;";
  wrap.appendChild(hint);

  const latlng = new kakao.maps.LatLng(site.polygon[0][0], site.polygon[0][1]);

  infoOverlay = new kakao.maps.CustomOverlay({
    content: wrap,
    position: latlng,
    xAnchor: 0.5,
    yAnchor: 1.2,
    zIndex: 9997
  });
  infoOverlay.setMap(map);

  wrap.addEventListener("click", (e) => {
    e.stopPropagation();
    hideInfoOverlay();
  });
}

async function deleteSite(siteId) {
  sites = sites.filter((s) => s.id !== siteId);
  await apiPut("/api/sites", { version: 1, sites });
  renderSites();
}

function clearSites() {
  for (const p of sitePolygons.values()) {
    try { p.setMap(null); } catch {}
  }
  sitePolygons.clear();
}

function renderSites() {
  clearSites();

  for (const s of sites) {
    const path = s.polygon.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng));

    const poly = new kakao.maps.Polygon({
      path,
      strokeWeight: s.style?.strokeWeight ?? 4,
      strokeColor: s.style?.strokeColor ?? "#FF3300",
      strokeOpacity: 1,
      fillColor: s.style?.fillColor ?? "#FF6600",
      fillOpacity: s.style?.fillOpacity ?? 0.25,
      clickable: true
    });
    poly.setMap(map);

    kakao.maps.event.addListener(poly, "click", async () => {
      suppressMapClick(350);

      if (deleteMode && editMode) {
        const ok = confirm(`"${s.name}" SITE를 삭제할까요?`);
        if (!ok) return;
        try {
          await deleteSite(s.id);
          setStatus("SITE 삭제 완료 (다음 동작: 우클릭 메뉴)");
        } catch (e) {
          console.error(e);
          setStatus(`삭제 실패: ${e.message}`);
        } finally {
          deleteMode = false;
        }
        return;
      }

      showSiteInfo(s);
    });

    sitePolygons.set(s.id, poly);
  }
}

function clearCameras() {
  for (const m of cameraMarkers.values()) {
    try { m.setMap(null); } catch {}
  }
  cameraMarkers.clear();
}
function tryMakeMarkerImage(src) {
  try {
    const size = new kakao.maps.Size(40, 40);
    const opt = { offset: new kakao.maps.Point(20, 40) };
    return new kakao.maps.MarkerImage(src, size, opt);
  } catch {
    return null;
  }
}
function renderCameras() {
  console.log("[renderCameras] count =", cameras.length);

  clearCameras();

  const img =
    tryMakeMarkerImage("/assets/camera.png") ||
    tryMakeMarkerImage("./assets/camera.png") ||
    null;

  for (const cam of cameras) {
    const lat = Number(cam.lat);
    const lng = Number(cam.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.warn("Invalid lat/lng:", cam);
      continue;
    }

    const source = normalizeCameraSource(cam);
    if (!source.type || !source.url) {
      console.warn("Camera source missing:", cam);
      continue;
    }

    const opts = {
      position: new kakao.maps.LatLng(lat, lng),
      map,
      title: `${cam.name || cam.id} [${getCameraDisplayLabel(cam)}]`
    };
    if (img) opts.image = img;

    const marker = new kakao.maps.Marker(opts);

    kakao.maps.event.addListener(marker, "click", async () => {
      try {
        await openCameraStream(cam);
      } catch (e) {
        console.error(e);
        setStatus(`카메라 오류: ${e.message}`);
      }
    });

    cameraMarkers.set(cam.id, marker);
  }
}

function getViewerDomByCamId(camId) {
  if (!camId) return null;
  try {
    return document.querySelector(`[data-hls-viewer-cam-id="${CSS.escape(String(camId))}"]`);
  } catch {
    return document.querySelector(`[data-hls-viewer-cam-id="${String(camId).replace(/"/g, '\\"')}"]`);
  }
}

function findOrphanViewerElements() {
  const nodes = Array.from(document.querySelectorAll('[data-hls-viewer-cam-id], .hls-viewer-draggable'));
  return nodes.filter((el) => {
    const camId = el?.dataset?.hlsViewerCamId;
    if (!camId) return true;
    const st = camOverlays.get(camId);
    return !st || st.rootEl !== el;
  });
}

function bringOverlayToFront(camId, rootEl = null) {
  const item = camOverlays.get(camId);
  const nextZ = ++viewerZIndexSeq;
  try { item?.overlay?.setZIndex?.(nextZ); } catch {}
  const el = rootEl || item?.rootEl || getViewerDomByCamId(camId);
  if (el) {
    el.style.zIndex = String(nextZ + 10);
    el.classList.add('viewer-focus-pulse');
    setTimeout(() => { try { el.classList.remove('viewer-focus-pulse'); } catch {} }, 900);
  }
}

async function removeOrphanViewerElement(el, releaseStream = false, removeConnectors = true) {
  if (!el) return;
  const camId = el.dataset?.hlsViewerCamId || el.dataset?.camId || '';
  try {
    const video = el.querySelector?.('video');
    if (video) {
      try { video.pause(); } catch {}
      try { video.removeAttribute('src'); } catch {}
      try { video.load(); } catch {}
    }
  } catch {}
  try { el.remove(); } catch {}
  if (removeConnectors && camId) removeConnectorsForCam(camId);
  if (releaseStream && camId && !camOverlays.has(camId)) {
    await releaseCameraStream(camId);
  }
}

async function cleanupDuplicateViewersForCam(camId, keepRoot = null) {
  const matches = Array.from(document.querySelectorAll('[data-hls-viewer-cam-id], .hls-viewer-draggable'))
    .filter((el) => (el.dataset?.hlsViewerCamId || el.dataset?.camId) === camId);
  for (const el of matches) {
    if (keepRoot && el === keepRoot) continue;
    const state = camOverlays.get(camId);
    if (state?.rootEl === el) continue;
    await removeOrphanViewerElement(el, false, false);
  }
}

function existingViewerForCamera(camId) {
  const state = camOverlays.get(camId);
  if (state && !state.isClosed) return { state, element: state.rootEl || getViewerDomByCamId(camId), orphan: false };
  const element = getViewerDomByCamId(camId);
  if (element) return { state: null, element, orphan: true };
  return null;
}

function evictOldestCamOverlayIfNeeded() {
  if (camOverlays.size < MAX_CAM_OVERLAYS) return;

  let oldestId = null;
  let oldest = Infinity;
  for (const [id, it] of camOverlays.entries()) {
    const t = it.openedAt || 0;
    if (t < oldest) { oldest = t; oldestId = id; }
  }
  if (oldestId) void closeCameraOverlay(oldestId, true);
}
async function releaseCameraStream(camId, source = "viewer-close", sessionId = null) {
  if (!camId) return;
  releasedCameraIds.add(camId);
  try {
    await apiPost("/api/streams/release", { camId, source, sessionId });
  } catch (err) {
    console.warn("release failed:", camId, err);
  }
}

async function releaseAllViewerStreams(source = "close-all") {
  try {
    await apiPost("/api/streams/release-viewers", { source });
  } catch (err) {
    console.warn("release all viewers failed:", err);
  }
}

function clearViewerTimers(item) {
  if (!item) return;
  for (const key of ["retryTimer", "statusTimer", "keepAliveTimer", "restartTimer", "playbackReadyTimer", "stallTimer"]) {
    if (item[key]) {
      try { clearTimeout(item[key]); } catch {}
      try { clearInterval(item[key]); } catch {}
      item[key] = null;
    }
  }
}

function markViewerReady(camId, label = "HLS") {
  const item = camOverlays.get(camId);
  if (!item || item.isClosed) return;
  const wasReady = item.isReady;
  item.isReady = true;
  item.retrying = false;
  item.restarting = false;
  item.restartCount = 0;
  item.restartWindowStartMs = 0;
  item.playerOnlyRecoverCount = 0;
  item.playerOnlyHardReloadCount = 0;
  item.lastPlayerAliveAt = Date.now();
  if (item.rootEl) {
    item.rootEl.classList.remove("is-preparing");
    item.rootEl.dataset.hlsState = "ready";
  }
  // 재생이 성공하면 상단 상태 문구는 운영 화면을 가리지 않도록 숨깁니다.
  // 여러 Viewer 중 아직 준비 중인 항목이 있으면 그 메시지는 유지합니다.
  hideFreezeFrameOverlay(item);
  setViewerState(camId, "playing", label);
  clearStatusWhenAllViewersReady(wasReady ? 0 : 250);
}

function markViewerPreparing(camId, message = "HLS 준비중") {
  const item = camOverlays.get(camId);
  if (!item || item.isClosed) return;
  item.isReady = false;
  setViewerState(camId, "preparing", message);
  if (item.rootEl) {
    item.rootEl.classList.add("is-preparing");
    item.rootEl.dataset.hlsState = "preparing";
  }
  setStatus(message);
}


function setViewerState(camId, state, detail = "") {
  const item = camOverlays.get(camId);
  if (!item || item.isClosed) return;
  const prev = item.playerState || "idle";
  item.playerState = state;
  item.playerStateDetail = detail || "";
  if (item.rootEl) item.rootEl.dataset.playerState = state;
  if (prev !== state || detail) {
    console.info(`[PLAYER_STATE] ${camId} ${prev} -> ${state}${detail ? ` · ${detail}` : ""}`);
  }
}

function isFreshHlsStatus(status, maxAgeSec = 8) {
  if (!status || !status.m3u8Exists) return false;
  const segCount = Number(status.segmentCount || 0);
  if (segCount <= 0) return false;
  const segAge = Number(status.latestSegmentAgeSec);
  const m3u8Age = Number(status.m3u8AgeSec);
  if (Number.isFinite(segAge) && segAge <= maxAgeSec) return true;
  if (Number.isFinite(m3u8Age) && m3u8Age <= maxAgeSec) return true;
  return false;
}

function stopPlayerStallMonitor(item) {
  if (!item) return;
  if (item.stallTimer) { try { clearInterval(item.stallTimer); } catch {} item.stallTimer = null; }
}

function getVideoLiveEdgeEnd(video, hls = null) {
  if (!video) return Number.NaN;
  try {
    if (video.seekable && video.seekable.length > 0) {
      return Number(video.seekable.end(video.seekable.length - 1));
    }
  } catch {}
  const dur = Number(video.duration);
  if (Number.isFinite(dur) && dur > 0) return dur;
  try {
    const pos = Number(hls?.liveSyncPosition);
    if (Number.isFinite(pos) && pos > 0) return pos;
  } catch {}
  try {
    const pos = Number(hls?.latencyController?.liveSyncPosition);
    if (Number.isFinite(pos) && pos > 0) return pos;
  } catch {}
  return Number.NaN;
}

function forceLiveViewerToMargin(item, reason = "live-resume", options = {}) {
  const video = item?.videoEl;
  if (!item || !video || item.isClosed) return false;
  const camId = item.rootEl?.dataset?.camId || options.camId || "";
  const marginSec = Number(options.marginSec || 3);
  const staleThresholdSec = Number(options.staleThresholdSec || 30);
  const end = getVideoLiveEdgeEnd(video, item.hls || null);
  const ct = Number(video.currentTime || 0);
  if (!Number.isFinite(end) || end <= marginSec + 1 || !Number.isFinite(ct)) return false;
  const target = Math.max(0, end - marginSec);
  const behindTooFar = ct < end - staleThresholdSec;
  const nearStartAfterLongRun = end > 60 && ct < 5;
  // V77.12: 정상 재생 중 live edge에 가깝다는 이유만으로 되감지 않습니다.
  // atEdgeNoBuffer 보정은 3초 seek loop를 만들 수 있으므로 background 복귀/지연/초기화 상황만 처리합니다.
  if (!behindTooFar && !nearStartAfterLongRun && options.force !== true) return false;
  try {
    video.currentTime = target;
    console.info(`[LIVE_RESUME_SEEK] ${camId} target=${target.toFixed(2)} end=${end.toFixed(2)} current=${ct.toFixed(2)} reason=${reason}`);
    try { if (item.hls && typeof item.hls.startLoad === "function") item.hls.startLoad(target); } catch {}
    try { const p = video.play(); if (p && typeof p.catch === "function") p.catch(() => {}); } catch {}
    return true;
  } catch (err) {
    console.warn("[LIVE_RESUME_SEEK_FAIL]", camId, err);
    return false;
  }
}

function keepYtnViewerBehindLiveEdge(camId, reason = "live-buffer-margin") {
  const item = camOverlays.get(camId);
  // V77.10: background 복귀 후 1초부터 재생되는 사이드 효과를 막기 위해
  // YTN뿐 아니라 모든 live HLS viewer를 live edge보다 3초 뒤로 보정합니다.
  return forceLiveViewerToMargin(item, reason, { marginSec: 3, staleThresholdSec: 30 });
}

function resumeAllLiveViewersAfterBackground(reason = "visibility-resume") {
  let fixed = 0;
  for (const [camId, item] of camOverlays.entries()) {
    if (!item || item.isClosed || !item.videoEl) continue;
    if (forceLiveViewerToMargin(item, reason, { marginSec: 3, staleThresholdSec: 30 })) fixed += 1;
    try { if (item.hls && typeof item.hls.startLoad === "function") item.hls.startLoad(-1); } catch {}
    try { const p = item.videoEl.play(); if (p && typeof p.catch === "function") p.catch(() => {}); } catch {}
  }
  if (fixed > 0) console.info(`[BACKGROUND_LIVE_RESUME] fixed=${fixed} reason=${reason}`);
}

let backgroundLiveResumeTimer = null;
function scheduleBackgroundLiveResume(reason = "visibility-resume") {
  if (backgroundLiveResumeTimer) clearTimeout(backgroundLiveResumeTimer);
  backgroundLiveResumeTimer = setTimeout(() => {
    backgroundLiveResumeTimer = null;
    resumeAllLiveViewersAfterBackground(reason);
    setTimeout(() => resumeAllLiveViewersAfterBackground(reason + ":delayed"), 1200);
  }, 150);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleBackgroundLiveResume("visibilitychange");
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => scheduleBackgroundLiveResume("window-focus"));
  window.addEventListener("pageshow", () => scheduleBackgroundLiveResume("pageshow"));
}

function markPlayerAliveFromHls(camId, eventName = "HLS") {
  const item = camOverlays.get(camId);
  if (!item || item.isClosed) return;
  item.lastPlayerAliveAt = Date.now();
  item.lastHlsEventName = eventName;
  if (item.freezeVisible && item.videoEl && Number(item.videoEl.readyState || 0) >= 2) {
    console.info(`[OVERLAY_CLEAR] ${camId} reason=${eventName} readyState=${item.videoEl.readyState}`);
    hideFreezeFrameOverlay(item);
  }
  if (item.playerState === "stalled" || item.playerState === "recovering" || item.playerState === "waiting-hls") {
    setViewerState(camId, "playing", eventName);
  }
}

function liveSeekToEdge(item, reason = "live edge recovery") {
  if (!item || !item.videoEl) return false;
  const hls = item.hls;
  const video = item.videoEl;
  const camId = item.rootEl?.dataset?.camId || "";
  // V77.10: live edge 자체가 아니라 live edge - 3초로 이동해 background 복귀 후 0~1초 재생을 방지합니다.
  const end = getVideoLiveEdgeEnd(video, hls);
  const target = Number.isFinite(end) && end > 4 ? Math.max(0, end - 3) : Number.NaN;
  if (Number.isFinite(target) && target >= 0) {
    try {
      video.currentTime = Math.max(0, target);
      console.info(`[PLAYER_LIVE_SEEK] ${camId} target=${target.toFixed(2)} end=${Number(end).toFixed(2)} reason=${reason} liveMargin=3s`);
    } catch (err) {
      console.warn("[PLAYER_LIVE_SEEK_FAIL]", err);
    }
  }
  try { if (hls && typeof hls.startLoad === "function") hls.startLoad(Number.isFinite(target) ? target : -1); } catch {}
  try { if (hls && typeof hls.recoverMediaError === "function") hls.recoverMediaError(); } catch {}
  try { const p = video.play(); if (p && typeof p.catch === "function") p.catch(() => {}); } catch {}
  return Number.isFinite(target);
}

function startPlayerStallMonitor(camId, video, options = {}) {
  const item = camOverlays.get(camId);
  if (!item || !video) return;
  stopPlayerStallMonitor(item);
  let lastTime = Number(video.currentTime || 0);
  let lastMoveAt = Date.now();
  let lastCheckAt = 0;
  item.stallTimer = setInterval(async () => {
    const current = camOverlays.get(camId);
    if (!current || current.isClosed || current.videoEl !== video) { stopPlayerStallMonitor(item); return; }
    const now = Date.now();
    const ct = Number(video.currentTime || 0);
    if (Math.abs(ct - lastTime) > 0.15) {
      lastTime = ct;
      lastMoveAt = now;
      current.lastVideoMoveAt = now;
      if (current.freezeVisible) hideFreezeFrameOverlay(current);
      if (current.playerState === "stalled" || current.playerState === "recovering" || current.playerState === "waiting-hls") setViewerState(camId, "playing", `currentTime=${ct.toFixed(1)}`);
      return;
    }
    const stalledMs = now - lastMoveAt;
    const readyState = Number(video.readyState || 0);
    const shouldCheck = stalledMs >= Number(options.stallThresholdMs || 8000) && now - lastCheckAt >= 4000;
    if (!shouldCheck) return;
    lastCheckAt = now;
    let status = null;
    try { status = await fetchStreamStatus(camId); } catch {}
    if (isFreshHlsStatus(status, Number(options.freshAgeSec || 8))) {
      console.warn(`[PLAYER_STALL] ${camId} currentTime stalled ${Math.round(stalledMs/1000)}s readyState=${readyState}; HLS output is fresh. Player-only recovery.`);
      setViewerState(camId, "stalled", `freshSegment=${status?.latestSegmentName || "unknown"}`);
      playerOnlyRecover(camId, "fresh segment but video stalled");
      lastMoveAt = Date.now();
    } else if (status) {
      console.warn(`[PLAYER_STALL] ${camId} currentTime stalled ${Math.round(stalledMs/1000)}s; HLS not fresh: ${summarizeStreamStatus(status)}`);
      setViewerState(camId, "waiting-hls", summarizeStreamStatus(status));
    }
  }, Number(options.intervalMs || 2000));
}

function playerOnlyRecover(camId, reason = "player stalled") {
  const item = camOverlays.get(camId);
  if (!item || item.isClosed || !item.videoEl) return;
  const now = Date.now();
  if (item.lastPlayerOnlyRecoverAt && now - item.lastPlayerOnlyRecoverAt < 8000) return;
  item.lastPlayerOnlyRecoverAt = now;
  item.playerOnlyRecoverCount = Number(item.playerOnlyRecoverCount || 0) + 1;
  const hlsUrl = item.hlsUrl || `/media/${camId}/stream.m3u8`;
  setStatus(`${camId} 영상 재동기화 중... 마지막 화면 유지`);
  setViewerState(camId, "recovering", reason);

  // 1단계: FFmpeg/API는 건드리지 않고 HLS.js를 live edge로 이동합니다.
  if (item.hls && item.playerOnlyRecoverCount % 3 !== 0) {
    showFreezeFrameOverlay(item, "영상 재동기화 중... 마지막 화면 유지");
    const sought = liveSeekToEdge(item, reason);
    if (sought) return;
  }

  // 2단계: 그래도 멈추면 HLS.js만 다시 붙입니다. 서버 FFmpeg는 재시작하지 않습니다.
  try { detachHlsKeepLastFrame(item); } catch {}
  try {
    const started = startPlaybackInVideo(item.videoEl, hlsUrl, {
      camId,
      label: `${camId} HLS`,
      onReady: () => markViewerReady(camId, `${camId} HLS`),
      hardReloadThreshold: 8,
      hardReloadMinAgeMs: 60000,
      preferPlayerOnlyHardReload: true,
      onHardReload: (why) => restartOverlayPlayback(camId, why)
    });
    item.hls = started.hls || null;
  } catch (err) {
    console.warn(`[PLAYER_RECOVER_FAIL] ${camId}`, err);
  }
}

function startViewerKeepAlive(camId) {
  const item = camOverlays.get(camId);
  if (!item || item.keepAliveTimer) return;
  item.keepAliveTimer = setInterval(async () => {
    const current = camOverlays.get(camId);
    if (releasedCameraIds.has(camId) || !current || current.isClosed) {
      try { clearInterval(item.keepAliveTimer); } catch {}
      item.keepAliveTimer = null;
      return;
    }
    try {
      const status = await fetchStreamStatus(camId);
      if (releasedCameraIds.has(camId) || !camOverlays.has(camId)) return;
      if (status && status.sourceType === "rtsp" && status.active === false) {
        setStatus(`${camId} 변환 요청이 끊겨 재요청합니다.`);
        const resp = await apiPost("/api/streams/request", { camId, source: "viewer-resume" });
        if (resp?.hls) current.hlsUrl = resolveHlsUrl(resp.hls);
        if (resp?.sessionId) current.sessionId = resp.sessionId;
      } else if (status && status.sourceType === "rtsp") {
        // Touch LRU so a viewer that is still open is not treated as idle.
        await apiPost("/api/streams/request", { camId, source: "keep-alive-touch" });
      }
    } catch (err) {
      console.warn("[viewer keepalive failed]", camId, err);
    }
  }, 8000);
}

async function closeCameraOverlay(camId, releaseStream = true) {
  if (releaseStream && camId) releasedCameraIds.add(camId);
  const it = camOverlays.get(camId);
  // v76.12: mark released first so keep-alive/reconnect callbacks cannot re-request it.
  // v76.09: remove connector polylines even if state/DOM is already inconsistent.
  removeConnectorsForCam(camId);
  if (it) {
    it.isClosed = true;
    clearViewerTimers(it);
    try {
      destroyPlaybackState(it);
      removeConnectorsForCam(camId);
      it.overlay?.setMap?.(null);
    } catch {}
    camOverlays.delete(camId);
  }

  // v76.08 safety net: remove duplicate/orphan DOM viewers for the same camera.
  const leftovers = Array.from(document.querySelectorAll('[data-hls-viewer-cam-id], .hls-viewer-draggable'))
    .filter((el) => (el.dataset?.hlsViewerCamId || el.dataset?.camId) === camId);
  for (const el of leftovers) {
    await removeOrphanViewerElement(el, false, false);
  }

  if (releaseStream) {
    await releaseCameraStream(camId, "viewer-close", it?.sessionId || null);
  }
}

async function closeAllCameraOverlays(releaseStream = true) {
  if (releaseStream) {
    for (const id of Array.from(camOverlays.keys())) releasedCameraIds.add(id);
    await releaseAllViewerStreams("close-all");
  }
  const ids = Array.from(camOverlays.keys());
  for (const id of ids) {
    await closeCameraOverlay(id, false);
  }

  // v76.08: also remove orphan Viewer DOM elements that were not registered in camOverlays.
  const orphans = findOrphanViewerElements();
  for (const el of orphans) {
    await removeOrphanViewerElement(el, releaseStream);
  }

  // v76.09: remove any Kakao Polyline connector overlays left in inconsistent state.
  removeAllCameraConnectors();
  camOverlays.clear();
}

async function closeOtherCameraOverlays(keepCamId, releaseStream = false) {
  const ids = Array.from(camOverlays.keys());
  for (const id of ids) {
    if (id === keepCamId) continue;
    await closeCameraOverlay(id, releaseStream);
  }
}

function notifyParent(type, extra = {}) {
  try { window.parent?.postMessage({ type, source: 'gis-map', ...extra }, '*'); } catch {}
}


function getMapContainerSize() {
  const node = map?.getNode?.() || document.getElementById("map");
  return {
    width: Math.max(1, Number(node?.clientWidth || window.innerWidth || 1)),
    height: Math.max(1, Number(node?.clientHeight || window.innerHeight || 1))
  };
}

function clampPointToMap(point, marginX = 190, marginY = 130) {
  const size = getMapContainerSize();
  const minX = Math.min(marginX, Math.max(0, size.width / 2));
  const maxX = Math.max(minX, size.width - marginX);
  const minY = Math.min(marginY, Math.max(0, size.height / 2));
  const maxY = Math.max(minY, size.height - marginY);
  const rawX = Number(point?.x || 0);
  const rawY = Number(point?.y || 0);
  const x = Math.max(minX, Math.min(rawX, maxX));
  const y = Math.max(minY, Math.min(rawY, maxY));
  return new kakao.maps.Point(x, y);
}

function getViewerSize(wrap) {
  const rawW = Number(wrap?.offsetWidth || parseFloat(wrap?.style?.width) || 360);
  const rawH = Number(wrap?.offsetHeight || parseFloat(wrap?.style?.height) || 300);
  return {
    width: Math.max(280, Math.min(520, rawW)),
    height: Math.max(260, Math.min(440, rawH))
  };
}

function rectFromTopLeft(x, y, size) {
  return {
    left: Number(x || 0),
    top: Number(y || 0),
    width: Number(size?.width || 360),
    height: Number(size?.height || 300),
    right: Number(x || 0) + Number(size?.width || 360),
    bottom: Number(y || 0) + Number(size?.height || 300)
  };
}

function rectFromCenterPoint(center, size) {
  return rectFromTopLeft(
    Number(center?.x || 0) - Number(size?.width || 360) / 2,
    Number(center?.y || 0) - Number(size?.height || 300) / 2,
    size
  );
}

function rectCenter(rect) {
  return {
    x: (Number(rect.left || 0) + Number(rect.right || 0)) / 2,
    y: (Number(rect.top || 0) + Number(rect.bottom || 0)) / 2
  };
}

function clampRectToMap(rect, margin = 12) {
  const mapSize = getMapContainerSize();
  const width = Math.min(Number(rect.width || 360), Math.max(40, mapSize.width - margin * 2));
  const height = Math.min(Number(rect.height || 300), Math.max(40, mapSize.height - margin * 2));
  const minX = margin;
  const minY = margin;
  const maxX = Math.max(minX, mapSize.width - width - margin);
  const maxY = Math.max(minY, mapSize.height - height - margin);
  const left = Math.max(minX, Math.min(Number(rect.left || 0), maxX));
  const top = Math.max(minY, Math.min(Number(rect.top || 0), maxY));
  return rectFromTopLeft(left, top, { width, height });
}

function clampViewerCenterToMap(point, viewerSize) {
  const rect = clampRectToMap(rectFromCenterPoint(point, viewerSize));
  const center = rectCenter(rect);
  return new kakao.maps.Point(center.x, center.y);
}

function rectOverlapArea(a, b) {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return x * y;
}

function distanceBetweenPoints(a, b) {
  const dx = Number(a?.x || 0) - Number(b?.x || 0);
  const dy = Number(a?.y || 0) - Number(b?.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function rectContainsPoint(rect, point, pad = 0) {
  const x = Number(point?.x || 0);
  const y = Number(point?.y || 0);
  return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
}

function getCameraMarkerKeepoutRects(excludeCamId = null) {
  const rects = [];
  const keepoutPad = 18;
  cameraMarkers.forEach((marker, id) => {
    if (excludeCamId && id === excludeCamId) return;
    const latLng = marker?.getPosition?.();
    if (!latLng) return;
    const point = mapPointFromLatLng(latLng);
    // Camera marker image is 40x40 with bottom-center anchor at the camera coordinate.
    // Keep extra padding so a new HLS Viewer does not cover nearby camera icons.
    rects.push(rectFromTopLeft(
      Number(point.x || 0) - 20 - keepoutPad,
      Number(point.y || 0) - 40 - keepoutPad,
      { width: 40 + keepoutPad * 2, height: 40 + keepoutPad * 2 }
    ));
  });
  return rects;
}

function getExistingViewerRects(excludeCamId = null) {
  const rects = [];
  camOverlays.forEach((item, id) => {
    if (excludeCamId && id === excludeCamId) return;
    const latLng = item?.viewerLatLng || item?.overlay?.getPosition?.();
    if (!latLng) return;
    const size = getViewerSize(item?.rootEl);
    const center = mapPointFromLatLng(latLng);
    rects.push(rectFromCenterPoint(center, size));
  });
  return rects;
}

function makeAroundCameraCandidates(camPoint, viewerSize, gap = 34) {
  const x = Number(camPoint?.x || 0);
  const y = Number(camPoint?.y || 0);
  const w = Number(viewerSize?.width || 360);
  const h = Number(viewerSize?.height || 300);
  return [
    rectFromTopLeft(x + gap, y - h - gap, viewerSize),
    rectFromTopLeft(x + gap, y + gap, viewerSize),
    rectFromTopLeft(x - w - gap, y - h - gap, viewerSize),
    rectFromTopLeft(x - w - gap, y + gap, viewerSize),
    rectFromTopLeft(x + gap, y - h / 2, viewerSize),
    rectFromTopLeft(x - w - gap, y - h / 2, viewerSize),
    rectFromTopLeft(x - w / 2, y - h - gap, viewerSize),
    rectFromTopLeft(x - w / 2, y + gap, viewerSize),
    rectFromTopLeft(x + gap * 2, y - h / 2, viewerSize),
    rectFromTopLeft(x - w - gap * 2, y - h / 2, viewerSize)
  ];
}

function makeGridCandidates(viewerSize, step = 56, margin = 12) {
  const mapSize = getMapContainerSize();
  const candidates = [];
  const w = Number(viewerSize?.width || 360);
  const h = Number(viewerSize?.height || 300);
  const maxX = Math.max(margin, mapSize.width - w - margin);
  const maxY = Math.max(margin, mapSize.height - h - margin);
  for (let y = margin; y <= maxY; y += step) {
    for (let x = margin; x <= maxX; x += step) {
      candidates.push(rectFromTopLeft(x, y, viewerSize));
    }
  }
  candidates.push(rectFromTopLeft(maxX, margin, viewerSize));
  candidates.push(rectFromTopLeft(margin, maxY, viewerSize));
  candidates.push(rectFromTopLeft(maxX, maxY, viewerSize));
  return candidates;
}

function edgePenalty(rect, margin = 26) {
  const mapSize = getMapContainerSize();
  const left = Math.max(0, margin - rect.left);
  const top = Math.max(0, margin - rect.top);
  const right = Math.max(0, margin - (mapSize.width - rect.right));
  const bottom = Math.max(0, margin - (mapSize.height - rect.bottom));
  return (left + top + right + bottom) * 6;
}

function scoreViewerCandidate(rect, camPoint, existingRects, markerKeepouts = []) {
  const center = rectCenter(rect);
  const overlap = existingRects.reduce((sum, other) => sum + rectOverlapArea(rect, other), 0);
  const distance = distanceBetweenPoints(center, camPoint);

  // Protect every visible camera marker, not only the selected marker.
  // If a viewer covers a marker, the user loses the ability to see/select that camera,
  // so marker overlap has a much stronger penalty than normal viewer distance.
  const markerOverlap = markerKeepouts.reduce((sum, markerRect) => sum + rectOverlapArea(rect, markerRect), 0);
  const markerCoverPenalty = markerOverlap > 0 ? 500000 + markerOverlap * 5000 : 0;
  const selectedCameraCoverPenalty = rectContainsPoint(rect, camPoint, 36) ? 1000000 : 0;

  return overlap * 1000 + markerCoverPenalty + selectedCameraCoverPenalty + distance * 0.35 + edgePenalty(rect);
}

function chooseBestViewerRect(camPoint, viewerSize, existingRects, markerKeepouts = []) {
  const candidates = [
    ...makeAroundCameraCandidates(camPoint, viewerSize),
    ...makeGridCandidates(viewerSize)
  ];
  let best = null;
  let bestScore = Infinity;
  const seen = new Set();
  for (const candidate of candidates) {
    const rect = clampRectToMap(candidate);
    const key = `${Math.round(rect.left)}:${Math.round(rect.top)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = scoreViewerCandidate(rect, camPoint, existingRects, markerKeepouts);
    if (score < bestScore) {
      bestScore = score;
      best = rect;
    }
  }
  return best || clampRectToMap(rectFromCenterPoint(camPoint, viewerSize));
}

function mapPointFromLatLng(latlng) {
  try {
    return map.getProjection().containerPointFromCoords(latlng);
  } catch {
    return new kakao.maps.Point(0, 0);
  }
}

function latLngFromMapPoint(point) {
  try {
    return map.getProjection().coordsFromContainerPoint(point);
  } catch {
    return map?.getCenter?.() || new kakao.maps.LatLng(37.5662952, 126.9779451);
  }
}

function getInitialViewerLatLng(cam, viewerSize = { width: 360, height: 300 }) {
  const camLatLng = new kakao.maps.LatLng(Number(cam.lat), Number(cam.lng));
  const camPoint = mapPointFromLatLng(camLatLng);
  const existingRects = getExistingViewerRects(cam.id);
  const markerKeepouts = getCameraMarkerKeepoutRects(cam.id);

  // Add a larger protected rectangle around the selected camera as well.
  // The marker anchor is at the bottom center, so the icon area is mostly above the coordinate.
  markerKeepouts.push(rectFromTopLeft(
    Number(camPoint.x || 0) - 28,
    Number(camPoint.y || 0) - 58,
    { width: 56, height: 74 }
  ));

  const bestRect = chooseBestViewerRect(camPoint, viewerSize, existingRects, markerKeepouts);
  const center = rectCenter(bestRect);
  setStatus(`${cam.name || cam.id} HLS Viewer 자동 배치: 카메라 아이콘 회피 위치 선택`);
  return latLngFromMapPoint(new kakao.maps.Point(center.x, center.y));
}


function registerCameraConnector(camId, connector) {
  if (!camId || !connector) return connector;
  const id = String(camId);
  if (!cameraConnectorRegistry.has(id)) cameraConnectorRegistry.set(id, new Set());
  cameraConnectorRegistry.get(id).add(connector);
  return connector;
}

function unregisterCameraConnector(camId, connector) {
  if (!camId || !connector) return;
  const id = String(camId);
  const set = cameraConnectorRegistry.get(id);
  if (!set) return;
  set.delete(connector);
  if (set.size === 0) cameraConnectorRegistry.delete(id);
}

function removeConnectorsForCam(camId) {
  if (!camId) return;
  const id = String(camId);
  const set = cameraConnectorRegistry.get(id);
  if (set) {
    for (const connector of Array.from(set)) {
      try { connector?.setMap?.(null); } catch {}
    }
    cameraConnectorRegistry.delete(id);
  }

  const item = camOverlays.get(id);
  if (item?.connector) {
    try { item.connector.setMap(null); } catch {}
    item.connector = null;
  }
}

function removeAllCameraConnectors() {
  for (const id of Array.from(cameraConnectorRegistry.keys())) {
    removeConnectorsForCam(id);
  }
  for (const item of camOverlays.values()) {
    if (item?.connector) {
      try { item.connector.setMap(null); } catch {}
      item.connector = null;
    }
  }
}

function createCameraConnector(cameraLatLng, viewerLatLng) {
  try {
    const line = new kakao.maps.Polyline({
      map,
      path: [cameraLatLng, viewerLatLng],
      strokeWeight: 4,
      strokeColor: "#ef4444",
      strokeOpacity: 0.95,
      strokeStyle: "solid"
    });
    return line;
  } catch (err) {
    console.warn("camera connector create failed", err);
    return null;
  }
}

function updateCameraConnector(item) {
  if (!item?.connector || !item.cameraLatLng || !item.viewerLatLng) return;
  try { item.connector.setPath([item.cameraLatLng, item.viewerLatLng]); } catch {}
}

function installOverlayDrag(camId, wrap) {
  if (!wrap) return;
  wrap.classList.add("hls-viewer-draggable");
  let dragging = false;
  let startMouse = null;
  let startPoint = null;

  const isBlockedDragTarget = (target) => {
    if (!target) return false;
    return Boolean(target.closest?.('button, video, .overlay-actions, input, select, textarea, a'));
  };

  const finishDrag = () => {
    if (!dragging) return;
    dragging = false;
    wrap.classList.remove("dragging");
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    const item = camOverlays.get(camId);
    if (item?.viewerLatLng) setStatus(`${camId} HLS Viewer 위치 고정`);
  };

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = Number(e.clientX || 0) - startMouse.x;
    const dy = Number(e.clientY || 0) - startMouse.y;
    const nextPoint = clampViewerCenterToMap(new kakao.maps.Point(startPoint.x + dx, startPoint.y + dy), getViewerSize(wrap));
    const nextLatLng = latLngFromMapPoint(nextPoint);
    const item = camOverlays.get(camId);
    if (!item) return;
    item.viewerLatLng = nextLatLng;
    try { item.overlay?.setPosition?.(nextLatLng); } catch {}
    updateCameraConnector(item);
  }

  function onUp(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    finishDrag();
  }

  wrap.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (isBlockedDragTarget(e.target)) return;
    const item = camOverlays.get(camId);
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    suppressMapClick(500);
    dragging = true;
    wrap.classList.add("dragging");
    const currentLatLng = item.viewerLatLng || item.overlay?.getPosition?.() || item.cameraLatLng;
    startPoint = mapPointFromLatLng(currentLatLng);
    startMouse = { x: Number(e.clientX || 0), y: Number(e.clientY || 0) };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
    setStatus(`${camId} HLS Viewer 이동 중...`);
  }, true);
}

function flushPendingFocusCamera() {
  if (!pendingFocusCamId) return;
  if (!map || !Array.isArray(cameras) || cameras.length === 0) return;
  const camId = pendingFocusCamId;
  pendingFocusCamId = null;
  void focusCameraOnMap(camId);
}

async function focusCameraOnMap(camId) {
  const cam = cameras.find((it) => it.id === camId);
  if (!cam) {
    setStatus(`카메라를 찾을 수 없습니다: ${camId}`);
    return;
  }

  const lat = Number(cam.lat);
  const lng = Number(cam.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    setStatus(`카메라 좌표가 올바르지 않습니다: ${cam.name || cam.id}`);
    return;
  }

  const now = Date.now();
  const existing = camOverlays.get(cam.id);
  if (existing && lastFocusedCamId === cam.id && (now - lastFocusAt) < 1500) {
    const pos = new kakao.maps.LatLng(lat, lng);
    map.setCenter(pos);
    setStatus(`GIS 포커스 유지: ${cam.name || cam.id}`);
    notifyParent('gis-focus-done', { camId: cam.id });
    return;
  }

  lastFocusedCamId = cam.id;
  lastFocusAt = now;

  hideContextMenu();
  hideInfoOverlay();
  hideFormOverlay();

  const pos = new kakao.maps.LatLng(lat, lng);
  map.setCenter(pos);
  const currentLevel = typeof map.getLevel === 'function' ? map.getLevel() : 4;
  if (currentLevel > 5) map.setLevel(5);

  await closeOtherCameraOverlays(cam.id, false);

  if (camOverlays.has(cam.id)) {
    setStatus(`GIS 포커스 완료: ${cam.name || cam.id}`);
    notifyParent('gis-focus-done', { camId: cam.id });
    return;
  }

  try {
    releasedCameraIds.delete(cam.id);
    await openCameraStream(cam);
    setStatus(`GIS 포커스 완료: ${cam.name || cam.id}`);
    notifyParent('gis-focus-done', { camId: cam.id });
  } catch (e) {
    console.error(e);
    setStatus(`GIS 포커스 실패: ${e.message}`);
  }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchStreamStatus(camId) {
  try {
    const r = await fetch(`${API}/api/streams/status/${encodeURIComponent(camId)}`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function summarizeStreamStatus(status) {
  if (!status || typeof status !== "object") return "상태 정보 없음";
  const parts = [];
  parts.push(status.active ? "변환 요청됨" : "변환 대기 아님");
  parts.push(status.m3u8Exists ? "m3u8 있음" : "m3u8 없음");
  parts.push(`segments ${Number(status.segmentCount || 0)}`);
  if (Number.isFinite(Number(status.m3u8AgeSec))) parts.push(`m3u8 ${Number(status.m3u8AgeSec)}s`);
  if (status.conversionEngine) parts.push(`engine ${status.conversionEngine}`);
  if (status.logClass) parts.push(status.logClass);
  return parts.join(" · ");
}

function resolveHlsUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return value;
  }
}

function assertConvertedHlsUrlMatchesCam(camId, hlsUrl) {
  const url = String(hlsUrl || "");
  if (!camId || !url) return;
  const needle = `/media/${encodeURIComponent(camId)}/`;
  if (!url.includes(needle)) {
    throw new Error(`HLS URL camId mismatch: ${camId} / ${url}`);
  }
}

function readHlsStartupConfig() {
  const raw = dashboardConfig?.hlsStartup && typeof dashboardConfig.hlsStartup === "object"
    ? dashboardConfig.hlsStartup
    : {};
  const boolValue = (value, fallback) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (["1", "true", "yes", "y", "on", "enabled"].includes(v)) return true;
      if (["0", "false", "no", "n", "off", "disabled"].includes(v)) return false;
    }
    return fallback;
  };
  const intValue = (value, fallback, min, max) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const fastStart = boolValue(raw.fastStart, true);
  return {
    fastStart,
    minSegmentsToPlay: fastStart ? intValue(raw.minSegmentsToPlay, 1, 1, 10) : intValue(raw.minSegmentsToPlay, 3, 1, 10),
    maxM3u8AgeSec: intValue(raw.maxM3u8AgeSec, 6, 1, 60),
    initialWaitMs: intValue(raw.initialWaitMs, 3000, 500, 60000),
    backgroundWaitMs: intValue(raw.backgroundWaitMs, 60000, 10000, 300000),
    fastProbeIntervalMs: intValue(raw.fastProbeIntervalMs, 500, 200, 10000),
    retryIntervalMs: intValue(raw.retryIntervalMs, 1000, 500, 30000),
    statusIntervalMs: intValue(raw.statusIntervalMs, 1000, 500, 30000)
  };
}

function isHlsStatusReady(status) {
  if (!status || typeof status !== "object") return false;
  if (!status.m3u8Exists) return false;
  const startup = readHlsStartupConfig();
  if (Number(status.segmentCount || 0) < startup.minSegmentsToPlay) return false;
  const age = Number(status.m3u8AgeSec);
  if (Number.isFinite(age) && age > startup.maxM3u8AgeSec) return false;
  return true;
}

const HLS_INITIAL_WAIT_MS = 3000;
const HLS_BACKGROUND_WAIT_MS = 60000;
const HLS_FAST_PROBE_INTERVAL_MS = 500;
const HLS_RETRY_INTERVAL_MS = 1000;
const HLS_STATUS_INTERVAL_MS = 1000;

function hlsStartupTiming() {
  const s = readHlsStartupConfig();
  return {
    initialWaitMs: s.initialWaitMs,
    backgroundWaitMs: s.backgroundWaitMs,
    fastProbeIntervalMs: s.fastProbeIntervalMs,
    retryIntervalMs: s.retryIntervalMs,
    statusIntervalMs: s.statusIntervalMs
  };
}

async function waitForM3U8(url, initialWaitMs = HLS_INITIAL_WAIT_MS, intervalMs = HLS_FAST_PROBE_INTERVAL_MS, options = {}) {
  const camId = options.camId || "";
  const label = options.label || "HLS";
  const startedAt = Date.now();
  const softEnd = startedAt + initialWaitMs;
  const maxWaitMs = Number(options.maxWaitMs || Math.max(initialWaitMs, HLS_BACKGROUND_WAIT_MS));
  const hardEnd = startedAt + maxWaitMs;
  const retryIntervalMs = Number(options.retryIntervalMs || HLS_RETRY_INTERVAL_MS);
  const statusIntervalMs = Number(options.statusIntervalMs || HLS_STATUS_INTERVAL_MS);
  let lastStatusAt = 0;
  let lastStatus = null;

  while (Date.now() < hardEnd) {
    const now = Date.now();

    if (camId && (now - lastStatusAt >= statusIntervalMs || !lastStatus)) {
      lastStatusAt = now;
      lastStatus = await fetchStreamStatus(camId);
      if (isHlsStatusReady(lastStatus)) {
        return { ok: true, status: lastStatus, elapsedMs: Date.now() - startedAt };
      }
    } else if (!camId) {
      try {
        const probeUrl = hlsWithCacheBuster(url);
        const r = await fetch(probeUrl, { method: "GET", cache: "no-store" });
        if (r.ok) return { ok: true, status: lastStatus, elapsedMs: Date.now() - startedAt };
      } catch {}
    }

    const afterInitialWait = now >= softEnd;
    if (camId && afterInitialWait) {
      const elapsedSec = Math.max(0, Math.ceil((now - startedAt) / 1000));
      setStatus(`${label} 변환 준비 중... ${summarizeStreamStatus(lastStatus)} · ${elapsedSec}s · 계속 재시도`);
    }
    await wait(afterInitialWait ? retryIntervalMs : intervalMs);
  }

  if (camId && !lastStatus) lastStatus = await fetchStreamStatus(camId);
  return { ok: false, status: lastStatus, elapsedMs: Date.now() - startedAt };
}

async function continueHlsRetryUntilReady(cam, hlsUrl) {
  const item = camOverlays.get(cam.id);
  if (!item || item.retrying || item.isClosed) return;
  item.retrying = true;
  const label = `${cam.name || cam.id} HLS`;
  markViewerPreparing(cam.id, `${label} 변환이 지연되고 있습니다. 카메라 상태를 확인하며 계속 재시도합니다.`);

  let restartAttempts = 0;
  while (camOverlays.has(cam.id)) {
    const currentBefore = camOverlays.get(cam.id);
    if (!currentBefore || currentBefore.isClosed || currentBefore.isReady) return;

    const timing = hlsStartupTiming();
    const ready = await waitForM3U8(hlsUrl, 0, timing.fastProbeIntervalMs, {
      camId: cam.id,
      label,
      maxWaitMs: 10000,
      retryIntervalMs: timing.retryIntervalMs,
      statusIntervalMs: timing.statusIntervalMs
    });
    if (ready.ok && camOverlays.has(cam.id)) {
      const current = camOverlays.get(cam.id);
      if (!current || current.isClosed || current.isReady) return;
      try {
        setStatus(`${label} 준비 완료. GIS HLS Viewer 재생을 시작합니다.`);
        detachHlsKeepLastFrame(current);
        const started = startPlaybackInVideo(current.videoEl, hlsUrl, {
          camId: cam.id,
          label: `${cam.id} HLS`,
          onReady: () => markViewerReady(cam.id, `${cam.id} HLS`),
          hardReloadThreshold: 8,
      hardReloadMinAgeMs: 60000,
      preferPlayerOnlyHardReload: true,
      onHardReload: (why) => restartOverlayPlayback(cam.id, why)
        });
        current.hls = started.hls || null;
        current.retrying = false;
      } catch (err) {
        current.retrying = false;
        setStatus(`${label} 재생 시작 실패: ${err?.message || String(err)}`);
      }
      return;
    }
    if (!camOverlays.has(cam.id)) return;

    if (!releasedCameraIds.has(cam.id) && camOverlays.has(cam.id) && ready.status && ready.status.sourceType === "rtsp" && ready.status.active === false && restartAttempts < 3) {
      restartAttempts += 1;
      try {
        setStatus(`${label} 변환 요청이 해제되어 재요청합니다. (${restartAttempts}/3)`);
        const resp = await apiPost("/api/streams/request", { camId: cam.id, source: "viewer-click" });
        hlsUrl = resolveHlsUrl(resp?.hls || hlsUrl || `/media/${cam.id}/stream.m3u8`);
        const latest = camOverlays.get(cam.id);
        if (latest) {
          latest.hlsUrl = hlsUrl;
          latest.sessionId = resp?.sessionId || latest.sessionId || null;
        }
      } catch (err) {
        console.warn("[stream re-request failed]", cam.id, err);
      }
    }

    const summary = summarizeStreamStatus(ready.status);
    setStatus(`${label} 아직 준비되지 않았습니다. ${summary} · 계속 재시도 중`);
    await wait(HLS_RETRY_INTERVAL_MS);
  }
}

function schedulePlaybackRetries(video, label = "재생", options = {}) {
  const retryDelays = [300, 800, 1500, 2500, 4000];
  let retryTimerIds = [];
  let readyCalled = false;

  const markReady = () => {
    if (readyCalled) return;
    readyCalled = true;
    try { if (typeof options.onReady === "function") options.onReady(); } catch {}
    clearRetries();
  };

  const clearRetries = () => {
    for (const id of retryTimerIds) clearTimeout(id);
    retryTimerIds = [];
    video.removeEventListener("playing", markReady);
    video.removeEventListener("loadeddata", markReady);
    video.removeEventListener("canplay", retryPlayNow);
    video.removeEventListener("loadedmetadata", retryPlayNow);
  };

  const retryPlayNow = () => {
    try {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  };

  video.addEventListener("playing", markReady, { once: true });
  video.addEventListener("loadeddata", markReady, { once: true });
  video.addEventListener("canplay", retryPlayNow);
  video.addEventListener("loadedmetadata", retryPlayNow);

  retryTimerIds = retryDelays.map((delay) => setTimeout(retryPlayNow, delay));
  setStatus(`${label} 준비중...`);
  return { clear: clearRetries, markReady };
}


function ensureFreezeFrameOverlay(item) {
  if (!item || !item.videoEl) return null;
  if (item.freezeOverlay && item.freezeOverlay.isConnected) return item.freezeOverlay;
  const parent = item.videoEl.parentElement || item.rootEl;
  if (!parent) return null;
  try { parent.style.position = parent.style.position || "relative"; } catch {}
  const overlay = document.createElement("div");
  overlay.className = "hls-freeze-frame-overlay";
  overlay.style.cssText = [
    "position:absolute", "inset:0", "display:none", "align-items:center", "justify-content:center",
    "background:#000 center center / cover no-repeat", "color:#fff", "font-size:13px", "font-weight:800",
    "text-shadow:0 1px 3px rgba(0,0,0,.9)", "border-radius:10px", "z-index:8", "pointer-events:none"
  ].join(";");
  const msg = document.createElement("div");
  msg.className = "hls-freeze-frame-message";
  msg.style.cssText = "position:absolute;left:8px;right:8px;bottom:8px;padding:6px 8px;border-radius:8px;background:rgba(0,0,0,.55);text-align:center;";
  msg.textContent = "재연결 중... 마지막 화면 유지";
  overlay.appendChild(msg);
  parent.appendChild(overlay);
  item.freezeOverlay = overlay;
  item.freezeOverlayMessage = msg;
  return overlay;
}

function showFreezeFrameOverlay(item, reason = "재연결 중... 마지막 화면 유지") {
  if (!item || !item.videoEl) return;
  const overlay = ensureFreezeFrameOverlay(item);
  if (!overlay) return;
  const video = item.videoEl;
  let captured = false;
  try {
    const w = Math.max(2, Math.floor(video.videoWidth || video.clientWidth || 640));
    const h = Math.max(2, Math.floor(video.videoHeight || video.clientHeight || 360));
    if (w > 2 && h > 2 && Number(video.readyState || 0) >= 2) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      overlay.style.backgroundImage = `url(${dataUrl})`;
      captured = true;
    }
  } catch (err) {
    console.warn("[FREEZE_FRAME_CAPTURE_FAIL]", item?.rootEl?.dataset?.camId || "", err);
  }
  if (!captured && item.lastFreezeDataUrl) {
    overlay.style.backgroundImage = `url(${item.lastFreezeDataUrl})`;
  }
  if (captured) item.lastFreezeDataUrl = overlay.style.backgroundImage.slice(4, -1).replace(/^"|"$/g, "");
  if (item.freezeOverlayMessage) item.freezeOverlayMessage.textContent = reason;
  overlay.style.display = "flex";
  item.freezeVisible = true;
  try { item.rootEl?.classList?.add("is-freeze-frame"); } catch {}
}

function hideFreezeFrameOverlay(item) {
  if (!item) return;
  if (item.freezeOverlay) item.freezeOverlay.style.display = "none";
  item.freezeVisible = false;
  try { item.rootEl?.classList?.remove("is-freeze-frame"); } catch {}
}

function destroyPlaybackState(target) {
  if (!target) return;
  try { hideFreezeFrameOverlay(target); } catch {}
  try { if (target.hls && typeof target.hls.destroy === "function") target.hls.destroy(); } catch {}
  target.hls = null;
  const video = target.videoEl;
  if (!video) return;
  try { video.pause(); } catch {}
  try { video.removeAttribute("src"); } catch {}
  try { video.removeAttribute("data-hls-url"); } catch {}
  try { video.load(); } catch {}
}

function detachHlsKeepLastFrame(target) {
  // Used during reconnect. Do not clear video.src or call load(); most browsers
  // keep the last decoded frame visible while the new HLS window is prepared.
  if (!target) return;
  showFreezeFrameOverlay(target, "재연결 중... 마지막 화면 유지");
  try { if (target.hls && typeof target.hls.destroy === "function") target.hls.destroy(); } catch {}
  target.hls = null;
}

function hideSourceOverlayForExpanded(camId) {
  const item = camOverlays.get(camId);
  if (!item?.rootEl) return;
  item.rootEl.style.visibility = "hidden";
  item.rootEl.style.pointerEvents = "none";
}

function restoreSourceOverlayFromExpanded(camId) {
  const item = camOverlays.get(camId);
  if (!item?.rootEl) return;
  item.rootEl.style.visibility = "";
  item.rootEl.style.pointerEvents = "";
}

function closeExpandedViewer() {
  if (expandedViewer?.camId) {
    restoreSourceOverlayFromExpanded(expandedViewer.camId);
  }
  destroyPlaybackState(expandedViewer);
  expandedViewer = null;
  if (expandedViewerLayer) expandedViewerLayer.classList.add("hidden");
}

function openExpandedViewer(cam) {
  const item = camOverlays.get(cam.id);
  if (!item || !item.hlsUrl || !expandedViewerLayer || !expandedViewerVideo) return;

  if (expandedViewer?.camId === cam.id) {
    expandedViewerLayer.classList.remove("hidden");
    setStatus(`확대 화면 유지: ${cam.name || cam.id}`);
    return;
  }

  closeExpandedViewer();
  hideSourceOverlayForExpanded(cam.id);

  expandedViewer = { camId: cam.id, videoEl: expandedViewerVideo, hls: null, hlsUrl: item.hlsUrl };
  expandedViewerTitle.textContent = `확대 화면 · ${cam.name || cam.id} (${cam.id})`;
  expandedViewerVideo.controls = true;
  expandedViewerVideo.muted = true;
  expandedViewerVideo.defaultMuted = true;
  expandedViewerVideo.autoplay = true;
  expandedViewerVideo.playsInline = true;
  expandedViewerVideo.disablePictureInPicture = true;
  expandedViewerVideo.controlsList = "nodownload noplaybackrate noremoteplayback nofullscreen";
  expandedViewerVideo.setAttribute("disablePictureInPicture", "");
  expandedViewerVideo.setAttribute("controlsList", "nodownload noplaybackrate noremoteplayback nofullscreen");
  expandedViewerLayer.classList.remove("hidden");
  const started = startPlaybackInVideo(expandedViewerVideo, resolveHlsUrl(item.hlsUrl), { camId: cam.id, label: `${cam.id} HLS 확대` });
  expandedViewer.hls = started.hls || null;
  setStatus(`확대 화면 표시: ${cam.name || cam.id}`);
}

function hlsWithCacheBuster(url) {
  return url + (url.includes("?") ? "&" : "?") + "_reload=" + Date.now();
}

function isExplicit404HlsError(data) {
  const responseCode = Number(data?.response?.code || data?.networkDetails?.status || 0);
  return responseCode === 404;
}

function isHlsNetworkishError(data) {
  const details = String(data?.details || "").toLowerCase();
  const responseCode = Number(data?.response?.code || data?.networkDetails?.status || 0);
  return responseCode === 404 || details.includes("frag") || details.includes("level") || details.includes("manifest") || details.includes("network");
}

function attachHlsRecovery(hls, video, url, label = "HLS", options = {}) {
  let consecutiveErrors = 0;
  let reloadTimer = null;
  let hardReloadTimer = null;
  const hardReloadThreshold = Number(options.hardReloadThreshold || 4);
  const hardReloadMinAgeMs = Number(options.hardReloadMinAgeMs || 15000);
  const playbackStartedAt = Date.now();

  const performLocalReload = (reason, delayMs = 700) => {
    if (reloadTimer) return;
    setStatus(`${label} 재연결 중: ${reason || "HLS 오류"}`);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      try {
        hls.stopLoad();
        hls.loadSource(hlsWithCacheBuster(url));
        hls.startLoad(-1);
        video.play().catch(() => {});
      } catch (err) {
        console.warn("[HLS recovery reload failed]", err);
        hardReload("HLS reload 실패");
      }
    }, delayMs);
  };

  const hardReload = (reason) => {
    if (hardReloadTimer) return true;
    const camId = options.camId || "";
    const item = camId ? camOverlays.get(camId) : null;
    if (camId && item && options.preferPlayerOnlyHardReload !== false) {
      item.playerOnlyHardReloadCount = Number(item.playerOnlyHardReloadCount || 0) + 1;
      const ageMs = Date.now() - playbackStartedAt;
      if (ageMs < hardReloadMinAgeMs || item.playerOnlyHardReloadCount <= 3) {
        consecutiveErrors = Math.max(0, hardReloadThreshold - 1);
        console.warn(`[PLAYER_ONLY_HARD_RELOAD] ${camId} reason=${reason || "HLS 오류 반복"} count=${item.playerOnlyHardReloadCount}`);
        playerOnlyRecover(camId, reason || "HLS 오류 반복");
        return true;
      }
    }
    if (typeof options.onHardReload !== "function") return false;
    setStatus(`${label} 전체 재시작 요청 중: ${reason || "HLS 오류 반복"}`);
    hardReloadTimer = setTimeout(async () => {
      hardReloadTimer = null;
      try {
        await options.onHardReload(reason || "HLS 오류 반복");
      } catch (err) {
        console.warn("[HLS hard reload failed]", err);
      }
    }, 500);
    return true;
  };

  const reloadSource = (reason) => {
    if (consecutiveErrors >= hardReloadThreshold && hardReload(reason)) return;
    performLocalReload(reason);
  };

  hls.on(Hls.Events.FRAG_LOADED, () => { consecutiveErrors = 0; clearStatusWhenAllViewersReady(250); });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    console.warn("[HLS ERROR]", label, data);
    const is404 = isExplicit404HlsError(data);
    const networkish = isHlsNetworkishError(data);
    if (!data?.fatal) {
      if (is404) {
        consecutiveErrors += 1;
        reloadSource("segment/playlist 404 감지");
      } else if (networkish) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 2) reloadSource("segment/playlist 지연");
        else { try { hls.startLoad(-1); } catch {} }
      }
      return;
    }
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      consecutiveErrors += 1;
      if (isExplicit404HlsError(data)) reloadSource("segment/playlist 404 감지");
      else if (consecutiveErrors >= 2) reloadSource("네트워크 오류");
      else { try { hls.startLoad(-1); } catch { reloadSource("네트워크 오류"); } }
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= hardReloadThreshold && hardReload("미디어 오류 반복")) return;
      try { hls.recoverMediaError(); } catch { reloadSource("미디어 오류"); }
      return;
    }
    reloadSource("복구 불가 오류");
  });
}

function isSafariNativeHlsBrowser() {
  const ua = navigator.userAgent || "";
  const vendor = navigator.vendor || "";
  return /Safari/i.test(ua)
    && /Apple/i.test(vendor)
    && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|Android/i.test(ua);
}

function startPlaybackInVideo(video, url, options = {}) {
  const camId = options.camId || "";
  if (camId) setViewerState(camId, "preparing", options.label || "HLS");
  // Chrome/Edge/Firefox에서는 native HLS가 아니라 HLS.js를 우선 사용해야 합니다.
  // 일부 Chrome 환경에서 canPlayType('application/vnd.apple.mpegurl')가 truthy가 되어도
  // 실제 m3u8/fMP4 재생이 멈추는 경우가 있어 Safari 계열에서만 native HLS를 허용합니다.
  try { video.setAttribute("data-hls-url", url); } catch {}

  const markReady = () => {
    try { if (typeof options.onReady === "function") options.onReady(); } catch {}
    clearStatusWhenAllViewersReady(250);
  };

  if (window.Hls && window.Hls.isSupported()) {
    const ytnMode = String(camId || "").toLowerCase() === "video1";
    const hls = new Hls({
      lowLatencyMode: false,
      autoStartLoad: true,
      ...(ytnMode ? { liveSyncDuration: 3, liveMaxLatencyDuration: 10 } : { liveSyncDurationCount: 4, liveMaxLatencyDurationCount: 10 }),
      maxBufferLength: ytnMode ? 30 : 15,
      maxMaxBufferLength: 30,
      manifestLoadingTimeOut: 10000,
      fragLoadingTimeOut: 12000,
      fragLoadingMaxRetry: 6,
      manifestLoadingMaxRetry: 6,
      levelLoadingMaxRetry: 6
    });
    hls.loadSource(hlsWithCacheBuster(url));
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (camId) setViewerState(camId, "manifest", "MANIFEST_PARSED");
      schedulePlaybackRetries(video, "HLS.js", { onReady: markReady });
      markReady();
    });
    hls.on(Hls.Events.LEVEL_LOADED, () => {
      if (camId) { markPlayerAliveFromHls(camId, "LEVEL_LOADED"); keepYtnViewerBehindLiveEdge(camId, "LEVEL_LOADED"); }
      schedulePlaybackRetries(video, "HLS.js", { onReady: markReady });
    });
    hls.on(Hls.Events.FRAG_LOADED, () => { if (camId) { markPlayerAliveFromHls(camId, "FRAG_LOADED"); keepYtnViewerBehindLiveEdge(camId, "FRAG_LOADED"); } markReady(); });
    hls.on(Hls.Events.FRAG_CHANGED, () => { if (camId) { markPlayerAliveFromHls(camId, "FRAG_CHANGED"); keepYtnViewerBehindLiveEdge(camId, "FRAG_CHANGED"); } markReady(); });
    attachHlsRecovery(hls, video, url, options.label || "HLS", options);
    if (camId) startPlayerStallMonitor(camId, video, { stallThresholdMs: options.stallThresholdMs || 8000, freshAgeSec: options.freshAgeSec || 8 });
    return { hls };
  }

  const canNative = video.canPlayType("application/vnd.apple.mpegurl");
  if (isSafariNativeHlsBrowser() && canNative) {
    video.src = hlsWithCacheBuster(url);
    schedulePlaybackRetries(video, "Safari 네이티브 HLS", { onReady: markReady });
    if (camId) startPlayerStallMonitor(camId, video, { stallThresholdMs: options.stallThresholdMs || 8000, freshAgeSec: options.freshAgeSec || 8 });
    return { hls: null };
  }

  const message = "HLS.js가 로드되지 않았습니다. 네트워크/CDN 접근 또는 hls.js 스크립트 로드를 확인하세요.";
  setStatus(message);
  throw new Error(message);
}

async function restartOverlayPlayback(camId, reason = "HLS 재시작") {
  if (releasedCameraIds.has(camId) || !camOverlays.has(camId)) return;
  const item = camOverlays.get(camId);
  if (!item || item.isClosed || item.restarting) return;
  const now = Date.now();
  if (!item.restartWindowStartMs || now - item.restartWindowStartMs > 10 * 60 * 1000) {
    item.restartWindowStartMs = now;
    item.restartCount = 0;
  }
  item.restartCount = Number(item.restartCount || 0) + 1;
  if (item.restartCount > 6) {
    // Do not leave the viewer permanently dead.  Back off, keep the last frame,
    // and continue status polling so the converter watchdog can recover the stream.
    setStatus(`${camId} HLS 재시작이 반복되어 15초 후 다시 확인합니다: ${reason}`);
    const cam = cameras.find((c) => c.id === camId) || { id: camId, name: camId };
    setTimeout(() => {
      const latest = camOverlays.get(camId);
      if (latest && !latest.isClosed) {
        latest.restartCount = 0;
        latest.restarting = false;
        continueHlsRetryUntilReady(cam, latest.hlsUrl || `/media/${camId}/stream.m3u8`);
      }
    }, 15000);
    return;
  }
  item.restarting = true;
  try {
    // Keep the existing viewer and last frame visible. Only detach HLS.js.
    markViewerPreparing(camId, `${camId} 영상 재연결 중... 현재 화면을 유지한 상태로 변환을 재시작합니다.`);
    detachHlsKeepLastFrame(item);
    const resp = await apiPost("/api/streams/request", { camId, reconnect: true, forceRestart: true, source: "reconnect" });
    if (resp?.evicted?.id && resp.evicted.id !== camId) {
      await closeCameraOverlay(resp.evicted.id, false);
    }
    const hlsUrl = resolveHlsUrl(resp?.hls || item.hlsUrl || `/media/${camId}/stream.m3u8`);
    item.hlsUrl = hlsUrl;
    item.sessionId = resp?.sessionId || item.sessionId || null;
    const timing = hlsStartupTiming();
    const ready = await waitForM3U8(hlsUrl, timing.initialWaitMs, timing.fastProbeIntervalMs, {
      camId,
      label: `${camId} HLS`,
      maxWaitMs: timing.backgroundWaitMs,
      retryIntervalMs: timing.retryIntervalMs,
      statusIntervalMs: timing.statusIntervalMs
    });
    if (!camOverlays.has(camId)) return;
    if (!ready.ok) {
      setStatus(`${camId} HLS 재연결 지연: ${summarizeStreamStatus(ready.status)} · 기존 화면 유지 중`);
      const cam = cameras.find((c) => c.id === camId) || { id: camId, name: camId };
      item.restarting = false;
      continueHlsRetryUntilReady(cam, hlsUrl);
      return;
    }
    detachHlsKeepLastFrame(item);
    const started = startPlaybackInVideo(item.videoEl, hlsUrl, {
      camId,
      label: `${camId} HLS`,
      onReady: () => markViewerReady(camId, `${camId} HLS`),
      hardReloadThreshold: 8,
      hardReloadMinAgeMs: 60000,
      preferPlayerOnlyHardReload: true,
      onHardReload: (why) => restartOverlayPlayback(camId, why)
    });
    item.hls = started.hls || null;
    clearStatusWhenAllViewersReady(250);
  } catch (err) {
    setStatus(`${camId} HLS 재연결 실패: ${err?.message || String(err)}`);
  } finally {
    const latest = camOverlays.get(camId);
    if (latest) latest.restarting = false;
  }
}

async function openCameraStream(cam) {
  const existing = existingViewerForCamera(cam.id);
  if (existing) {
    // v76.08: one GIS HLS Viewer per camId. Do not create duplicates.
    if (existing.orphan) {
      await removeOrphanViewerElement(existing.element, false);
    } else {
      await cleanupDuplicateViewersForCam(cam.id, existing.element);
      bringOverlayToFront(cam.id, existing.element);
      setStatus(`${cam.name || cam.id} Viewer가 이미 열려 있습니다. 기존 Viewer를 앞으로 가져왔습니다.`);
      const st = camOverlays.get(cam.id);
      if (st?.isReady === false && st?.hlsUrl && !st.reconnecting) {
        continueHlsRetryUntilReady(cam, st.hlsUrl);
      }
      return;
    }
  }

  if (openingCameraIds.has(cam.id)) {
    setStatus(`${cam.name || cam.id} Viewer를 여는 중입니다. 중복 요청을 무시합니다.`);
    return;
  }
  openingCameraIds.add(cam.id);

  evictOldestCamOverlayIfNeeded();

  // v77.01: a deliberate new open must cancel the local closed guard for this camId.
  // Old async callbacks still check camOverlays/isClosed, while this lets the fresh viewer request proceed.
  releasedCameraIds.delete(cam.id);

  setStatus(`스트림 사전 점검 및 요청: ${cam.id}`);
  let resp;
  try {
    resp = await apiPost("/api/streams/request", { camId: cam.id, source: "viewer-click" });
  } catch (err) {
    const reason = err?.precheck?.reason || err?.message || "카메라 접속 상태를 확인할 수 없습니다.";
    setStatus(`${cam.name || cam.id} 접속 불가: ${reason}`);
    openingCameraIds.delete(cam.id);
    throw err;
  }

  if (resp?.evicted?.id) {
    await closeCameraOverlay(resp.evicted.id, false);
    setStatus(`리소스 보호: 오래된 카메라 ${resp.evicted.name || resp.evicted.id}를 닫고 ${cam.name || cam.id}를 엽니다.`);
  }

  const wrap = createCardBase();
  wrap.classList.add("hls-viewer-draggable");
  wrap.dataset.hlsViewerCamId = cam.id;
  wrap.dataset.camId = cam.id;
  wrap.style.width = "360px";
  wrap.style.position = "relative";

  const header = document.createElement("div");
  header.className = "overlay-header";
  header.style.marginBottom = "8px";
  const title = createTitle(`📷 ${cam.name || cam.id} (${cam.id})`);
  title.style.marginBottom = "0";
  title.classList.add("overlay-title");
  const actions = document.createElement("div");
  actions.className = "overlay-actions";
  actions.style.position = "relative";
  actions.style.zIndex = "100";
  const camViewBtn = document.createElement("button");
  camViewBtn.type = "button";
  camViewBtn.textContent = "확대보기";
  camViewBtn.className = "action-btn";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "닫기";
  closeBtn.className = "close";
  closeBtn.style.position = "relative";
  closeBtn.style.zIndex = "101";
  actions.appendChild(camViewBtn);
  actions.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(actions);
  wrap.appendChild(header);

  const meta = document.createElement("div");
  const modeLabel = resp?.sourceType === "rtsp+" || resp?.alwaysOn === true
    ? "RTSP+ 상시 HLS"
    : resp?.streamMode === "direct" ? "Direct HLS" : "RTSP→HLS";
  meta.textContent = `재생 방식: ${modeLabel}`;
  meta.style.cssText = "font-size:12px; font-weight:700; color:#333; margin-bottom:8px;";
  wrap.appendChild(meta);

  const video = document.createElement("video");
  video.controls = true;
  video.autoplay = true;
  video.muted = true;
  video.defaultMuted = true;
  video.disablePictureInPicture = true;
  video.controlsList = "nodownload noplaybackrate noremoteplayback nofullscreen";
  video.setAttribute("muted", "");
  video.setAttribute("autoplay", "");
  video.setAttribute("disablePictureInPicture", "");
  video.setAttribute("controlsList", "nodownload noplaybackrate noremoteplayback nofullscreen");
  video.setAttribute("playsinline", "");
  video.playsInline = true;
  video.style.cssText = "width:100%; height:200px; background:#000; border-radius:10px; outline:none; display:block;";
  const videoBox = document.createElement("div");
  videoBox.className = "hls-video-box";
  videoBox.style.cssText = "position:relative;width:100%;height:200px;background:#000;border-radius:10px;overflow:hidden;";
  videoBox.appendChild(video);
  wrap.appendChild(videoBox);

  const cameraLatLng = new kakao.maps.LatLng(Number(cam.lat), Number(cam.lng));
  const viewerLatLng = getInitialViewerLatLng(cam, getViewerSize(wrap));
  removeConnectorsForCam(cam.id);
  const connector = registerCameraConnector(cam.id, createCameraConnector(cameraLatLng, viewerLatLng));

  const overlay = new kakao.maps.CustomOverlay({
    content: wrap,
    position: viewerLatLng,
    xAnchor: 0.5,
    yAnchor: 0.5,
    zIndex: 9000
  });
  overlay.setMap(map);

  wrap.addEventListener("mousedown", (e) => e.stopPropagation());
  wrap.addEventListener("click", (e) => e.stopPropagation());

  camViewBtn.onclick = (e) => {
    e.stopPropagation();
    notifyParent("open-camera-in-cam-mode", {
      camId: cam.id,
      camName: cam.name || cam.id
    });
    setStatus(`CAM 모드 전환 요청: ${cam.name || cam.id}`);
  };

  const closeHandler = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await closeCameraOverlay(cam.id, true);
  };
  closeBtn.onclick = closeHandler;
  closeBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
  closeBtn.addEventListener("click", closeHandler, true);

  camOverlays.set(cam.id, {
    overlay,
    videoEl: video,
    hls: null,
    openedAt: Date.now(),
    rootEl: wrap,
    hlsUrl: null,
    sessionId: resp?.sessionId || null,
    cameraLatLng,
    viewerLatLng,
    connector,
    isReady: false,
    isClosed: false,
    retrying: false,
    restarting: false,
    restartCount: 0,
    playerState: "idle",
    playerStateDetail: "",
    lastPlayerOnlyRecoverAt: 0,
    playerOnlyRecoverCount: 0,
    playerOnlyHardReloadCount: 0,
    lastPlayerAliveAt: 0,
    lastVideoMoveAt: 0,
    freezeOverlay: null,
    freezeOverlayMessage: null,
    freezeVisible: false,
    lastFreezeDataUrl: null,
    stallTimer: null,
    keepAliveTimer: null
  });
  openingCameraIds.delete(cam.id);
  installOverlayDrag(cam.id, wrap);
  updateCameraConnector(camOverlays.get(cam.id));
  bringOverlayToFront(cam.id, wrap);
  void cleanupDuplicateViewersForCam(cam.id, wrap);
  startViewerKeepAlive(cam.id);

  const hlsUrl = resolveHlsUrl(resp?.hls || `/media/${cam.id}/stream.m3u8`);
  if (resp?.streamMode === "converted") assertConvertedHlsUrlMatchesCam(cam.id, hlsUrl);
  { const it = camOverlays.get(cam.id); if (it) { it.hlsUrl = hlsUrl; it.sessionId = resp?.sessionId || it.sessionId || null; } }
  const shouldWait = Boolean(resp?.waitForReady);

  if (shouldWait) {
    markViewerPreparing(cam.id, `HLS 변환 시작 요청 완료: ${cam.name || cam.id} · 뷰어를 먼저 표시하고 빠른 시작 조건을 확인합니다.`);
    const timing = hlsStartupTiming();
    const ready = await waitForM3U8(hlsUrl, timing.initialWaitMs, timing.fastProbeIntervalMs, {
      camId: cam.id,
      label: `${cam.name || cam.id} HLS`,
      maxWaitMs: timing.backgroundWaitMs,
      retryIntervalMs: timing.retryIntervalMs,
      statusIntervalMs: timing.statusIntervalMs
    });
    if (!ready.ok) {
      const summary = summarizeStreamStatus(ready.status);
      setStatus(`HLS 변환이 지연되고 있습니다. ${summary} · 뷰어를 유지하고 계속 재시도합니다.`);
      continueHlsRetryUntilReady(cam, hlsUrl);
      return;
    }
  } else {
    setStatus(`직접 HLS 재생 준비: ${hlsUrl}`);
  }

  setStatus("GIS HLS Viewer 재생 시작");
  try {
    const started = startPlaybackInVideo(video, hlsUrl, {
      camId: cam.id,
      label: `${cam.id} HLS`,
      onReady: () => markViewerReady(cam.id, `${cam.id} HLS`),
      hardReloadThreshold: 8,
      hardReloadMinAgeMs: 60000,
      preferPlayerOnlyHardReload: true,
      onHardReload: (why) => restartOverlayPlayback(cam.id, why)
    });
    const it = camOverlays.get(cam.id);
    if (it) it.hls = started.hls || null;
  } catch (err) {
    await closeCameraOverlay(cam.id, true);
    throw err;
  }
}

function initMap() {
  const cfg = normalizeDashboardConfig(dashboardConfig);
  map = new kakao.maps.Map(document.getElementById("map"), {
    center: new kakao.maps.LatLng(cfg.map.centerLat, cfg.map.centerLng),
    level: cfg.map.level
  });

  const node = map.getNode();
  if (node) {
    node.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  kakao.maps.event.addListener(map, "rightclick", (e) => {
    if (!editMode) return;
    showContextMenu(e.latLng);
  });

  kakao.maps.event.addListener(map, "click", (e) => {
    if (Date.now() < suppressMapClickUntil) return;
    if (formOpen) return;

    hideContextMenu();

    if (deleteMode) {
      setStatus("삭제 모드: 삭제할 SITE 영역을 클릭하세요");
      return;
    }

    if (drawing) {
      drawingPoints.push(e.latLng);
      updatePreview();
      setStatus(`점 추가: ${drawingPoints.length}개`);
    } else {
      hideInfoOverlay();
    }
  });
}

async function loadAll() {
  const cfg = await apiGet("/api/dashboard-config").catch(() => null);
  dashboardConfig = normalizeDashboardConfig(cfg);

  const s = await apiGet("/api/sites");
  sites = s.sites || [];

  const cams = await apiGet("/api/cameras");
  cameras = Array.isArray(cams.cameras) ? cams.cameras : [];
}

window.addEventListener('message', (ev) => {
  const data = ev.data || {};
  if (!data || typeof data !== 'object') return;
  if (data.type === 'focusCameraOnMap' && data.camId) {
    pendingFocusCamId = data.camId;
    flushPendingFocusCamera();
  }
});

function boot() {
  gisBootReady = false;
  if (!window.kakao?.maps) {
    console.error("Kakao Maps SDK not loaded yet.");
    setStatus("지도 SDK 로드 실패 (index.html의 Kakao SDK script 순서 확인)");
    return;
  }
  if (!document.getElementById("map")) {
    console.error("#map element not found.");
    return;
  }

  (async () => {
    try {
      await loadAll();
      initMap();
      renderSites();
      renderCameras();
      gisBootReady = true;
      notifyParent('gis-ready');
      flushPendingFocusCamera();
      setStatus("준비 완료 (편집모드 ON/OFF, 카메라 클릭→영상)");
    } catch (e) {
      console.error(e);
      setStatus("초기화 실패 (콘솔 확인)");
    }
  })();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
