const __weatherIsEmbedMode = new URLSearchParams(window.location.search).get('embed') === '1';
if (__weatherIsEmbedMode) { document.body.classList.add('embed-mode'); }
function __weatherNotifyParent(status) { if (!__weatherIsEmbedMode) return; try { window.parent.postMessage({ type: 'panel-sync', panel: 'weather', status }, '*'); } catch {} }
const WEATHER_JS_VERSION = 'v758';
console.log('[weather.js]', WEATHER_JS_VERSION);


function updatePlatformDate() {
  const el = document.getElementById('platformToday');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

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


async function fetchWeather() {
  const res = await fetch("/api/weather", { cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}


function isSnowPty(pty) {
  // PTY (강수형태): 0 없음, 1 비, 2 비/눈, 3 눈, 5 빗방울, 6 빗방울/눈날림, 7 눈날림
  // KMA 응답이 "02", "2.0" 같은 형태로 올 수 있어 숫자로 정규화
  const n = parseInt(String(pty ?? "").trim(), 10);
  return n === 2 || n === 3 || n === 6 || n === 7;
}

function pickPrecipText(obj) {
  const pty = obj?.PTY;
  const sno = (obj?.SNO ?? "").toString().trim();
  const pcp = (obj?.PCP ?? obj?.RN1 ?? "-").toString().trim();

  const hasSnow = (() => {
    const s = sno.replace(/\s+/g, "");
    if (s === "" || s === "-") return false;
    // common "no snow" strings
    if (s === "0" || s === "0.0" || s === "0cm" || s === "0.0cm") return false;
    if (s.includes("적설없") || s.includes("없음") || s.includes("없습니다")) return false;
    return true; // allow ranges like "1~4cm"
  })();

  // ✅ Snow (including rain+snow): always show "snowfall" label; if SNO missing, fallback to PCP value
  if (isSnowPty(pty)) {
    if (hasSnow) {
      return { icon: "❄️", label: "강설량(SNO)", value: sno };
    }
    return { icon: "❄️", label: "강설량(SNO, 대체)", value: pcp };
  }

  // Rain / other precipitation
  return { icon: "💧", label: (obj?.PCP !== undefined ? "강수량(PCP)" : "1시간 강수량(RN1)"), value: pcp };
}
function line(icon, text) {
  return `${icon} ${text}<br>`;
}

function render(data) {
  const updatedAt = document.getElementById("updatedAt");
  updatedAt.textContent = `업데이트: ${data.generated_at || "-"}`;

  const pageTitle = document.getElementById("pageTitle");
  if (pageTitle) pageTitle.textContent = `🌦️ 현재 날씨 + 내일 날씨`;

  const root = document.getElementById("regions");
  root.innerHTML = "";

  if (data.error) {
    const err = document.createElement("div");
    err.style.cssText = "color:#FFB4A2;padding:12px;font-weight:700;";
    err.textContent = `데이터 상태: ${data.error}`;
    root.appendChild(err);
  }

  const baseRegions = [];
  for (const r of (data.regions || [])) {
    const region = document.createElement("section");
    region.className = "region";

    region.innerHTML = `
      <div class="region-title">📍 ${r.name}</div>
      <div class="row">
        ${renderNow(r)}
        ${renderTomorrow(r, data.forecast_config || {})}
      </div>
    `;
    root.appendChild(region);
    baseRegions.push(region);
  }

  if (baseRegions.length > 1) {
    for (const region of baseRegions) {
      const clone = region.cloneNode(true);
      clone.setAttribute('data-dup', '1');
      root.appendChild(clone);
    }
  }
}

function renderNow(r) {
  const n = r.now || {};
  const detail =
    line("☁️", `하늘상태(SKY, 예보): ${n.SKY ?? "-"}`) +
    line("🌧️", `강수형태(PTY, 예보/실황): ${n.PTY ?? "-"} (실황:${n.PTY_obs ?? "-"})`) +
    (() => { const p = pickPrecipText({ ...n, PCP: undefined }); return line(p.icon, `${p.label}: ${p.value}`); })() +
    line("💦", `습도(REH): ${n.REH ?? "-" }%`) +
    line("🌬️", `풍향: ${n.VEC ?? "-"}`) +
    line("💨", `풍속(WSD): ${n.WSD ?? "-" } m/s`);

  return `
    <div class="now-card">
      <div class="label card-head time-inline">조회시각: ${n.captured_at || "-"}</div>
      <div class="icon">${n.icon || "🌈"}</div>
      <div class="temp">${n.T1H ?? "-"}℃</div>
      <div class="detail">${detail}</div>
      ${r.now_error ? `<div class="label" style="color:#FFB4A2;margin-top:10px">now: ${r.now_error}</div>` : ""}
      ${r.ultra_error ? `<div class="label" style="color:#FFB4A2;margin-top:6px">ultra: ${r.ultra_error}</div>` : ""}
    </div>
  `;
}

function renderTomorrow(r, forecastConfig = {}) {
  const list = r.forecast || [];
  const f = list[0] || {};
  const detail =
    line("☔", `강수확률(POP): ${f.POP ?? "-" }%`) +
    (() => { const p = pickPrecipText(f); return line(p.icon, `${p.label}: ${p.value}`); })() +
    line("💦", `습도(REH): ${f.REH ?? "-" }%`) +
    line("🌬️", `풍향: ${f.VEC ?? "-"}`) +
    line("💨", `풍속(WSD): ${f.WSD ?? "-" } m/s`);

  return `
    <div class="forecast">
      ${r.forecast_error ? `<div class="label" style="color:#FFB4A2;margin-bottom:10px">forecast: ${r.forecast_error}</div>` : ""}
      <div class="grid">
        <div class="fcard tomorrow-card">
          <div class="label card-head time-inline">내일 날씨: ${f.time || "-"}</div>
          <div class="icon">${f.icon || "🌈"}</div>
          <div class="temp">${f.TMP ?? "-"}℃</div>
          <div class="detail">${list.length ? detail : '예보 데이터가 없습니다.'}</div>
        </div>
      </div>
    </div>
  `;
}

// 자동 스크롤: 지역이 상단에 오면 잠시 정지 후 다음 지역으로 이동
function startAutoScroll(config = {}) {
  const pauseMs = Math.max(0, Number(config.scroll_pause_seconds || 5) * 1000);
  const stopPosi = Math.max(-1, Math.min(1, Number.isFinite(Number(config.stop_posi)) ? Number(config.stop_posi) : 0));
  const stepPx = 1;
  const intervalMs = 25;
  const scroller = document.scrollingElement || document.documentElement;
  let pauseUntil = performance.now() + pauseMs;
  let nextRegionIndex = 1;
  let hoverPaused = false;

  const getBaseRegions = () => Array.from(document.querySelectorAll('.region:not([data-dup="1"])'));
  const getLoopPoint = () => {
    const dupFirst = document.querySelector('.region[data-dup="1"]');
    return dupFirst ? dupFirst.offsetTop : Math.max(0, scroller.scrollHeight - window.innerHeight);
  };

  const currentRegionIndex = () => {
    const regions = getBaseRegions();
    if (regions.length === 0) return 0;
    const loopPoint = getLoopPoint();
    const currentTop = loopPoint > 0 ? (scroller.scrollTop % loopPoint) : scroller.scrollTop;
    let idx = 0;
    for (let i = 0; i < regions.length; i += 1) {
      if (regions[i].offsetTop <= currentTop + 1) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  };

  const moveToRegionIndex = (targetIndex, nowTs = performance.now()) => {
    const regions = getBaseRegions();
    if (regions.length === 0) return;
    const clampedIndex = Math.max(0, Math.min(regions.length - 1, targetIndex));
    scroller.scrollTop = regions[clampedIndex].offsetTop;
    nextRegionIndex = Math.min(regions.length, clampedIndex + 1);
    pauseUntil = nowTs + pauseMs;
  };

  const jumpToRegion = (direction) => {
    moveToRegionIndex(currentRegionIndex() + (direction > 0 ? 1 : -1));
  };

  const snapToStopPosition = (nowTs = performance.now()) => {
    moveToRegionIndex(currentRegionIndex() + stopPosi, nowTs);
  };

  const wrapToTopSeamlessly = (timestamp) => {
    const loopPoint = getLoopPoint();
    if (loopPoint > 0) {
      scroller.scrollTop = Math.max(0, scroller.scrollTop - loopPoint);
    } else {
      scroller.scrollTop = 0;
    }
    nextRegionIndex = 1;
    pauseUntil = timestamp + pauseMs;
  };

  const onEnter = () => {
    hoverPaused = true;
    snapToStopPosition(performance.now());
  };

  const onLeave = () => {
    hoverPaused = false;
    pauseUntil = performance.now() + pauseMs;
  };

  const onWheel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    hoverPaused = true;
    jumpToRegion(event.deltaY >= 0 ? 1 : -1);
  };

  const hoverTarget = document.documentElement;
  hoverTarget.addEventListener('mouseenter', onEnter, true);
  hoverTarget.addEventListener('mousemove', onEnter, true);
  hoverTarget.addEventListener('mouseleave', onLeave, true);
  hoverTarget.addEventListener('wheel', onWheel, { passive: false, capture: true });

  const timer = setInterval(() => {
    const now = performance.now();
    if (hoverPaused || now < pauseUntil) return;

    const regions = getBaseRegions();
    if (regions.length === 0) return;

    const loopPoint = getLoopPoint();
    if (loopPoint <= 0) return;

    if (nextRegionIndex >= regions.length) {
      const nextY = scroller.scrollTop + stepPx;
      scroller.scrollTop = nextY;
      if (nextY >= loopPoint - 1) {
        wrapToTopSeamlessly(now);
      }
      return;
    }

    const targetTop = regions[nextRegionIndex].offsetTop;
    const nextY = Math.min(scroller.scrollTop + stepPx, targetTop);
    scroller.scrollTop = nextY;

    if (nextY >= targetTop - 1) {
      pauseUntil = now + pauseMs;
      nextRegionIndex += 1;
    }
  }, intervalMs);

  return () => {
    clearInterval(timer);
    hoverTarget.removeEventListener('mouseenter', onEnter, true);
    hoverTarget.removeEventListener('mousemove', onEnter, true);
    hoverTarget.removeEventListener('mouseleave', onLeave, true);
    hoverTarget.removeEventListener('wheel', onWheel, true);
  };
}

async function boot() {
  let lastData = {};
  __weatherNotifyParent('loading');
  try {
    lastData = await fetchWeather();
    render(lastData);
    __weatherNotifyParent(lastData && !lastData.error ? 'success' : 'error');
  } catch (e) {
    __weatherNotifyParent('error');
    document.getElementById("regions").innerHTML =
      `<div style="color:#FFB4A2">데이터 로드 실패: ${e.message}</div>`;
  }

  const stopAutoScroll = startAutoScroll(lastData || {});
  window.__weatherStopAutoScroll = stopAutoScroll;

  // 프론트는 1분마다 갱신 (백엔드는 10분마다 캐시 갱신)
  setInterval(async () => {
    __weatherNotifyParent('loading');
    try {
      lastData = await fetchWeather();
      render(lastData);
      __weatherNotifyParent(lastData && !lastData.error ? 'success' : 'error');
    } catch {
      __weatherNotifyParent('error');
    }
  }, 60 * 1000);
}

updatePlatformDate();
initCursorAutoHide();
boot();
