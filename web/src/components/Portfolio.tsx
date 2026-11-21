import { dir, pct, signed, time, won } from '../format';
import { useStore } from '../store';

export function Portfolio() {
  const { account, holdings, quotes, select, setTab } = useStore();
  if (!account) return <section className="panel portfolio" />;

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
    <section className="panel portfolio">
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
    </section>
  );
}

export function Orders() {
  const { orders, cancelOrder } = useStore();
  const label = { open: '미체결', filled: '체결', cancelled: '취소', rejected: '거부' } as const;

  return (
    <section className="panel orders">
      <div className="panel-title">주문 내역</div>
      <ul className="rows">
        {orders.map((o) => (
          <li key={o.id} className="row">
            <div className="grow">
              <div className="name">
                {o.name} <span className={o.side}>{o.side === 'buy' ? '매수' : '매도'}</span>
              </div>
              <div className="sub">
                {time(o.createdAt)} · {o.type === 'limit' ? `지정가 ${won(o.price!)}` : '시장가'} · {won(o.qty)}주
              </div>
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
        {!orders.length && <li className="empty">주문 내역이 없습니다.</li>}
      </ul>
    </section>
  );
}
