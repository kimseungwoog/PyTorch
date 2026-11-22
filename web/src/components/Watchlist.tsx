import { useState } from 'react';
import { dir, pct, won } from '../format';
import { useStore } from '../store';

// 시장 흐름: 전 종목 평균 등락과 업종별 평균. 지수 자료가 없어 종목 평균으로 대신한다.
function MarketPulse() {
  const stocks = useStore((s) => s.stocks);
  const quotes = useStore((s) => s.quotes);
  const rates = stocks.flatMap((s) => (quotes[s.symbol] ? [{ sector: s.sector ?? '기타', r: quotes[s.symbol].changeRate }] : []));
  if (!rates.length) return null;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sectors = [...new Set(rates.map((x) => x.sector))]
    .map((name) => ({ name, r: avg(rates.filter((x) => x.sector === name).map((x) => x.r)) }))
    .sort((a, b) => b.r - a.r);
  const all = avg(rates.map((x) => x.r));
  const ups = rates.filter((x) => x.r > 0).length;
  const downs = rates.filter((x) => x.r < 0).length;
  return (
    <div className="pulse">
      <div className="pulse-head">
        <b>시장 흐름</b>
        <span className={dir(all)}>{pct(all)}</span>
        <span className="sub">
          상승 <span className="up">{ups}</span> · 하락 <span className="down">{downs}</span>
        </span>
      </div>
      <div className="pulse-sectors">
        {sectors.map((s) => (
          <span key={s.name} className={`sector ${dir(s.r)}`}>
            {s.name} {pct(s.r)}
          </span>
        ))}
      </div>
      <div className="sub">등록 종목의 평균 등락률입니다 (지수 아님).</div>
    </div>
  );
}

export function Watchlist() {
  const { stocks, quotes, selected, favorites, select, setTab, toggleFavorite } = useStore();
  const [query, setQuery] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);

  const q = query.trim().toLowerCase();
  const rows = stocks.filter(
    (s) =>
      (!onlyFav || favorites.includes(s.symbol)) && (!q || s.name.toLowerCase().includes(q) || s.symbol.includes(q)),
  );

  return (
    <section className="panel watchlist">
      <MarketPulse />
      <div className="panel-head">
        <input
          className="search"
          placeholder="종목명 또는 코드"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className={`chip ${onlyFav ? 'on' : ''}`} onClick={() => setOnlyFav(!onlyFav)}>
          ★ 관심
        </button>
      </div>
      <ul className="rows">
        {rows.map((s) => {
          const quote = quotes[s.symbol];
          const fav = favorites.includes(s.symbol);
          return (
            <li
              key={s.symbol}
              className={`row ${s.symbol === selected ? 'selected' : ''}`}
              onClick={() => {
                select(s.symbol);
                setTab('trade');
              }}
            >
              <button
                className={`star ${fav ? 'on' : ''}`}
                aria-label={fav ? '관심 해제' : '관심 등록'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(s.symbol);
                }}
              >
                ★
              </button>
              <div className="grow">
                <div className="name">{s.name}</div>
                <div className="sub">{s.symbol}</div>
              </div>
              {quote && (
                <div className={`right ${dir(quote.change)}`}>
                  {/* key 가 바뀌면 깜빡임 애니메이션이 다시 돈다 */}
                  <div className="price flash" key={quote.price}>
                    {won(quote.price)}
                  </div>
                  <div className="sub">{pct(quote.changeRate)}</div>
                </div>
              )}
            </li>
          );
        })}
        {!rows.length && <li className="empty">표시할 종목이 없습니다.</li>}
      </ul>
    </section>
  );
}
