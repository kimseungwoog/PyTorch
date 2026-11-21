import { dir, pct, won } from '../format';
import { useStore } from '../store';

export function OrderbookPanel() {
  const book = useStore((s) => s.orderbook);
  const quote = useStore((s) => s.quotes[s.selected]);
  const fillTicket = useStore((s) => s.fillTicket);

  if (!book || !quote) {
    return (
      <section className="panel orderbook">
        <div className="empty">호가를 불러오는 중…</div>
      </section>
    );
  }

  const max = Math.max(...book.asks.map((l) => l.qty), ...book.bids.map((l) => l.qty));
  const row = (side: 'ask' | 'bid', price: number, qty: number) => {
    const rate = (price - quote.prevClose) / quote.prevClose;
    return (
      <li key={`${side}${price}`} className={`level ${side}`} onClick={() => fillTicket(price)}>
        <span className="bar" style={{ width: `${(qty / max) * 100}%` }} />
        <span className={`lp ${dir(rate)} ${price === quote.price ? 'current' : ''}`}>{won(price)}</span>
        <span className="lr sub">{pct(rate)}</span>
        <span className="lq">{won(qty)}</span>
      </li>
    );
  };

  return (
    <section className="panel orderbook">
      <div className="panel-title">
        호가 <span className="sub">가격을 누르면 주문가에 입력됩니다</span>
      </div>
      <ul className="levels">
        {[...book.asks].reverse().map((l) => row('ask', l.price, l.qty))}
        {book.bids.map((l) => row('bid', l.price, l.qty))}
      </ul>
    </section>
  );
}
