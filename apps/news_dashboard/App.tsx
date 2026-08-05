import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchDashboardConfig,
  fetchDisasterNews,
  saveDashboardConfig,
  loadCachedNews,
  saveCachedNews,
  filterNewsByArea,
  applyNonAiDefaults,
  loadAiCache,
  saveAiCache,
  pruneAiCache,
  mergeNewsWithAiCache,
  buildCachedAnalysis,
} from './services/newsService';
import { analyzeNewsWithAI } from './services/geminiService';
import { NewsCard } from './components/NewsCard';
import type {
  NewsItem,
  DashboardConfig,
  NewsSortOrder,
  AiAnalysisCacheMap,
} from './types';

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));


function formatKoreanDate(date: Date): string {
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function PlatformTitleHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 w-full min-h-[168px] bg-[#001B3D]/95 backdrop-blur-md border-b border-white/10 px-10 py-7 flex items-center justify-between gap-8">
      <div className="flex items-center gap-6 min-w-0">
        <svg className="w-14 h-14 text-red-500 flex-none" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 5 6v5c0 4.8 3 8.2 7 10 4-1.8 7-5.2 7-10V6l-7-3Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
          <path d="M12 7v6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="1" fill="currentColor" />
        </svg>
        <div className="min-w-0">
          <h1 className="text-[44px] leading-none font-black tracking-[-0.05em] text-white whitespace-nowrap">
            재난안전공유플랫폼 <span className="text-blue-400 font-light">뉴스 대시보드</span>
          </h1>
          <p className="mt-4 text-[20px] font-mono font-extrabold uppercase tracking-[0.16em] text-white/50 whitespace-nowrap">
            MINISTRY OF THE INTERIOR AND SAFETY | EMERGENCY ALERT SYSTEM
          </p>
        </div>
      </div>
      <div className="text-right whitespace-nowrap flex-none">
        <div className="text-[34px] leading-none font-mono font-extrabold tracking-wider text-white">{formatKoreanDate(new Date())}</div>
        <div className="mt-4 text-[18px] font-mono uppercase tracking-[0.12em] text-white/40">REAL-TIME MONITORING ACTIVE</div>
      </div>
    </header>
  );
}

function formatSyncError(message: string): string {
  if (!message) return '';
  if (message.includes('서비스 요청제한횟수 초과')) {
    return '공공 API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (message.includes('설정 조회 실패')) {
    return '설정 파일을 읽지 못했습니다. 백엔드 상태를 확인해 주세요.';
  }
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return '백엔드 연결에 실패했습니다. 서버가 실행 중인지 확인해 주세요.';
  }
  return message;
}


const isNewsEmbedMode = new URLSearchParams(window.location.search).get('embed') === '1';
function notifyNewsParent(status: 'loading' | 'success' | 'error') {
  if (!isNewsEmbedMode) return;
  try { window.parent.postMessage({ type: 'panel-sync', panel: 'news', status }, '*'); } catch {}
}

