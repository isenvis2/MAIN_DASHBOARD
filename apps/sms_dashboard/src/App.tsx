/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, MapPin, Clock, Flame, Waves, Snowflake, Activity, Zap } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types for our data
interface DisasterMessage {
  id: string;
  area: string;
  step: string;
  type: string;
  message: string;
  timestamp: string; // displayed timestamp
}

interface FilterData {
  areas: string[];
  steps: string[];
  types: string[];
  refreshTime: number;
  scrollSpeed: number;
  dashboardTitle: string;
  dashboardSubtitle: string;
  orgName: string;
  dataCount: number;
  timeRangeMinutes: number;
  showCursor: boolean;
  scrollPauseSeconds: number;
  stopPosi: number;

  // ✅ New config fields
  reportDate: number; // recent N days
  displayOnlyInterestedArea: boolean; // show only AreaData regions
}

interface ApiResponse {
  ok: boolean;
  items?: Array<{
    id: string;
    area: string;
    areaFull?: string;
    step: string;
    type: string;
    message: string;
    timestamp: string; // raw timestamp from server
  }>;
  error?: string;
}

function isEmbedMode() { return new URLSearchParams(window.location.search).get('embed') === '1'; }
function notifyParent(status: 'loading' | 'success' | 'error') { if (!isEmbedMode()) return; try { window.parent.postMessage({ type: 'panel-sync', panel: 'sms', status }, '*'); } catch {} }

