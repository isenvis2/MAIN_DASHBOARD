const CONFIG_BASE = '../../../shared/config';
const REMOTE_SERVICE_PORTS = {
  hls_url: 8080,
  weather_url: 8100,
  sms_url: 3000,
  news_url: 5173,
  ytn_url: 8080,
  weather_probe_url: 8100,
  event_url: 3100,
  report_url: 3200
};
const REMOTE_SERVICE_DEFAULT_PATHS = {
  hls_url: '/index.html?embed=1',
  weather_url: '/?embed=1',
  sms_url: '/?embed=1',
  news_url: '/?embed=1',
  ytn_url: '/ytn.html?camId=video1&embed=1&unifiedHls=1&liveDelay=3&v=7712',
  weather_probe_url: '/',
  event_url: '/?embed=1',
  report_url: '/'
};
function getRemoteHost() {
  return window.location.hostname || 'localhost';
}
function getHttpProtocol() {
  return window.location.protocol === 'https:' ? 'https:' : 'http:';
}
function isLoopbackHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h === '0.0.0.0';
}
function isHostPlaceholder(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === '{host}' || v === '__host__' || v === '${host}' || v === '%server_host%' || v === 'auto';
}
function serviceOrigin(port, host = getRemoteHost()) {
  return `${getHttpProtocol()}//${host}:${port}`;
}
function joinUrl(base, path = '') {
  const b = String(base || '').trim().replace(/\/+$/, '');
  const p = String(path || '').trim();
  if (!p) return b;
  return `${b}/${p.replace(/^\/+/, '')}`;
}
function serviceUrl(port, path = '/', host = getRemoteHost()) {
  return joinUrl(serviceOrigin(port, host), path || '/');
}
function resolveConfiguredHost(value, fallback = getRemoteHost()) {
  const raw = String(value || '').trim();
  if (!raw || isHostPlaceholder(raw)) return fallback;
  return raw.replace(/^https?:\/\//i, '').replace(/[:/].*$/, '') || fallback;
}
function replaceHostPlaceholders(raw, context = {}) {
  const frontendHost = context.frontendHost || getRemoteHost();
  const backendHost = context.backendHost || getRemoteHost();
  return String(raw || '')
    .replaceAll('{BACKEND_HOST}', backendHost)
    .replaceAll('{backend_host}', backendHost)
    .replaceAll('__BACKEND_HOST__', backendHost)
    .replaceAll('%BACKEND_HOST%', backendHost)
    .replaceAll('{FRONTEND_HOST}', frontendHost)
    .replaceAll('{frontend_host}', frontendHost)
    .replaceAll('__FRONTEND_HOST__', frontendHost)
    .replaceAll('%FRONTEND_HOST%', frontendHost)
    .replaceAll('{HOST}', frontendHost)
    .replaceAll('{host}', frontendHost)
    .replaceAll('__HOST__', frontendHost)
    .replaceAll('__host__', frontendHost)
    .replaceAll('%SERVER_HOST%', backendHost)
    .replaceAll('%server_host%', backendHost);
}
function resolveRemoteServiceUrl(rawUrl, fallbackPort = null, fallbackPath = '/', context = {}) {
  const fallbackHost = context.backendHost || getRemoteHost();
  const raw = replaceHostPlaceholders(String(rawUrl || '').trim(), context);
  if (!raw && fallbackPort) return serviceUrl(fallbackPort, fallbackPath, fallbackHost);
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.href);
    if (isLoopbackHost(url.hostname) || isHostPlaceholder(url.hostname)) {
      // localhost/auto placeholder만 현재 설정 host로 보정합니다. 명시된 원격 서버 IP는 보존합니다.
      url.hostname = fallbackHost;
      url.protocol = getHttpProtocol();
    }
    if (fallbackPort && (!url.port || url.port === '0')) url.port = String(fallbackPort);
    return url.toString();
  } catch {
    return fallbackPort ? serviceUrl(fallbackPort, fallbackPath, fallbackHost) : raw;
  }
}
function normalizeModuleUrls(rawModules) {
  const m = rawModules && typeof rawModules === 'object' ? { ...rawModules } : {};
  const context = {
    frontendHost: resolveConfiguredHost(m.frontend_host, getRemoteHost()),
    backendHost: resolveConfiguredHost(m.backend_host || m.server_host, getRemoteHost()),
  };
  m.frontend_host = context.frontendHost;
  m.backend_host = context.backendHost;
  for (const [key, port] of Object.entries(REMOTE_SERVICE_PORTS)) {
    const fallbackPath = REMOTE_SERVICE_DEFAULT_PATHS[key] || '/';
    const rawValue = key === 'weather_probe_url' ? (m.weather_probe_url || m.weather_url) : m[key];
    const serviceContext = { ...context };
    // News/SMS iframe은 데모 환경에서 클라이언트 PC의 Vite frontend가 담당할 수 있습니다.
    if (key === 'news_url' || key === 'sms_url') serviceContext.backendHost = context.frontendHost;
    m[key] = resolveRemoteServiceUrl(rawValue, port, fallbackPath, serviceContext);
  }
  m.hls_api = resolveRemoteServiceUrl(m.hls_api || `http://{BACKEND_HOST}:8080`, 8080, '/', context).replace(/\/+$/, '');
  return m;
}
function getHlsApiBase() {
  return state.modules?.hls_api || serviceOrigin(8080);
}
const FALLBACK_GIS_URL = serviceUrl(8080, '/index.html');
const STATUS_RESET_MS = 1800;

