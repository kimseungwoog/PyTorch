import { useEffect, useMemo, useState } from 'react';
import { forecast, type ForecastRow } from '../../../shared/forecast';
import { costProfile } from '../../../shared/profile';
import type { Candle } from '../../../shared/types';
import { pct, won } from '../format';
import { fetchCandles, useStore } from '../store';
import { Sheet } from './Modals';

const p2 = (v: number) => `${(v * 100).toFixed(2)}%`;
const day = (sec: number) => new Date(sec * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

// 선택 종목의 일봉을 넉넉히 불러온다.
function useDaily(): { stockName: string; candles: Candle[] | null; error: string } {
  const selected = useStore((s) => s.selected);
  const stock = useStore((s) => s.stocks.find((x) => x.symbol === s.selected));
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    fetchCandles(selected, '1d', 1_000)
      .then((c) => alive && setCandles(c))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [selected]);
  return { stockName: `${stock?.name ?? ''} ${selected}`, candles, error };
}

// ---------- 원가 분포 추정 ----------
export function CostModal() {
  const { stockName, candles, error } = useDaily();
  const [period, setPeriod] = useState(120);
  const [floatText, setFloatText] = useState('');
  const floatShares = Number(floatText.replace(/,/g, '')) || undefined;
  const p = useMemo(() => (candles ? costProfile(candles.slice(-period), floatShares) : null), [candles, period, floatShares]);

  const maxBin = p ? Math.max(...p.bins.map((b) => b.pct)) : 1;
  const span = p ? p.high - p.low || 1 : 1;
  const pos = (price: number) => `${Math.min(100, Math.max(0, ((price - p!.low) / span) * 100))}%`;

  return (
    <Sheet title="원가 분포 추정">
      <p className="sub">{stockName} · 일봉</p>
      <div className="filters">
        <label className="inline">
          관측 기간
          <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
            {[60, 120, 250, 500].map((n) => (
              <option key={n} value={n}>
                {n}봉
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          유통주식 수(주)
          <input className="search" inputMode="numeric" placeholder="선택 입력" value={floatText} onChange={(e) => setFloatText(e.target.value)} />
        </label>
      </div>
      <p className="sub">
        일봉의 고가~저가 사이에 거래량을 고르게 나눕니다. 유통주식 수를 입력하면 그날 회전율만큼 이전 물량을 줄입니다. 수익권 비중은
        기준일 종가보다 낮은 가격대에서 거래된 비율입니다.
      </p>
      {error && <div className="problem">{error}</div>}
      {!p && !error && <div className="empty">일봉을 불러오는 중…</div>}
      {p && (
        <>
          <div className="panel-title small">
            {day(p.from)} ~ {day(p.to)} · 일봉 {p.bars}개 · 누적 거래량 {won(p.totalVolume)}
          </div>
          <div className="cost-top">
            <div className="body-chart">
              <div className="sub">
                기준일 종가 <b className="warn">{won(p.close)}원</b> · {p.closeZone} 부근
              </div>
              <div className="body-row">
                <svg viewBox="0 0 60 200" className="figure" aria-hidden>
                  <circle cx="30" cy="14" r="12" />
                  <rect x="25" y="24" width="10" height="8" />
                  <path d="M12 32 h36 a6 6 0 0 1 6 6 v52 h-8 v-44 h-3 v54 h-26 v-54 h-3 v44 h-8 v-52 a6 6 0 0 1 6 -6z" />
                  <rect x="17" y="100" width="11" height="96" rx="3" />
                  <rect x="32" y="100" width="11" height="96" rx="3" />
                  <line x1="0" x2="60" y1={200 - ((p.close - p.low) / span) * 200} y2={200 - ((p.close - p.low) / span) * 200} className="close-line" />
                </svg>
                <ul className="zones">
                  {p.zones.map((z) => (
                    <li key={z.name} style={{ flex: (z.hi - z.lo) / span }} className={z.name === p.closeZone ? 'here' : ''}>
                      <b>{z.name}</b>{' '}
                      <span className="sub">
                        {won(z.lo)} ~ {won(z.hi)}원 · 거래량 {p2(z.pct)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="sub">머리는 관측 최고가, 발은 관측 최저가입니다.</div>
            </div>
            <div className="cost-stats">
              <div className="stat-cards">
                <div>
                  <span className="sub">손실권 비율</span>
                  <b>{p2(p.abovePct)}</b>
                  <span className="sub">종가보다 비싸게 거래된 물량</span>
                </div>
                <div>
                  <span className="sub">수익권 비율</span>
                  <b>{p2(p.belowPct)}</b>
                  <span className="sub">종가보다 싸게 거래된 물량</span>
                </div>
                <div>
                  <span className="sub">평균 거래 가격 대비 종가</span>
                  <b className={p.close >= p.avgPrice ? 'up' : 'down'}>{pct(p.close / p.avgPrice - 1)}</b>
                  <span className="sub">평균 {won(p.avgPrice)}원</span>
                </div>
              </div>
              <div className="range-bar">
                <span className="band wide" style={{ left: pos(p.p5), right: `calc(100% - ${pos(p.p95)})` }} />
                <span className="band core" style={{ left: pos(p.p15), right: `calc(100% - ${pos(p.p85)})` }} />
                <span className="mark avg" style={{ left: pos(p.avgPrice) }} />
                <span className="mark close" style={{ left: pos(p.close) }} />
              </div>
              <div className="range-ends sub">
                <span>{won(p.low)}원</span>
                <span>{won(p.high)}원</span>
              </div>
              <p className="sub">
                옅은 띠는 거래량의 중앙 90%, 진한 띠는 중앙 70%입니다. <b className="avg-text">파란 선</b>은 평균 거래 가격,{' '}
                <b className="warn">주황 선</b>은 기준일 종가입니다.
              </p>
              <dl className="summary">
                <dt>중앙 70% 구간</dt>
                <dd>
                  {won(p.p15)} ~ {won(p.p85)}원
                </dd>
                <dt>중앙 90% 구간</dt>
                <dd>
                  {won(p.p5)} ~ {won(p.p95)}원
                </dd>
                <dt>가장 집중된 가격대</dt>
                <dd>
                  {won(p.mode.lo)} ~ {won(p.mode.hi)}원
                </dd>
              </dl>
            </div>
          </div>

          <div className="panel-title small">가격대별 거래량 비중</div>
          <ul className="hbars">
            {p.bins.map((b) => (
              <li key={b.lo} className={p.close >= b.lo && p.close < b.hi ? 'here' : ''}>
                <span className="hl">
                  {won(b.lo)} ~ {won(b.hi)}
                </span>
                <span className="track">
                  <span style={{ width: `${(b.pct / maxBin) * 100}%` }} />
                </span>
                <span className="hv">{p2(b.pct)}</span>
              </li>
            ))}
          </ul>
          <p className="disclaimer">실제 손실·수익 투자자 인원 비율은 계좌별 자료가 없어 알 수 없습니다. 거래량 기준 추정입니다.</p>
        </>
      )}
    </Sheet>
  );
}

// ---------- 주가 경로 추정 ----------
const STATUS: Record<ForecastRow['status'], [string, string]> = {
  ok: ['표시 가능', 'ok'],
  'range-unverified': ['범위 검증 기준 미달', 'warn'],
  unverified: ['미검증 참고', 'warn'],
};

// 주말을 건너뛴 예상 날짜. 휴장일에 따라 달라질 수 있다.
function addBusinessDays(fromSec: number, bars: number): string {
  const d = new Date(fromSec * 1000);
  for (let left = bars; left > 0; ) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = new Date(d.getTime() + 9 * 3_600_000).getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return day(d.getTime() / 1000);
}

export function ForecastModal() {
  const { stockName, candles, error } = useDaily();
  const rows = useMemo(() => (candles ? forecast(candles.map((c) => c.close)) : null), [candles]);

  const chart = useMemo(() => {
    if (!candles || !rows) return null;
    const past = candles.slice(-120).map((c) => c.close);
    const maxH = rows[rows.length - 1].horizon;
    const values = [...past, ...rows.flatMap((r) => [r.center, r.lo ?? r.center, r.hi ?? r.center])];
    const [lo, hi] = [Math.min(...values), Math.max(...values)];
    const W = 640;
    const H = 240;
    const x = (i: number) => 8 + (i / (past.length - 1 + maxH)) * (W - 70);
    const y = (v: number) => 12 + (1 - (v - lo) / (hi - lo || 1)) * (H - 36);
    return { past, lo, hi, W, H, x, y };
  }, [candles, rows]);

  return (
    <Sheet title="주가 경로 추정">
      <p className="sub">
        {stockName} · 일봉 {candles?.length ?? 0}개
      </p>
      <p className="sub">
        직전 20봉의 흐름이 지금과 비슷했던 과거 시점을 더 크게 반영해, 그 뒤 21·63·126봉(약 1·3·6개월) 동안 실제로 어떻게
        움직였는지를 모은 통계입니다. 점선은 세 시점의 중심값을 이은 안내선이며 매일의 예측값이 아닙니다.
      </p>
      {error && <div className="problem">{error}</div>}
      {!rows && !error && <div className="empty">계산하는 중…</div>}
      {rows && chart && candles && (
        <>
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="forecast-chart" role="img" aria-label="과거 종가와 추정 경로">
            {[0, 0.5, 1].map((f) => {
              const v = chart.lo + (chart.hi - chart.lo) * f;
              return (
                <g key={f}>
                  <line x1="8" x2={chart.W - 62} y1={chart.y(v)} y2={chart.y(v)} className="grid" />
                  <text x={chart.W - 58} y={chart.y(v) + 4}>
                    {won(v)}
                  </text>
                </g>
              );
            })}
            <polyline className="past" points={chart.past.map((v, i) => `${chart.x(i)},${chart.y(v)}`).join(' ')} />
            <line className="now" x1={chart.x(chart.past.length - 1)} x2={chart.x(chart.past.length - 1)} y1="8" y2={chart.H - 20} />
            <polyline
              className="path"
              points={[
                `${chart.x(chart.past.length - 1)},${chart.y(chart.past[chart.past.length - 1])}`,
                ...rows.map((r) => `${chart.x(chart.past.length - 1 + r.horizon)},${chart.y(r.center)}`),
              ].join(' ')}
            />
            {rows.map((r) => {
              const cx = chart.x(chart.past.length - 1 + r.horizon);
              return (
                <g key={r.horizon} className={STATUS[r.status][1]}>
                  {r.lo !== null && r.hi !== null && r.status !== 'range-unverified' && (
                    <line className="range" x1={cx} x2={cx} y1={chart.y(r.lo)} y2={chart.y(r.hi)} />
                  )}
                  <circle cx={cx} cy={chart.y(r.center)} r="4" />
                </g>
              );
            })}
          </svg>
          <p className="sub">
            <b className="ok-text">보라색</b>은 검증 기준을 통과한 추정, <b className="warn">주황색</b>은 통과하지 못한 참고값입니다.
            세로 막대는 예상 범위(과거 결과의 80%가 들어간 구간)입니다.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="left">기간</th>
                  <th>중심 추정</th>
                  <th>예상 범위</th>
                  <th>검증 표본</th>
                  <th>모델 / 현재가 유지 오차</th>
                  <th>범위 포함률</th>
                  <th className="left">상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.horizon} className="static">
                    <td className="left">
                      {addBusinessDays(candles[candles.length - 1].time, r.horizon)}경 ({r.horizon}봉 뒤)
                    </td>
                    <td>
                      {won(r.center)} <span className="sub">({pct(r.center / candles[candles.length - 1].close - 1)})</span>
                    </td>
                    <td>{r.lo !== null && r.hi !== null && r.status !== 'range-unverified' ? `${won(r.lo)} ~ ${won(r.hi)}` : '보류'}</td>
                    <td>{r.samples}</td>
                    <td>{r.modelErr !== null ? `${p2(r.modelErr)} / ${p2(r.holdErr!)}` : '—'}</td>
                    <td>{r.coverage !== null ? `${p2(r.coverage)} (목표 80%)` : '—'}</td>
                    <td className={`left ${STATUS[r.status][1]}-text`}>{STATUS[r.status][0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="disclaimer">
            오차는 로그수익률의 평균 절대 오차입니다. 검증은 서로 겹치지 않는 과거 구간에서 그 시점까지의 자료만 써서 계산합니다. 표본이
            20개 미만이거나 "현재가가 그대로 유지된다"고 본 것보다 오차가 크면 미검증으로 표시합니다. 통계적 참고값이며 미래 가격을
            보장하지 않습니다.
          </p>
        </>
      )}
    </Sheet>
  );
}
