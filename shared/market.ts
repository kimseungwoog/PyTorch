import type { Candle, Interval } from './types';

// KRX 호가가격단위 (2023년 유가증권·코스닥 통일 기준)
export function tickSize(price: number): number {
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}

export function roundToTick(price: number, dir: 'nearest' | 'up' | 'down' = 'nearest'): number {
  const t = tickSize(price);
  const fn = dir === 'up' ? Math.ceil : dir === 'down' ? Math.floor : Math.round;
  return fn(price / t) * t;
}

export function isOnTick(price: number): boolean {
  return Number.isInteger(price) && price % tickSize(price) === 0;
}

export const INTERVAL_SEC: Record<Interval, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3_600,
  '4h': 14_400,
  '1d': 86_400,
  '1w': 604_800,
};

export const KST_OFFSET_SEC = 9 * 3_600;

// 해당 시각이 속한 봉의 시작 시각. 일봉은 한국 시간 자정, 주봉은 한국 시간 월요일 자정 기준.
export function bucketStart(tsSec: number, interval: Interval): number {
  const s = INTERVAL_SEC[interval];
  if (interval === '1w') {
    const monday = 4 * 86_400 - KST_OFFSET_SEC; // 1970-01-05(월) 00:00 KST
    return Math.floor((tsSec - monday) / s) * s + monday;
  }
  if (interval === '1d') return Math.floor((tsSec + KST_OFFSET_SEC) / s) * s - KST_OFFSET_SEC;
  return Math.floor(tsSec / s) * s;
}

// 체결 한 건을 봉 배열에 반영한다. 배열을 직접 수정하고 마지막 봉을 돌려준다.
export function applyTick(
  candles: Candle[],
  interval: Interval,
  price: number,
  volumeDelta: number,
  tsSec: number,
): Candle {
  const start = bucketStart(tsSec, interval);
  const last = candles[candles.length - 1];
  if (last && last.time >= start) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.volume += volumeDelta;
    return last;
  }
  const next: Candle = { time: start, open: price, high: price, low: price, close: price, volume: volumeDelta };
  candles.push(next);
  return next;
}
