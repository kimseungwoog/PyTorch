import { useEffect, useMemo, useState } from 'react';
import { analyze, ratingLabel, type Row, type Verdict } from '../../../shared/analysis';
import { roundToTick } from '../../../shared/market';
import { pct, won } from '../format';
import { useStore } from '../store';
import { INTERVALS } from './ChartPanel';

const VERDICT: Record<Verdict, string> = { buy: '매수', sell: '매도', neutral: '중립' };
const CLS: Record<Verdict, string> = { buy: 'up', sell: 'down', neutral: 'sub' };
const scoreCls = (s: number) => (s > 0.1 ? 'up' : s < -0.1 ? 'down' : '');

// 반원 게이지: 왼쪽 끝이 적극 매도, 오른쪽 끝이 적극 매수.
function Gauge({ label, score }: { label: string; score: number }) {
  const angle = Math.PI * (1 - (score + 1) / 2);
  const x = 50 + 30 * Math.cos(angle);
  const y = 46 - 30 * Math.sin(angle);
  return (
    <div className="gauge">
      <div className="sub">{label}</div>
      <svg viewBox="0 0 100 52" role="img" aria-label={`${label} ${ratingLabel(score)}`}>
        <path d="M12 46 A38 38 0 0 1 31 13" className="arc down" />
        <path d="M35 11 A38 38 0 0 1 65 11" className="arc mid" />
        <path d="M69 13 A38 38 0 0 1 88 46" className="arc up" />
        <line x1="50" y1="46" x2={x} y2={y} className="needle" />
        <circle cx="50" cy="46" r="3" className="hub" />
      </svg>
      <div className={`gauge-label ${scoreCls(score)}`}>{ratingLabel(score)}</div>
    </div>
  );
}

function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <>
      <div className="panel-title small">{title}</div>
      <table className="tech-table">
        <thead>
          <tr>
            <th>지표</th>
            <th>수치</th>
            <th>판정</th>
            <th>이유</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className="num">
                {r.value === null ? '—' : Math.abs(r.value) >= 1000 ? won(r.value) : r.value.toFixed(2)}
              </td>
              <td className={CLS[r.verdict]}>{r.value === null ? '—' : VERDICT[r.verdict]}</td>
              <td className="why">{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// 타점·비중 계산: 손절가까지의 거리와 허용 손실로 살 수 있는 수량을 구한다.
function SizeCalculator({ entry0, stop0 }: { entry0: number; stop0: number }) {
  const equity = useStore((s) => s.account?.equity ?? 0);
  const { fillTicket, setTab } = useStore();
  const [risk, setRisk] = useState(1);
  const [entry, setEntry] = useState(entry0);
  const [stop, setStop] = useState(stop0);

  const perShare = entry - stop;
  const valid = perShare > 0 && entry > 0;
  const qty = valid ? Math.floor((equity * risk) / 100 / perShare) : 0;
  const capped = Math.min(qty, Math.floor(equity / entry) || 0); // 가진 돈보다 많이 살 수는 없다.
  const amount = capped * entry;
  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value) || 0);

  return (
    <div className="calc">
      <div className="calc-grid">
        <label>
          <span>진입가</span>
          <input inputMode="numeric" value={entry || ''} onChange={num(setEntry)} />
        </label>
        <label>
          <span>손절가</span>
          <input inputMode="numeric" value={stop || ''} onChange={num(setStop)} />
        </label>
        <label>
          <span>허용 손실 %</span>
          <input inputMode="decimal" value={risk || ''} onChange={num(setRisk)} />
        </label>
      </div>
      {valid ? (
        <dl className="summary">
          <dt>매수 수량</dt>
          <dd>{won(capped)}주</dd>
          <dt>투입 금액 (자산 대비)</dt>
          <dd>
            {won(amount)}원 ({equity ? ((amount / equity) * 100).toFixed(1) : 0}%)
          </dd>
          <dt>손절 시 손실</dt>
          <dd className="down">-{won(capped * perShare)}원</dd>
          <dt>목표가 (손실의 2배)</dt>
          <dd className="up">{won(roundToTick(entry + 2 * perShare))}원</dd>
        </dl>
      ) : (
        <div className="problem">손절가는 진입가보다 낮아야 합니다.</div>
      )}
      <button
        className="chip on wide"
        disabled={!valid || capped <= 0}
        onClick={() => {
          fillTicket(roundToTick(entry), capped);
          setTab('trade');
        }}
      >
        주문창에 넣기
      </button>
    </div>
  );
}

