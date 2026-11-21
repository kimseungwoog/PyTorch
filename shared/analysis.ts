import { adx, atr, cci, ema, macd, mfi, roc, rsi, sma, stochK, williamsR, type Num } from './indicators';
import type { Candle } from './types';

// 기술 상태 판정. 지표마다 매수·매도·중립을 매기고 쉬운 말로 이유를 붙인다.
// 판정 기준은 이 앱의 모의 규칙이며 수익을 보장하지 않는다.

export type Verdict = 'buy' | 'sell' | 'neutral';

export interface Row {
  name: string;
  value: number | null;
  verdict: Verdict;
  reason: string;
}

export interface Analysis {
  bars: number;
  oscillators: Row[];
  mas: Row[];
  counts: Record<Verdict, number>;
  scores: { osc: number; ma: number; all: number }; // -1(매도) ~ +1(매수)
  candidate: 'buy' | 'sell' | 'watch';
  reason: string;
  plan?: { entry: number; stop: number; target: number }; // 매수 후보일 때만
  atr: number | null;
}

const MA_LENGTHS = [5, 10, 20, 60, 120];
const last = (s: Num[]): number | null => (s.length ? s[s.length - 1] : null);

export function ratingLabel(score: number): string {
  if (score > 0.5) return '적극 매수';
  if (score > 0.1) return '매수';
  if (score < -0.5) return '적극 매도';
  if (score < -0.1) return '매도';
  return '중립';
}

function row(name: string, value: number | null, judge: (v: number) => [Verdict, string]): Row {
  if (value === null) return { name, value, verdict: 'neutral', reason: '계산할 봉이 아직 부족해요.' };
  const [verdict, reason] = judge(value);
  return { name, value, verdict, reason };
}

// 구간 판정: hi 보다 크면 매수, lo 보다 작으면 매도.
const band =
  (lo: number, hi: number, buy: string, sell: string, mid: string) =>
  (v: number): [Verdict, string] =>
    v > hi ? ['buy', buy] : v < lo ? ['sell', sell] : ['neutral', mid];

function score(rows: Row[]): number {
  const valid = rows.filter((r) => r.value !== null);
  if (!valid.length) return 0;
  const net = valid.reduce((a, r) => a + (r.verdict === 'buy' ? 1 : r.verdict === 'sell' ? -1 : 0), 0);
  return net / valid.length;
}

