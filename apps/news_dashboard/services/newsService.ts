import {
  NewsItem,
  ApiResponse,
  DisasterImportance,
  NewsSortOrder,
  AiAnalysisCacheMap,
  CachedAiAnalysis,
  DashboardConfig,
  FetchNewsResult,
} from '../types';
import { areaData } from '../areaData';
import dashboardConfig from '../NewsDashBoard.json';

const ALL_AREAS = [
  '서울', '인천', '경기', '강원', '충북', '충남', '대전', '전북', '전남', '광주', '경북', '경남', '대구', '부산', '울산', '제주', '전국',
] as const;

const AI_CACHE_KEY = 'news-dashboard-ai-cache-v1';
const NEWS_CACHE_KEY = 'news-dashboard-news-cache-v1';

type PageResult = {
  items: NewsItem[];
  totalCount: number | null;
  pageNo: number;
  failed: boolean;
  error?: string;
  rateLimited?: boolean;
};

type PageCache = Map<number, PageResult>;

const DEFAULT_CONFIG: DashboardConfig = {
  AIAnal: Boolean((dashboardConfig as Partial<DashboardConfig>).AIAnal ?? false),
  ReportDate: Number((dashboardConfig as Partial<DashboardConfig>).ReportDate ?? 30),
  RowsPerPage: Number((dashboardConfig as Partial<DashboardConfig>).RowsPerPage ?? 100),
  StartDayPage: Number((dashboardConfig as Partial<DashboardConfig>).StartDayPage ?? 458),
  EndPage: Number((dashboardConfig as Partial<DashboardConfig>).EndPage ?? 470),
  LastPage: Number((dashboardConfig as Partial<DashboardConfig>).LastPage ?? 470),
  BackwardScanLimit: Number((dashboardConfig as Partial<DashboardConfig>).BackwardScanLimit ?? 3),
  ForwardScanLimit: Number((dashboardConfig as Partial<DashboardConfig>).ForwardScanLimit ?? 3),
  LOAD_TIME: Number((dashboardConfig as Partial<DashboardConfig>).LOAD_TIME ?? 20),
  LOAD_TRY_TIME: Number((dashboardConfig as Partial<DashboardConfig>).LOAD_TRY_TIME ?? 2),
  ScrollSpeed: Number((dashboardConfig as Partial<DashboardConfig>).ScrollSpeed ?? 40),
  ScrollPauseSeconds: Number((dashboardConfig as Partial<DashboardConfig>).ScrollPauseSeconds ?? 5),
  StopPosi: Number((dashboardConfig as Partial<DashboardConfig>).StopPosi ?? 0),
};

