import { KST_OFFSET_SEC } from './market';
import type { Candle } from './types';

// 보조 지표 계산. 모든 함수는 입력과 길이가 같은 배열을 돌려주고, 값이 아직 없는 자리는 null 이다.
export type Num = number | null;

const nulls = (n: number): Num[] => new Array<Num>(n).fill(null);

// 앞쪽 null 을 건너뛰고 유효한 구간에만 fn 을 적용한다.
function onValid(series: Num[], fn: (v: number[]) => Num[]): Num[] {
  const start = series.findIndex((x) => x !== null);
  if (start < 0) return nulls(series.length);
  return [...nulls(start), ...fn(series.slice(start) as number[])];
}

export function sma(v: number[], n: number): Num[] {
  const out = nulls(v.length);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(v: number[], n: number): Num[] {
  const out = nulls(v.length);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let prev = v.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < v.length; i++) {
    prev = v[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function wma(v: number[], n: number): Num[] {
  const out = nulls(v.length);
  const denom = (n * (n + 1)) / 2;
  for (let i = n - 1; i < v.length; i++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += v[i - k] * (n - k);
    out[i] = sum / denom;
  }
  return out;
}

export function rsi(c: number[], n = 14): Num[] {
  const out = nulls(c.length);
  if (c.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = value();
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = value();
  }
  return out;
}

function trueRange(c: Candle[]): number[] {
  return c.map((x, i) =>
    i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)),
  );
}

// 와일더 평활: 처음 n 개 평균으로 시작한다.
function wilder(v: number[], n: number): Num[] {
  const out = nulls(v.length);
  if (v.length < n) return out;
  let prev = v.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < v.length; i++) {
    prev = (prev * (n - 1) + v[i]) / n;
    out[i] = prev;
  }
  return out;
}

export function atr(c: Candle[], n = 14): Num[] {
  return wilder(trueRange(c), n);
}

export function adx(c: Candle[], n = 14): { adx: Num[]; plusDI: Num[]; minusDI: Num[] } {
  const len = c.length;
  const plusDM = new Array<number>(len).fill(0);
  const minusDM = new Array<number>(len).fill(0);
  for (let i = 1; i < len; i++) {
    const up = c[i].high - c[i - 1].high;
    const down = c[i - 1].low - c[i].low;
    if (up > down && up > 0) plusDM[i] = up;
    if (down > up && down > 0) minusDM[i] = down;
  }
  const trS = wilder(trueRange(c), n);
  const pS = wilder(plusDM, n);
  const mS = wilder(minusDM, n);
  const plusDI = nulls(len);
  const minusDI = nulls(len);
  const dx = nulls(len);
  for (let i = 0; i < len; i++) {
    const tr = trS[i];
    if (tr === null || tr === 0) continue;
    const p = (100 * pS[i]!) / tr;
    const m = (100 * mS[i]!) / tr;
    plusDI[i] = p;
    minusDI[i] = m;
    dx[i] = p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m);
  }
  return { adx: onValid(dx, (v) => wilder(v, n)), plusDI, minusDI };
}

function highest(c: Candle[], i: number, n: number): number {
  let h = -Infinity;
  for (let k = i - n + 1; k <= i; k++) h = Math.max(h, c[k].high);
  return h;
}

function lowest(c: Candle[], i: number, n: number): number {
  let l = Infinity;
  for (let k = i - n + 1; k <= i; k++) l = Math.min(l, c[k].low);
  return l;
}

export function stochK(c: Candle[], n = 14, smooth = 3): Num[] {
  const raw = nulls(c.length);
  for (let i = n - 1; i < c.length; i++) {
    const h = highest(c, i, n);
    const l = lowest(c, i, n);
    raw[i] = h === l ? 50 : (100 * (c[i].close - l)) / (h - l);
  }
  return onValid(raw, (v) => sma(v, smooth));
}

export function williamsR(c: Candle[], n = 14): Num[] {
  const out = nulls(c.length);
  for (let i = n - 1; i < c.length; i++) {
    const h = highest(c, i, n);
    const l = lowest(c, i, n);
    out[i] = h === l ? -50 : (-100 * (h - c[i].close)) / (h - l);
  }
  return out;
}

