
/**
 * SMS_DASHBOARD - SafetyData.go.kr proxy server with local cache
 *
 * Strategy:
 * - API clients always read from local cache first.
 * - Server syncs latest pages in the background and merges new items.
 * - If upstream fails, cached data still serves the dashboard.
 */

import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, '../.env');
dotenv.config({ path: ENV_PATH });
console.log('[ENV PATH]', ENV_PATH);
console.log('[ENV CHECK] SAFETYDATA_SERVICE_KEY exists =', !!process.env.SAFETYDATA_SERVICE_KEY);

const app = express();

app.use((req, res, next) => {
  const origin = process.env.SMS_CORS_ORIGINS || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
const PORT = Number(String(process.env.PORT || '3005').trim()) || 3005;
const HOST = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';
const CACHE_DIR = path.join(__dirname, 'data');
const CACHE_PATH = path.join(CACHE_DIR, 'sms_cache.json');
const CACHE_KEEP_DAYS = Number(process.env.SMS_CACHE_KEEP_DAYS || 30);
const CACHE_MAX_ITEMS = Number(process.env.SMS_CACHE_MAX_ITEMS || 5000);
const LATEST_SCAN_PAGES = Number(process.env.SMS_LATEST_SCAN_PAGES || 3);
const SYNC_MIN_INTERVAL_MS = Number(process.env.SMS_SYNC_MIN_INTERVAL_MS || 60_000);
const FETCH_TIMEOUT_MS = Number(process.env.SMS_FETCH_TIMEOUT_MS || 15_000);

let syncPromise = null;
let lastSyncStartedAt = 0;
let lastSyncError = null;

app.get('/favicon.ico', (_req, res) => res.status(204).end());

function buildUpstreamUrl({ pageNo, numOfRows }) {
  const base = 'https://www.safetydata.go.kr/V2/api/DSSP-IF-00247';
  const u = new URL(base);

  let key = process.env.SAFETYDATA_SERVICE_KEY || '';
  try {
    if (/%[0-9A-Fa-f]{2}/.test(key)) key = decodeURIComponent(key);
  } catch {
    // ignore decode errors
  }

  u.searchParams.set('serviceKey', key);
  u.searchParams.set('pageNo', String(pageNo));
  u.searchParams.set('numOfRows', String(numOfRows));
  u.searchParams.set('returnType', 'json');
  return u;
}

function findFirstObjectArray(root) {
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') continue;
    if (seen.has(cur)) continue;
    seen.add(cur);

    if (Array.isArray(cur)) {
      if (cur.length && cur.every((v) => v && typeof v === 'object' && !Array.isArray(v))) return cur;
      for (const v of cur) queue.push(v);
    } else {
      for (const v of Object.values(cur)) queue.push(v);
    }
  }
  return null;
}

function toIsoFromCrtDt(crtDt) {
  if (!crtDt || typeof crtDt !== 'string') return null;
  const m = crtDt.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  return `${y}-${mo}-${d}T${hh}:${mm}:${ss}+09:00`;
}

function parseCrtDtToMs(crtDt) {
  const iso = toIsoFromCrtDt(crtDt);
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function makeItemId(item) {
  const tsIso = toIsoFromCrtDt(item?.CRT_DT) || item?.timestamp || '';
  const areaFull = (item?.RCPTN_RGN_NM ?? item?.areaFull ?? item?.area ?? '').toString().trim();
  const msg = (item?.MSG_CN ?? item?.message ?? '').toString().trim();
  const sn = (item?.SN ?? '').toString().trim();
  return sn ? `sn-${sn}` : `${tsIso}|${areaFull}|${msg}`;
}

function normalizeItem(item, idx, sourcePage = null) {
  const msg = (item?.MSG_CN ?? item?.message ?? '').toString();
  const areaFull = (item?.RCPTN_RGN_NM ?? item?.areaFull ?? '').toString().trim();
  const area = (areaFull.split(',')[0] || item?.area || '').toString().trim() || '미상';
  const step = (item?.EMRG_STEP_NM ?? item?.step ?? '').toString().trim() || '미상';
  const type = (item?.DST_SE_NM ?? item?.type ?? '').toString().trim() || '미상';
  const tsIso = toIsoFromCrtDt(item?.CRT_DT) || item?.timestamp || new Date().toISOString();
  const id = makeItemId(item) || `api-${Date.now()}-${idx}`;

  return {
    id,
    area,
    areaFull: areaFull || area,
    step,
    type,
    message: msg || JSON.stringify(item),
    timestamp: tsIso,
    sourcePage,
    _raw: item,
  };
}

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      updatedAt: parsed?.updatedAt || null,
      lastSyncStatus: parsed?.lastSyncStatus || 'ok',
      lastSyncError: parsed?.lastSyncError || null,
      orderGuessed: parsed?.orderGuessed || null,
      items: Array.isArray(parsed?.items) ? parsed.items : [],
    };
  } catch {
    return {
      version: 1,
      updatedAt: null,
      lastSyncStatus: 'empty',
      lastSyncError: null,
      orderGuessed: null,
      items: [],
    };
  }
}