function clampPositive(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeConfig(raw: Partial<DashboardConfig> | null | undefined): DashboardConfig {
  const cfg: DashboardConfig = {
    AIAnal: Boolean(raw?.AIAnal ?? DEFAULT_CONFIG.AIAnal),
    ReportDate: clampPositive(raw?.ReportDate, DEFAULT_CONFIG.ReportDate),
    RowsPerPage: clampPositive(raw?.RowsPerPage, DEFAULT_CONFIG.RowsPerPage),
    StartDayPage: clampPositive(raw?.StartDayPage, DEFAULT_CONFIG.StartDayPage),
    EndPage: clampPositive(raw?.EndPage, DEFAULT_CONFIG.EndPage),
    LastPage: clampPositive(raw?.LastPage, DEFAULT_CONFIG.LastPage),
    BackwardScanLimit: clampPositive(raw?.BackwardScanLimit, DEFAULT_CONFIG.BackwardScanLimit),
    ForwardScanLimit: clampPositive(raw?.ForwardScanLimit, DEFAULT_CONFIG.ForwardScanLimit),
    LOAD_TIME: clampPositive(raw?.LOAD_TIME, DEFAULT_CONFIG.LOAD_TIME),
    LOAD_TRY_TIME: clampPositive(raw?.LOAD_TRY_TIME, DEFAULT_CONFIG.LOAD_TRY_TIME),
    ScrollSpeed: clampPositive(raw?.ScrollSpeed, DEFAULT_CONFIG.ScrollSpeed),
    ScrollPauseSeconds: clampPositive(raw?.ScrollPauseSeconds, DEFAULT_CONFIG.ScrollPauseSeconds),
    StopPosi: Math.max(-1, Math.min(1, Number(raw?.StopPosi ?? DEFAULT_CONFIG.StopPosi))),
  };

  if (cfg.EndPage < cfg.StartDayPage) cfg.EndPage = cfg.StartDayPage;
  if (cfg.LastPage < cfg.EndPage) cfg.LastPage = cfg.EndPage;
  return cfg;
}

function parsePubDate(pubDate: string): Date | null {
  if (!pubDate) return null;

  const text = String(pubDate).trim();
  let parsed: Date;

  if (/^\d{12}$/.test(text)) {
    parsed = new Date(
      Number(text.slice(0, 4)),
      Number(text.slice(4, 6)) - 1,
      Number(text.slice(6, 8)),
      Number(text.slice(8, 10)),
      Number(text.slice(10, 12)),
      0,
    );
  } else if (/^\d{14}$/.test(text)) {
    parsed = new Date(
      Number(text.slice(0, 4)),
      Number(text.slice(4, 6)) - 1,
      Number(text.slice(6, 8)),
      Number(text.slice(8, 10)),
      Number(text.slice(10, 12)),
      Number(text.slice(12, 14)),
    );
  } else if (/^\d{8}$/.test(text)) {
    parsed = new Date(
      Number(text.slice(0, 4)),
      Number(text.slice(4, 6)) - 1,
      Number(text.slice(6, 8)),
      0,
      0,
      0,
    );
  } else {
    parsed = new Date(text.replace(' ', 'T'));
  }

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getCutoffDate(reportDays: number): Date {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - Math.max(reportDays - 1, 0));
  return cutoff;
}

export function isWithinReportWindow(pubDate: string, reportDays: number): boolean {
  const parsed = parsePubDate(pubDate);
  if (!parsed) return false;
  return parsed.getTime() >= getCutoffDate(reportDays).getTime();
}

function dedupeNews(items: NewsItem[]): NewsItem[] {
  const map = new Map<string, NewsItem>();
  for (const item of items) map.set(item.id, item);
  return Array.from(map.values());
}

function sortNews(items: NewsItem[], sortOrder: NewsSortOrder = 'desc'): NewsItem[] {
  const factor = sortOrder === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const ta = parsePubDate(a.pubDate)?.getTime() ?? 0;
    const tb = parsePubDate(b.pubDate)?.getTime() ?? 0;
    const diff = ta - tb;
    if (diff !== 0) return diff * factor;
    return a.id.localeCompare(b.id) * factor;
  });
}

export function filterNewsByReportDate(news: NewsItem[], reportDays: number): NewsItem[] {
  return sortNews(
    dedupeNews(news).filter((item) => isWithinReportWindow(item.pubDate, reportDays)),
    'desc',
  );
}

export function loadCachedNews(reportDays: number): NewsItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(NEWS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: NewsItem[] };
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return filterNewsByReportDate(items, reportDays);
  } catch {
    return [];
  }
}

export function saveCachedNews(news: NewsItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      NEWS_CACHE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), items: dedupeNews(news) }),
    );
  } catch {
    // ignore
  }
}

export async function fetchDashboardConfig(): Promise<DashboardConfig> {
  const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`설정 조회 실패: ${response.status} ${text}`);
  }
  const raw = await response.json();
  return sanitizeConfig(raw);
}

export async function saveDashboardConfig(config: DashboardConfig): Promise<DashboardConfig> {
  const response = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`설정 저장 실패: ${response.status} ${text}`);
  }
  const data = await response.json();
  return sanitizeConfig(data.config ?? data);
}

function isRateLimitMessage(message: string | undefined | null): boolean {
  const text = String(message ?? '').toLowerCase();
  return (
    text.includes('서비스 요청제한횟수 초과') ||
    text.includes('요청제한') ||
    text.includes('request limit exceeded') ||
    text.includes('rate limit')
  );
}

function formatUpstreamError(pageNo: number, message?: string): string {
  const fallback = `페이지 조회 실패: ${pageNo}`;
  if (!message) return fallback;
  if (isRateLimitMessage(message)) return '서비스 요청제한횟수 초과';
  return message;
}

