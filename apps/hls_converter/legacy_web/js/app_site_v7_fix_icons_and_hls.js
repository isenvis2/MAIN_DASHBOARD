// app_site_v7_fix_icons_and_hls.js
// Fix: camera icons disappeared -> robust marker image fallback + boot after DOM/Kakao ready.
// Adds camera click -> /api/streams/request -> wait m3u8 -> Hls.js playback in overlay.

const API = ""; // same origin

const statusText = document.getElementById("statusText");
const reloadBtn = document.getElementById("reloadBtn");
const toggleEditBtn = document.getElementById("toggleEditBtn");
function setStatus(t){ if(statusText) statusText.textContent = t; }

// ===== State =====
let map;

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

// Camera overlays: camId -> { overlay, videoEl, hls, openedAt }
const camOverlays = new Map();
const MAX_CAM_OVERLAYS = 20;

// ★ map click suppression after polygon click (prevents immediate close)
let suppressMapClickUntil = 0;
function suppressMapClick(ms = 250){ suppressMapClickUntil = Date.now() + ms; }

// ===== Buttons =====
toggleEditBtn?.addEventListener("click", ()=>{
  editMode = !editMode;

  if(!editMode){
    deleteMode = false;
    cancelDrawing();
    hideContextMenu();
    hideFormOverlay();
    setStatus("편집모드 OFF");
  }else{
    setStatus("편집모드 ON (지도 우클릭 메뉴)");
  }
});

reloadBtn?.addEventListener("click", async ()=>{
  try{
    await loadAll();
    renderSites();
    renderCameras();
    setStatus("재로딩 완료");
  }catch(e){
    console.error(e);
    setStatus("재로딩 실패 (콘솔 확인)");
  }
});

