import React from 'react';
import { NewsItem } from '../types';
import { Badge } from './Badge';

interface NewsCardProps {
  news: NewsItem;
  isAnalyzing: boolean;
}

function formatPubDate(pubDate: string): string {
  const text = String(pubDate || '').trim();

  if (/^\d{12}$/.test(text)) {
    const y = text.slice(0, 4);
    const m = text.slice(4, 6);
    const d = text.slice(6, 8);
    const hh = text.slice(8, 10);
    const mm = text.slice(10, 12);
    return `${y}.${m}.${d} ${hh}:${mm}`;
  }

  const parsed = new Date(text.replace(' ', 'T'));
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return text;
}

export const NewsCard: React.FC<NewsCardProps> = ({ news, isAnalyzing }) => {
  const isUrgent = news.importance === 'Urgent';

  return (
    <div data-news-card="1" className={`group glass card-transition relative overflow-hidden rounded-2xl p-6 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40 ${isUrgent ? 'ring-1 ring-rose-500/30' : ''}`}>
      {isUrgent && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-rose-500"></div>}

      <div className="flex justify-between items-start mb-4 gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <Badge type={news.importance}>{news.importance || '분석 중'}</Badge>
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/10 rounded text-slate-200 font-semibold text-[10px]">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
            {news.area}
          </div>
        </div>
        <div className="text-[11px] text-slate-400 font-medium bg-white/5 px-2 py-1 rounded-full border border-white/10 shadow-sm whitespace-nowrap">
          {formatPubDate(news.pubDate)}
        </div>
      </div>

      <h3 className="text-xl font-extrabold text-white mb-3 leading-snug group-hover:text-indigo-200 transition-colors">
        {news.title}
      </h3>

      <p className="text-[14px] text-slate-300 line-clamp-3 mb-5 leading-relaxed">
        {news.content}
      </p>

      {news.summary ? (
        <div className="relative bg-gradient-to-br from-white/8 to-white/4 border border-white/10 p-4 rounded-xl">
          <div className="flex items-start gap-2">
            <div className="mt-1 flex-shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed font-medium">
              <span className="text-indigo-200 font-bold mr-1">AI INSIGHT</span>
              {news.summary}
            </p>
          </div>
        </div>
      ) : isAnalyzing ? (
        <div className="flex items-center gap-2 p-4 bg-white/5 rounded-xl border border-white/10 border-dashed">
          <div className="flex space-x-1">
            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div>
            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
          </div>
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">분석 중</span>
        </div>
      ) : null}

      <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-slate-200">Y</div>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">{news.source}</span>
        </div>
        <span className="text-[10px] font-bold text-indigo-200/80">#{news.category}</span>
      </div>
    </div>
  );
};
