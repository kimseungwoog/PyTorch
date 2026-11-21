import { useMemo, useState } from 'react';
import { replay, STRATEGIES } from '../../../shared/strategies';
import { pct, won } from '../format';
import { useStore } from '../store';

// 전략 전광판: 알려진 매매 방식을 모의 규칙으로 과거 봉에 돌려 보고, 차트에 화살표로 표시한다.
export function StrategyBoard() {
  const candles = useStore((s) => s.candles);
  const rev = useStore((s) => s.candleRev);
  const strategyId = useStore((s) => s.strategyId);
  const { setStrategy, setTab } = useStore();
  const [id, setId] = useState(strategyId ?? STRATEGIES[0].id);
  const strategy = STRATEGIES.find((s) => s.id === id)!;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- 봉 배열은 제자리에서 바뀌므로 rev 로 다시 계산한다.
  const result = useMemo(() => replay(strategy, candles), [strategy, candles, rev]);
  const onChart = strategyId === id;
  const recent = result.signals.slice(-6).reverse();
  const date = (sec: number) => new Date(sec * 1000).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

  return (
    <div className="strategy">
      <div className="panel-title">
        전략 전광판 <span className="sub">공개 전략 · 모의 리플레이</span>
      </div>
      <select
        value={id}
        onChange={(e) => {
          setId(e.target.value);
          if (strategyId) setStrategy(e.target.value);
        }}
      >
        {STRATEGIES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        className={`chip wide ${onChart ? '' : 'on'}`}
        onClick={() => {
          setStrategy(onChart ? null : id);
          if (!onChart) setTab('trade');
        }}
      >
        {onChart ? '차트에서 화살표 지우기' : '차트에 모의 화살표 표시'}
      </button>

      <p className="sub">{strategy.style}</p>
      <p>{strategy.summary}</p>
      <p>
        <b className="buy-mark">▲ 모의 매수</b> {strategy.buyRule}
      </p>
      <p>
        <b className="sell-mark">▼ 모의 매도</b> {strategy.sellRule}
      </p>
      <p>
        <b>숫자 예시</b> {strategy.example}
      </p>
      <p className="sub">{strategy.note}</p>

      <div className="panel-title small">지금 차트의 {candles.length}봉에 적용한 결과</div>
      {candles.length < strategy.minBars ? (
        <div className="empty">봉이 부족해 계산할 수 없습니다.</div>
      ) : (
        <>
          <dl className="summary cols">
            <dt>끝난 거래</dt>
            <dd>{result.trades}회</dd>
            <dt>이긴 비율</dt>
            <dd>{result.trades ? `${(result.winRate * 100).toFixed(0)}%` : '—'}</dd>
            <dt>거래당 평균</dt>
            <dd className={result.avgReturn > 0 ? 'up' : result.avgReturn < 0 ? 'down' : ''}>
              {result.trades ? pct(result.avgReturn) : '—'}
            </dd>
            <dt>누적</dt>
            <dd className={result.totalReturn > 0 ? 'up' : result.totalReturn < 0 ? 'down' : ''}>
              {result.trades ? pct(result.totalReturn) : '—'}
            </dd>
            <dt>현재 상태</dt>
            <dd>{result.holding ? '보유 중 (미청산)' : '대기'}</dd>
          </dl>
          <ul className="signals">
            {recent.map((s) => (
              <li key={`${s.index}${s.type}`}>
                <span className={s.type === 'entry' ? 'buy-mark' : 'sell-mark'}>{s.type === 'entry' ? '▲ 매수' : '▼ 매도'}</span>
                <span className="sub">{date(s.time)}</span>
                <span>{won(s.price)}</span>
                <span className="sub">{s.reason}</span>
              </li>
            ))}
            {!recent.length && <li className="empty">이 구간에는 조건을 충족한 신호가 없습니다.</li>}
          </ul>
        </>
      )}
      <p className="disclaimer">
        수수료·세금·체결 지연을 반영하지 않은 과거 모의 결과입니다. 앞으로의 수익을 뜻하지 않습니다.
      </p>
    </div>
  );
}