// ===== API =====
async function apiGet(url){
  const r = await fetch(`${API}${url}`, { cache:"no-store" });
  if(!r.ok) throw new Error(`GET ${url} failed`);
  return r.json();
}
async function apiPut(url, body){
  const r = await fetch(`${API}${url}`,{
    method:"PUT",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(()=> ({}));
  if(!r.ok) throw new Error(data?.error || `PUT ${url} failed`);
  return data;
}
async function apiPost(url, body){
  const r = await fetch(`${API}${url}`,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(()=> ({}));
  if(!r.ok) throw new Error(data?.error || `POST ${url} failed`);
  return data;
}

// ===== Overlay helpers =====
function hideContextMenu(){
  if(ctxOverlay){ try{ ctxOverlay.setMap(null); }catch{} ctxOverlay = null; }
}
function hideInfoOverlay(){
  if(infoOverlay){ try{ infoOverlay.setMap(null); }catch{} infoOverlay = null; }
}
function hideFormOverlay(){
  if(formOverlay){ try{ formOverlay.setMap(null); }catch{} formOverlay = null; }
  formOpen = false;
}

// ===== UI builders =====
function createCardBase(){
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
function createTitle(text){
  const t = document.createElement("div");
  t.textContent = text;
  t.style.cssText = "font-weight:900; font-size:16px; margin-bottom:8px; color:#111;";
  return t;
}

// ===== Context menu =====
function buildContextMenuElement(){
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

function showContextMenu(latlng){
  hideContextMenu();
  if(!editMode) return;

  const div = buildContextMenuElement();

  ctxOverlay = new kakao.maps.CustomOverlay({
    content: div,
    position: latlng,
    xAnchor: 0,
    yAnchor: 0,
    zIndex: 9999
  });
  ctxOverlay.setMap(map);

  div.addEventListener("mousedown", (e)=> e.stopPropagation());
  div.addEventListener("click", (e)=>{
    e.stopPropagation();
    const act = e.target?.dataset?.act;
    if(!act) return;

    hideContextMenu();

    if(act === "start"){
      startDrawing();
    } else if(act === "finish"){
      finishDrawing();
    } else if(act === "cancel"){
      cancelDrawing();
    } else if(act === "delete"){
      deleteMode = true;
      drawing = false;
      hideFormOverlay();
      hideInfoOverlay();
      setStatus("삭제 모드: 삭제할 SITE 영역을 클릭하세요");
    }
  });
}

// ===== Drawing preview =====
function clearPreview(){
  if(previewLine){ try{ previewLine.setMap(null); }catch{} previewLine = null; }
  if(previewPoly){ try{ previewPoly.setMap(null); }catch{} previewPoly = null; }
}
function startDrawing(){
  if(!editMode) return;

  deleteMode = false;
  hideInfoOverlay();
  hideFormOverlay();
  hideContextMenu();
  clearPreview();

  drawing = true;
  drawingPoints = [];
  setStatus("경계 입력: 지도 좌클릭으로 점 추가 → 우클릭 메뉴에서 '그리기 완료'");
}
function cancelDrawing(){
  drawing = false;
  drawingPoints = [];
  clearPreview();
  if(editMode) setStatus("편집 대기 (우클릭 메뉴)");
}
function updatePreview(){
  if(drawingPoints.length >= 2){
    if(!previewLine){
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
  if(drawingPoints.length >= 3){
    if(!previewPoly){
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

// ===== Template =====
async function loadSiteTemplate(){
  try{
    const r = await fetch("/data/SiteInfoTemplate.txt", { cache:"no-store" });
    if(!r.ok) return "";
    return await r.text();
  }catch{
    return "";
  }
}

// ===== Site form =====
async function showSiteForm(latlng, initialName="", initialMemo="", onSave, onCancel){
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

  drawing = false; // pause drawing while form open

  formOverlay = new kakao.maps.CustomOverlay({
    content: wrap,
    position: latlng,
    xAnchor: 0.5,
    yAnchor: 1.2,
    zIndex: 9998
  });
  formOverlay.setMap(map);

  wrap.addEventListener("mousedown", (e)=> e.stopPropagation());
  wrap.addEventListener("click", (e)=> e.stopPropagation());

  wrap.querySelector("#btnSave").onclick = ()=>{
    const name = nameInput.value.trim();
    const memo = memoArea.value ?? "";
    if(!name){ alert("SITE 명은 필수입니다."); return; }
    hideFormOverlay();
    onSave({ name, memo });
  };
  wrap.querySelector("#btnCancel").onclick = ()=>{
    hideFormOverlay();
    onCancel?.();
  };

  if(!memoArea.value){
    const tpl = await loadSiteTemplate();
    if(tpl) memoArea.value = tpl;
  }

  setTimeout(()=> nameInput.focus(), 0);
  setStatus("SITE 정보 입력: 저장/취소");
}

async function finishDrawing(){
  if(!editMode) return;
  if(formOpen) return;

  if(drawingPoints.length < 3){
    setStatus("오류: 점을 3개 이상 찍어야 합니다 (우클릭→그리기 시작 후 좌클릭으로 점 추가)");
    return;
  }

  const anchor = drawingPoints[0];
  const tpl = await loadSiteTemplate();

  await showSiteForm(anchor, "", tpl || "", async ({name, memo})=>{
    try{
      const id = `site_${Date.now()}`;
      const newSite = {
        id,
        name,
        memo,
        style: { strokeColor:"#FF3300", strokeWeight:4, fillColor:"#FF6600", fillOpacity:0.25 },
        polygon: drawingPoints.map(ll => [ll.getLat(), ll.getLng()]),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const payload = { version: 1, sites: [...sites, newSite] };
      await apiPut("/api/sites", payload);

      sites = payload.sites;
      renderSites();

      cancelDrawing();
      setStatus("SITE 저장 완료 (다음 SITE: 우클릭→그리기 시작)");
    }catch(e){
      console.error(e);
      setStatus(`저장 실패: ${e.message}`);
    }
  }, ()=>{
    cancelDrawing();
    setStatus("SITE 입력 취소 (우클릭→그리기 시작)");
  });
}

// ===== Site info (view-only) =====
function showSiteInfo(site){
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

  wrap.addEventListener("click", (e)=>{
    e.stopPropagation();
    hideInfoOverlay();
  });
}

// ===== Delete =====
async function deleteSite(siteId){
  sites = sites.filter(s => s.id !== siteId);
  await apiPut("/api/sites", { version: 1, sites });
  renderSites();
}

// ===== Render Sites =====
function clearSites(){
  for(const p of sitePolygons.values()){
    try{ p.setMap(null); }catch{}
  }
  sitePolygons.clear();
}

function renderSites(){
  clearSites();

  for(const s of sites){
    const path = s.polygon.map(([lat,lng]) => new kakao.maps.LatLng(lat, lng));

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

    kakao.maps.event.addListener(poly, "click", async ()=>{
      suppressMapClick(350);

      if(deleteMode && editMode){
        const ok = confirm(`"${s.name}" SITE를 삭제할까요?`);
        if(!ok) return;
        try{
          await deleteSite(s.id);
          setStatus("SITE 삭제 완료 (다음 동작: 우클릭 메뉴)");
        }catch(e){
          console.error(e);
          setStatus(`삭제 실패: ${e.message}`);
        }finally{
          deleteMode = false;
        }
        return;
      }

      showSiteInfo(s);
    });

    sitePolygons.set(s.id, poly);
  }
}

// ===== Camera markers =====
function clearCameras(){
  for (const m of cameraMarkers.values()){
    try { m.setMap(null); } catch {}
  }
  cameraMarkers.clear();
}
function tryMakeMarkerImage(src){
  try{
    const size = new kakao.maps.Size(40,40);
    const opt = { offset: new kakao.maps.Point(20,40) };
    return new kakao.maps.MarkerImage(src, size, opt);
  }catch{
    return null;
  }
}
function renderCameras(){
  console.log("[renderCameras] count =", cameras.length);

  clearCameras();

  const img =
    tryMakeMarkerImage("/assets/camera.png") ||
    tryMakeMarkerImage("./assets/camera.png") ||
    null;

  for (const cam of cameras){
    const lat = Number(cam.lat);
    const lng = Number(cam.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.warn("Invalid lat/lng:", cam);
      continue;
    }

    const opts = {
      position: new kakao.maps.LatLng(lat, lng),
      map,
      title: cam.name || cam.id
    };
    if(img) opts.image = img; // if image fails, default marker is used

    const marker = new kakao.maps.Marker(opts);

    kakao.maps.event.addListener(marker, "click", async () => {
      try{
        await openCameraStream(cam);
      }catch(e){
        console.error(e);
        setStatus(`카메라 오류: ${e.message}`);
      }
    });

    cameraMarkers.set(cam.id, marker);
  }
}

// ===== Camera overlay + HLS playback =====
function evictOldestCamOverlayIfNeeded(){
  if(camOverlays.size < MAX_CAM_OVERLAYS) return;

  let oldestId = null;
  let oldest = Infinity;
  for(const [id, it] of camOverlays.entries()){
    const t = it.openedAt || 0;
    if(t < oldest){ oldest = t; oldestId = id; }
  }
  if(oldestId) closeCameraOverlay(oldestId);
}
function closeCameraOverlay(camId){
  const it = camOverlays.get(camId);
  if(!it) return;

  try{
    if(it.hls){ try{ it.hls.destroy(); }catch{} it.hls = null; }
    if(it.videoEl){
      try{ it.videoEl.pause(); }catch{}
      it.videoEl.removeAttribute("src");
      try{ it.videoEl.load(); }catch{}
    }
    it.overlay?.setMap?.(null);
  }catch{}
  camOverlays.delete(camId);
}

function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }
async function waitForM3U8(url, timeoutMs=15000, intervalMs=600){
  const end = Date.now() + timeoutMs;
  while(Date.now() < end){
    try{
      const r = await fetch(url, { method:"GET", cache:"no-store" });
      if(r.ok) return true;
    }catch{}
    await wait(intervalMs);
  }
  return false;
}

function startPlaybackInVideo(video, url){
  const canNative = video.canPlayType("application/vnd.apple.mpegurl");
  if(canNative){
    video.src = url;
    video.play().catch(()=>{});
    return { hls:null };
  }

  if(window.Hls && window.Hls.isSupported()){
    const hls = new Hls({ lowLatencyMode:true });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, ()=> video.play().catch(()=>{}));
    return { hls };
  }

  throw new Error("이 브라우저는 HLS 재생을 지원하지 않습니다.");
}

async function openCameraStream(cam){
  if(camOverlays.has(cam.id)){
    closeCameraOverlay(cam.id);
    return;
  }

  evictOldestCamOverlayIfNeeded();

  setStatus(`스트림 요청: ${cam.id}`);
  const resp = await apiPost("/api/streams/request", { camId: cam.id });

  if(resp?.evicted?.id){
    closeCameraOverlay(resp.evicted.id);
  }

  const wrap = createCardBase();
  wrap.style.width = "360px";

  const header = document.createElement("div");
  header.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;";
  const title = createTitle(`📷 ${cam.name || cam.id} (${cam.id})`);
  title.style.marginBottom = "0";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "닫기";
  closeBtn.style.cssText = "padding:6px 10px; border-radius:8px; border:1px solid #333; background:#ddd; cursor:pointer; font-weight:800;";
  header.appendChild(title);
  header.appendChild(closeBtn);
  wrap.appendChild(header);

  const video = document.createElement("video");
  video.controls = true;
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = "width:100%; height:200px; background:#000; border-radius:10px;";
  wrap.appendChild(video);

  const overlay = new kakao.maps.CustomOverlay({
    content: wrap,
    position: new kakao.maps.LatLng(Number(cam.lat), Number(cam.lng)),
    xAnchor: 0.5,
    yAnchor: 1.3,
    zIndex: 9000
  });
  overlay.setMap(map);

  wrap.addEventListener("mousedown", (e)=> e.stopPropagation());
  wrap.addEventListener("click", (e)=> e.stopPropagation());

  closeBtn.onclick = (e)=>{
    e.stopPropagation();
    closeCameraOverlay(cam.id);
  };

  camOverlays.set(cam.id, { overlay, videoEl: video, hls:null, openedAt: Date.now() });

  const hlsUrl = resp?.hls || `/media/${cam.id}/stream.m3u8`;
  setStatus(`HLS 준비 확인중... ${hlsUrl}`);

  const ok = await waitForM3U8(hlsUrl, 15000, 600);
  if(!ok){
    setStatus("HLS 준비 실패(시간초과). Converter/경로 확인");
    return;
  }

  setStatus("재생 시작");
  const started = startPlaybackInVideo(video, hlsUrl);
  const it = camOverlays.get(cam.id);
  if(it) it.hls = started.hls || null;
}

// ===== Map init =====
function initMap(){
  map = new kakao.maps.Map(document.getElementById("map"),{
    center: new kakao.maps.LatLng(37.5662952, 126.9779451),
    level: 4
  });

  const node = map.getNode();
  if(node){
    node.addEventListener("contextmenu", (e)=> e.preventDefault());
  }

  kakao.maps.event.addListener(map, "rightclick", (e)=>{
    if(!editMode) return;
    showContextMenu(e.latLng);
  });

  kakao.maps.event.addListener(map, "click", (e)=>{
    if(Date.now() < suppressMapClickUntil) return;
    if(formOpen) return;

    hideContextMenu();

    if(deleteMode){
      setStatus("삭제 모드: 삭제할 SITE 영역을 클릭하세요");
      return;
    }

    if(drawing){
      drawingPoints.push(e.latLng);
      updatePreview();
      setStatus(`점 추가: ${drawingPoints.length}개`);
    }else{
      hideInfoOverlay();
    }
  });
}

// ===== Load =====
async function loadAll(){
  const s = await apiGet("/api/sites");
  sites = s.sites || [];

  const cams = await apiGet("/api/cameras");
  cameras = Array.isArray(cams.cameras) ? cams.cameras : [];
}

// ===== Boot =====
function boot(){
  if(!window.kakao?.maps){
    console.error("Kakao Maps SDK not loaded yet.");
    setStatus("지도 SDK 로드 실패 (index.html의 Kakao SDK script 순서 확인)");
    return;
  }
  if(!document.getElementById("map")){
    console.error("#map element not found.");
    return;
  }

  (async ()=>{
    try{
      initMap();
      await loadAll();
      renderSites();
      renderCameras();
      setStatus("준비 완료 (편집모드 ON/OFF, 카메라 클릭→영상)");
    }catch(e){
      console.error(e);
      setStatus("초기화 실패 (콘솔 확인)");
    }
  })();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