async function fetchNewsPage(pageNo: number, numOfRows: number): Promise<PageResult> {
  const response = await fetch(`/api/news?pageNo=${pageNo}&numOfRows=${numOfRows}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      pageNo,
      totalCount: null,
      failed: true,
      error: formatUpstreamError(pageNo, errorText),
      rateLimited: isRateLimitMessage(errorText),
      items: [],
    };
  }

  const data: ApiResponse = await response.json();
  const body = Array.isArray(data.body) ? data.body : [];
  const totalCount = data.totalCount == null ? null : Number(data.totalCount);
  const resultCode = data.header?.resultCode ?? '00';
  const errorMsg = data.header?.errorMsg ?? null;
  const resultMsg = data.header?.resultMsg ?? '';
  const mergedMessage = [resultMsg, errorMsg].filter(Boolean).join(' ').trim();
  const failed = resultCode !== '00';

  return {
    pageNo,
    totalCount: Number.isFinite(totalCount) ? totalCount : null,
    failed,
    error: failed ? formatUpstreamError(pageNo, mergedMessage || `페이지 조회 실패: ${pageNo}`) : undefined,
    rateLimited: failed ? isRateLimitMessage(mergedMessage) : false,
    items: body.map((item) => ({
      id: item.YNA_NO.toString(),
      title: item.YNA_TTL,
      content: (item.YNA_CN ?? '').replace(/\(끝\)/g, '').trim(),
      pubDate: item.YNA_YMD,
      source: item.YNA_WRTR_NM,
      category: '재난소식',
      area: '미분류',
    })),
  };
}

function hasValidNewsInPage(items: NewsItem[], reportDays: number): boolean {
  return items.some((item) => isWithinReportWindow(item.pubDate, reportDays));
}

async function getPageResult(page: number, rowsPerPage: number, cache: PageCache): Promise<PageResult> {
  if (cache.has(page)) return cache.get(page)!;

  try {
    const result = await fetchNewsPage(page, rowsPerPage);
    cache.set(page, result);
    return result;
  } catch (error) {
    const failed: PageResult = {
      pageNo: page,
      totalCount: null,
      failed: true,
      error: formatUpstreamError(page, error instanceof Error ? error.message : String(error)),
      rateLimited: isRateLimitMessage(error instanceof Error ? error.message : String(error)),
      items: [],
    };
    console.warn('[PAGE FETCH FAILED]', page, failed.error);
    cache.set(page, failed);
    return failed;
  }
}

async function estimateLastPage(config: DashboardConfig, cache: PageCache): Promise<number> {
  const rowsPerPage = config.RowsPerPage;
  const seedCandidates = [config.LastPage, config.EndPage, config.StartDayPage].filter((v) => v > 0);

  for (const seedPage of seedCandidates) {
    const seed = await getPageResult(seedPage, rowsPerPage, cache);
    if (seed.totalCount && rowsPerPage > 0) {
      return Math.max(1, Math.ceil(seed.totalCount / rowsPerPage));
    }
  }

  return Math.max(1, ...seedCandidates);
}

async function resolveLastPage(config: DashboardConfig, cache: PageCache): Promise<{ page: number; warning?: string; rateLimited?: boolean }> {
  const rowsPerPage = config.RowsPerPage;
  let resolvedLast = await estimateLastPage(config, cache);
  let warning: string | undefined;
  let rateLimited = false;

  let current = await getPageResult(resolvedLast, rowsPerPage, cache);
  if (current.failed && current.error) warning = current.error;
  if (current.rateLimited) rateLimited = true;

  while (resolvedLast > 1 && current.items.length === 0 && !rateLimited) {
    resolvedLast -= 1;
    current = await getPageResult(resolvedLast, rowsPerPage, cache);
    if (current.failed && current.error) warning = current.error;
    if (current.rateLimited) rateLimited = true;
  }

  while (!rateLimited) {
    const nextPage = resolvedLast + 1;
    const next = await getPageResult(nextPage, rowsPerPage, cache);
    if (next.failed && next.error) warning = next.error;
    if (next.rateLimited) {
      rateLimited = true;
      break;
    }
    if (next.items.length === 0) break;
    resolvedLast = nextPage;
  }

  return { page: resolvedLast, warning, rateLimited };
}

async function resolveValidPageRange(
  config: DashboardConfig,
  resolvedLastPage: number,
  cache: PageCache,
): Promise<{ start: number; end: number; validPages: number[]; warning?: string; rateLimited?: boolean }> {
  const rowsPerPage = config.RowsPerPage;
  const scanStart = Math.max(1, config.StartDayPage - config.BackwardScanLimit);
  const scanEnd = Math.min(
    resolvedLastPage,
    Math.max(config.EndPage + config.ForwardScanLimit, config.StartDayPage, config.EndPage),
  );
  const validPages: number[] = [];
  let warning: string | undefined;
  let rateLimited = false;

  for (let page = scanStart; page <= scanEnd; page += 1) {
    const result = await getPageResult(page, rowsPerPage, cache);
    if (result.failed && result.error) {
      warning = result.error;
      console.warn('[PAGE SKIPPED]', page, result.error);
      if (result.rateLimited) {
        rateLimited = true;
        break;
      }
      continue;
    }
    if (result.items.length === 0) continue;
    if (hasValidNewsInPage(result.items, config.ReportDate)) validPages.push(page);
  }

  if (validPages.length === 0) {
    const fallback = Math.min(Math.max(config.StartDayPage, 1), resolvedLastPage);
    return { start: fallback, end: fallback, validPages: [], warning, rateLimited };
  }

  return {
    start: Math.min(...validPages),
    end: Math.max(...validPages),
    validPages,
    warning,
    rateLimited,
  };
}

export async function fetchDisasterNews(config: DashboardConfig): Promise<FetchNewsResult> {
  const sortOrder: NewsSortOrder = 'desc';
  const cache: PageCache = new Map();

  const lastResult = await resolveLastPage(config, cache);
  const rangeResult = await resolveValidPageRange(config, lastResult.page, cache);

  const collected: NewsItem[] = [];
  let errorDetail = rangeResult.warning || lastResult.warning;
  let rateLimited = Boolean(rangeResult.rateLimited || lastResult.rateLimited);

  for (let page = rangeResult.start; page <= rangeResult.end; page += 1) {
    const result = await getPageResult(page, config.RowsPerPage, cache);
    if (result.failed) {
      if (result.error) errorDetail = result.error;
      if (result.rateLimited) {
        rateLimited = true;
        break;
      }
      console.warn('[PAGE SKIPPED]', page, result.error);
      continue;
    }
    if (!result.items.length) continue;
    collected.push(...result.items);
  }

  const finalNews = filterNewsByReportDate(collected, config.ReportDate);
  const warning = rateLimited
    ? '공공 API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'
    : errorDetail;

  return {
    news: finalNews,
    sortOrder,
    pageState: {
      StartDayPage: rangeResult.start,
      EndPage: Math.min(rangeResult.end, lastResult.page),
      LastPage: lastResult.page,
    },
    warning,
    errorDetail,
    rateLimited,
  };
}

export function applyNonAiDefaults(news: NewsItem[]): NewsItem[] {
  return news.map((item) => ({
    ...item,
    area: detectAreaFromText(`${item.title} ${item.content}`),
    importance: DisasterImportance.INFO,
    summary: item.summary ?? 'AI 분석 비활성화',
  }));
}

export function filterNewsByArea(news: NewsItem[]): NewsItem[] {
  const interested = areaData.interestedAreas.map(normalizeArea);
  return news.filter((item) => {
    const a = normalizeArea(item.area);
    if (!a || a === '미분류') return true;
    if (a === '전국') return true;
    return interested.includes(a) || interested.includes('전국');
  });
}

export function loadAiCache(): AiAnalysisCacheMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(AI_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as AiAnalysisCacheMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAiCache(cache: AiAnalysisCacheMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

export function pruneAiCache(cache: AiAnalysisCacheMap, reportDays: number): AiAnalysisCacheMap {
  const cutoffTime = getCutoffDate(reportDays).getTime();
  const next: AiAnalysisCacheMap = {};
  Object.entries(cache).forEach(([id, value]) => {
    const parsed = parsePubDate(value.pubDate);
    if (parsed && parsed.getTime() >= cutoffTime) next[id] = value;
  });
  return next;
}

export function mergeNewsWithAiCache(news: NewsItem[], cache: AiAnalysisCacheMap): NewsItem[] {
  return news.map((item) => {
    const cached = cache[item.id];
    if (!cached) return item;
    return {
      ...item,
      area: cached.area,
      importance: cached.importance,
      summary: cached.summary,
    };
  });
}

export function buildCachedAnalysis(news: NewsItem): CachedAiAnalysis {
  return {
    id: news.id,
    pubDate: news.pubDate,
    area: news.area,
    importance: news.importance ?? DisasterImportance.INFO,
    summary: news.summary ?? '요약을 생성할 수 없습니다.',
    updatedAt: new Date().toISOString(),
  };
}

export function detectAreaFromText(text: string): string {
  const source = (text || '').trim();
  if (!source) return '전국';

  const aliasMap: Record<string, string[]> = {
    '서울': ['서울', '서울시', '서울특별시', '강남', '강북', '서초', '송파', '마포', '영등포', '용산', '관악', '동작', '종로', '중구', '성동', '광진', '동대문', '중랑', '성북', '도봉', '노원', '은평', '서대문', '양천', '강서', '구로', '금천', '강동'],
    '인천': ['인천', '인천시', '인천광역시', '강화', '옹진', '연수', '남동', '부평', '계양', '서구', '미추홀', '중구', '동구', '선학', '송도', '영종'],
    '경기': ['경기', '경기도', '수원', '성남', '고양', '용인', '부천', '안산', '안양', '화성', '평택', '의정부', '시흥', '파주', '김포', '광명', '군포', '오산', '이천', '안성', '양주', '구리', '남양주', '하남', '광주', '동두천', '포천', '여주', '양평', '가평', '연천'],
    '강원': ['강원', '강원도', '강원특별자치도', '춘천', '원주', '강릉', '동해', '태백', '속초', '삼척', '홍천', '횡성', '영월', '평창', '정선', '철원', '화천', '양구', '인제', '고성', '양양'],
    '충북': ['충북', '충청북도', '청주', '충주', '제천', '보은', '옥천', '영동', '증평', '진천', '괴산', '음성', '단양'],
    '충남': ['충남', '충청남도', '천안', '공주', '보령', '아산', '서산', '논산', '계룡', '당진', '금산', '부여', '서천', '청양', '홍성', '예산', '태안'],
    '대전': ['대전', '대전시', '대전광역시', '유성', '서구', '중구', '동구', '대덕'],
    '전북': ['전북', '전라북도', '전북특별자치도', '전주', '군산', '익산', '정읍', '남원', '김제', '완주', '진안', '무주', '장수', '임실', '순창', '고창', '부안'],
    '전남': ['전남', '전라남도', '목포', '여수', '순천', '나주', '광양', '담양', '곡성', '구례', '고흥', '보성', '화순', '장흥', '강진', '해남', '영암', '무안', '함평', '영광', '장성', '완도', '진도', '신안'],
    '광주': ['광주', '광주시', '광주광역시', '광산', '북구', '서구', '남구', '동구'],
    '경북': ['경북', '경상북도', '포항', '경주', '김천', '안동', '구미', '영주', '영천', '상주', '문경', '경산', '군위', '의성', '청송', '영양', '영덕', '청도', '고령', '성주', '칠곡', '예천', '봉화', '울진', '울릉'],
    '경남': ['경남', '경상남도', '창원', '진주', '통영', '사천', '김해', '밀양', '거제', '양산', '의령', '함안', '창녕', '고성', '남해', '하동', '산청', '함양', '거창', '합천'],
    '대구': ['대구', '대구시', '대구광역시', '수성', '달서', '달성', '중구', '동구', '서구', '남구', '북구'],
    '부산': ['부산', '부산시', '부산광역시', '해운대', '수영', '동래', '연제', '부산진', '사하', '사상', '기장', '영도', '중구', '서구', '동구', '남구', '북구', '금정', '강서'],
    '울산': ['울산', '울산시', '울산광역시', '중구', '남구', '동구', '북구', '울주'],
    '제주': ['제주', '제주시', '서귀포', '제주도', '제주특별자치도'],
  };

  for (const area of ALL_AREAS) {
    if (area === '전국') continue;
    const aliases = aliasMap[area] ?? [area];
    if (aliases.some((keyword) => source.includes(keyword))) return area;
  }

  return '전국';
}

export function normalizeArea(area: string): string {
  const trimmed = (area || '').trim();
  const map: Record<string, string> = {
    '경기도': '경기',
    '충청북도': '충북',
    '충청남도': '충남',
    '전라북도': '전북',
    '전라남도': '전남',
    '경상북도': '경북',
    '경상남도': '경남',
    '서울특별시': '서울',
    '부산광역시': '부산',
    '대구광역시': '대구',
    '인천광역시': '인천',
    '광주광역시': '광주',
    '대전광역시': '대전',
    '울산광역시': '울산',
    '제주특별자치도': '제주',
  };

  if (map[trimmed]) return map[trimmed];
  if (trimmed.endsWith('특별시') || trimmed.endsWith('광역시')) return trimmed.slice(0, 2);
  if (trimmed.endsWith('특별자치도')) return trimmed.slice(0, 2);
  if (trimmed.endsWith('도')) return trimmed.slice(0, 2);
  return trimmed;
}
