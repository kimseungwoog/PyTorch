import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IPriceLine,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import {
  adx,
  bollinger,
  donchian,
  ema,
  macd,
  mfi,
  rsi,
  sma,
  stochK,
  supertrend,
  vwap,
  type Num,
} from '../../../shared/indicators';
import { bucketStart, KST_OFFSET_SEC, roundToTick } from '../../../shared/market';
import { replay, STRATEGIES } from '../../../shared/strategies';
import type { Candle, Interval } from '../../../shared/types';
import { dir, pct, signed, won } from '../format';
import { useStore, type IndicatorConfig } from '../store';

export const INTERVALS: Array<[Interval, string]> = [
  ['1m', '1분'],
  ['5m', '5분'],
  ['15m', '15분'],
  ['1h', '1시간'],
  ['4h', '4시간'],
  ['1d', '일'],
  ['1w', '주'],
];

const UP = '#f04452';
const DOWN = '#3182f6';
const PALETTE = ['#f5a623', '#a66cff', '#2bb673', '#ff7ab6', '#4cc9f0', '#e0e0e0'];
const SUB_HEIGHT = 92;

// 차트 축을 한국 시간으로 보이게 한다.
const t = (c: Candle) => (c.time + KST_OFFSET_SEC) as UTCTimestamp;

type Feed = (candles: Candle[]) => void;
type Chart = ReturnType<typeof createChart>;

// 설정에 맞춰 시리즈를 만들고, 봉이 바뀔 때 다시 채워 넣는 함수 목록을 돌려준다.
function buildSeries(chart: Chart, cfg: IndicatorConfig, legend: Array<[string, string]>): Feed[] {
  const feeds: Feed[] = [];
  let pane = 0;

  const line = (paneIndex: number, color: string, label?: string, dashed = false) => {
    const s = chart.addSeries(
      LineSeries,
      {
        color,
        lineWidth: 1,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: paneIndex > 0,
        crosshairMarkerVisible: false,
      },
      paneIndex,
    );
    if (label) legend.push([label, color]);
    return s;
  };
  const fill = (s: ISeriesApi<'Line'>, candles: Candle[], values: Num[]) =>
    s.setData(candles.flatMap((c, i) => (values[i] === null ? [] : [{ time: t(c), value: values[i]! }])));
  const closes = (c: Candle[]) => c.map((x) => x.close);
  const guide = (s: ISeriesApi<'Line'>, ...levels: number[]) =>
    levels.forEach((price) =>
      s.createPriceLine({ price, color: '#3a404c', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false }),
    );

  if (cfg.ma) {
    cfg.maLengths.forEach((n, i) => {
      const s = line(0, PALETTE[i % PALETTE.length], `MA${n}`);
      feeds.push((c) => fill(s, c, sma(closes(c), n)));
    });
  }
  if (cfg.ema) {
    [20, 50].forEach((n, i) => {
      const s = line(0, ['#4cc9f0', '#ff7ab6'][i], `EMA${n}`, true);
      feeds.push((c) => fill(s, c, ema(closes(c), n)));
    });
  }
  if (cfg.boll) {
    const [u, m, l] = [line(0, '#7f8ea3', 'BOLL(20,2)'), line(0, '#7f8ea3', undefined, true), line(0, '#7f8ea3')];
    feeds.push((c) => {
      const b = bollinger(closes(c));
      fill(u, c, b.upper);
      fill(m, c, b.mid);
      fill(l, c, b.lower);
    });
  }
  if (cfg.donchian) {
    const [u, l] = [line(0, '#2bb673', 'DC(20)'), line(0, '#2bb673')];
    feeds.push((c) => {
      const d = donchian(c);
      fill(u, c, d.upper);
      fill(l, c, d.lower);
    });
  }
  if (cfg.vwap) {
    const s = line(0, '#ffd166', 'VWAP');
    feeds.push((c) => fill(s, c, vwap(c)));
  }
  if (cfg.supertrend) {
    const [upS, downS] = [line(0, UP, 'Supertrend(10,3)'), line(0, DOWN)];
    feeds.push((c) => {
      const st = supertrend(c);
      fill(upS, c, st.line.map((v, i) => (st.up[i] ? v : null)));
      fill(downS, c, st.line.map((v, i) => (st.up[i] ? null : v)));
    });
  }

  if (cfg.volume) {
    const p = ++pane;
    const s = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false }, p);
    feeds.push((c) =>
      s.setData(
        c.map((x) => ({
          time: t(x),
          value: x.volume,
          color: x.close >= x.open ? 'rgba(240,68,82,.5)' : 'rgba(49,130,246,.5)',
        })),
      ),
    );
  }
  if (cfg.rsi) {
    const s = line(++pane, '#4c8dff', 'RSI(14)');
    guide(s, 30, 70);
    feeds.push((c) => fill(s, c, rsi(closes(c))));
  }
  if (cfg.macd) {
    const p = ++pane;
    const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, p);
    const [m, sig] = [line(p, '#4c8dff', 'MACD(12,26,9)'), line(p, '#f5a623')];
    feeds.push((c) => {
      const r = macd(closes(c));
      fill(m, c, r.macd);
      fill(sig, c, r.signal);
      hist.setData(
        c.flatMap((x, i) =>
          r.hist[i] === null
            ? []
            : [{ time: t(x), value: r.hist[i]!, color: r.hist[i]! >= 0 ? 'rgba(240,68,82,.5)' : 'rgba(49,130,246,.5)' }],
        ),
      );
    });
  }
  if (cfg.adx) {
    const p = ++pane;
    const [a, plus, minus] = [line(p, '#f5a623', 'ADX·DI(14)'), line(p, UP), line(p, DOWN)];
    guide(a, 20);
    feeds.push((c) => {
      const r = adx(c);
      fill(a, c, r.adx);
      fill(plus, c, r.plusDI);
      fill(minus, c, r.minusDI);
    });
  }
  if (cfg.stoch) {
    const s = line(++pane, '#a66cff', 'Stoch %K(14)');
    guide(s, 20, 80);
    feeds.push((c) => fill(s, c, stochK(c)));
  }
  if (cfg.mfi) {
    const s = line(++pane, '#2bb673', 'MFI(14)');
    guide(s, 20, 80);
    feeds.push((c) => fill(s, c, mfi(c)));
  }

  chart.panes().forEach((p, i) => i > 0 && p.setHeight(SUB_HEIGHT));
  return feeds;
}

