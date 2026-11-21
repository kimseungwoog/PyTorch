import { describe, expect, it } from 'vitest';
import { analyze, ratingLabel } from '../../shared/analysis';
import { forecast } from '../../shared/forecast';
import { bollinger, ema, macd, rsi, sma, supertrend, wma } from '../../shared/indicators';
import { bucketStart } from '../../shared/market';
import { costProfile } from '../../shared/profile';
import { replay, STRATEGIES } from '../../shared/strategies';
import type { Candle } from '../../shared/types';

const bar = (i: number, close: number, spread = 1, volume = 100): Candle => ({
  time: i * 86_400,
  open: close,
  high: close + spread,
  low: close - spread,
  close,
  volume,
});
const trend = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => bar(i, f(i)));

describe('지표', () => {
  it('이동평균', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(wma([1, 2, 3], 3)).toEqual([null, null, (1 + 4 + 9) / 6]);
    expect(ema([2, 4, 6], 2)[2]).toBeCloseTo(6 * (2 / 3) + 3 * (1 / 3));
  });
  it('RSI: 계속 오르면 100, 계속 내리면 0', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(up).at(-1)).toBe(100);
    expect(rsi([...up].reverse()).at(-1)).toBe(0);
    expect(rsi(up)[13]).toBeNull();
  });
  it('MACD 는 상승 추세에서 양수, 볼린저는 상단 > 중심 > 하단', () => {
    const c = Array.from({ length: 60 }, (_, i) => 100 + i + Math.sin(i));
    expect(macd(c).macd.at(-1)!).toBeGreaterThan(0);
    const b = bollinger(c);
    expect(b.upper.at(-1)!).toBeGreaterThan(b.mid.at(-1)!);
    expect(b.mid.at(-1)!).toBeGreaterThan(b.lower.at(-1)!);
  });
  it('슈퍼트렌드는 상승 추세에서 가격 아래에 놓인다', () => {
    const c = trend(60, (i) => 100 + i * 2);
    const st = supertrend(c);
    expect(st.up.at(-1)).toBe(true);
    expect(st.line.at(-1)!).toBeLessThan(c.at(-1)!.close);
  });
  it('주봉은 한국 시간 월요일 자정에 시작한다', () => {
    const wed = Date.UTC(2026, 10, 18, 3, 0) / 1000; // 2026-11-18(수) 12:00 KST
    expect(bucketStart(wed, '1w')).toBe(Date.UTC(2026, 10, 15, 15, 0) / 1000); // 11-16(월) 00:00 KST
  });
});

describe('기술 상태 판정', () => {
  it('꾸준한 상승은 매수 쪽, 꾸준한 하락은 매도 쪽으로 판정한다', () => {
    const up = analyze(trend(200, (i) => 1000 + i * 5));
    const down = analyze(trend(200, (i) => 2000 - i * 5));
    expect(up.scores.all).toBeGreaterThan(0.5);
    expect(ratingLabel(up.scores.all)).toBe('적극 매수');
    expect(down.scores.all).toBeLessThan(-0.5);
    expect(down.counts.buy).toBe(0);
  });
  it('RSI 가 기준 밖이면 관망으로 두고 이유를 알려 준다', () => {
    const a = analyze(trend(200, (i) => 1000 + i * 5)); // RSI 100
    expect(a.candidate).toBe('watch');
    expect(a.reason).toContain('RSI');
    expect(a.plan).toBeUndefined();
  });
  it('완만하게 오르내리며 상승하면 매수 후보와 손절·목표가를 낸다', () => {
    const a = analyze(trend(200, (i) => 1000 + i * 3 + (i % 2 ? -8 : 8)));
    expect(a.candidate).toBe('buy');
    expect(a.plan!.stop).toBeLessThan(a.plan!.entry);
    expect(a.plan!.target - a.plan!.entry).toBeCloseTo(2 * (a.plan!.entry - a.plan!.stop));
  });
  it('봉이 부족하면 판정을 미룬다', () => {
    expect(analyze(trend(5, () => 100)).candidate).toBe('watch');
  });
});

describe('원가 분포', () => {
  it('거래량이 몰린 가격대와 수익권 비율을 구한다', () => {
    const candles = [bar(0, 100, 5, 900), bar(1, 200, 5, 100)];
    const p = costProfile(candles)!;
    expect(p.low).toBe(95);
    expect(p.high).toBe(205);
    expect(p.belowPct).toBeGreaterThan(0.9); // 종가 200 아래에 거래량 대부분
    expect(p.belowPct + p.abovePct).toBeCloseTo(1);
    expect(p.avgPrice).toBeGreaterThan(105);
    expect(p.avgPrice).toBeLessThan(115);
    expect(p.zones.reduce((a, z) => a + z.pct, 0)).toBeCloseTo(1);
    expect(p.closeZone).toBe('머리');
    expect(p.mode.lo).toBeLessThanOrEqual(100);
  });
  it('유통주식 수를 주면 오래된 물량이 줄어든다', () => {
    const candles = [bar(0, 100, 5, 900), bar(1, 200, 5, 900)];
    expect(costProfile(candles, 1000)!.avgPrice).toBeGreaterThan(costProfile(candles)!.avgPrice);
  });
});

describe('전략 리플레이', () => {
  it('터틀: 고가 돌파에 사고 저가 이탈에 판다', () => {
    const c = trend(120, (i) => (i < 30 ? 100 : i < 70 ? 100 + (i - 30) * 3 : 220 - (i - 70) * 4));
    const r = replay(STRATEGIES.find((s) => s.id === 'turtle-20')!, c);
    expect(r.signals[0].type).toBe('entry');
    expect(r.signals[1].type).toBe('exit');
    expect(r.trades).toBe(1);
    expect(r.totalReturn).toBeGreaterThan(0);
  });
  it('B.N.F.: 25일선 15% 이탈 뒤 전일 고가를 넘으면 진입한다', () => {
    const c = trend(40, (i) => (i < 30 ? 100 : i < 33 ? 80 : 84));
    const r = replay(STRATEGIES.find((s) => s.id === 'bnf-25')!, c);
    expect(r.signals[0]).toMatchObject({ index: 33, type: 'entry', price: 84 });
  });
  it('봉이 부족하면 신호가 없다', () => {
    for (const s of STRATEGIES) expect(replay(s, trend(5, () => 100)).signals).toEqual([]);
  });
});

describe('주가 경로 추정', () => {
  it('자료가 부족하면 현재가 유지로 두고 미검증으로 표시한다', () => {
    const [row] = forecast(Array.from({ length: 30 }, () => 100), [21]);
    expect(row).toMatchObject({ center: 100, lo: null, status: 'unverified', samples: 0 });
  });
  it('일정하게 오르는 자료에서는 중심 추정이 현재가보다 높고 범위가 중심을 감싼다', () => {
    const closes = Array.from({ length: 800 }, (_, i) => 100 * Math.exp(i * 0.001 + Math.sin(i / 7) * 0.01));
    const [row] = forecast(closes, [21]);
    expect(row.center).toBeGreaterThan(closes.at(-1)!);
    expect(row.lo!).toBeLessThanOrEqual(row.center);
    expect(row.hi!).toBeGreaterThanOrEqual(row.center);
    expect(row.samples).toBeGreaterThanOrEqual(20);
    expect(row.modelErr!).toBeLessThan(row.holdErr!);
  });
});
