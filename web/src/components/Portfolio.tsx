import { dir, pct, signed, time, won } from '../format';
import { useState } from 'react';
import { sendJson, useStore } from '../store';

export function Portfolio() {
  const { account, holdings, quotes, risk, select, setTab, refreshAccount, toast } = useStore();
  const [limitText, setLimitText] = useState<string | null>(null);
  if (!account) return <div className="portfolio" />;

  // 서버 값은 주문 시점 기준이라, 화면에서는 실시간 현재가로 다시 계산한다.
  const rows = holdings.map((h) => {
    const price = quotes[h.symbol]?.price ?? h.price;
    const cost = h.qty * h.avgPrice;
    const value = h.qty * price;
    return { ...h, price, value, pnl: value - cost, pnlRate: cost ? (value - cost) / cost : 0 };
  });
  const value = rows.reduce((a, r) => a + r.value, 0);
  const pnl = value - account.invested;
  const equity = account.cash + value;
  const total = equity - account.initialCash;

  return (
    <div className="portfolio">
      <div className="panel-title">내 자산</div>
      <div className="equity">
        <div className="big">{won(equity)}원</div>
        <div className={`sub ${dir(total)}`}>
          시작 대비 {signed(total)}원 ({pct(total / account.initialCash)})
        </div>
      </div>
      <dl className="summary cols">
        <dt>예수금</dt>
        <dd>{won(account.cash)}원</dd>
        <dt>평가 금액</dt>
        <dd>{won(value)}원</dd>
        <dt>평가 손익</dt>
        <dd className={dir(pnl)}>
          {signed(pnl)}원 {account.invested ? `(${pct(pnl / account.invested)})` : ''}
        </dd>
        <dt>실현 손익</dt>
        <dd className={dir(account.realizedPnl)}>{signed(account.realizedPnl)}원</dd>
      </dl>
      {risk && (
        <div className={`risk-box ${risk.blocked ? 'blocked' : ''}`}>
          <div>
            <b>오늘 손익</b> <span className={dir(risk.dayPnl)}>{signed(risk.dayPnl)}원</span>
            {risk.blocked && <span className="badge live">매수 차단 중</span>}
          </div>
          <label className="inline">
            하루 손실 한도
            <input
              className="search"
              inputMode="numeric"
              value={limitText ?? String(risk.limit)}
              onChange={(e) => setLimitText(e.target.value)}
              onBlur={async () => {
                if (limitText === null) return;
                try {
                  await sendJson('PUT', '/api/risk', { limit: Number(limitText.replace(/,/g, '')) });
                  await refreshAccount();
                  toast('하루 손실 한도를 바꿨습니다.');
                } catch (e) {
                  toast((e as Error).message, 'error');
                }
                setLimitText(null);
              }}
            />
            원
          </label>
          <div className="sub">오늘 시작 자산보다 이만큼 줄면 그날 매수를 막습니다. 0 이면 끕니다.</div>
        </div>
      )}
      <ul className="rows">
        {rows.map((h) => (
          <li
            key={h.symbol}
            className="row"
            onClick={() => {
              select(h.symbol);
              setTab('trade');
            }}
          >
            <div className="grow">
              <div className="name">{h.name}</div>
              <div className="sub">
                {won(h.qty)}주 · 평단 {won(h.avgPrice)}
              </div>
            </div>
            <div className={`right ${dir(h.pnl)}`}>
              <div className="price">{won(h.value)}</div>
              <div className="sub">
                {signed(h.pnl)} ({pct(h.pnlRate)})
              </div>
            </div>
          </li>
        ))}
        {!rows.length && <li className="empty">보유 종목이 없습니다.</li>}
      </ul>
    </div>
  );
}

export function Orders() {
  const { orders, brackets, cancelOrder, cancelBracket, openModal } = useStore();
  const label = { open: '미체결', filled: '체결', cancelled: '취소', rejected: '거부' } as const;

  return (
    <section className="panel orders">
      <div className="panel-title">
        주문 내역
        <button className="chip right-chip" onClick={() => openModal('journal')}>
          매매 일지
        </button>
      </div>
      <ul className="rows">
        {brackets.map((b) => (
          <li key={b.id} className="row">
            <div className="grow">
              <div className="name">
                {b.name} <span className="warn">자동 매도</span>
              </div>
              <div className="sub">
                {won(b.qty)}주 · {b.stopPrice ? `손절 ${won(b.stopPrice)} ` : ''}
                {b.takePrice ? `익절 ${won(b.takePrice)}` : ''}
              </div>
            </div>
            <div className="right">
              <div className="badge open">{b.status === 'waiting' ? '매수 체결 대기' : '감시 중'}</div>
              <button className="chip" onClick={() => cancelBracket(b.id)}>
                취소
              </button>
            </div>
          </li>
        ))}
        {orders.map((o) => (
          <li key={o.id} className="row">
            <div className="grow">
              <div className="name">
                {o.name} <span className={o.side}>{o.side === 'buy' ? '매수' : '매도'}</span>
              </div>
              <div className="sub">
                {time(o.createdAt)} · {o.type === 'limit' ? `지정가 ${won(o.price!)}` : '시장가'} · {won(o.qty)}주
                {o.note ? ` · ${o.note}` : ''}
              </div>
              {o.memo && <div className="sub memo-line">“{o.memo}”</div>}
            </div>
            <div className="right">
              <div className={`badge ${o.status}`}>{label[o.status]}</div>
              {o.status === 'filled' && <div className="sub">{won(o.avgFillPrice)}원</div>}
              {o.status === 'open' && (
                <button className="chip" onClick={() => cancelOrder(o.id)}>
                  취소
                </button>
              )}
            </div>
          </li>
        ))}
        {!orders.length && !brackets.length && <li className="empty">주문 내역이 없습니다.</li>}
      </ul>
    </section>
  );
}
