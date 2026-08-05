export interface NewsItem {
  id: string;
  title: string;
  content: string;
  pubDate: string;
  source: string;
  category: string;
  area: string;
  importance?: 'Urgent' | 'Alert' | 'Info';
  summary?: string;
}

export interface AreaConfig {
  interestedAreas: string[];
}

export enum DisasterImportance {
  URGENT = 'Urgent',
  ALERT = 'Alert',
  INFO = 'Info'
}

export type NewsSortOrder = 'asc' | 'desc';

export interface CachedAiAnalysis {
  id: string;
  pubDate: string;
  area: string;
  importance: DisasterImportance | 'Urgent' | 'Alert' | 'Info';
  summary: string;
  updatedAt: string;
}

export type AiAnalysisCacheMap = Record<string, CachedAiAnalysis>;

export interface DashboardConfig {
  AIAnal: boolean;
  ReportDate: number;
  RowsPerPage: number;
  StartDayPage: number;
  EndPage: number;
  LastPage: number;
  BackwardScanLimit: number;
  ForwardScanLimit: number;
  LOAD_TIME: number;
  LOAD_TRY_TIME: number;
  ScrollSpeed: number;
  ScrollPauseSeconds: number;
  StopPosi: number;
}

export interface RuntimePageState {
  StartDayPage: number;
  EndPage: number;
  LastPage: number;
}

export interface FetchNewsResult {
  news: NewsItem[];
  sortOrder: NewsSortOrder;
  pageState: RuntimePageState;
  warning?: string;
  errorDetail?: string;
  rateLimited?: boolean;
}

export interface ApiResponse {
  body: {
    CRT_DT: string;
    YNA_WRTR_NM: string;
    YNA_CN: string;
    YNA_YMD: string;
    YNA_TTL: string;
    YNA_NO: number;
  }[] | null;
  header: {
    resultCode: string;
    resultMsg: string;
    errorMsg?: string | null;
  };
  totalCount?: number | string | null;
  pageNo?: number | string | null;
  numOfRows?: number | string | null;
}