const SUB_KEYS = ['volume', 'rsi', 'macd', 'adx', 'stoch', 'mfi'] as const;

export function ChartPanel() {
  const selected = useStore((s) => s.selected);
  const stock = useStore((s) => s.stocks.find((x) => x.symbol === s.selected));
  const quote = useStore((s) => s.quotes[s.selected]);
  const interval = useStore((s) => s.interval);
  const indicators = useStore((s) => s.indicators);
  const strategyId = useStore((s) => s.strategyId);
  const drawMode = useStore((s) => s.drawMode);
  const hasDrawings = useStore((s) => (s.drawings[s.selected] ?? []).length > 0);
  const { setChartInterval, openModal, setDrawMode, clearDrawings } = useStore();
  const el = useRef<HTMLDivElement>(null);
  const legendEl = useRef<HTMLDivElement>(null);

  const subPanes = SUB_KEYS.filter((k) => indicators[k]).length;
  const strategy = STRATEGIES.find((s) => s.id === strategyId);

  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8b93a1',
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: '#262b35' },
      },
      grid: { vertLines: { color: '#1c2028' }, horzLines: { color: '#1c2028' } },
      rightPriceScale: { borderColor: '#262b35' },
      timeScale: { borderColor: '#262b35', timeVisible: !['1d', '1w'].includes(interval), secondsVisible: false },
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
    const legend: Array<[string, string]> = [];
    const feeds = buildSeries(chart, indicators, legend);
    const markers = createSeriesMarkers(candleSeries, []);
    if (legendEl.current) {
      legendEl.current.replaceChildren(
        ...legend.map(([label, color]) => {
          const span = document.createElement('span');
          span.textContent = label;
          span.style.color = color;
          return span;
        }),
      );
    }

    let shown: Candle[] | undefined;
    const render = () => {
      const { candles } = useStore.getState();
      candleSeries.setData(candles.map((c) => ({ ...c, time: t(c) })));
      for (const feed of feeds) feed(candles);
      const active = STRATEGIES.find((s) => s.id === useStore.getState().strategyId);
      markers.setMarkers(
        active
          ? replay(active, candles).signals.map(
              (s): SeriesMarker<Time> => ({
                time: (s.time + KST_OFFSET_SEC) as UTCTimestamp,
                position: s.type === 'entry' ? 'belowBar' : 'aboveBar',
                shape: s.type === 'entry' ? 'arrowUp' : 'arrowDown',
                color: s.type === 'entry' ? '#2bb673' : '#ff5c7a',
                text: s.type === 'entry' ? '매수' : '매도',
              }),
            )
          : [],
      );
      // 새로 불러온 봉이면 최근 구간으로 화면을 맞춘다.
      if (candles !== shown && candles.length) {
        shown = candles;
        chart.timeScale().setVisibleLogicalRange({ from: candles.length - 140, to: candles.length + 4 });
      }
    };
    render();

    // 내 평단가, 미체결 주문, 자동 매도 가격, 직접 그린 선을 차트에 올린다.
    let priceLines: IPriceLine[] = [];
    let trendSeries: Array<ISeriesApi<'Line'>> = [];
    const syncLines = () => {
      const s = useStore.getState();
      priceLines.forEach((l) => candleSeries.removePriceLine(l));
      trendSeries.forEach((x) => chart.removeSeries(x));
      priceLines = [];
      trendSeries = [];
      const add = (price: number, color: string, title: string, style = LineStyle.Dashed) =>
        priceLines.push(candleSeries.createPriceLine({ price, color, title, lineWidth: 1, lineStyle: style, axisLabelVisible: true }));
      const holding = s.holdings.find((h) => h.symbol === selected);
      if (holding) add(holding.avgPrice, '#ffd166', `평단 ${holding.qty}주`, LineStyle.Solid);
      for (const o of s.orders) {
        if (o.status === 'open' && o.symbol === selected) add(o.price!, o.side === 'buy' ? UP : DOWN, `${o.side === 'buy' ? '매수' : '매도'} ${o.qty}주`);
      }
      for (const b of s.brackets) {
        if (b.symbol !== selected) continue;
        if (b.stopPrice) add(b.stopPrice, DOWN, '손절', LineStyle.Dotted);
        if (b.takePrice) add(b.takePrice, UP, '익절', LineStyle.Dotted);
      }
      for (const d of s.drawings[selected] ?? []) {
        if (d.type === 'h') {
          add(d.price, '#e0e0e0', '', LineStyle.Solid);
          continue;
        }
        // 다른 주기에서 그린 선도 보이도록 현재 주기의 봉 시작 시각에 맞춘다.
        const a = bucketStart(d.t1, interval);
        const b = bucketStart(d.t2, interval);
        if (a === b) continue;
        const points = a < b ? [[a, d.p1], [b, d.p2]] : [[b, d.p2], [a, d.p1]];
        const ls = chart.addSeries(LineSeries, {
          color: '#e0e0e0',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => null,
        });
        ls.setData(points.map(([time, value]) => ({ time: (time + KST_OFFSET_SEC) as UTCTimestamp, value })));
        trendSeries.push(ls);
      }
    };
    syncLines();

    // 그리기: 수평선은 한 번, 추세선은 두 번 누른다.
    let pending: { t: number; p: number } | null = null;
    chart.subscribeClick((param) => {
      const s = useStore.getState();
      if (!s.drawMode || !param.point || (param.paneIndex ?? 0) !== 0) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null) return;
      if (s.drawMode === 'h') {
        s.addDrawing({ type: 'h', price: roundToTick(price) });
        return;
      }
      if (param.time === undefined) return;
      const time = (param.time as number) - KST_OFFSET_SEC;
      if (!pending) {
        pending = { t: time, p: price };
        s.toast('추세선의 끝점을 눌러 주세요.');
      } else {
        s.addDrawing({ type: 't', t1: pending.t, p1: pending.p, t2: time, p2: price });
        pending = null;
      }
    });

    let prev = useStore.getState();
    const unsubscribe = useStore.subscribe((s) => {
      if (s.candleRev !== prev.candleRev) render();
      if (s.holdings !== prev.holdings || s.orders !== prev.orders || s.brackets !== prev.brackets || s.drawings !== prev.drawings) {
        syncLines();
      }
      if (!s.drawMode) pending = null;
      prev = s;
    });

    return () => {
      unsubscribe();
      chart.remove();
    };
  }, [selected, interval, indicators, strategyId]);

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
          <button key={key} className={`chip ${interval === key ? 'on' : ''}`} onClick={() => setChartInterval(key)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        <button className={`chip ${drawMode === 'h' ? 'on' : ''}`} onClick={() => setDrawMode(drawMode === 'h' ? null : 'h')}>
          수평선
        </button>
        <button className={`chip ${drawMode === 't' ? 'on' : ''}`} onClick={() => setDrawMode(drawMode === 't' ? null : 't')}>
          추세선
        </button>
        {hasDrawings && (
          <button className="chip" onClick={clearDrawings}>
            선 지우기
          </button>
        )}
        <button className="chip" onClick={() => openModal('indicators')}>
          지표
        </button>
        <button className="chip" onClick={() => openModal('cost')}>
          원가 분포
        </button>
        <button className="chip" onClick={() => openModal('forecast')}>
          경로 추정
        </button>
      </div>
      <div className="chart-wrap">
        <div className="chart-legend">
          <div ref={legendEl} className="legend-items" />
          {strategy && <div className="legend-strategy">▲▼ {strategy.name} · 모의 화살표</div>}
        </div>
        {drawMode && <div className="draw-hint">{drawMode === 'h' ? '차트에서 가격을 누르면 수평선이 그려집니다.' : '차트에서 시작점과 끝점을 차례로 누르세요.'}</div>}
        <div className={`chart ${drawMode ? 'drawing' : ''}`} ref={el} style={{ height: 320 + subPanes * SUB_HEIGHT }} />
      </div>
    </section>
  );
}
