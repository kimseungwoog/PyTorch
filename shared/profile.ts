import type { Candle } from './types';

// 원가 분포 추정: 각 봉의 거래량을 그 봉의 저가~고가 사이에 고르게 나눠 가격대별 거래량을 만든다.
// 실제 투자자별 매입가는 알 수 없으므로 어디까지나 거래량 기준 추정이다.

export interface PriceBin {
  lo: number;
  hi: number;
  pct: number; // 전체 거래량 대비 비율 (0~1)
}

export interface Zone extends PriceBin {
  name: string;
}

export interface CostProfile {
  bars: number;
  from: number;
  to: number;
  totalVolume: number;
  low: number;
  high: number;
  close: number;
  avgPrice: number; // 거래량 가중 평균 가격
  belowPct: number; // 종가보다 낮은 가격대의 거래량 = 수익권
  abovePct: number; // 종가보다 높은 가격대의 거래량 = 손실권
  p5: number;
  p15: number;
  p85: number;
  p95: number;
  bins: PriceBin[];
  mode: PriceBin; // 가장 집중된 가격대
  zones: Zone[]; // 머리 → 발 순서
  closeZone: string;
}

const CELLS = 400;
// 사람 모양 구간 경계 (저가 0 ~ 고가 1): 발, 무릎, 몸통, 어깨, 머리
const ZONE_EDGES: Array<[string, number, number]> = [
  ['머리', 0.9, 1],
  ['어깨', 0.64, 0.9],
  ['몸통', 0.38, 0.64],
  ['무릎', 0.12, 0.38],
  ['발', 0, 0.12],
];

function niceStep(range: number, maxBins = 24): number {
  const pow = 10 ** Math.floor(Math.log10(range / maxBins));
  for (const m of [1, 2, 5, 10]) if (range / (m * pow) <= maxBins) return m * pow;
  return 10 * pow;
}

// floatShares(유통주식 수)를 주면 그날 회전율만큼 이전 물량을 줄인다(손바뀜 반영).
export function costProfile(candles: Candle[], floatShares?: number): CostProfile | null {
  if (!candles.length) return null;
  const low = Math.min(...candles.map((c) => c.low));
  const high = Math.max(...candles.map((c) => c.high));
  const close = candles[candles.length - 1].close;
  const span = high - low || 1;
  const width = span / CELLS;
  const cells = new Array<number>(CELLS).fill(0);
  const cellOf = (p: number) => Math.min(CELLS - 1, Math.max(0, Math.floor((p - low) / width)));

  for (const c of candles) {
    if (floatShares && floatShares > 0) {
      const keep = Math.max(0, 1 - c.volume / floatShares);
      for (let i = 0; i < CELLS; i++) cells[i] *= keep;
    }
    const a = cellOf(c.low);
    const b = cellOf(c.high);
    const share = c.volume / (b - a + 1);
    for (let i = a; i <= b; i++) cells[i] += share;
  }

  const total = cells.reduce((x, y) => x + y, 0) || 1;
  const center = (i: number) => low + (i + 0.5) * width;
  const sumBetween = (lo: number, hi: number) => {
    let s = 0;
    for (let i = 0; i < CELLS; i++) if (center(i) >= lo && center(i) < hi) s += cells[i];
    return s / total;
  };
  const percentile = (q: number) => {
    let acc = 0;
    for (let i = 0; i < CELLS; i++) {
      acc += cells[i] / total;
      if (acc >= q) return center(i);
    }
    return high;
  };

  const step = niceStep(span);
  const bins: PriceBin[] = [];
  for (let lo = Math.floor(low / step) * step; lo < high; lo += step) {
    bins.push({ lo, hi: lo + step, pct: sumBetween(lo, lo + step) });
  }
  bins.reverse();

  const zones = ZONE_EDGES.map(([name, a, b]) => {
    const lo = low + span * a;
    const hi = low + span * b;
    return { name, lo, hi, pct: sumBetween(lo, b === 1 ? Infinity : hi) };
  });
  const belowPct = sumBetween(-Infinity, close);

  return {
    bars: candles.length,
    from: candles[0].time,
    to: candles[candles.length - 1].time,
    totalVolume: candles.reduce((a, c) => a + c.volume, 0),
    low,
    high,
    close,
    avgPrice: cells.reduce((a, v, i) => a + v * center(i), 0) / total,
    belowPct,
    abovePct: 1 - belowPct,
    p5: percentile(0.05),
    p15: percentile(0.15),
    p85: percentile(0.85),
    p95: percentile(0.95),
    bins,
    mode: bins.reduce((a, b) => (b.pct > a.pct ? b : a)),
    zones,
    closeZone: (zones.find((z) => close >= z.lo) ?? zones[zones.length - 1]).name,
  };
}
