// 주가 경로 추정. 과거에서 "직전 20봉 수익률이 지금과 비슷했던 시점"을 더 크게 반영해
// 그 뒤 h봉 동안의 수익률 분포(10%·50%·90%)를 구한다.
// 검증은 과거 시점마다 그때까지의 자료만으로 같은 계산을 해 실제 결과와 비교한다.
// 통계적 참고값일 뿐 예측을 보장하지 않으며, 검증을 통과하지 못하면 화면에 그렇게 표시한다.

export interface ForecastRow {
  horizon: number; // 봉 수
  center: number; // 중심 추정 가격
  lo: number | null; // 예상 범위 (80% 목표)
  hi: number | null;
  samples: number; // 검증 표본 수
  modelErr: number | null; // 모델의 평균 절대 오차 (로그수익률)
  holdErr: number | null; // "현재가 그대로"라고 봤을 때의 오차
  coverage: number | null; // 예상 범위가 실제 값을 포함한 비율
  status: 'ok' | 'range-unverified' | 'unverified';
}

const MOMENTUM = 20;
const MIN_PAIRS = 30;
const MIN_SAMPLES = 20;

function weightedQuantile(items: Array<[number, number]>, q: number): number {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let acc = 0;
  for (const [v, w] of items) {
    acc += w / total;
    if (acc >= q) return v;
  }
  return items[items.length - 1][0];
}

// 시점 t 에서 h봉 뒤 로그수익률의 [10%, 50%, 90%] 분위. t 이후 자료는 쓰지 않는다.
function predictAt(lp: number[], t: number, h: number): [number, number, number] | null {
  const pairs: Array<{ m: number; f: number }> = [];
  for (let s = MOMENTUM; s + h <= t; s++) pairs.push({ m: lp[s] - lp[s - MOMENTUM], f: lp[s + h] - lp[s] });
  if (pairs.length < MIN_PAIRS || t < MOMENTUM) return null;
  const now = lp[t] - lp[t - MOMENTUM];
  const mean = pairs.reduce((a, p) => a + p.m, 0) / pairs.length;
  const sd = Math.sqrt(pairs.reduce((a, p) => a + (p.m - mean) ** 2, 0) / pairs.length) || 1e-9;
  const items = pairs
    .map((p): [number, number] => [p.f, Math.exp(-0.5 * ((p.m - now) / sd) ** 2) + 1e-6])
    .sort((a, b) => a[0] - b[0]);
  return [weightedQuantile(items, 0.1), weightedQuantile(items, 0.5), weightedQuantile(items, 0.9)];
}

export function forecast(closes: number[], horizons = [21, 63, 126]): ForecastRow[] {
  const lp = closes.map(Math.log);
  const n = lp.length;
  const close = closes[n - 1];

  return horizons.map((h) => {
    // 서로 겹치지 않는 과거 구간으로 검증한다.
    let samples = 0;
    let modelSum = 0;
    let holdSum = 0;
    let covered = 0;
    for (let t = n - 1 - h; t > 0; t -= h) {
      const p = predictAt(lp, t, h);
      if (!p) break;
      const real = lp[t + h] - lp[t];
      samples++;
      modelSum += Math.abs(real - p[1]);
      holdSum += Math.abs(real);
      if (real >= p[0] && real <= p[2]) covered++;
    }
    const modelErr = samples ? modelSum / samples : null;
    const holdErr = samples ? holdSum / samples : null;
    const coverage = samples ? covered / samples : null;

    const now = predictAt(lp, n - 1, h);
    const enough = samples >= MIN_SAMPLES;
    const centerOk = enough && modelErr! < holdErr!;
    const rangeOk = enough && Math.abs(coverage! - 0.8) <= 0.1;
    const status = centerOk && rangeOk ? 'ok' : centerOk ? 'range-unverified' : 'unverified';

    return {
      horizon: h,
      center: now ? close * Math.exp(now[1]) : close,
      lo: now ? close * Math.exp(now[0]) : null,
      hi: now ? close * Math.exp(now[2]) : null,
      samples,
      modelErr,
      holdErr,
      coverage,
      status,
    };
  });
}
