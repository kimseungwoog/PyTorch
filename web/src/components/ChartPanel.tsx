import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  LineSeries,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { applyTick, KST_OFFSET_SEC } from '../../../shared/market';
import type { Candle, Interval } from '../../../shared/types';
import { dir, pct, signed, won } from '../format';
import { fetchCandles, useStore } from '../store';

const INTERVALS: Array<[Interval, string]> = [
  ['1m', '1분'],
  ['5m', '5분'],
  ['15m', '15분'],
  ['1h', '1시간'],
  ['1d', '일'],
];
const MA = [
  { n: 5, color: '#f5a623' },
  { n: 20, color: '#a66cff' },
  { n: 60, color: '#2bb673' },
];
const UP = '#f04452';
const DOWN = '#3182f6';

// 차트 축을 한국 시간으로 보이게 한다.
const t = (c: Candle) => (c.time + KST_OFFSET_SEC) as UTCTimestamp;

function smaAt(candles: Candle[], i: number, n: number): number | undefined {
  if (i < n - 1) return undefined;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) sum += candles[k].close;
  return sum / n;
}

export function ChartPanel() {
  const selected = useStore((s) => s.selected);
  const stock = useStore((s) => s.stocks.find((x) => x.symbol === s.selected));
  const quote = useStore((s) => s.quotes[s.selected]);
  const [interval, setIntervalKey] = useState<Interval>('5m');
  const [showMa, setShowMa] = useState(true);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current || !selected) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8b93a1', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: '#1c2028' }, horzLines: { color: '#1c2028' } },
      rightPriceScale: { borderColor: '#262b35' },
      timeScale: { borderColor: '#262b35', timeVisible: interval !== '1d', secondsVisible: false },
      localization: { priceFormatter: (p: number) => won(p) },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });
    const maSeries: Array<ISeriesApi<'Line'>> = showMa
      ? MA.map((m) =>
          chart.addSeries(LineSeries, {
            color: m.color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          }),
        )
      : [];
    const volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' } }, 1);
    chart.panes()[1]?.setHeight(70);

    const volBar = (c: Candle) => ({
      time: t(c),
      value: c.volume,
      color: c.close >= c.open ? 'rgba(240,68,82,.5)' : 'rgba(49,130,246,.5)',
    });

    let candles: Candle[] = [];
    let lastVolume: number | undefined;
    let unsubscribe = () => {};
    let disposed = false;

    void fetchCandles(selected, interval).then((data) => {
      if (disposed) return;
      candles = data;
      candleSeries.setData(candles.map((c) => ({ ...c, time: t(c) })));
      volumeSeries.setData(candles.map(volBar));
      maSeries.forEach((s, mi) =>
        s.setData(
          candles.flatMap((c, i) => {
            const v = smaAt(candles, i, MA[mi].n);
            return v === undefined ? [] : [{ time: t(c), value: v }];
          }),
        ),
      );

      // 이후 들어오는 체결을 마지막 봉에 반영한다.
      unsubscribe = useStore.subscribe((state) => {
        const q = state.quotes[selected];
        if (!q || q.volume === lastVolume) return;
        const delta = lastVolume === undefined ? 0 : Math.max(0, q.volume - lastVolume);
        lastVolume = q.volume;
        const last = applyTick(candles, interval, q.price, delta, Math.floor(q.ts / 1000));
        candleSeries.update({ ...last, time: t(last) });
        volumeSeries.update(volBar(last));
        maSeries.forEach((s, mi) => {
          const v = smaAt(candles, candles.length - 1, MA[mi].n);
          if (v !== undefined) s.update({ time: t(last), value: v });
        });
      });
    });

    return () => {
      disposed = true;
      unsubscribe();
      chart.remove();
    };
  }, [selected, interval, showMa]);

  return (
    <section className="panel chart-panel">
      <div className="quote-head">
        <div>
          <div className="title">
            {stock?.name} <span className="sub">{stock?.symbol}</span>
          </div>
          {quote && (
            <div className={`big ${dir(quote.change)}`}>
              <span className="price">{won(quote.price)}</span>
              <span className="chg">
                {signed(quote.change)} ({pct(quote.changeRate)})
              </span>
            </div>
          )}
        </div>
        {quote && (
          <dl className="stats">
            <dt>시가</dt>
            <dd>{won(quote.open)}</dd>
            <dt>고가</dt>
            <dd className="up">{won(quote.high)}</dd>
            <dt>저가</dt>
            <dd className="down">{won(quote.low)}</dd>
            <dt>거래량</dt>
            <dd>{won(quote.volume)}</dd>
          </dl>
        )}
      </div>
      <div className="toolbar">
        {INTERVALS.map(([key, label]) => (
          <button key={key} className={`chip ${interval === key ? 'on' : ''}`} onClick={() => setIntervalKey(key)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        <button className={`chip ${showMa ? 'on' : ''}`} onClick={() => setShowMa(!showMa)}>
          이평선
        </button>
        {showMa &&
          MA.map((m) => (
            <span key={m.n} className="legend" style={{ color: m.color }}>
              {m.n}
            </span>
          ))}
      </div>
      <div className="chart" ref={el} />
    </section>
  );
}