const state = {
  cameras: [],
  filteredCameras: [],
  modules: null,
  centerMode: 'gis',
  selectedCameraId: '',
  gisReady: false,
  lastEventImage: null,
  pendingEventCrop: null,
  reportModalOpen: false
};

const els = {
  clock: document.getElementById('clock'),
  headerStatus: document.getElementById('headerStatus'),
  btnShowGis: document.getElementById('btnShowGis'),
  btnShowHls: document.getElementById('btnShowHls'),
  btnRefreshList: document.getElementById('btnRefreshList'),
  cameraSearch: document.getElementById('cameraSearch'),
  cameraList: document.getElementById('cameraList'),
  cameraHelperText: document.getElementById('cameraHelperText'),
  centerPanelTitle: document.getElementById('centerPanelTitle'),
  centerPanelSubTitle: document.getElementById('centerPanelSubTitle'),
  centerFrameWrap: document.getElementById('centerFrameWrap'),
  gisFrame: document.getElementById('gisFrame'),
  hlsStage: document.getElementById('hlsStage'),
  hlsFrame: document.getElementById('hlsFrame'),
  hlsPlaceholder: document.getElementById('hlsPlaceholder'),
  weatherFrame: document.getElementById('weatherFrame'),
  smsFrame: document.getElementById('smsFrame'),
  newsFrame: document.getElementById('newsFrame'),
  ytnFrame: document.getElementById('ytnFrame'),
  btnSyncWeather: document.getElementById('btnSyncWeather'),
  btnSyncSms: document.getElementById('btnSyncSms'),
  btnSyncNews: document.getElementById('btnSyncNews'),
  btnSyncEvent: document.getElementById('btnSyncEvent'),
  btnOpenWeather: document.getElementById('btnOpenWeather'),
  btnOpenSms: document.getElementById('btnOpenSms'),
  btnOpenNews: document.getElementById('btnOpenNews'),
  btnOpenEvent: document.getElementById('btnOpenEvent'),
  btnOpenReport: document.getElementById('btnOpenReport'),
  reportModal: document.getElementById('reportModal'),
  reportFrame: document.getElementById('reportFrame'),
  btnCloseReportModal: document.getElementById('btnCloseReportModal'),
  eventFrame: document.getElementById('eventFrame'),
  eventImageStage: document.getElementById('eventImageStage'),
  eventCenterImage: document.getElementById('eventCenterImage'),
  eventCenterBox: document.getElementById('eventCenterBox'),
  eventCenterCaption: document.getElementById('eventCenterCaption'),
};

let lastHeaderStatusText = "";
let lastHeaderStatusAt = 0;
function setStatus(text) {
  if (!els.headerStatus) return;
  const msg = text || "";
  const now = Date.now();
  if (msg === lastHeaderStatusText && now - lastHeaderStatusAt < 5000) return;
  lastHeaderStatusText = msg;
  lastHeaderStatusAt = now;
  els.headerStatus.textContent = msg;
}

function updateClock() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '');
  const timeStr = now.toLocaleTimeString('ko-KR', { hour12: false });
  if (els.clock) els.clock.textContent = `${dateStr} ${timeStr}`;
}
setInterval(updateClock, 1000);
updateClock();
initCursorAutoHide();