export default function App() {
  const [messages, setMessages] = useState<DisasterMessage[]>([]);
  const [filters, setFilters] = useState<FilterData | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollFrameRef = useRef<number | null>(null);
  const pauseUntilRef = useRef(0);
  const nextPauseIndexRef = useRef(1);
  const hoverPausedRef = useRef(false);
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
      styleEl.remove();
    };
  }, []);


  // Load filters from JSON files (served from /public)
  useEffect(() => {
    const loadFilters = async () => {
      try {
        const areaRes = await fetch('/AreaData.json');
        const stepRes = await fetch('/StepData.json');
        const typeRes = await fetch('/disaster_typeData.json');
        const configRes = await fetch('/SMS_DashBoard.json');

        const areaData = await areaRes.json();
        const stepData = await stepRes.json();
        const typeData = await typeRes.json();
        const configData = await configRes.json();

        setFilters({
          areas: areaData.areas,
          steps: stepData.steps,
          types: typeData.types,
          refreshTime: configData.refresh_time || 600,
          scrollSpeed: configData.scroll_speed || 0.5,
          dashboardTitle: configData.dashboard_title || '재난안전공유플랫폼',
          dashboardSubtitle: configData.dashboard_subtitle || '긴급문자 대시보드',
          orgName: configData.org_name || 'Ministry of the Interior and Safety | Emergency Alert System',
          dataCount: configData.data_count || 50,
          timeRangeMinutes: configData.time_range_minutes || 240,
          showCursor: configData.show_cursor ?? false,
          scrollPauseSeconds: Number(configData.scroll_pause_seconds ?? 5),
          stopPosi: Math.max(-1, Math.min(1, Number(configData.stop_posi ?? 0))),

          // ✅ new fields
          reportDate: Number(configData.ReportDate ?? 3),
          displayOnlyInterestedArea: Boolean(configData.DisplayOnlyInterestedArea ?? false),
        });
      } catch (error) {
        console.error('Failed to load filters:', error);
        // Fallback filters if files aren't ready
        setFilters({
          areas: ['서울특별시', '경기도', '강원도', '부산광역시', '제주특별자치도'],
          steps: ['긴급', '위급', '주의', '안전안내'],
          types: ['화재', '지진', '호우', '대설', '교통통제', '기타'],
          refreshTime: 600,
          scrollSpeed: 0.5,
          dashboardTitle: '재난안전공유플랫폼',
          dashboardSubtitle: '긴급문자 대시보드',
          orgName: 'Ministry of the Interior and Safety | Emergency Alert System',
          dataCount: 50,
          timeRangeMinutes: 240,
          showCursor: false,
          scrollPauseSeconds: 5,
          stopPosi: 0,

          // ✅ new fields
          reportDate: 3,
          displayOnlyInterestedArea: false,
        });
      }
    };

    loadFilters();
  }, []);

  // Load real data from SafetyData (via local proxy server)
  useEffect(() => {
    if (!filters) return;

    const toDisplayTimestamp = (raw: string) => {
      // If it's parseable, format nicely; otherwise keep as-is.
      try {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          return `${d.getMonth() + 1}.${d.getDate()} ${d.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })}`;
        }
      } catch {
        // ignore
      }
      return raw;
    };

    const normalize = (s: string) => (s || '').replace(/\s+/g, '').toLowerCase();

    const buildInterestedKeys = (areas: string[]) => {
      // 관심지역 + 약칭까지 키워드 확장
      const aliasMap: Record<string, string[]> = {
        '서울특별시': ['서울'],
        '경기도': ['경기'],
        '부산광역시': ['부산'],
        '제주특별자치도': ['제주'],
        '강원도': ['강원'],
        '대구광역시': ['대구'],
        '인천광역시': ['인천'],
        '광주광역시': ['광주'],
        '대전광역시': ['대전'],
        '울산광역시': ['울산'],
        '세종특별자치시': ['세종'],
        '충청북도': ['충북'],
        '충청남도': ['충남'],
        '전라북도': ['전북'],
        '전라남도': ['전남'],
        '경상북도': ['경북'],
        '경상남도': ['경남'],
      };

      const keys = new Set<string>();
      for (const a of areas) {
        const n = normalize(a);
        if (n) keys.add(n);
        for (const al of aliasMap[a] || []) {
          const nn = normalize(al);
          if (nn) keys.add(nn);
        }
      }
      return Array.from(keys);
    };

    const matchesInterestedArea = (msgArea: string, msgAreaFull: string, interestedAreas: string[]) => {
      const a = normalize(msgArea);
      const af = normalize(msgAreaFull);
      const keys = buildInterestedKeys(interestedAreas);

      return keys.some((k) => {
        if (!k) return false;
        // 대표 area가 "서울특별시..." 또는 "서울" 등 잡히도록
        if (a.startsWith(k) || a.includes(k)) return true;
        if (af.includes(k)) return true;
        return false;
      });
    };

    const fetchRealData = async () => {
      try {
        setLoading(true);
        notifyParent('loading');
        const res = await fetch(
          `/api/disaster-sms?pageNo=1&numOfRows=${filters.dataCount}&days=${filters.reportDate}`
        );
        const data: ApiResponse = await res.json();

        if (!data.ok) {
          console.error('API error:', data.error);
          setMessages([]);
          setLoading(false);
          notifyParent('error');
          return;
        }

        let itemsWithKey = (data.items || []).map((it) => {
          const sortKey = Date.parse(it.timestamp);
          return {
            id: it.id,
            area: it.area,
            areaFull: it.areaFull || it.area,
            step: it.step,
            type: it.type,
            message: it.message,
            timestamp: toDisplayTimestamp(it.timestamp),
            sortKey: isNaN(sortKey) ? 0 : sortKey,
          };
        });

        // ✅ 관심지역만 표시 옵션
        if (filters.displayOnlyInterestedArea) {
          itemsWithKey = itemsWithKey.filter((m) => matchesInterestedArea(m.area, m.areaFull, filters.areas));
        }

        // 최신 우선
        itemsWithKey.sort((a, b) => b.sortKey - a.sortKey);

        const items: DisasterMessage[] = itemsWithKey.map(({ sortKey: _k, areaFull: _af, ...rest }) => rest);
        setMessages(items);
        setLoading(false);
        notifyParent('success');
      } catch (error) {
        console.error('Failed to fetch real data:', error);
        setMessages([]);
        setLoading(false);
        notifyParent('error');
      }
    };

    fetchRealData();
    const interval = setInterval(fetchRealData, filters.refreshTime * 1000);
    return () => clearInterval(interval);
  }, [filters]);

  // Auto-scroll logic
  useEffect(() => {
    if (loading || messages.length === 0) return;

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    let animationId: number;
    const pauseMs = Math.max(0, (filters?.scrollPauseSeconds ?? 5) * 1000);
    const stopPosi = Math.max(-1, Math.min(1, Number(filters?.stopPosi ?? 0)));
    const pixelsPerSecond = Math.max(1, (filters?.scrollSpeed || 0.5) * 60);

    const getCards = () => Array.from(scrollContainer.querySelectorAll<HTMLElement>('[data-sms-card="1"]'));
    const getBaseCards = () => getCards().slice(0, messages.length);
    const getLoopPoint = () => {
      const cards = getCards();
      return cards.length > messages.length ? cards[messages.length].offsetTop : 0;
    };

    const resetLoop = (timestamp: number) => {
      const loopPoint = getLoopPoint();
      if (loopPoint > 0) {
        scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - loopPoint);
      } else {
        scrollContainer.scrollTop = 0;
      }
      pauseUntilRef.current = timestamp + pauseMs;
      nextPauseIndexRef.current = 1;
    };

    const currentCardIndex = () => {
      const cards = getBaseCards();
      if (cards.length === 0) return 0;

      const loopPoint = getLoopPoint();
      const currentTop = loopPoint > 0 ? (scrollContainer.scrollTop % loopPoint) : scrollContainer.scrollTop;
      let nearestIndex = 0;
      let nearestDist = Number.POSITIVE_INFINITY;

      cards.forEach((card, idx) => {
        const dist = Math.abs(card.offsetTop - currentTop);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIndex = idx;
        }
      });

      return nearestIndex;
    };

    const moveToCardIndex = (index: number, timestamp = performance.now()) => {
      const cards = getBaseCards();
      if (cards.length === 0) return;

      const clampedIndex = Math.max(0, Math.min(cards.length - 1, index));
      scrollContainer.scrollTop = cards[clampedIndex].offsetTop;
      nextPauseIndexRef.current = Math.min(cards.length, clampedIndex + 1);
      pauseUntilRef.current = timestamp + pauseMs;
    };

    const snapToStopPosition = (timestamp = performance.now()) => {
      moveToCardIndex(currentCardIndex() + stopPosi, timestamp);
    };

    const jumpToCard = (direction: 1 | -1) => {
      moveToCardIndex(currentCardIndex() + direction, performance.now());
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

    scrollContainer.addEventListener('mouseenter', onEnter);
    scrollContainer.addEventListener('mouseleave', onLeave);
    scrollContainer.addEventListener('pointerenter', onEnter);
    scrollContainer.addEventListener('pointerleave', onLeave);
    scrollContainer.addEventListener('wheel', onWheel, { passive: false, capture: true });

    const scroll = (timestamp: number) => {
      if (!scrollContainer) return;

      if (lastScrollFrameRef.current == null) {
        lastScrollFrameRef.current = timestamp;
        if (pauseUntilRef.current === 0) {
          pauseUntilRef.current = timestamp + pauseMs;
        }
      }

      if (hoverPausedRef.current || timestamp < pauseUntilRef.current) {
        lastScrollFrameRef.current = timestamp;
        animationId = requestAnimationFrame(scroll);
        return;
      }

      const cards = getBaseCards();
      const loopPoint = getLoopPoint();
      const deltaMs = timestamp - lastScrollFrameRef.current;
      lastScrollFrameRef.current = timestamp;
      const distance = (pixelsPerSecond * deltaMs) / 1000;

      if (loopPoint > 0 && cards.length > 0 && nextPauseIndexRef.current < cards.length) {
        const targetTop = cards[nextPauseIndexRef.current].offsetTop;
        const nextTop = Math.min(scrollContainer.scrollTop + distance, targetTop);
        scrollContainer.scrollTop = nextTop;
        if (nextTop >= targetTop - 1) {
          pauseUntilRef.current = timestamp + pauseMs;
          nextPauseIndexRef.current += 1;
        }
      } else {
        scrollContainer.scrollTop += distance;
      }

      if (loopPoint > 0 && scrollContainer.scrollTop >= loopPoint - 1) {
        resetLoop(timestamp);
      }

      animationId = requestAnimationFrame(scroll);
    };

    lastScrollFrameRef.current = null;
    pauseUntilRef.current = 0;
    nextPauseIndexRef.current = 1;
    hoverPausedRef.current = false;
    animationId = requestAnimationFrame(scroll);
    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      scrollContainer.removeEventListener('mouseenter', onEnter);
      scrollContainer.removeEventListener('mouseleave', onLeave);
      scrollContainer.removeEventListener('pointerenter', onEnter);
      scrollContainer.removeEventListener('pointerleave', onLeave);
      scrollContainer.removeEventListener('wheel', onWheel, true);
      lastScrollFrameRef.current = null;
      pauseUntilRef.current = 0;
      nextPauseIndexRef.current = 1;
      hoverPausedRef.current = false;
    };
  }, [loading, messages, filters]);

  const getIcon = (type: string) => {
    switch (type) {
      case '화재':
        return <Flame className="text-orange-500" />;
      case '지진':
        return <Activity className="text-yellow-500" />;
      case '호우':
        return <Waves className="text-blue-400" />;
      case '대설':
        return <Snowflake className="text-blue-200" />;
      case '교통통제':
        return <Zap className="text-purple-400" />;
      default:
        return <ShieldAlert className="text-red-500" />;
    }
  };

  const getStepColor = (step: string) => {
    switch (step) {
      case '위급':
        return 'bg-red-900/50 border-red-500 text-red-200';
      case '긴급':
        return 'bg-orange-900/50 border-orange-500 text-orange-200';
      case '주의':
        return 'bg-yellow-900/50 border-yellow-500 text-yellow-200';
      default:
        return 'bg-blue-900/50 border-blue-500 text-blue-200';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#001B3D] flex items-center justify-center text-white font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-xl font-light tracking-widest">데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'min-h-screen bg-[#001B3D] text-white font-sans overflow-hidden selection:bg-blue-500/30'
      )}
    >
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#001B3D]/80 backdrop-blur-md border-b border-white/10 px-8 py-6 flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-bold tracking-tighter flex items-center gap-3">
            <ShieldAlert className="w-10 h-10 text-red-500 animate-pulse" />
            {filters?.dashboardTitle}{' '}
            <span className="text-blue-400 font-light">{filters?.dashboardSubtitle}</span>
          </h1>
          <p className="text-sm text-white/50 mt-2 font-mono uppercase tracking-widest">{filters?.orgName}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono">
            {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
          <div className="text-white/40 text-xs uppercase tracking-widest">Real-time Monitoring Active</div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="pt-32 h-screen overflow-hidden relative">
        {/* Scrolling Container */}
        <div ref={scrollContainerRef} className="h-full overflow-hidden">
          <div className="px-8 pb-32 flex flex-col gap-6 max-w-6xl mx-auto">
            {messages.length === 0 ? (
              <div className="mt-20 text-center text-white/60">
                <div className="text-xl">표시할 데이터가 없습니다.</div>
                <div className="text-sm mt-2 text-white/40">
                  (서버 실행 여부, SAFETYDATA_SERVICE_KEY 설정, API 이용승인 상태,
                  관심지역 필터(DisplayOnlyInterestedArea) 설정을 확인하세요)
                </div>
              </div>
            ) : (
              // Double the messages for seamless looping
              [...messages, ...messages].map((msg, idx) => (
                <motion.div
                  key={`${msg.id}-${idx}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn('p-8 rounded-2xl border backdrop-blur-sm transition-all duration-500', getStepColor(msg.step))}
                  data-sms-card="1"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white/10 rounded-xl">{getIcon(msg.type)}</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-white/20 rounded text-[10px] font-bold uppercase tracking-tighter">
                            {msg.step}
                          </span>
                          <span className="text-xs text-white/60 flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {msg.area}
                          </span>
                        </div>
                        <h2 className="text-2xl font-semibold mt-1">{msg.type} 상황 전파</h2>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-white/40 font-mono text-sm">
                      <Clock className="w-4 h-4" />
                      {msg.timestamp}
                    </div>
                  </div>

                  <p className="text-lg leading-relaxed text-white/90 font-light whitespace-pre-wrap">{msg.message}</p>

                  <div className="mt-6 pt-6 border-t border-white/10 flex justify-between items-center">
                    <div className="flex gap-2 flex-wrap">
                      {filters?.areas.map((a) => {
                        const shortName =
                          a === '서울특별시'
                            ? '서울'
                            : a === '경기도'
                              ? '경기'
                              : a === '강원도'
                                ? '강원'
                                : a === '제주특별자치도'
                                  ? '제주'
                                  : a === '부산광역시'
                                    ? '부산'
                                    : a;
                        const isHit = (msg.area || '').includes(shortName) || (msg.area || '').includes(a);
                        return (
                          <span
                            key={a}
                            className={cn(
                              'text-[10px] px-2 py-1 rounded-full border border-white/10',
                              isHit ? 'bg-white/10 text-white' : 'text-white/30'
                            )}
                          >
                            {shortName}
                          </span>
                        );
                      })}
                    </div>
                    <div className="text-[10px] text-white/20 uppercase tracking-widest">Source: SafetyData OpenAPI</div>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Readability: remove strong top/bottom fade overlays that made lower text look dim */}
      </main>

      {/* Footer / Status Bar */}
      <footer className="fixed bottom-0 left-0 right-0 z-50 bg-[#001B3D]/90 backdrop-blur-md border-t border-white/10 px-8 py-4 flex justify-between items-center text-[10px] uppercase tracking-[0.2em] text-white/40">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            System Online
          </div>
          <div>
            Filtered by:{' '}
            {filters?.areas
              .map((a) =>
                a === '서울특별시'
                  ? '서울'
                  : a === '경기도'
                    ? '경기'
                    : a === '강원도'
                      ? '강원'
                      : a === '제주특별자치도'
                        ? '제주'
                        : a === '부산광역시'
                          ? '부산'
                          : a
              )
              .join(', ')}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div>Auto-Scroll Active</div>
          <div className="w-px h-3 bg-white/10" />
          <div>© 2026 Disaster Safety Platform</div>
        </div>
      </footer>
    </div>
);
}
