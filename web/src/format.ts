const nf = new Intl.NumberFormat('ko-KR');

export const won = (n: number) => nf.format(Math.round(n));

export const signed = (n: number) => `${n > 0 ? '+' : ''}${nf.format(Math.round(n))}`;

export const pct = (rate: number) => `${rate > 0 ? '+' : ''}${(rate * 100).toFixed(2)}%`;

// 국내 관례: 상승은 빨강, 하락은 파랑.
export const dir = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

export const time = (ms: number) =>
  new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