const App: React.FC = () => {
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<NewsSortOrder>('desc');
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [syncMessage, setSyncMessage] = useState<string>('');
  const [timeoutError, setTimeoutError] = useState<boolean>(false);
  const [lastSyncFailed, setLastSyncFailed] = useState<boolean>(false);
  const [usingCachedData, setUsingCachedData] = useState<boolean>(false);
  const [syncWarning, setSyncWarning] = useState<string>('');
  const [syncErrorDetail, setSyncErrorDetail] = useState<string>('');

  const syncInProgressRef = useRef(false);
  const [embedIntroVisible, setEmbedIntroVisible] = useState(isNewsEmbedMode);
  const embedIntroDismissedRef = useRef(false);
  const mountedRef = useRef(true);
  const autoSyncStartedRef = useRef(false);
  const usingCachedDataRef = useRef(false);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const lastScrollFrameRef = useRef<number | null>(null);
  const nextPauseIndexRef = useRef(1);
  const pauseUntilRef = useRef(0);
  const hoverPausedRef = useRef(false);

  const displayedNews = filterNewsByArea(newsList);
  const loopedNews = displayedNews.length > 1 ? [...displayedNews, ...displayedNews] : displayedNews;

  const persistAnalysis = useCallback((news: NewsItem, reportDays: number) => {
    const currentCache = pruneAiCache(loadAiCache(), reportDays);
    currentCache[news.id] = buildCachedAnalysis(news);
    saveAiCache(currentCache);
  }, []);

  const triggerAiAnalysis = useCallback(
    async (news: NewsItem, reportDays: number) => {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.add(news.id);
        return next;
      });

      try {
        const analysis = await analyzeNewsWithAI(news.title, news.content);
        const updatedNews: NewsItem = {
          ...news,
          area: analysis.area ?? news.area,
          importance: analysis.importance,
          summary: analysis.summary,
        };

        if (!mountedRef.current) return;

        setNewsList((prevList) =>
          prevList.map((item) => (item.id === news.id ? updatedNews : item)),
        );

        persistAnalysis(updatedNews, reportDays);
      } catch (error) {
        console.error('[AI ANALYSIS FAILED]', error);
      } finally {
        if (!mountedRef.current) return;

        setAnalyzingIds((prev) => {
          const next = new Set(prev);
          next.delete(news.id);
          return next;
        });
      }
    },
    [persistAnalysis],
  );

  const applyNewsToScreen = useCallback(
    async (news: NewsItem[], currentConfig: DashboardConfig) => {
      let visibleNews: NewsItem[];

      if (currentConfig.AIAnal) {
        const aiCache: AiAnalysisCacheMap = pruneAiCache(loadAiCache(), currentConfig.ReportDate);
        saveAiCache(aiCache);
        visibleNews = mergeNewsWithAiCache(news, aiCache);

        if (mountedRef.current) {
          setNewsList(visibleNews);
        }

        for (const item of visibleNews) {
          const hasCached = Boolean(aiCache[item.id]?.summary);
          if (!hasCached) {
            void triggerAiAnalysis(item, currentConfig.ReportDate);
          }
        }
      } else {
        visibleNews = applyNonAiDefaults(news);
        if (mountedRef.current) {
          setNewsList(visibleNews);
        }
      }

      if (visibleNews.length > 0) {
        saveCachedNews(visibleNews);
      }
    },
    [triggerAiAnalysis],
  );

  const loadDataOnce = useCallback(async (): Promise<void> => {
    const currentConfig = await fetchDashboardConfig();

    if (!mountedRef.current) return;
    setConfig(currentConfig);

    const { news, sortOrder: detectedSortOrder, pageState, warning, errorDetail } = await fetchDisasterNews(currentConfig);

    if (!mountedRef.current) return;

    setSortOrder(detectedSortOrder);
    setSyncWarning(warning ?? '');
    setSyncErrorDetail(errorDetail ?? '');

    const nextConfig: DashboardConfig = {
      ...currentConfig,
      StartDayPage: pageState.StartDayPage,
      EndPage: pageState.EndPage,
      LastPage: pageState.LastPage,
    };

    const configChanged =
      currentConfig.StartDayPage !== nextConfig.StartDayPage ||
      currentConfig.EndPage !== nextConfig.EndPage ||
      currentConfig.LastPage !== nextConfig.LastPage;

    if (configChanged) {
      try {
        const saved = await saveDashboardConfig(nextConfig);
        if (mountedRef.current) {
          setConfig(saved);
        }
      } catch (error) {
        console.error('[CONFIG SAVE FAILED]', error);
        if (mountedRef.current) {
          setConfig(nextConfig);
        }
      }
    }

    await applyNewsToScreen(news, currentConfig);

    if (mountedRef.current) {
      usingCachedDataRef.current = false;
      setUsingCachedData(false);
    }
  }, [applyNewsToScreen]);

  const runSyncOnce = useCallback(
    async (reason: 'auto' | 'manual'): Promise<boolean> => {
      if (syncInProgressRef.current) {
        console.log(`[SYNC SKIPPED] already in progress (${reason})`);
        notifyNewsParent('error');
        return false;
      }

      syncInProgressRef.current = true;

      if (mountedRef.current) {
        setLoading(true);
        notifyNewsParent('loading');
        setLastSyncFailed(false);
        setTimeoutError(false);
      }

      try {
        console.log(`[SYNC START] ${reason}`);
        await loadDataOnce();

        if (mountedRef.current) {
          setLastSyncFailed(false);
        }

        console.log(`[SYNC SUCCESS] ${reason}`);
        notifyNewsParent('success');
        return true;
      } catch (error) {
        console.error(`[SYNC FAILED] ${reason}`, error);

        const message = error instanceof Error ? error.message : String(error);

        if (mountedRef.current) {
          setLastSyncFailed(true);
          setSyncErrorDetail(message);
        }

        notifyNewsParent('error');
        return false;
      } finally {
        syncInProgressRef.current = false;

        if (mountedRef.current) {
          setLoading(false);
        }

        console.log(`[SYNC END] ${reason}`);
      }
    },
    [loadDataOnce],
  );

  const runAutoSyncWithRetry = useCallback(
    async (currentConfig: DashboardConfig) => {
      if (autoSyncStartedRef.current) return;
      autoSyncStartedRef.current = true;

      const loadTimeSec = Math.max(1, currentConfig.LOAD_TIME ?? 20);
      const loadTryTimeSec = Math.max(1, currentConfig.LOAD_TRY_TIME ?? 2);
      const timeoutMs = loadTimeSec * 1000;
      const retryMs = loadTryTimeSec * 1000;
      const startedAt = Date.now();

      while (mountedRef.current && Date.now() - startedAt < timeoutMs) {
        const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);

        if (mountedRef.current) {
          if (usingCachedDataRef.current) {
            setSyncMessage(`저장된 뉴스 표시 중... 최신 데이터 동기화 중입니다. (${elapsedSec}s)`);
          } else {
            setSyncMessage(`초기 동기화 중... (${elapsedSec}s)`);
          }
        }

        const success = await runSyncOnce('auto');
        if (success) {
          if (mountedRef.current) {
            setSyncMessage(syncWarning || syncErrorDetail ? '동기화 완료 (일부 경고 있음)' : '동기화 완료');
            setTimeoutError(false);
            setLastSyncFailed(false);
          }

          await sleep(1000);

          if (mountedRef.current) {
            setSyncMessage('');
          }
          return;
        }

        const remainingMs = timeoutMs - (Date.now() - startedAt);
        if (remainingMs <= 0) break;

        if (mountedRef.current) {
          if (usingCachedDataRef.current) {
            setSyncMessage(`동기화 실패. 이전 저장 데이터를 표시 중이며 ${loadTryTimeSec}초 후 다시 시도합니다...`);
          } else {
            setSyncMessage(`동기화 실패, ${loadTryTimeSec}초 후 다시 시도합니다...`);
          }
        }

        await sleep(retryMs);
      }

      if (mountedRef.current) {
        setSyncMessage(
          usingCachedDataRef.current
            ? '동기화 실패. 이전 저장 데이터를 표시합니다.'
            : '동기화 실패. 표시할 저장 데이터가 없습니다.',
        );
        setTimeoutError(true);
        setLastSyncFailed(true);
      }
    },
    [runSyncOnce, syncErrorDetail, syncWarning],
  );


  useEffect(() => {
    if (!isNewsEmbedMode) return;
    console.log('[NEWS][embed]', {
      usingCachedData,
      loading,
      timeoutError,
      syncWarning,
      formattedError: formatSyncError(syncErrorDetail),
      syncMessage,
      lastSyncFailed,
      displayedCount: displayedNews.length,
      config: config
        ? {
            ReportDate: config.ReportDate,
            RowsPerPage: config.RowsPerPage,
            StartDayPage: config.StartDayPage,
            EndPage: config.EndPage,
            LastPage: config.LastPage,
            LOAD_TIME: config.LOAD_TIME,
            LOAD_TRY_TIME: config.LOAD_TRY_TIME,
            ScrollSpeed: config.ScrollSpeed,
            ScrollPauseSeconds: config.ScrollPauseSeconds,
          }
        : null,
    });
  }, [
    isNewsEmbedMode,
    usingCachedData,
    loading,
    timeoutError,
    syncWarning,
    syncErrorDetail,
    syncMessage,
    lastSyncFailed,
    displayedNews.length,
    config,
  ]);

  const handleManualSync = useCallback(async () => {
    if (syncInProgressRef.current) {
      console.log('[MANUAL SYNC BLOCKED] sync already running');
      return;
    }

    if (mountedRef.current) {
      setSyncMessage('수동 동기화 중...');
      setTimeoutError(false);
      setLastSyncFailed(false);
      setSyncWarning('');
      setSyncErrorDetail('');
    }

    const success = await runSyncOnce('manual');

    if (mountedRef.current) {
      if (success) {
        setSyncMessage('수동 동기화 완료');
        await sleep(1000);
        if (mountedRef.current) {
          setSyncMessage('');
        }
      } else {
        setSyncMessage(
          usingCachedDataRef.current
            ? '수동 동기화 실패. 이전 저장 데이터를 표시합니다.'
            : '수동 동기화 실패. 표시할 저장 데이터가 없습니다.',
        );
        setLastSyncFailed(true);
      }
    }
  }, [runSyncOnce]);
  useEffect(() => {
    let hideTimer: number | null = null;
    const styleEl = document.createElement('style');
    styleEl.textContent = 'body.dashboard-cursor-hidden, body.dashboard-cursor-hidden * { cursor: none !important; }';
    document.head.appendChild(styleEl);

    const showCursor = () => {
      document.body.classList.remove('dashboard-cursor-hidden');
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
      }
      hideTimer = window.setTimeout(() => {
        document.body.classList.add('dashboard-cursor-hidden');
      }, 10000);
    };

    if (isNewsEmbedMode) {
      document.body.classList.add('news-embed-mode');
    }

    const events: Array<keyof WindowEventMap> = [
      'mousemove', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave',
      'wheel', 'touchstart', 'touchmove', 'pointermove', 'keydown',
    ];

    events.forEach((eventName) => window.addEventListener(eventName, showCursor, { passive: true }));
    showCursor();

    return () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
      }
      events.forEach((eventName) => window.removeEventListener(eventName, showCursor));
      document.body.classList.remove('dashboard-cursor-hidden');
      document.body.classList.remove('news-embed-mode');
      styleEl.remove();
    };
  }, []);


  useEffect(() => {
    const scrollSpeed = Math.max(1, config?.ScrollSpeed ?? 40);
    const pauseMs = Math.max(0, (config?.ScrollPauseSeconds ?? 5) * 1000);
    const stopPosi = Math.max(-1, Math.min(1, Number(config?.StopPosi ?? 0)));
    const pixelsPerSecond = scrollSpeed;

    const getCards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-news-card="1"]'));
    const getBaseCards = () => getCards().slice(0, displayedNews.length);
    const getLoopPoint = () => {
      const cards = getCards();
      return cards.length > displayedNews.length ? cards[displayedNews.length].offsetTop : 0;
    };

    const resetLoop = (timestamp: number) => {
      const loopPoint = getLoopPoint();
      if (loopPoint > 0) {
        window.scrollTo({ top: Math.max(0, window.scrollY - loopPoint), behavior: 'auto' });
      } else {
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
      nextPauseIndexRef.current = 1;
      pauseUntilRef.current = timestamp + pauseMs;
    };

    const currentCardIndex = () => {
      const cards = getBaseCards();
      if (cards.length === 0) return 0;
      const loopPoint = getLoopPoint();
      const currentTop = loopPoint > 0 ? (window.scrollY % loopPoint) : window.scrollY;
      let idx = 0;
      for (let i = 0; i < cards.length; i += 1) {
        if (cards[i].offsetTop <= currentTop + 1) {
          idx = i;
        } else {
          break;
        }
      }
      return idx;
    };

    const moveToCardIndex = (targetIndex: number, timestamp = performance.now()) => {
      const cards = getBaseCards();
      if (cards.length === 0) return;
      const maxScrollTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const clampedIndex = Math.max(0, Math.min(cards.length - 1, targetIndex));
      const targetTop = Math.min(cards[clampedIndex].offsetTop, maxScrollTop);
      window.scrollTo({ top: targetTop, behavior: 'auto' });
      nextPauseIndexRef.current = Math.min(cards.length, clampedIndex + 1);
      pauseUntilRef.current = timestamp + pauseMs;
    };

    const jumpToCard = (direction: 1 | -1) => {
      moveToCardIndex(currentCardIndex() + (direction > 0 ? 1 : -1));
    };

    const snapToStopPosition = (timestamp = performance.now()) => {
      moveToCardIndex(currentCardIndex() + stopPosi, timestamp);
    };

    const onEnter = () => {
      hoverPausedRef.current = true;
      snapToStopPosition(performance.now());
    };

    const onLeave = () => {
      hoverPausedRef.current = false;
      pauseUntilRef.current = performance.now() + pauseMs;
      lastScrollFrameRef.current = null;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      hoverPausedRef.current = true;
      jumpToCard(event.deltaY >= 0 ? 1 : -1);
    };

    const hoverTarget = document.documentElement;
    hoverTarget.addEventListener('mouseenter', onEnter, true);
    hoverTarget.addEventListener('mousemove', onEnter, true);
    hoverTarget.addEventListener('mouseleave', onLeave, true);
    hoverTarget.addEventListener('wheel', onWheel, { passive: false, capture: true });

    const step = (timestamp: number) => {
      if (!mountedRef.current) return;

      if (lastScrollFrameRef.current == null) {
        lastScrollFrameRef.current = timestamp;
        if (pauseUntilRef.current === 0) {
          pauseUntilRef.current = timestamp + pauseMs;
        }
      }

      if (hoverPausedRef.current || timestamp < pauseUntilRef.current) {
        lastScrollFrameRef.current = timestamp;
        scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      const deltaMs = timestamp - lastScrollFrameRef.current;
      lastScrollFrameRef.current = timestamp;
      const distance = (pixelsPerSecond * deltaMs) / 1000;

      const maxScrollTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const cards = getBaseCards();
      const loopPoint = getLoopPoint();

      if (loopPoint > 0 && cards.length > 0 && nextPauseIndexRef.current < cards.length) {
        const targetTop = Math.min(cards[nextPauseIndexRef.current].offsetTop, maxScrollTop);
        const nextScrollTop = Math.min(window.scrollY + distance, targetTop);
        window.scrollTo({ top: nextScrollTop, behavior: 'auto' });
        if (nextScrollTop >= targetTop - 1) {
          pauseUntilRef.current = timestamp + pauseMs;
          nextPauseIndexRef.current += 1;
        }
      } else if (loopPoint > 0) {
        const nextScrollTop = window.scrollY + distance;
        if (nextScrollTop >= loopPoint) {
          resetLoop(timestamp);
        } else {
          window.scrollTo({ top: nextScrollTop, behavior: 'auto' });
        }
      }

      scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
    };

    if (scrollAnimationFrameRef.current != null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
    }
    lastScrollFrameRef.current = null;
    nextPauseIndexRef.current = 1;
    pauseUntilRef.current = 0;
    hoverPausedRef.current = false;
    scrollAnimationFrameRef.current = window.requestAnimationFrame(step);

    return () => {
      if (scrollAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
      hoverTarget.removeEventListener('mouseenter', onEnter, true);
      hoverTarget.removeEventListener('mousemove', onEnter, true);
      hoverTarget.removeEventListener('mouseleave', onLeave, true);
      hoverTarget.removeEventListener('wheel', onWheel, true);
      scrollAnimationFrameRef.current = null;
      lastScrollFrameRef.current = null;
      nextPauseIndexRef.current = 1;
      pauseUntilRef.current = 0;
      hoverPausedRef.current = false;
    };
  }, [config?.ScrollSpeed, config?.ScrollPauseSeconds, displayedNews.length]);

  useEffect(() => {
    mountedRef.current = true;

    const bootstrap = async () => {
      try {
        const currentConfig = await fetchDashboardConfig();
        if (!mountedRef.current) return;

        setConfig(currentConfig);

        const cached = loadCachedNews(currentConfig.ReportDate);
        if (cached.length > 0) {
          usingCachedDataRef.current = true;
          setUsingCachedData(true);
          setNewsList(cached);
          setSyncMessage('저장된 뉴스 표시 중... 최신 데이터 동기화 중입니다.');
        } else {
          usingCachedDataRef.current = false;
          setUsingCachedData(false);
          setSyncMessage('초기 동기화 중...');
        }

        await runAutoSyncWithRetry(currentConfig);
      } catch (error) {
        console.error('[BOOTSTRAP FAILED]', error);

        if (mountedRef.current) {
          const message = error instanceof Error ? error.message : String(error);
          setSyncErrorDetail(message);
          setTimeoutError(true);
          setLastSyncFailed(true);
          setSyncMessage(
            usingCachedDataRef.current
              ? '초기화 실패. 이전 저장 데이터를 표시합니다.'
              : '초기화 실패. 설정 또는 서버 상태를 확인해 주세요.',
          );
        }
      }
    };

    void bootstrap();

    return () => {
      mountedRef.current = false;
    };
  }, [runAutoSyncWithRetry]);

  const reportDays = config?.ReportDate ?? 0;
  const formattedError = formatSyncError(syncErrorDetail);
  const showStandaloneHeader = !isNewsEmbedMode;
  const rootClassName = isNewsEmbedMode
    ? 'relative min-h-screen pb-8 text-slate-100'
    : 'relative min-h-screen pb-24 text-slate-100 bg-[#001B3D]';
  const mainClassName = isNewsEmbedMode
    ? 'max-w-5xl mx-auto px-3 mt-3'
    : 'max-w-5xl mx-auto px-4 pt-[208px] pb-24';
  const summarySectionClassName = isNewsEmbedMode
    ? 'mb-4 text-left'
    : 'mb-10 text-center sm:text-left';

  useEffect(() => {
    if (!isNewsEmbedMode) return;
    console.log('[NEWS][embed][intro]', {
      title: '재난안전 통합 대시보드',
      description: '저장된 뉴스가 있으면 먼저 표시하고, 최신 뉴스는 백그라운드 동기화로 갱신합니다.',
      summary: config
        ? `ReportDate ${config.ReportDate}일 / RowsPerPage ${config.RowsPerPage} / StartDayPage ${config.StartDayPage} / EndPage ${config.EndPage} / LastPage ${config.LastPage} / LOAD_TIME ${config.LOAD_TIME}s / LOAD_TRY_TIME ${config.LOAD_TRY_TIME}s / ScrollSpeed ${config.ScrollSpeed}px/s / Pause ${config.ScrollPauseSeconds}s · ${sortOrder === 'desc' ? '최신순 정렬' : '오래된순 정렬'}`
        : null,
    });
  }, [isNewsEmbedMode, config, sortOrder]);

  useEffect(() => {
    if (!isNewsEmbedMode) return;
    const onFirstScrollLike = () => {
      if (embedIntroDismissedRef.current) return;
      embedIntroDismissedRef.current = true;
      setEmbedIntroVisible(false);
    };
    window.addEventListener('scroll', onFirstScrollLike, { passive: true });
    return () => window.removeEventListener('scroll', onFirstScrollLike);
  }, [isNewsEmbedMode]);

  return (
    <div className={rootClassName}>
      {showStandaloneHeader && <PlatformTitleHeader />}

      <main className={mainClassName}>
        {(!isNewsEmbedMode || (isNewsEmbedMode && embedIntroVisible && displayedNews.length > 0)) && (
        <section className={summarySectionClassName}>
          <h2 className={`${isNewsEmbedMode ? 'text-2xl' : 'text-4xl'} font-extrabold text-white mb-2 tracking-tight`}>재난안전 통합 대시보드</h2>
          <p className="text-slate-300 font-medium">
            저장된 뉴스가 있으면 먼저 표시하고, 최신 뉴스는 백그라운드 동기화로 갱신합니다.
          </p>
          {config && (
            <p className="text-slate-400 text-sm mt-2">
              ReportDate {config.ReportDate}일 / RowsPerPage {config.RowsPerPage} / StartDayPage {config.StartDayPage} / EndPage {config.EndPage} / LastPage {config.LastPage} / LOAD_TIME {config.LOAD_TIME}s / LOAD_TRY_TIME {config.LOAD_TRY_TIME}s / ScrollSpeed {config.ScrollSpeed}px/s / Pause {config.ScrollPauseSeconds}s
              <span className="font-bold text-indigo-200"> · {sortOrder === 'desc' ? '최신순 정렬' : '오래된순 정렬'}</span>
            </p>
          )}
          {!isNewsEmbedMode && syncMessage && <p className="text-indigo-200 text-sm mt-2 font-semibold">{syncMessage}</p>}
          {!isNewsEmbedMode && usingCachedData && displayedNews.length > 0 && (
            <p className="text-sky-200 text-sm mt-2 font-semibold">저장된 뉴스 데이터를 먼저 표시 중입니다.</p>
          )}
        </section>
        )}

        <section>
          {!isNewsEmbedMode && (
          <div className="mb-8 flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
              <h2 className="text-2xl font-black text-white tracking-tight">LATEST FEED</h2>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="w-7 h-7 rounded-full border-2 border-white/10 bg-white/10 flex items-center justify-center overflow-hidden">
                    <div className="bg-indigo-100 w-full h-full flex items-center justify-center text-[8px] font-bold text-indigo-500 uppercase">AI</div>
                  </div>
                ))}
              </div>
              <span className="text-xs font-bold text-slate-400">Analysing Active</span>
            </div>
          </div>
          )}

          {(!isNewsEmbedMode ? !!formattedError : (formattedError && displayedNews.length === 0)) && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-rose-500/20 border border-rose-400/30 text-rose-100">
              동기화 오류: {formattedError}
            </div>
          )}

          {!isNewsEmbedMode && !formattedError && syncWarning && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-100">
              동기화 경고: {syncWarning}
            </div>
          )}

          {(!isNewsEmbedMode ? (!formattedError && !syncWarning && timeoutError) : (!formattedError && !syncWarning && timeoutError && displayedNews.length === 0)) && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-rose-500/20 border border-rose-400/30 text-rose-100">
              초기 동기화 시간 초과. 백엔드 또는 네트워크 상태를 확인해 주세요.
            </div>
          )}

          {(!isNewsEmbedMode ? (!formattedError && !timeoutError && lastSyncFailed && !loading) : (!formattedError && !timeoutError && lastSyncFailed && !loading && displayedNews.length === 0)) && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-100">
              동기화에 실패했습니다. 이전 데이터를 표시 중이면 그대로 유지되며, SYNC 버튼으로 다시 시도할 수 있습니다.
            </div>
          )}

          {loading && displayedNews.length === 0 ? (
            <div className="grid grid-cols-1 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse glass border border-white/10 rounded-2xl h-64 shadow-sm"></div>
              ))}
            </div>
          ) : displayedNews.length > 0 ? (
            <div className="grid grid-cols-1 gap-6">
              {loopedNews.map((news, idx) => (
                <NewsCard key={`${news.id}-${idx}`} news={news} isAnalyzing={analyzingIds.has(news.id)} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 glass rounded-3xl border-2 border-dashed border-white/10">
              <p className="text-slate-200 font-extrabold text-xl">{isNewsEmbedMode ? '표시할 뉴스가 없습니다.' : '데이터가 없습니다'}</p>
              <p className="text-slate-400 text-sm font-medium mt-1">
                {isNewsEmbedMode
                  ? '통신 상태 또는 뉴스 수집 조건을 확인해 주세요.'
                  : '동기화 후 뉴스가 없으면 ReportDate 또는 페이지 범위를 확인해 주세요.'}
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
);
};

export default App;