function initCursorAutoHide(idleMs = 10000) {
  let hideTimer = null;
  const showCursor = () => {
    document.body.classList.remove('dashboard-cursor-hidden');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      document.body.classList.add('dashboard-cursor-hidden');
    }, idleMs);
  };
  ['mousemove','mousedown','mouseup','mouseenter','mouseleave','wheel','touchstart','touchmove','pointermove','keydown'].forEach((evt) => {
    window.addEventListener(evt, showCursor, { passive: true });
  });
  showCursor();
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load: ${url} (${res.status})`);
  return res.json();
}

function getStreamModeLabel(cam) {
  const sourceType = String(cam?.sourceType || cam?.source_type || '').trim().toLowerCase();
  const streamMode = String(cam?.streamMode || cam?.stream_mode || '').trim().toLowerCase();
  const alwaysOn = cam?.alwaysOn === true || cam?.always_on === true || sourceType === 'rtsp+';

  if (alwaysOn || sourceType === 'rtsp+') return 'RTSP+ 상시 HLS';
  if (sourceType === 'rtsp') return 'RTSP→HLS';
  if (sourceType === 'hls' || streamMode === 'direct') return 'Direct HLS';
  if (streamMode === 'converted') return 'RTSP→HLS';
  return cam?.hasSource === false ? 'No Source' : 'Unknown';
}

function buildEmbedLoaderUrl(appUrl, label, probeUrl = '') {
  const u = new URL('./embed_loader.html', window.location.href);
  u.searchParams.set('target', appUrl || '');
  u.searchParams.set('label', label);
  u.searchParams.set('interval', '3500');
  if (probeUrl) u.searchParams.set('probe', probeUrl);
  return u.toString();
}

function buildCameraPlayerUrl(camId = '') {
  const u = new URL('/apps/main_dashboard/web/camera_player.html', window.location.origin);
  if (camId) u.searchParams.set('camId', camId);
  u.searchParams.set('_ts', Date.now().toString());
  return u.toString();
}

function setSyncState(btn, stateName) {
  if (!btn) return;
  btn.classList.remove('idle', 'loading', 'success', 'error');
  btn.classList.add(stateName || 'idle');
  btn.dataset.state = stateName || 'idle';
  btn.setAttribute('aria-busy', stateName === 'loading' ? 'true' : 'false');
}

function pulseSyncState(btn, stateName, delay = STATUS_RESET_MS) {
  setSyncState(btn, stateName);
  if (stateName === 'success' || stateName === 'error') {
    setTimeout(() => {
      if (btn && btn.dataset.state === stateName) setSyncState(btn, 'idle');
    }, delay);
  }
}

function forceReloadFrame(frameEl, appUrl, label, useLoader = false, probeUrl = '') {
  if (!frameEl || !appUrl) return;
  const finalUrl = useLoader ? buildEmbedLoaderUrl(appUrl, label, probeUrl) : `${appUrl}${appUrl.includes('?') ? '&' : '?'}_ts=${Date.now()}`;
  frameEl.src = finalUrl;
}

function buildStandaloneDashboardUrl(appUrl = '') {
  if (!appUrl) return '';
  try {
    const url = new URL(appUrl, window.location.href);
    url.searchParams.delete('embed');
    url.searchParams.delete('_ts');
    return url.toString();
  } catch {
    return appUrl
      .replace(/([?&])embed=1(&?)/, (match, sep, tail) => (sep === '?' && tail ? '?' : sep === '?' ? '' : tail ? sep : ''))
      .replace(/[?&]_ts=\d+/, '');
  }
}

function openStandaloneDashboard(appUrl, label) {
  const standaloneUrl = buildStandaloneDashboardUrl(appUrl);
  if (!standaloneUrl) {
    setStatus(`${label.toUpperCase()} 대시보드 주소가 없습니다`);
    return;
  }

  // 새 탭이 아니라 독립 팝업 창으로 열리도록 크기/위치/브라우저 UI 옵션을 명시한다.
  // 최신 브라우저는 사용자 클릭 이벤트 안에서 window.open이 호출되고 width/height가 있으면
  // 일반 탭보다 별도 창으로 여는 경우가 가장 안정적이다.
  const width = 1280;
  const height = 800;
  const left = Math.max(0, Math.round((window.screen.availWidth - width) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - height) / 2));
  const features = [
    'popup=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'scrollbars=yes',
    'resizable=yes'
  ].join(',');

  const opened = window.open(standaloneUrl, `${label}_dashboard_window`, features);
  if (opened) {
    try { opened.opener = null; } catch {}
    try { opened.focus(); } catch {}
    setStatus(`${label.toUpperCase()} 단일 대시보드 새 창 열기`);
  } else {
    setStatus(`${label.toUpperCase()} 새 창 열기가 브라우저에서 차단되었습니다`);
  }
}

function setupPanelOpenButton(btn, label, getUrl) {
  if (!btn) return;
  btn.addEventListener('click', () => openStandaloneDashboard(getUrl(), label));
}

function buildReportModalUrl(appUrl = '') {
  if (!appUrl) return '';
  try {
    const url = new URL(appUrl, window.location.href);
    // Report Dashboard has no special embed-only UI, but this identifies the main-dashboard route
    // and prevents a stale browser cache from being re-used after the modal is reopened.
    url.searchParams.set('embed', '1');
    url.searchParams.set('from', 'main-dashboard');
    url.searchParams.set('_modal', Date.now().toString());
    return url.toString();
  } catch {
    const sep = appUrl.includes('?') ? '&' : '?';
    return `${appUrl}${sep}embed=1&from=main-dashboard&_modal=${Date.now()}`;
  }
}

function openReportModal() {
  const appUrl = state.modules?.report_url || serviceUrl(3200, '/');
  const modalUrl = buildReportModalUrl(appUrl);
  if (!modalUrl || !els.reportModal || !els.reportFrame) {
    setStatus('보고서 대시보드 주소 또는 모달 요소가 없습니다');
    return;
  }

  state.reportModalOpen = true;
  els.reportModal.classList.remove('hidden');
  els.reportModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('report-modal-open');
  els.reportFrame.src = modalUrl;
  setStatus('보고서 대시보드 모달 열기');

  // Modal close returns focus to the launch button. Opening starts with the close button so
  // keyboard users always have a visible escape path before entering the cross-origin iframe.
  requestAnimationFrame(() => els.btnCloseReportModal?.focus());
}

function closeReportModal() {
  if (!state.reportModalOpen || !els.reportModal) return;
  state.reportModalOpen = false;
  els.reportModal.classList.add('hidden');
  els.reportModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('report-modal-open');
  if (els.reportFrame) els.reportFrame.src = 'about:blank';
  setStatus('보고서 대시보드 모달 닫기 · 메인 보고서 버튼으로 포커스 이동');
  // Wait until the dialog is hidden before returning focus to the main launcher.
  setTimeout(() => els.btnOpenReport?.focus(), 0);
}

function createVisibleOpenButton(id, labelKo) {
  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'open-panel-btn panel-tool-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', `${labelKo} 대시보드 새창 열기`);
  btn.setAttribute('title', `${labelKo} 대시보드 새창 열기`);
  btn.innerHTML = '<span class="open-icon" aria-hidden="true">▣</span>';
  return btn;
}

function normalizeVisibleOpenButton(btn, labelKo) {
  if (!btn) return null;
  btn.classList.remove('open-float-btn');
  btn.classList.add('open-panel-btn', 'panel-tool-btn');
  btn.type = 'button';
  btn.setAttribute('aria-label', `${labelKo} 대시보드 새창 열기`);
  btn.setAttribute('title', `${labelKo} 대시보드 새창 열기`);
  if (!btn.querySelector('.open-icon')) btn.innerHTML = '<span class="open-icon" aria-hidden="true">▣</span>';
  btn.style.position = 'static';
  btn.style.display = 'inline-flex';
  btn.style.visibility = 'visible';
  btn.style.opacity = '1';
  return btn;
}

function ensurePanelOpenButtonsVisible() {
  const specs = [
    { key: 'btnOpenWeather', openId: 'btnOpenWeather', syncId: 'btnSyncWeather', labelKo: '날씨' },
    { key: 'btnOpenSms', openId: 'btnOpenSms', syncId: 'btnSyncSms', labelKo: 'SMS' },
    { key: 'btnOpenNews', openId: 'btnOpenNews', syncId: 'btnSyncNews', labelKo: '뉴스' },
  ];

  specs.forEach((spec) => {
    const syncBtn = document.getElementById(spec.syncId);
    if (!syncBtn) return;

    let actions = syncBtn.closest('.panel-title-actions');
    if (!actions) {
      const title = syncBtn.closest('.panel-title') || syncBtn.parentElement;
      actions = document.createElement('span');
      actions.className = 'panel-title-actions';
      if (title) title.appendChild(actions);
      actions.appendChild(syncBtn);
    }

    let openBtn = document.getElementById(spec.openId);
    if (!openBtn) openBtn = createVisibleOpenButton(spec.openId, spec.labelKo);
    normalizeVisibleOpenButton(openBtn, spec.labelKo);

    if (openBtn.parentElement !== actions) actions.insertBefore(openBtn, syncBtn);
    else if (openBtn.nextElementSibling !== syncBtn) actions.insertBefore(openBtn, syncBtn);

    els[spec.key] = openBtn;
  });

  const eventBtn = document.getElementById('btnOpenEvent');
  if (eventBtn) {
    eventBtn.classList.remove('open-float-btn');
    eventBtn.classList.add('open-panel-btn');
    if (!eventBtn.querySelector('.open-icon')) eventBtn.innerHTML = '<span class="open-icon" aria-hidden="true">▣</span>';
    els.btnOpenEvent = eventBtn;
  }
}

function wireFrameLoad(frameEl, btn) {
  if (!frameEl || !btn) return;
  frameEl.addEventListener('load', () => {
    if (frameEl.dataset.loaderManaged !== 'true' && btn.dataset.state === 'loading') {
      pulseSyncState(btn, 'success');
    }
  });
}

function setupPanelSync(btn, frameEl, label, getUrl, options = {}) {
  if (!btn || !frameEl) return;
  const useLoader = !!options.useLoader;
  const getProbeUrl = options.getProbeUrl || (() => '');
  if (useLoader) frameEl.dataset.loaderManaged = 'true';
  btn.addEventListener('click', () => {
    const appUrl = getUrl();
    if (!appUrl) return;
    setSyncState(btn, 'loading');
    forceReloadFrame(frameEl, appUrl, label, useLoader, getProbeUrl());
    setStatus(`${label.toUpperCase()} 패널 동기화 요청`);
  });
}

function updateModeButtons() {
  const isGis = state.centerMode === 'gis';
  const isHls = state.centerMode === 'hls';
  const isEvent = state.centerMode === 'event';
  els.btnShowGis?.classList.toggle('active', isGis);
  els.btnShowHls?.classList.toggle('active', isHls);
  els.centerFrameWrap?.classList.toggle('center-mode-gis', isGis);
  els.centerFrameWrap?.classList.toggle('center-mode-hls', isHls);
  els.centerFrameWrap?.classList.toggle('center-mode-event', isEvent);
  els.gisFrame?.classList.toggle('hidden', !isGis);
  els.hlsStage?.classList.toggle('hidden', !isHls);
  els.eventImageStage?.classList.toggle('hidden', !isEvent);
}

function getSelectedCamera() {
  return state.cameras.find((cam) => cam.id === state.selectedCameraId) || null;
}

function updateCenterHeader(title, subtitle) {
  if (els.centerPanelTitle) els.centerPanelTitle.textContent = title;
  if (els.centerPanelSubTitle) {
    if (subtitle === null) {
      els.centerPanelSubTitle.textContent = '';
      els.centerPanelSubTitle.classList.add('hidden');
    } else {
      els.centerPanelSubTitle.textContent = subtitle || '';
      els.centerPanelSubTitle.classList.remove('hidden');
    }
  }
}

function ensureGisFrameLoaded() {
  if (!els.gisFrame) return;
  const gisUrl = state.modules?.hls_url || FALLBACK_GIS_URL;
  const current = els.gisFrame.getAttribute('src') || '';
  if (!current || current.startsWith('about:blank')) {
    state.gisReady = false;
    els.gisFrame.src = gisUrl;
  }
}

function showHlsPlaceholder(title, text) {
  if (!els.hlsPlaceholder) return;
  els.hlsPlaceholder.innerHTML = `<div class="hls-placeholder-title">${title}</div><div class="hls-placeholder-text">${text}</div>`;
  els.hlsPlaceholder.classList.remove('hidden');
}

function hideHlsPlaceholder() {
  els.hlsPlaceholder?.classList.add('hidden');
}


function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function compactText(value, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function extractEventSource(rawSource) {
  const source = compactText(rawSource, 'Unknown');
  const parts = source.split('/').filter(Boolean);
  const host = parts.find((part) => part.toLowerCase() === 'hosts') ? parts[1] : '';
  const device = parts.find((part) => /device/i.test(part)) || '';
  const endpoint = parts.find((part) => /sourceendpoint|video/i.test(part)) || '';
  if (host || device || endpoint) {
    return [host, device, endpoint].filter(Boolean).join(' / ');
  }
  return source;
}

function parseAxxonLocalizedEventText(text) {
  const raw = compactText(text, '');
  if (!raw) return { cameraName: '', eventName: '', eventMessage: '' };

  // Axxon Korean event text examples:
  // 카메라 "54.카메라" · "3.영역 내 움직임 감지" 검출 동작 시작 ...
  // 카메라 "54.카메라". "3.영역 내 움직임 감지" 검출 동작 종료 ...
  // Separator can be middle dot, period, dash, colon, or bullet depending on VMS/localization.
  const match = raw.match(/^카메라\s+(\"[^\"]+\"|[^\"·ㆍ•\.\-:：]+?)\s*[·ㆍ•\.\-:：]\s*(\"[^\"]+\"|[^\s]+)(?:\s+([\s\S]+))?$/);
  if (!match) {
    return { cameraName: '', eventName: raw, eventMessage: raw };
  }

  return {
    cameraName: `카메라 ${compactText(match[1], '')}`,
    eventName: compactText(match[2], raw),
    eventMessage: compactText(match[3], '')
  };
}

function deriveCameraName(payload) {
  const parsed = parseAxxonLocalizedEventText(payload?.rawEventText || payload?.eventName || payload?.eventType);
  if (parsed.cameraName) return parsed.cameraName;

  const explicitName = compactText(payload?.cameraName, '');
  if (explicitName) return explicitName;

  const source = compactText(payload?.eventSource || payload?.source || payload?.cameraId, '');
  const matched = state.cameras.find((cam) => cam.id === payload?.cameraId || cam.name === payload?.cameraId);
  if (matched) return matched.name || matched.id;

  const parts = source.split('/').filter(Boolean);
  const device = parts.find((part) => /device/i.test(part));
  if (device) return device;
  return compactText(payload?.cameraId, 'Unknown');
}

function deriveEventName(payload) {
  const parsed = parseAxxonLocalizedEventText(payload?.rawEventText || payload?.eventName || payload?.eventType);
  if (parsed.eventName && parsed.eventName !== parsed.eventMessage) return parsed.eventName;

  const parsedFromEventName = parseAxxonLocalizedEventText(payload?.eventName || payload?.eventType);
  return compactText(parsedFromEventName.eventName || payload?.eventName || payload?.eventType, '이벤트');
}

function deriveEventMessage(payload) {
  const rawParsed = parseAxxonLocalizedEventText(payload?.rawEventText || payload?.eventName || payload?.eventType);
  if (rawParsed.eventMessage && rawParsed.eventMessage !== rawParsed.eventName) return rawParsed.eventMessage;

  const explicitMessage = compactText(payload?.eventMessage, '');
  const explicitParsed = parseAxxonLocalizedEventText(explicitMessage);
  if (explicitParsed.eventMessage && explicitParsed.eventMessage !== explicitParsed.eventName) return explicitParsed.eventMessage;
  if (explicitMessage && explicitMessage !== payload?.eventName && !/^카메라\s+/.test(explicitMessage)) return explicitMessage;

  return compactText(rawParsed.eventMessage || payload?.message || payload?.detailMessage || deriveEventName(payload), deriveEventName(payload));
}

function formatEventTimestamp(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString('ko-KR', { hour12:false });
}

function buildEventLogRows(payload) {
  const eventSource = extractEventSource(payload?.eventSource || payload?.source || payload?.cameraId);
  const cameraName = deriveCameraName(payload);
  const eventName = deriveEventName(payload);
  const eventMessage = deriveEventMessage(payload);
  const eventTime = formatEventTimestamp(payload?.timestamp);

  return [
    ['이벤트 소스', eventSource],
    ['카메라 이름', cameraName],
    ['이벤트명', eventName],
    ['이벤트 메세지', eventMessage],
    ['발생시각', eventTime]
  ];
}

function updateEventCenterLog(payload) {
  if (!els.eventCenterCaption) return;
  const rows = buildEventLogRows(payload);
  els.eventCenterCaption.innerHTML = rows.map(([label, value]) => `
    <div class="event-log-row">
      <div class="event-log-label">${escapeHtml(label)}</div>
      <div class="event-log-value" title="${escapeHtml(value)}">${escapeHtml(value)}</div>
    </div>
  `).join('');
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function normalizeCrop(crop) {
  if (!crop) return null;
  const x = Number(crop.x);
  const y = Number(crop.y);
  const w = Number(crop.w);
  const h = Number(crop.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;

  const left = clampNumber(x, 0, 1);
  const top = clampNumber(y, 0, 1);
  const right = clampNumber(x + w, 0, 1);
  const bottom = clampNumber(y + h, 0, 1);

  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function getContainedImageRect(img, container) {
  if (!img || !container || !img.naturalWidth || !img.naturalHeight) return null;

  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  if (containerW <= 0 || containerH <= 0) return null;

  const imageRatio = img.naturalWidth / img.naturalHeight;
  const containerRatio = containerW / containerH;

  let width;
  let height;
  let offsetX;
  let offsetY;

  if (imageRatio > containerRatio) {
    width = containerW;
    height = containerW / imageRatio;
    offsetX = 0;
    offsetY = (containerH - height) / 2;
  } else {
    height = containerH;
    width = containerH * imageRatio;
    offsetX = (containerW - width) / 2;
    offsetY = 0;
  }

  return { width, height, offsetX, offsetY };
}

function setEventCenterBox(crop) {
  if (!els.eventCenterBox) return;

  const normalized = normalizeCrop(crop);
  const container = els.eventCenterImage?.parentElement || null;
  const imageRect = getContainedImageRect(els.eventCenterImage, container);

  if (!normalized || !container || !imageRect) {
    els.eventCenterBox.classList.add('hidden');
    return;
  }

  const imageLeft = imageRect.offsetX;
  const imageTop = imageRect.offsetY;
  const imageRight = imageRect.offsetX + imageRect.width;
  const imageBottom = imageRect.offsetY + imageRect.height;

  let left = imageRect.offsetX + normalized.x * imageRect.width;
  let top = imageRect.offsetY + normalized.y * imageRect.height;
  let right = left + normalized.w * imageRect.width;
  let bottom = top + normalized.h * imageRect.height;

  // Clamp the overlay to the actual displayed image area, not to the outer container.
  left = clampNumber(left, imageLeft, imageRight);
  top = clampNumber(top, imageTop, imageBottom);
  right = clampNumber(right, imageLeft, imageRight);
  bottom = clampNumber(bottom, imageTop, imageBottom);

  if (right <= left || bottom <= top) {
    els.eventCenterBox.classList.add('hidden');
    return;
  }

  els.eventCenterBox.classList.remove('hidden');
  els.eventCenterBox.style.left = `${left}px`;
  els.eventCenterBox.style.top = `${top}px`;
  els.eventCenterBox.style.width = `${right - left}px`;
  els.eventCenterBox.style.height = `${bottom - top}px`;
}

function showEventImageInCenter(payload) {
  if (!payload || !payload.imageUrl || !els.eventCenterImage) return;
  state.centerMode = 'event';
  state.lastEventImage = payload;
  updateModeButtons();
  hideHlsPlaceholder();
  state.pendingEventCrop = payload.crop || null;
  els.eventCenterImage.src = payload.imageUrl;
  if (els.eventCenterImage.complete) setEventCenterBox(state.pendingEventCrop);
  const cameraId = payload.cameraId || 'Unknown';
  const eventName = deriveEventName(payload);
  updateCenterHeader('이벤트 뷰어', null);
  updateEventCenterLog(payload);
  if (els.cameraHelperText) els.cameraHelperText.textContent = '이벤트 이미지 표시 모드입니다. GIS 또는 CAM 버튼을 누르면 기존 화면으로 돌아갑니다.';
  setStatus(`이벤트 이미지 중앙 표시: ${cameraId} / ${eventName}`);
}

function postFocusCameraToGis(cam, attempt = 0) {
  if (!cam || !els.gisFrame?.contentWindow) return;
  try {
    els.gisFrame.contentWindow.postMessage({
      type: 'focusCameraOnMap',
      camId: cam.id,
    }, '*');
  } catch {}

  if (!state.gisReady && attempt < 8) {
    setTimeout(() => postFocusCameraToGis(cam, attempt + 1), 350);
  }
}

function enterGisMode() {
  state.centerMode = 'gis';
  updateModeButtons();
  ensureGisFrameLoaded();
  const cam = getSelectedCamera();
  updateCenterHeader('GIS', cam ? `선택 카메라: ${cam.name || cam.id}` : '초기 상태: GIS 지도 화면');
  if (els.cameraHelperText) {
    els.cameraHelperText.textContent = cam
      ? `선택된 카메라: ${cam.name || cam.id} (${cam.id}) · 지도 중심을 이동하고 해당 카메라 Viewer 하나만 표시합니다.`
      : '초기 상태는 GIS 지도 화면입니다. GIS 상태에서 카메라를 선택하면 해당 위치로 이동하고 카메라 Viewer를 하나만 표시합니다.';
  }
  if (cam) {
    setTimeout(() => postFocusCameraToGis(cam), 150);
    setStatus(`GIS 화면으로 전환: ${cam.name || cam.id} 위치 강조`);
  } else {
    setStatus('중앙 패널을 GIS 화면으로 전환했습니다');
  }
}

function enterHlsMode() {
  state.centerMode = 'hls';
  updateModeButtons();
  const cam = getSelectedCamera();
  if (!cam) {
    updateCenterHeader('CAM', '카메라를 선택하세요');
    showHlsPlaceholder('CAM 모드', '좌측 카메라 목록에서 재생할 카메라를 선택하세요.');
    if (els.hlsFrame) els.hlsFrame.src = buildCameraPlayerUrl('');
    if (els.cameraHelperText) els.cameraHelperText.textContent = 'CAM 모드입니다. 좌측 카메라 목록에서 재생할 카메라를 선택하세요.';
    setStatus('중앙 패널을 CAM 대기 화면으로 전환했습니다');
    return;
  }
  playSelectedCamera(cam);
}

function highlightSelectedCamera() {
  document.querySelectorAll('.camera-item').forEach((el) => {
    const isActive = el.dataset.camId === state.selectedCameraId;
    el.classList.toggle('active', isActive);
  });
}

function playSelectedCamera(cam) {
  if (!cam || !els.hlsFrame) return;
  state.centerMode = 'hls';
  state.selectedCameraId = cam.id;
  updateModeButtons();
  highlightSelectedCamera();
  hideHlsPlaceholder();
  updateCenterHeader(`CAM · ${cam.name || cam.id}`, `${cam.id} · ${cam.status || 'UNKNOWN'}`);
  els.hlsFrame.src = buildCameraPlayerUrl(cam.id);
  if (els.cameraHelperText) {
    els.cameraHelperText.textContent = `선택된 카메라: ${cam.name || cam.id} (${cam.id}) · 중앙 패널에 HLS 영상을 표시합니다.`;
  }
  setStatus(`중앙 HLS 화면으로 전환: ${cam.name || cam.id}`);
}

async function loadModules() {
  const rawModulesCfg = await fetchJson(`${CONFIG_BASE}/modules.json`);
  const modulesCfg = normalizeModuleUrls(rawModulesCfg);
  state.modules = modulesCfg;
  ensureGisFrameLoaded();
  if (els.ytnFrame) {
    const baseYtnUrl = modulesCfg.ytn_url || serviceUrl(8080, '/ytn.html?camId=video1&embed=1&unifiedHls=1&liveDelay=3&v=7712');
    const sep = String(baseYtnUrl).includes('?') ? '&' : '?';
    // V77.09: YouTube iframe/old player cache가 남지 않도록 항상 HLS 공통 player로 새로 로드합니다.
    els.ytnFrame.src = `${baseYtnUrl}${sep}_frameBoot=${Date.now()}`;
  }

  setSyncState(els.btnSyncWeather, 'loading');
  setSyncState(els.btnSyncSms, 'loading');
  setSyncState(els.btnSyncNews, 'loading');
  setSyncState(els.btnSyncEvent, 'loading');

  forceReloadFrame(els.weatherFrame, modulesCfg.weather_url || '', 'weather', true, modulesCfg.weather_probe_url || modulesCfg.weather_url || '');
  forceReloadFrame(els.smsFrame, modulesCfg.sms_url || '', 'sms', false);
  forceReloadFrame(els.newsFrame, modulesCfg.news_url || '', 'news', false);
  forceReloadFrame(els.eventFrame, modulesCfg.event_url || '', 'event', false);
}

async function loadCameras() {
  const camerasUrl = joinUrl(getHlsApiBase(), '/api/cameras');
  console.log('[loadCameras] url =', camerasUrl);
  const payload = await fetchJson(camerasUrl);
  state.cameras = Array.isArray(payload.cameras) ? payload.cameras : [];
  state.filteredCameras = [...state.cameras];
}

function renderCameraList() {
  const q = (els.cameraSearch?.value || '').trim().toLowerCase();
  state.filteredCameras = state.cameras.filter((cam) => !q || `${cam.id} ${cam.name}`.toLowerCase().includes(q));
  if (!els.cameraList) return;
  els.cameraList.innerHTML = '';

  state.filteredCameras.forEach((cam) => {
    const div = document.createElement('div');
    div.className = 'camera-item';
    div.dataset.camId = cam.id;
    div.innerHTML = `<div class="camera-item-title">${cam.id} | ${cam.name}</div><div class="camera-item-meta"><span>${cam.status || 'UNKNOWN'}</span><span>${getStreamModeLabel(cam)}</span></div>`;
    div.addEventListener('click', () => {
      state.selectedCameraId = cam.id;
      highlightSelectedCamera();
      if (state.centerMode === 'hls') {
        playSelectedCamera(cam);
        return;
      }
      if (els.cameraHelperText) {
        els.cameraHelperText.textContent = `선택된 카메라: ${cam.name || cam.id} (${cam.id}) · 지도 중심을 이동하고 선택된 카메라 Viewer만 지도 위에 표시합니다.`;
      }
      updateCenterHeader('GIS', `카메라 포커스: ${cam.name || cam.id}`);
      postFocusCameraToGis(cam);
      setStatus(`GIS에서 카메라 포커스: ${cam.name || cam.id}`);
    });
    els.cameraList.appendChild(div);
  });

  highlightSelectedCamera();
}

function renderSnapshots() {
  if (!els.snapshotContainer) return;
  const items = [
    { type: 'FIRE', cam: 'CAM-001', time: '14:21:11', img: 'https://picsum.photos/seed/fire-preview/240/120' },
    { type: 'LPR', cam: 'CAM-002', time: '14:22:07', img: 'https://picsum.photos/seed/lpr-preview/240/120' },
    { type: 'INTRUSION', cam: 'CAM-003', time: '14:23:19', img: 'https://picsum.photos/seed/intrusion-preview/240/120' },
  ];
  els.snapshotContainer.innerHTML = items.map((item) => `<div class="snapshot-card"><img src="${item.img}" alt="snapshot" /><div class="snapshot-caption">${item.type} | ${item.cam} | ${item.time}</div></div>`).join('');
}

function bindEvents() {
  ensurePanelOpenButtonsVisible();
  if (els.btnShowGis) els.btnShowGis.addEventListener('click', enterGisMode);
  if (els.btnShowHls) els.btnShowHls.addEventListener('click', enterHlsMode);
  if (els.btnRefreshList) {
    els.btnRefreshList.addEventListener('click', async () => {
      try {
        if (els.cameraSearch) els.cameraSearch.value = '';
        await loadCameras();
        renderCameraList();
        setStatus('검색 초기화 후 카메라 목록 새로고침 완료');
      } catch (e) {
        console.error(e);
        setStatus(`목록 새로고침 실패: ${e.message}`);
      }
    });
  }
  if (els.cameraSearch) els.cameraSearch.addEventListener('input', renderCameraList);

  wireFrameLoad(els.smsFrame, els.btnSyncSms);
  wireFrameLoad(els.newsFrame, els.btnSyncNews);
  wireFrameLoad(els.eventFrame, els.btnSyncEvent);
  if (els.eventCenterImage) {
    els.eventCenterImage.addEventListener('load', () => setEventCenterBox(state.pendingEventCrop));
    window.addEventListener('resize', () => {
      if (state.centerMode === 'event') setEventCenterBox(state.pendingEventCrop);
    });
  }

  if (els.gisFrame) {
    els.gisFrame.addEventListener('load', () => {
      state.gisReady = false;
      const cam = getSelectedCamera();
      if (state.centerMode === 'gis' && cam) {
        setTimeout(() => postFocusCameraToGis(cam), 400);
      }
    });
  }

  setupPanelSync(els.btnSyncWeather, els.weatherFrame, 'weather', () => state.modules?.weather_url || '', {
    useLoader: true,
    getProbeUrl: () => state.modules?.weather_probe_url || state.modules?.weather_url || ''
  });
  setupPanelSync(els.btnSyncSms, els.smsFrame, 'sms', () => state.modules?.sms_url || '');
  setupPanelSync(els.btnSyncNews, els.newsFrame, 'news', () => state.modules?.news_url || '');
  setupPanelSync(els.btnSyncEvent, els.eventFrame, 'event', () => state.modules?.event_url || '');

  setupPanelOpenButton(els.btnOpenWeather, 'weather', () => state.modules?.weather_url || serviceUrl(8100, '/'));
  setupPanelOpenButton(els.btnOpenSms, 'sms', () => state.modules?.sms_url || serviceUrl(3000, '/'));
  setupPanelOpenButton(els.btnOpenNews, 'news', () => state.modules?.news_url || serviceUrl(5173, '/'));
  setupPanelOpenButton(els.btnOpenEvent, 'event', () => state.modules?.event_url || serviceUrl(3100, '/'));
  if (els.btnOpenReport) els.btnOpenReport.addEventListener('click', openReportModal);
  if (els.btnCloseReportModal) els.btnCloseReportModal.addEventListener('click', closeReportModal);
  if (els.reportModal) {
    els.reportModal.addEventListener('click', (event) => {
      if (event.target === els.reportModal || event.target?.dataset?.reportModalClose === 'true') closeReportModal();
    });
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.reportModalOpen) {
      event.preventDefault();
      closeReportModal();
    }
  });

  window.addEventListener('message', (ev) => {
    const data = ev.data || {};
    if (typeof data !== 'object') return;

    if (data.type === 'embed-loader:loading' && data.label === 'weather') setSyncState(els.btnSyncWeather, 'loading');
    if (data.type === 'embed-loader:ready' && data.label === 'weather') {
      pulseSyncState(els.btnSyncWeather, 'success');
      setStatus('WEATHER 패널 연결 완료');
    }
    if (data.type === 'embed-loader:error' && data.label === 'weather') {
      pulseSyncState(els.btnSyncWeather, 'error');
      setStatus('WEATHER 패널 연결 실패');
    }

    if (data.type === 'panel-sync') {
      const btn = data.panel === 'sms' ? els.btnSyncSms : data.panel === 'news' ? els.btnSyncNews : data.panel === 'weather' ? els.btnSyncWeather : data.panel === 'event' ? els.btnSyncEvent : null;
      if (!btn) return;
      if (data.status === 'loading') setSyncState(btn, 'loading');
      else if (data.status === 'success') pulseSyncState(btn, 'success');
      else if (data.status === 'error') pulseSyncState(btn, 'error');
      return;
    }

    if (data.type === 'event-dashboard:image-selected') {
      showEventImageInCenter(data);
      pulseSyncState(els.btnSyncEvent, 'success');
      return;
    }

    if (data.type === 'open-camera-in-cam-mode' && data.camId) {
      const cam = state.cameras.find((item) => item.id === data.camId) || null;
      state.selectedCameraId = data.camId;
      highlightSelectedCamera();
      if (cam) {
        playSelectedCamera(cam);
        setStatus(`GIS에서 CAM 모드 전환: ${cam.name || cam.id}`);
      } else {
        enterHlsMode();
        setStatus(`GIS에서 CAM 모드 전환 요청: ${data.camId}`);
      }
      return;
    }
  });
}

async function start() {
  try {
    setStatus('설정 로드 중');
    bindEvents();
    updateModeButtons();
    enterGisMode();
    await loadModules();
    await loadCameras();
    renderCameraList();
    setStatus('준비 완료 (중앙 패널: GIS 기본 표시)');
  } catch (e) {
    console.error(e);
    setStatus(`초기화 실패: ${e.message}`);
  }
}

start();
