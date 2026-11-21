import { donchian, rsi, sma, supertrend } from './indicators';
import type { Candle } from './types';

// 전략 전광판: 널리 알려진 매매 방식을 단순한 모의 규칙으로 옮겨 과거 봉에 다시 돌려 본다.
// 매수만 하는(롱 전용) 모의 리플레이이며, 수수료·세금·체결 지연은 반영하지 않는다.

export interface Signal {
  index: number;
  time: number;
  type: 'entry' | 'exit';
  price: number;
  reason: string;
}

export interface ReplayResult {
  signals: Signal[];
  trades: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number; // 매 거래에 전액을 넣었다고 가정한 누적 수익률
  holding: boolean; // 마지막 진입이 아직 청산되지 않음
}

export interface Strategy {
  id: string;
  name: string;
  style: string;
  summary: string;
  buyRule: string;
  sellRule: string;
  example: string;
  note: string;
  minBars: number;
  // enter/exit 는 i번째 봉이 끝난 시점에 판단한다. 이유 문자열을 돌려주면 신호가 난 것이다.
  build(c: Candle[]): {
    enter(i: number): string | null;
    exit(i: number, entryIndex: number, entryPrice: number): string | null;
  };
}

export const STRATEGIES: Strategy[] = [
  {
    id: 'bnf-25',
    name: 'B.N.F. · 25일선 과매도 반등',
    style: '역발상 · 일봉',
    summary: '일본 개인 투자자 B.N.F.(고테가와 다카시)가 25일선에서 크게 밀린 종목의 반등을 노렸다고 알려진 방식입니다.',
    buyRule: '전날 종가가 25일 평균보다 15% 이상 낮았고, 오늘 종가가 전날 고가를 넘으면 매수.',
    sellRule: '25일선까지 회복하거나, 진입가에서 5% 이상 하락하거나, 진입 후 5봉이 지나면 매도.',
    example: '25일 평균이 100이고 어제 종가가 84, 고가가 87이라면 오늘 종가 88에서 조건을 충족합니다.',
    note: '15%, 반등 확인, 손절과 보유 기간은 이 앱의 모의 규칙입니다. 지수와 업종 흐름은 따로 확인해야 합니다.',
    minBars: 26,
    build(c) {
      const ma = sma(c.map((x) => x.close), 25);
      return {
        enter: (i) =>
          ma[i - 1] !== null && c[i - 1].close <= ma[i - 1]! * 0.85 && c[i].close > c[i - 1].high ? '과매도 뒤 전일 고가 돌파' : null,
        exit: (i, at, price) =>
          ma[i] !== null && c[i].close >= ma[i]! ? '25일선 회복' : c[i].close <= price * 0.95 ? '손절 -5%' : i - at >= 5 ? '5봉 경과' : null,
      };
    },
  },
  {
    id: 'turtle-20',
    name: '터틀 · 20일 고가 돌파',
    style: '추세 추종 · 일봉',
    summary: '리처드 데니스의 터틀 트레이더들이 썼다고 알려진 돈치안 채널 돌파 방식입니다.',
    buyRule: '종가가 직전 20봉의 최고가를 넘으면 매수.',
    sellRule: '종가가 직전 10봉의 최저가 아래로 내려가면 매도.',
    example: '직전 20봉 최고가가 100일 때 오늘 종가가 101이면 매수, 이후 직전 10봉 최저가 92를 깨면 매도합니다.',
    note: '원래 규칙의 변동성 기반 수량 조절과 분할 진입은 뺀 단순화 버전입니다.',
    minBars: 21,
    build(c) {
      const entry = donchian(c, 20);
      const out = donchian(c, 10);
      return {
        enter: (i) => (entry.upper[i - 1] !== null && c[i].close > entry.upper[i - 1]! ? '20봉 고가 돌파' : null),
        exit: (i) => (out.lower[i - 1] !== null && c[i].close < out.lower[i - 1]! ? '10봉 저가 이탈' : null),
      };
    },
  },
  {
    id: 'golden-cross',
    name: '골든크로스 · 20/60 이동평균',
    style: '추세 추종',
    summary: '짧은 평균선이 긴 평균선을 위로 넘을 때 사고, 아래로 내려갈 때 파는 가장 기본적인 추세 방식입니다.',
    buyRule: '20봉 평균선이 60봉 평균선을 아래에서 위로 넘으면 매수.',
    sellRule: '20봉 평균선이 60봉 평균선 아래로 내려가면 매도.',
    example: '어제는 20봉 평균 99 · 60봉 평균 100, 오늘은 20봉 평균 101 · 60봉 평균 100 이면 매수합니다.',
    note: '횡보장에서는 잦은 손실 신호가 납니다.',
    minBars: 61,
    build(c) {
      const closes = c.map((x) => x.close);
      const fast = sma(closes, 20);
      const slow = sma(closes, 60);
      const diff = (i: number) => (fast[i] !== null && slow[i] !== null ? fast[i]! - slow[i]! : null);
      return {
        enter: (i) => (diff(i - 1) !== null && diff(i - 1)! <= 0 && diff(i)! > 0 ? '골든크로스' : null),
        exit: (i) => (diff(i) !== null && diff(i)! < 0 ? '데드크로스' : null),
      };
    },
  },
  {
    id: 'rsi-rebound',
    name: 'RSI · 과매도 되돌림',
    style: '역발상',
    summary: 'RSI 가 과매도 구간에서 벗어나는 순간을 반등 신호로 보는 방식입니다.',
    buyRule: 'RSI(14)가 30 아래에 있다가 30 위로 올라오면 매수.',
    sellRule: 'RSI 가 55 이상으로 회복하거나 진입가에서 7% 이상 하락하면 매도.',
    example: '어제 RSI 28, 오늘 RSI 32 면 매수합니다.',
    note: '강한 하락 추세에서는 과매도가 오래 이어질 수 있습니다.',
    minBars: 16,
    build(c) {
      const r = rsi(c.map((x) => x.close));
      return {
        enter: (i) => (r[i - 1] !== null && r[i - 1]! < 30 && r[i]! >= 30 ? 'RSI 30 회복' : null),
        exit: (i, _at, price) => (r[i] !== null && r[i]! >= 55 ? 'RSI 55 회복' : c[i].close <= price * 0.93 ? '손절 -7%' : null),
      };
    },
  },
  {
    id: 'supertrend',
    name: '슈퍼트렌드 · 추세 전환',
    style: '추세 추종',
    summary: '변동성(ATR)으로 만든 기준선을 가격이 넘나드는 시점을 추세 전환으로 보는 방식입니다.',
    buyRule: '슈퍼트렌드(10, 3)가 하락에서 상승으로 바뀌면 매수.',
    sellRule: '상승에서 하락으로 바뀌면 매도.',
    example: '종가가 위쪽 기준선을 넘어서면 기준선이 가격 아래로 내려오며 상승 전환으로 봅니다.',
    note: '변동성이 큰 종목일수록 신호가 늦습니다.',
    minBars: 12,
    build(c) {
      const st = supertrend(c);
      return {
        enter: (i) => (st.line[i - 1] !== null && !st.up[i - 1] && st.up[i] ? '상승 전환' : null),
        exit: (i) => (st.line[i] !== null && !st.up[i] ? '하락 전환' : null),
      };
    },
  },
];

export function replay(strategy: Strategy, candles: Candle[]): ReplayResult {
  const signals: Signal[] = [];
  const returns: number[] = [];
  let entryIndex = -1;
  let entryPrice = 0;

  if (candles.length >= strategy.minBars) {
    const rules = strategy.build(candles);
    for (let i = 1; i < candles.length; i++) {
      const { close, time } = candles[i];
      if (entryIndex < 0) {
        const reason = rules.enter(i);
        if (reason) {
          entryIndex = i;
          entryPrice = close;
          signals.push({ index: i, time, type: 'entry', price: close, reason });
        }
      } else {
        const reason = rules.exit(i, entryIndex, entryPrice);
        if (reason) {
          returns.push(close / entryPrice - 1);
          signals.push({ index: i, time, type: 'exit', price: close, reason });
          entryIndex = -1;
        }
      }
    }
  }

  const wins = returns.filter((r) => r > 0).length;
  return {
    signals,
    trades: returns.length,
    winRate: returns.length ? wins / returns.length : 0,
    avgReturn: returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0,
    totalReturn: returns.reduce((a, r) => a * (1 + r), 1) - 1,
    holding: entryIndex >= 0,
  };
}