async function writeCache(cache) {
  await ensureCacheDir();
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

function pruneItems(items, keepDays = CACHE_KEEP_DAYS, maxItems = CACHE_MAX_ITEMS) {
  const cutoff = Date.now() - Math.max(0, keepDays) * 24 * 60 * 60 * 1000;
  const filtered = items.filter((x) => {
    const ms = Date.parse(x.timestamp);
    return !Number.isNaN(ms) && ms >= cutoff;
  });
  filtered.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return filtered.slice(0, Math.max(1, maxItems));
}

function dedupeItems(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.id) continue;
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          ...(options.headers || {}),
        },
      });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

async function fetchUpstreamPage(pn, rows) {
  const upstreamUrl = buildUpstreamUrl({ pageNo: pn, numOfRows: rows });
  const r = await fetchWithRetry(upstreamUrl.toString(), { method: 'GET' }, 3);

  const upstreamStatus = r.status;
  const contentType = r.headers.get('content-type') || '';
  const text = await r.text();

  if (!r.ok) {
    const err = new Error('Upstream returned non-2xx');
    err.upstream = { upstreamStatus, contentType, text, upstreamUrl: upstreamUrl.toString() };
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err = new Error('Upstream response was not JSON');
    err.upstream = { upstreamStatus, contentType, text, upstreamUrl: upstreamUrl.toString() };
    throw err;
  }

  const arr = findFirstObjectArray(parsed) || [];
  const totalCount = parsed?.totalCount ?? parsed?.data?.totalCount ?? parsed?.response?.body?.totalCount ?? parsed?.body?.totalCount;
  return { arr, totalCount };
}

async function detectOrder() {
  const p1 = await fetchUpstreamPage(1, 1);
  const p2 = await fetchUpstreamPage(2, 1);
  const a = p1.arr?.[0];
  const b = p2.arr?.[0];
  const ta = parseCrtDtToMs(a?.CRT_DT);
  const tb = parseCrtDtToMs(b?.CRT_DT);
  return tb > ta ? 'ASC' : 'DESC';
}

async function findLastPage(rowsPerPage) {
  try {
    const p = await fetchUpstreamPage(1, 1);
    if (Number.isFinite(Number(p.totalCount)) && Number(p.totalCount) > 0) {
      return Math.ceil(Number(p.totalCount) / rowsPerPage);
    }
  } catch {
    // ignore
  }
  const MAX_PAGES = 500;
  let lastNonEmpty = 1;
  for (let pn = 1; pn <= MAX_PAGES; pn++) {
    const { arr } = await fetchUpstreamPage(pn, rowsPerPage);
    if (!arr.length) break;
    lastNonEmpty = pn;
  }
  return lastNonEmpty;
}

async function syncLatestPages({ rowsPerPage = 100 } = {}) {
  const currentCache = await readCache();
  const existingItems = currentCache.items || [];
  const existingIds = new Set(existingItems.map((x) => x.id));
  const order = await detectOrder();

  let pagesToCheck = [];
  if (order === 'DESC') {
    pagesToCheck = Array.from({ length: LATEST_SCAN_PAGES }, (_, i) => i + 1);
  } else {
    const lastPage = await findLastPage(rowsPerPage);
    pagesToCheck = Array.from({ length: LATEST_SCAN_PAGES }, (_, i) => lastPage - i).filter((x) => x >= 1);
  }

  let newNormalized = [];
  let consecutiveNoNew = 0;

  for (const pn of pagesToCheck) {
    const { arr } = await fetchUpstreamPage(pn, rowsPerPage);
    if (!arr.length) continue;

    const normalizedPage = arr.map((it, idx) => normalizeItem(it, idx, pn));
    const pageNew = normalizedPage.filter((it) => !existingIds.has(it.id));

    if (pageNew.length === 0) {
      consecutiveNoNew += 1;
      if (consecutiveNoNew >= 2) break;
    } else {
      consecutiveNoNew = 0;
      newNormalized.push(...pageNew);
    }
  }

  const mergedItems = pruneItems(dedupeItems([...newNormalized, ...existingItems]));
  const nextCache = {
    version: 1,
    updatedAt: new Date().toISOString(),
    lastSyncStatus: 'ok',
    lastSyncError: null,
    orderGuessed: order,
    items: mergedItems,
  };
  await writeCache(nextCache);
  return nextCache;
}

