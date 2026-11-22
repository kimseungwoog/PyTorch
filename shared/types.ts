// 서버와 웹(추후 안드로이드)이 함께 쓰는 도메인 타입.

export type Market = 'KR' | 'US';
export type Currency = 'KRW' | 'USD';

export interface Stock {
  symbol: string;
  name: string;
  market: Market;
  currency: Currency;
  sector?: string;
}

export interface Quote {
  symbol: string;
  price: number;
  prevClose: number;
  change: number;
  changeRate: number; // 0.0123 = +1.23%
  open: number;
  high: number;
  low: number;
  volume: number; // 당일 누적 거래량
  value: number; // 당일 누적 거래대금
  ts: number; // epoch ms
}

export type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export interface Candle {
  time: number; // 봉 시작 시각, epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderbookLevel {
  price: number;
  qty: number;
}

export interface Orderbook {
  symbol: string;
  asks: OrderbookLevel[]; // 최우선 매도호가부터 오름차순
  bids: OrderbookLevel[]; // 최우선 매수호가부터 내림차순
  ts: number;
}

export type Side = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type OrderStatus = 'open' | 'filled' | 'cancelled' | 'rejected';

export interface OrderRequest {
  symbol: string;
  side: Side;
  type: OrderType;
  qty: number;
  price?: number; // 지정가일 때 필수
  stopPrice?: number; // 매수 체결 뒤 이 가격 이하로 내려가면 자동 매도 (손절)
  takePrice?: number; // 매수 체결 뒤 이 가격 이상으로 오르면 자동 매도 (익절)
  memo?: string; // 매매 이유 (매매 일지)
}

export interface Order extends OrderRequest {
  id: string;
  name: string;
  filledQty: number;
  avgFillPrice: number;
  fee: number; // 수수료 + 세금
  note?: string; // 자동 주문일 때 사유 (손절·익절)
  realizedPnl?: number; // 매도 체결 시 실현 손익
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Holding {
  symbol: string;
  name: string;
  qty: number;
  sellableQty: number; // 미체결 매도 주문을 뺀 수량
  avgPrice: number;
  price: number;
  value: number;
  pnl: number;
  pnlRate: number;
}

export interface Account {
  currency: Currency;
  cash: number;
  buyingPower: number; // 미체결 매수 주문을 뺀 주문 가능 금액
  invested: number; // 매입 금액
  equity: number; // 현금 + 평가 금액
  unrealizedPnl: number;
  unrealizedPnlRate: number;
  realizedPnl: number;
  initialCash: number;
}

export interface ServerStatus {
  marketProvider: string; // 'mock' | 'toss'
  broker: string; // 'paper' | 'toss'
  live: boolean; // 실계좌 주문 여부
  feeRate: number;
  sellTaxRate: number;
  maxOrderAmount: number;
}

// 매수에 묶어 둔 자동 매도 (손절·익절)
export interface Bracket {
  id: string;
  parentId: string;
  symbol: string;
  name: string;
  qty: number;
  stopPrice?: number;
  takePrice?: number;
  status: 'waiting' | 'active' | 'done' | 'cancelled'; // waiting = 매수 체결 전
  result?: 'stop' | 'take';
  createdAt: number;
}

export interface RiskStatus {
  limit: number; // 하루 손실 한도 (원). 0 이면 끔
  dayPnl: number; // 오늘(한국 시간) 시작 대비 자산 변화
  blocked: boolean; // 한도 도달로 매수 차단 중
}

export type AlertRule = { id: string; symbol: string; name: string; createdAt: number } & (
  | { kind: 'price'; op: 'gte' | 'lte'; price: number }
  | { kind: 'candidate' }
  | { kind: 'strategy'; strategyId: string }
);
export type NewAlertRule =
  | { symbol: string; kind: 'price'; price: number }
  | { symbol: string; kind: 'candidate' }
  | { symbol: string; kind: 'strategy'; strategyId: string };

export interface AlertEvent {
  id: string;
  ts: number;
  title: string;
  body: string;
  symbol?: string;
  url?: string; // 새 글 알림의 원문 주소
}

export interface StrategyMatrixRow {
  symbol: string;
  name: string;
  cells: Array<{ strategyId: string; trades: number; winRate: number; totalReturn: number; holding: boolean }>;
}

// 새 글 알림
export type FeedSource = 'x' | 'fmkorea' | 'tradingview';
export interface FeedAuthor {
  id: string;
  source: FeedSource;
  handle: string; // X·트레이딩뷰 아이디 또는 에펨코리아 닉네임
  notify: boolean; // 새 글 알림
  userId?: string;
  lastId?: string;
  seen?: string[]; // 이미 확인한 글. 처음 확인하기 전에는 없다.
  error?: string;
}
export interface FeedPost {
  id: string;
  authorId: string;
  source: FeedSource;
  handle: string;
  text: string; // 제목 또는 글 앞부분
  url: string;
  ts: number;
}
export interface FeedState {
  authors: FeedAuthor[];
  posts: FeedPost[];
  intervalMin: number;
  xEnabled: boolean; // 서버에 X API 토큰이 설정됐는지
  lastPollAt?: number;
}

// 스크리너 한 줄: 종목별 기술 평가와 매매 후보
export interface ScreenerRow {
  symbol: string;
  name: string;
  price: number;
  changeRate: number;
  gapRate: number; // 시가가 전일 종가에서 벌어진 비율
  volumeMultiple: number | null; // 직전 확정 봉 거래량 / 그 앞 20봉 평균
  value: number;
  score: number; // -1 ~ +1
  rating: string;
  candidate: 'buy' | 'sell' | 'watch';
  reason: string;
}

// 서버 → 클라이언트 WebSocket 메시지
export type ServerMessage =
  | { type: 'quote'; data: Quote }
  | { type: 'orderbook'; data: Orderbook }
  | { type: 'order'; data: Order }
  | { type: 'alert'; data: AlertEvent }
  | { type: 'feed' };

// 클라이언트 → 서버 WebSocket 메시지
export type ClientMessage = { type: 'subscribe'; symbol: string };
