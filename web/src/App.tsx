import { useEffect, useState } from 'react';
import { ChartPanel } from './components/ChartPanel';
import { IndicatorModal, RankModal, ScreenerModal } from './components/Modals';
import { OrderbookPanel } from './components/OrderbookPanel';
import { OrderTicket } from './components/OrderTicket';
import { Orders, Portfolio } from './components/Portfolio';
import { CostModal, ForecastModal } from './components/Research';
import { StrategyBoard } from './components/StrategyBoard';
import { TechPanel } from './components/TechPanel';
import { AlertsModal, FeedModal, JournalModal, MatrixModal } from './components/Tools';
import { Watchlist } from './components/Watchlist';
import { useStore, type Side } from './store';

const SIDES: Array<[Side, string]> = [
  ['tech', '기술 상태'],
  ['strategy', '전략'],
  ['asset', '자산'],
];

export function App() {
  const { init, status, tab, side, modal, setTab, setSide, openModal, connected, toasts } = useStore();
  const alertCount = useStore((s) => s.alertRules.length);
  const riskBlocked = useStore((s) => s.risk?.blocked);
  const [error, setError] = useState('');

  useEffect(() => {
    init().catch((e: Error) => setError(e.message));
  }, [init]);

  if (error) return <div className="boot">서버에 연결하지 못했습니다. ({error})</div>;
  if (!status) return <div className="boot">불러오는 중…</div>;

  // 휴대폰 하단 탭. '분석'과 '자산'은 같은 칸의 다른 화면이다.
  const nav: Array<{ label: string; on: boolean; go(): void }> = [
    { label: '종목', on: tab === 'watch', go: () => setTab('watch') },
    { label: '거래', on: tab === 'trade', go: () => setTab('trade') },
    {
      label: '분석',
      on: tab === 'side' && side !== 'asset',
      go: () => {
        setTab('side');
        if (side === 'asset') setSide('tech');
      },
    },
    {
      label: '자산',
      on: tab === 'side' && side === 'asset',
      go: () => {
        setTab('side');
        setSide('asset');
      },
    },
    { label: '주문', on: tab === 'orders', go: () => setTab('orders') },
  ];

  return (
    <div className="app" data-tab={tab}>
      <header className="topbar">
        <strong>TradeDeck</strong>
        <span className={`badge ${status.live ? 'live' : 'paper'}`}>{status.live ? '실계좌' : '모의투자'}</span>
        {status.marketProvider === 'mock' && <span className="badge">모의 시세</span>}
        <button className="chip" onClick={() => openModal('rank')}>
          시장 순위
        </button>
        <button className="chip" onClick={() => openModal('screener')}>
          스크리너
        </button>
        <button className="chip" onClick={() => openModal('matrix')}>
          전략 비교
        </button>
        <button className="chip" onClick={() => openModal('alerts')}>
          알림{alertCount ? ` ${alertCount}` : ''}
        </button>
        <button className="chip" onClick={() => openModal('journal')}>
          매매 일지
        </button>
        <button className="chip" onClick={() => openModal('feed')}>
          글 모아보기
        </button>
        {riskBlocked && <span className="badge live">매수 차단 중</span>}
        <span className="spacer" />
        <span className={`dot ${connected ? 'on' : ''}`} title={connected ? '실시간 연결됨' : '연결 끊김'} />
        <span className="sub conn">{connected ? '실시간' : '재연결 중'}</span>
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
        <div className="col col-side">
          <section className="panel">
            <div className="seg small">
              {SIDES.map(([key, label]) => (
                <button key={key} className={side === key ? 'on' : ''} onClick={() => setSide(key)}>
                  {label}
                </button>
              ))}
            </div>
            {side === 'tech' && <TechPanel />}
            {side === 'strategy' && <StrategyBoard />}
            {side === 'asset' && <Portfolio />}
          </section>
        </div>
        <div className="col col-orders mobile-only">
          <Orders />
        </div>
      </main>

      <nav className="tabs">
        {nav.map((n) => (
          <button key={n.label} className={n.on ? 'on' : ''} onClick={n.go}>
            {n.label}
          </button>
        ))}
      </nav>

      {modal === 'rank' && <RankModal />}
      {modal === 'screener' && <ScreenerModal />}
      {modal === 'indicators' && <IndicatorModal />}
      {modal === 'cost' && <CostModal />}
      {modal === 'forecast' && <ForecastModal />}
      {modal === 'alerts' && <AlertsModal />}
      {modal === 'journal' && <JournalModal />}
      {modal === 'matrix' && <MatrixModal />}
      {modal === 'feed' && <FeedModal />}

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