async function ensureFreshCache() {
  const cache = await readCache();
  if ((cache.items || []).length > 0) return cache;
  try {
    return await syncLatestPages({ rowsPerPage: 100 });
  } catch (err) {
    lastSyncError = String(err?.message || err);
    const failed = {
      ...cache,
      lastSyncStatus: 'failed',
      lastSyncError,
      updatedAt: cache.updatedAt || new Date().toISOString(),
    };
    await writeCache(failed);
    return failed;
  }
}

function maybeTriggerBackgroundSync() {
  const now = Date.now();
  if (syncPromise) return;
  if (now - lastSyncStartedAt < SYNC_MIN_INTERVAL_MS) return;

  lastSyncStartedAt = now;
  syncPromise = (async () => {
    try {
      await syncLatestPages({ rowsPerPage: 100 });
      lastSyncError = null;
    } catch (err) {
      lastSyncError = String(err?.message || err);
      const cache = await readCache();
      await writeCache({
        ...cache,
        lastSyncStatus: 'failed',
        lastSyncError,
        updatedAt: cache.updatedAt || new Date().toISOString(),
      });
      console.error('[SYNC FAILED]', err);
    } finally {
      syncPromise = null;
    }
  })();
}

app.get('/api/health', async (_req, res) => {
  const cache = await readCache();
  res.json({
    ok: true,
    cacheUpdatedAt: cache.updatedAt,
    cacheItems: cache.items.length,
    lastSyncStatus: cache.lastSyncStatus,
    lastSyncError: cache.lastSyncError,
  });
});

app.get('/api/disaster-sms', async (req, res) => {
  const numOfRows = Number(req.query.numOfRows || 50);
  const days = Number(req.query.days || 3);

  if (!process.env.SAFETYDATA_SERVICE_KEY) {
    return res.status(400).json({
      ok: false,
      error: 'Missing SAFETYDATA_SERVICE_KEY in .env',
      hint: 'Create .env and set SAFETYDATA_SERVICE_KEY=... (see README2.md)',
    });
  }

  if (typeof globalThis.fetch !== 'function') {
    return res.status(500).json({
      ok: false,
      error: 'Node.js fetch() is not available. Please use Node 18+ (recommended 20 LTS).',
    });
  }

  try {
    const cache = await ensureFreshCache();
    maybeTriggerBackgroundSync();

    const cutoffMs = Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000;
    const filtered = (cache.items || [])
      .filter((it) => {
        const ms = Date.parse(it.timestamp);
        return Number.isFinite(ms) && ms >= cutoffMs;
      })
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, Math.max(1, numOfRows));

    return res.json({
      ok: true,
      source: 'cache',
      fetchedAt: new Date().toISOString(),
      updatedAt: cache.updatedAt,
      lastSyncStatus: cache.lastSyncStatus,
      lastSyncError: cache.lastSyncError,
      ReportDate: days,
      pagesScanned: LATEST_SCAN_PAGES,
      orderGuessed: cache.orderGuessed,
      items: filtered,
    });
  } catch (e) {
    console.error(e);
    const cache = await readCache();
    if ((cache.items || []).length > 0) {
      const cutoffMs = Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000;
      const filtered = (cache.items || [])
        .filter((it) => {
          const ms = Date.parse(it.timestamp);
          return Number.isFinite(ms) && ms >= cutoffMs;
        })
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .slice(0, Math.max(1, numOfRows));

      return res.json({
        ok: true,
        source: 'cache',
        fetchedAt: new Date().toISOString(),
        updatedAt: cache.updatedAt,
        lastSyncStatus: 'failed',
        lastSyncError: String(e?.message || e),
        ReportDate: days,
        items: filtered,
      });
    }

    const upstream = e?.upstream;
    if (upstream) {
      return res.status(502).json({
        ok: false,
        error: e?.message || 'Upstream error',
        upstreamStatus: upstream.upstreamStatus,
        contentType: upstream.contentType,
        raw: String(upstream.text || '').slice(0, 2000),
        upstreamUrl: String(upstream.upstreamUrl || '').replace(/serviceKey=[^&]+/, 'serviceKey=***'),
      });
    }
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Warm cache shortly after startup
setTimeout(() => {
  maybeTriggerBackgroundSync();
}, 1500);

app.listen(PORT, HOST, async () => {
  await ensureCacheDir();
  console.log(`[SMS_DASHBOARD server] listening on http://${HOST}:${PORT}`);
  console.log(`[REMOTE] SMS backend available from LAN as http://<server-ip>:${PORT}`);
  console.log(`[SMS_DASHBOARD cache] ${CACHE_PATH}`);
  console.log(`[SMS_DASHBOARD cwd] ${process.cwd()}`);
});
