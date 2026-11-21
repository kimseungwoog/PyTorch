import type { Candle, Interval, Orderbook, Quote, Stock } from '../../../shared/types';

// 시세 공급자. mock(모의 시세)와 toss(토스증권 Open API)가 같은 인터페이스를 구현한다.
export interface MarketProvider {
  readonly name: string;
  start(): Promise<void>;
  stop(): void;
  listStocks(): Promise<Stock[]>;
  getQuotes(symbols?: string[]): Promise<Quote[]>;
  getCandles(symbol: string, interval: Interval, count: number): Promise<Candle[]>;
  getOrderbook(symbol: string): Promise<Orderbook>;
  onQuote(cb: (q: Quote) => void): void;
}