export function analyze(candles: Candle[], round: (p: number) => number = (p) => p): Analysis {
  const closes = candles.map((c) => c.close);
  const close = closes[closes.length - 1] ?? 0;

  const rsiV = last(rsi(closes));
  const macdV = last(macd(closes).macd);
  const dmi = adx(candles);
  const adxV = last(dmi.adx);
  const plus = last(dmi.plusDI) ?? 0;
  const minus = last(dmi.minusDI) ?? 0;

  const oscillators: Row[] = [
    row('RSI(14)', rsiV, band(45, 55, '최근 오르는 힘이 더 강해요.', '최근 내리는 힘이 더 강해요.', '오르는 힘과 내리는 힘이 비슷해요.')),
    row(
      'Stochastic %K(14)',
      last(stochK(candles)),
      band(40, 60, '최근 가격 범위의 위쪽이에요.', '최근 가격 범위의 아래쪽이에요.', '최근 가격 범위의 가운데예요.'),
    ),
    row(
      'Williams %R(14)',
      last(williamsR(candles)),
      band(-60, -40, '최근 가격 범위의 위쪽이에요.', '최근 가격 범위의 아래쪽이에요.', '최근 가격 범위의 가운데예요.'),
    ),
    row('MACD(12,26)', macdV, band(0, 0, '짧은 평균선이 긴 평균선 위에 있어요.', '짧은 평균선이 긴 평균선 아래에 있어요.', '두 평균선이 겹쳐 있어요.')),
    row('ROC(10)', last(roc(closes)), band(-0.5, 0.5, '10봉 전보다 종가가 높아요.', '10봉 전보다 종가가 낮아요.', '10봉 전과 종가가 비슷해요.')),
    row(
      'CCI(14)',
      last(cci(candles)),
      band(-100, 100, '최근 평균보다 위로 많이 벗어났어요.', '최근 평균보다 아래로 많이 벗어났어요.', '최근 평균에서 크게 벗어나지 않았어요.'),
    ),
    row('MFI(14)', last(mfi(candles)), band(40, 60, '거래대금이 오르는 쪽에 더 실렸어요.', '거래대금이 내리는 쪽에 더 실렸어요.', '거래대금이 한쪽으로 쏠리지 않았어요.')),
    row('ADX(14)', adxV, (v) =>
      v < 20
        ? ['neutral', '추세가 약해 방향을 말하기 어려워요.']
        : plus > minus
          ? ['buy', '추세가 뚜렷하고 오르는 쪽이 우세해요.']
          : ['sell', '추세가 뚜렷하고 내리는 쪽이 우세해요.'],
    ),
  ];

  const maRow = (name: string, value: number | null) =>
    row(name, value, (v) =>
      close > v ? ['buy', '종가가 이 평균선보다 높아요.'] : close < v ? ['sell', '종가가 이 평균선보다 낮아요.'] : ['neutral', '종가가 이 평균선과 같아요.'],
    );
  const mas = MA_LENGTHS.flatMap((n) => [maRow(`SMA(${n})`, last(sma(closes, n))), maRow(`EMA(${n})`, last(ema(closes, n)))]);

  const all = [...oscillators, ...mas].filter((r) => r.value !== null);
  const counts: Record<Verdict, number> = { buy: 0, sell: 0, neutral: 0 };
  for (const r of all) counts[r.verdict]++;
  const scores = { osc: score(oscillators), ma: score(mas), all: score(all) };

  const atrV = last(atr(candles));
  const ema20 = last(ema(closes, 20));
  const { candidate, reason } = judgeCandidate(scores.all, close, ema20, rsiV, macdV);
  const plan =
    candidate === 'buy' && atrV
      ? { entry: close, stop: round(close - 2 * atrV), target: round(close + 4 * atrV) }
      : undefined;

  return { bars: candles.length, oscillators, mas, counts, scores, candidate, reason, plan, atr: atrV };
}

// 매매 후보: 종합 평가 방향에 더해 20봉 평균선, RSI 구간, MACD 가 모두 같은 쪽일 때만 후보로 본다.
function judgeCandidate(
  all: number,
  close: number,
  ema20: number | null,
  rsiV: number | null,
  macdV: number | null,
): Pick<Analysis, 'candidate' | 'reason'> {
  if (ema20 === null || rsiV === null || macdV === null) {
    return { candidate: 'watch', reason: '판정에 필요한 봉이 아직 부족해요.' };
  }
  if (Math.abs(all) <= 0.1) {
    return { candidate: 'watch', reason: '여러 지표를 합친 평가가 중립이라 한쪽 방향이 뚜렷하지 않아요.' };
  }
  const up = all > 0;
  const word = up ? '상승' : '하락';
  const [lo, hi] = up ? [55, 70] : [30, 45];
  const r = rsiV.toFixed(1);
  const miss = (text: string) => ({ candidate: 'watch' as const, reason: `종합 평가는 ${word} 쪽이지만 추가 조건이 맞지 않아요. ${text}` });

  if (up ? close <= ema20 : close >= ema20) return miss(`종가가 20봉 평균선 ${up ? '아래' : '위'}에 있어요.`);
  if (rsiV < lo || rsiV > hi) return miss(`가격의 힘을 보는 RSI가 ${r}로 기준(${lo}~${hi}) 밖이에요.`);
  if (up ? macdV <= 0 : macdV >= 0) return miss(`짧은 평균선이 긴 평균선보다 ${up ? '낮아요' : '높아요'}.`);
  return {
    candidate: up ? 'buy' : 'sell',
    reason: `종합 평가가 ${word} 쪽이고, 종가가 20봉 평균선 ${up ? '위' : '아래'}에 있어요. RSI ${r}이(가) 기준(${lo}~${hi}) 안이고, 짧은 평균선도 긴 평균선보다 ${up ? '높아요' : '낮아요'}.`,
  };
}