export function TechPanel() {
  const candles = useStore((s) => s.candles);
  const rev = useStore((s) => s.candleRev);
  const selected = useStore((s) => s.selected);
  const interval = useStore((s) => s.interval);
  const stock = useStore((s) => s.stocks.find((x) => x.symbol === s.selected));
  const setChartInterval = useStore((s) => s.setChartInterval);
  const [calc, setCalc] = useState(false);
  const [detail, setDetail] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- 봉 배열은 제자리에서 바뀌므로 rev 로 다시 계산한다.
  const a = useMemo(() => analyze(candles, roundToTick), [candles, rev]);
  useEffect(() => setCalc(false), [selected, interval]);

  if (!candles.length) return <div className="empty">봉을 불러오는 중…</div>;

  const close = candles[candles.length - 1].close;
  const total = a.counts.buy + a.counts.sell + a.counts.neutral || 1;
  const label = { buy: '매수 후보', sell: '매도 후보', watch: '관망' }[a.candidate];
  const stop0 = a.plan?.stop ?? (a.atr ? roundToTick(close - 2 * a.atr) : 0);

  return (
    <div className="tech">
      <div className="panel-title">
        {stock?.name} · 기술 상태 <span className="sub">{a.bars}봉 기준</span>
      </div>
      <div className="toolbar">
        {INTERVALS.map(([key, text]) => (
          <button key={key} className={`chip ${interval === key ? 'on' : ''}`} onClick={() => setChartInterval(key)}>
            {text}
          </button>
        ))}
      </div>

      <div className="gauges">
        <Gauge label="기술 지표" score={a.scores.osc} />
        <Gauge label="종합" score={a.scores.all} />
        <Gauge label="이동평균" score={a.scores.ma} />
      </div>
      <div className="count-bar" aria-hidden>
        <span className="sell-bg" style={{ flex: a.counts.sell / total }} />
        <span className="mid-bg" style={{ flex: a.counts.neutral / total }} />
        <span className="buy-bg" style={{ flex: a.counts.buy / total }} />
      </div>
      <div className="count-labels">
        <span className="down">매도 {a.counts.sell}</span>
        <span className="sub">중립 {a.counts.neutral}</span>
        <span className="up">매수 {a.counts.buy}</span>
      </div>

      <div className="candidate">
        <div className="panel-title small">매매 후보 · 판정 이유</div>
        <div className={`cand-label ${a.candidate === 'buy' ? 'up' : a.candidate === 'sell' ? 'down' : ''}`}>{label}</div>
        <p>{a.reason}</p>
        {a.plan && (
          <p className="sub">
            모의 진입 {won(a.plan.entry)} · 손절 {won(a.plan.stop)} ({pct(a.plan.stop / a.plan.entry - 1)}) · 목표{' '}
            {won(a.plan.target)} ({pct(a.plan.target / a.plan.entry - 1)})
          </p>
        )}
        {a.candidate === 'sell' && <p className="sub">보유 중이라면 비중을 줄일지 살펴볼 구간입니다.</p>}
        <button className="chip" onClick={() => setCalc(!calc)}>
          타점·비중 계산 {calc ? '닫기' : ''}
        </button>
        {calc && <SizeCalculator key={`${selected}${interval}`} entry0={close} stop0={stop0} />}
      </div>

      <button className="fold" onClick={() => setDetail(!detail)}>
        {detail ? '▾' : '▸'} 기술 지표·이동평균 보기
      </button>
      {detail && (
        <>
          <Table title="기술 지표" rows={a.oscillators} />
          <Table title="이동평균" rows={a.mas} />
        </>
      )}
      <p className="disclaimer">판정은 이 앱의 모의 규칙으로 계산한 참고값이며 투자 권유가 아닙니다.</p>
    </div>
  );
}