export function macd(c: number[], fast = 12, slow = 26, signal = 9): { macd: Num[]; signal: Num[]; hist: Num[] } {
  const f = ema(c, fast);
  const s = ema(c, slow);
  const line = c.map((_, i) => (f[i] !== null && s[i] !== null ? f[i]! - s[i]! : null));
  const sig = onValid(line, (v) => ema(v, signal));
  return { macd: line, signal: sig, hist: line.map((m, i) => (m !== null && sig[i] !== null ? m - sig[i]! : null)) };
}

export function roc(c: number[], n = 10): Num[] {
  return c.map((x, i) => (i >= n && c[i - n] !== 0 ? (100 * (x - c[i - n])) / c[i - n] : null));
}

const typical = (x: Candle) => (x.high + x.low + x.close) / 3;

export function cci(c: Candle[], n = 14): Num[] {
  const tp = c.map(typical);
  const avg = sma(tp, n);
  return tp.map((x, i) => {
    const a = avg[i];
    if (a === null) return null;
    let dev = 0;
    for (let k = i - n + 1; k <= i; k++) dev += Math.abs(tp[k] - a);
    dev /= n;
    return dev === 0 ? 0 : (x - a) / (0.015 * dev);
  });
}

export function mfi(c: Candle[], n = 14): Num[] {
  const out = nulls(c.length);
  const tp = c.map(typical);
  for (let i = n; i < c.length; i++) {
    let pos = 0;
    let neg = 0;
    for (let k = i - n + 1; k <= i; k++) {
      const flow = tp[k] * c[k].volume;
      if (tp[k] > tp[k - 1]) pos += flow;
      else if (tp[k] < tp[k - 1]) neg += flow;
    }
    out[i] = neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

export function bollinger(c: number[], n = 20, k = 2): { mid: Num[]; upper: Num[]; lower: Num[] } {
  const mid = sma(c, n);
  const upper = nulls(c.length);
  const lower = nulls(c.length);
  for (let i = n - 1; i < c.length; i++) {
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (c[j] - mid[i]!) ** 2;
    const sd = Math.sqrt(sq / n);
    upper[i] = mid[i]! + k * sd;
    lower[i] = mid[i]! - k * sd;
  }
  return { mid, upper, lower };
}

export function donchian(c: Candle[], n = 20): { upper: Num[]; lower: Num[] } {
  const upper = nulls(c.length);
  const lower = nulls(c.length);
  for (let i = n - 1; i < c.length; i++) {
    upper[i] = highest(c, i, n);
    lower[i] = lowest(c, i, n);
  }
  return { upper, lower };
}

// 한국 시간 기준 하루마다 다시 시작하는 거래량 가중 평균가.
export function vwap(c: Candle[]): Num[] {
  let day = NaN;
  let pv = 0;
  let vol = 0;
  return c.map((x) => {
    const d = Math.floor((x.time + KST_OFFSET_SEC) / 86_400);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    pv += typical(x) * x.volume;
    vol += x.volume;
    return vol ? pv / vol : typical(x);
  });
}

export function supertrend(c: Candle[], n = 10, mult = 3): { line: Num[]; up: boolean[] } {
  const a = atr(c, n);
  const line = nulls(c.length);
  const up = new Array<boolean>(c.length).fill(true);
  let upper = 0;
  let lower = 0;
  let started = false;
  for (let i = 0; i < c.length; i++) {
    if (a[i] === null) continue;
    const mid = (c[i].high + c[i].low) / 2;
    const bu = mid + mult * a[i]!;
    const bl = mid - mult * a[i]!;
    if (!started) {
      upper = bu;
      lower = bl;
      up[i] = c[i].close >= mid;
      started = true;
    } else {
      upper = bu < upper || c[i - 1].close > upper ? bu : upper;
      lower = bl > lower || c[i - 1].close < lower ? bl : lower;
      up[i] = up[i - 1] ? c[i].close >= lower : c[i].close > upper;
    }
    line[i] = up[i] ? lower : upper;
  }
  return { line, up };
}
