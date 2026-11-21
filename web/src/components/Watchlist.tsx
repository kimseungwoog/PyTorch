import { useState } from 'react';
import { dir, pct, won } from '../format';
import { useStore } from '../store';

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
