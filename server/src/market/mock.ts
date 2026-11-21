import { applyTick, bucketStart, INTERVAL_SEC, roundToTick, tickSize } from '../../../shared/market';
import type { Candle, Interval, Orderbook, Quote, Stock } from '../../../shared/types';
import type { MarketProvider } from './types';

// 모의 시세. 종목명은 실제 종목이지만 가격은 전부 난수로 만든 가짜다.
const UNIVERSE: Array<Stock & { base: number }> = [
  { symbol: '005930', name: '삼성전자', base: 71_000 },
  { symbol: '000660', name: 'SK하이닉스', base: 182_000 },
  { symbol: '373220', name: 'LG에너지솔루션', base: 398_000 },
  { symbol: '207940', name: '삼성바이오로직스', base: 812_000 },
  { symbol: '005380', name: '현대차', base: 243_000 },
  { symbol: '000270', name: '기아', base: 104_500 },
  { symbol: '035420', name: 'NAVER', base: 196_000 },
  { symbol: '035720', name: '카카오', base: 41_250 },
  { symbol: '068270', name: '셀트리온', base: 178_300 },
  { symbol: '105560', name: 'KB금융', base: 86_400 },
  { symbol: '005490', name: 'POSCO홀딩스', base: 352_000 },
  { symbol: '012450', name: '한화에어로스페이스', base: 291_500 },
].map((s) => ({ ...s, market: 'KR' as const, currency: 'KRW' as const }));

const SIGMA: Record<Interval, number> = { '1m': 0.0008, '5m': 0.0018, '15m': 0.003, '1h': 0.006, '4h': 0.011, '1d': 0.018, '1w': 0.04 };

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function gauss(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

export class MockMarket implements MarketProvider {
  readonly name = 'mock';
  private quotes = new Map<string, Quote>();
  private candles = new Map<string, Candle[]>();
  private listeners: Array<(q: Quote) => void> = [];
  private timer?: NodeJS.Timeout;

  constructor(private tickMs = 1_000) {
    const now = Date.now();
    for (const s of UNIVERSE) {
      const rnd = mulberry32(hash(s.symbol));
      const open = roundToTick(s.base * (1 + gauss(rnd) * 0.008));
      const price = roundToTick(open * (1 + gauss(rnd) * 0.01));
      this.quotes.set(s.symbol, {
        symbol: s.symbol,
        price,
        prevClose: s.base,
        change: price - s.base,
        changeRate: (price - s.base) / s.base,
        open,
        high: Math.max(open, price),
        low: Math.min(open, price),
        volume: 0,
        value: 0,
        ts: now,
      });
      const q = this.quotes.get(s.symbol)!;
      q.volume = Math.floor(rnd() * 2_000_000) + 100_000;
      q.value = q.volume * open;
    }
  }

  async start() {
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  onQuote(cb: (q: Quote) => void) {
    this.listeners.push(cb);
  }

  async listStocks(): Promise<Stock[]> {
    return UNIVERSE.map(({ base: _base, ...s }) => s);
  }

  async getQuotes(symbols?: string[]): Promise<Quote[]> {
    const all = [...this.quotes.values()];
    return symbols ? all.filter((q) => symbols.includes(q.symbol)) : all;
  }

  async getCandles(symbol: string, interval: Interval, count: number): Promise<Candle[]> {
    const q = this.mustQuote(symbol);
    const key = `${symbol}:${interval}`;
    let series = this.candles.get(key);
    if (!series) {
      series = this.genHistory(symbol, interval, 1_000, q.price);
      this.candles.set(key, series);
    }
    return series.slice(-count);
  }

  async getOrderbook(symbol: string): Promise<Orderbook> {
    const q = this.mustQuote(symbol);
    const asks = [];
    const bids = [];
    let ask = q.price + tickSize(q.price);
    let bid = q.price;
    for (let i = 0; i < 10; i++) {
      asks.push({ price: ask, qty: Math.floor(Math.random() * 4_000) + 50 });
      bids.push({ price: bid, qty: Math.floor(Math.random() * 4_000) + 50 });
      ask += tickSize(ask);
      bid -= tickSize(bid - 1);
    }
    return { symbol, asks, bids, ts: Date.now() };
  }

  private mustQuote(symbol: string): Quote {
    const q = this.quotes.get(symbol);
    if (!q) throw new Error(`알 수 없는 종목: ${symbol}`);
    return q;
  }

  private tick() {
    const now = Date.now();
    for (const q of this.quotes.values()) {
      if (Math.random() > 0.7) continue;
      const steps = Math.round(gauss(Math.random) * 1.3);
      // 상·하한가(±30%) 안에서만 움직인다.
      const upper = roundToTick(q.prevClose * 1.3, 'down');
      const lower = roundToTick(q.prevClose * 0.7, 'up');
      const price = Math.min(upper, Math.max(lower, q.price + steps * tickSize(q.price)));
      const vol = Math.floor(Math.random() * 800) + 1;
      q.price = price;
      q.change = price - q.prevClose;
      q.changeRate = q.change / q.prevClose;
      q.high = Math.max(q.high, price);
      q.low = Math.min(q.low, price);
      q.volume += vol;
      q.value += vol * price;
      q.ts = now;
      for (const interval of Object.keys(INTERVAL_SEC) as Interval[]) {
        const series = this.candles.get(`${q.symbol}:${interval}`);
        if (series) applyTick(series, interval, price, vol, Math.floor(now / 1000));
      }
      for (const cb of this.listeners) cb({ ...q });
    }
  }

  // 현재가에서 과거로 거슬러 올라가며 랜덤워크로 봉을 만든다.
  private genHistory(symbol: string, interval: Interval, count: number, endPrice: number): Candle[] {
    const rnd = mulberry32(hash(`${symbol}:${interval}`));
    const sigma = SIGMA[interval];
    const sec = INTERVAL_SEC[interval];
    const end = bucketStart(Math.floor(Date.now() / 1000), interval);
    const closes = new Array<number>(count);
    closes[count - 1] = endPrice;
    for (let i = count - 1; i > 0; i--) closes[i - 1] = closes[i] / (1 + gauss(rnd) * sigma);
    const out: Candle[] = [];
    for (let i = 0; i < count; i++) {
      const close = roundToTick(closes[i]);
      const open = i === 0 ? close : out[i - 1].close;
      const high = roundToTick(Math.max(open, close) * (1 + Math.abs(gauss(rnd)) * sigma * 0.5), 'up');
      const low = roundToTick(Math.min(open, close) * (1 - Math.abs(gauss(rnd)) * sigma * 0.5), 'down');
      out.push({ time: end - (count - 1 - i) * sec, open, high, low, close, volume: Math.floor(rnd() * 90_000) + 5_000 });
    }
    return out;
  }
}
