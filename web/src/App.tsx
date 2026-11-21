import { useEffect, useState } from 'react';
import { ChartPanel } from './components/ChartPanel';
import { OrderbookPanel } from './components/OrderbookPanel';
import { OrderTicket } from './components/OrderTicket';
import { Orders, Portfolio } from './components/Portfolio';
import { Watchlist } from './components/Watchlist';
import { useStore, type Tab } from './store';

const TABS: Array<[Tab, string]> = [
  ['watch', '종목'],
  ['trade', '거래'],
  ['asset', '자산'],
  ['orders', '주문'],
];

export function App() {
  const { init, status, tab, setTab, connected, toasts } = useStore();
  const [error, setError] = useState('');

  useEffect(() => {
    init().catch((e: Error) => setError(e.message));
  }, [init]);

  if (error) return <div className="boot">서버에 연결하지 못했습니다. ({error})</div>;
  if (!status) return <div className="boot">불러오는 중…</div>;

  return (
    <div className="app" data-tab={tab}>
      <header className="topbar">
        <strong>TradeDeck</strong>
        <span className={`badge ${status.live ? 'live' : 'paper'}`}>{status.live ? '실계좌' : '모의투자'}</span>
        {status.marketProvider === 'mock' && <span className="badge">모의 시세</span>}
        <span className="spacer" />
        <span className={`dot ${connected ? 'on' : ''}`} title={connected ? '실시간 연결됨' : '연결 끊김'} />
        <span className="sub">{connected ? '실시간' : '재연결 중'}</span>
      </header>

      <main className="layout">
        <div className="col col-watch">
          <Watchlist />
        </div>
        <div className="col col-main">
          <ChartPanel />
          <div className="desk-only">
            <Orders />
          </div>
        </div>
        <div className="col col-trade">
          <OrderbookPanel />
          <OrderTicket />
        </div>
        <div className="col col-asset">
          <Portfolio />
        </div>
        <div className="col col-orders mobile-only">
          <Orders />
        </div>
      </main>

      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
