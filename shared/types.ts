// 서버와 웹(추후 안드로이드)이 함께 쓰는 도메인 타입.

export type Market = 'KR' | 'US';
export type Currency = 'KRW' | 'USD';

export interface Stock {
  symbol: string;
  name: string;
  market: Market;
  currency: Currency;
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
  ts: number; // epoch ms
}

export type Interval = '1m' | '5m' | '15m' | '1h' | '1d';

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
}

export interface Order extends OrderRequest {
  id: string;
  name: string;
  filledQty: number;
  avgFillPrice: number;
  fee: number; // 수수료 + 세금
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

// 서버 → 클라이언트 WebSocket 메시지
export type ServerMessage =
  | { type: 'quote'; data: Quote }
  | { type: 'orderbook'; data: Orderbook }
  | { type: 'order'; data: Order };

// 클라이언트 → 서버 WebSocket 메시지
export type ClientMessage = { type: 'subscribe'; symbol: string };
