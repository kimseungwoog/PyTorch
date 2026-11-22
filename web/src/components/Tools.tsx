import { useEffect, useState } from 'react';
import { STRATEGIES } from '../../../shared/strategies';
import type { AlertRule, FeedAuthor, FeedSource, FeedState, StrategyMatrixRow } from '../../../shared/types';
import { dir, pct, signed, won } from '../format';
import { api, sendJson, useStore } from '../store';
import { INTERVALS } from './ChartPanel';
import { Sheet } from './Modals';

const stamp = (ms: number) =>
  new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

// ---------- 알림 ----------
function ruleText(r: AlertRule): string {
  if (r.kind === 'price') return `${won(r.price)}원 ${r.op === 'gte' ? '이상' : '이하'}이 되면`;
  if (r.kind === 'candidate') return '매매 후보가 바뀌면 (일봉)';
  return `${STRATEGIES.find((s) => s.id === r.strategyId)?.name ?? r.strategyId} 신호가 나오면 (일봉)`;
}

export function AlertsModal() {
  const { selected, alertRules, alertEvents, refreshAlerts, toast } = useStore();
  const stock = useStore((s) => s.stocks.find((x) => x.symbol === s.selected));
  const price = useStore((s) => s.quotes[s.selected]?.price);
  const [target, setTarget] = useState('');
  const [strategyId, setStrategyId] = useState(STRATEGIES[0].id);
  const [permission, setPermission] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

  const add = async (body: object) => {
    try {
      await sendJson('POST', '/api/alerts', { symbol: selected, ...body });
      await refreshAlerts();
      toast('알림을 등록했습니다.');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const remove = async (id: string) => {
    await api(`/api/alerts/${id}`, { method: 'DELETE' });
    await refreshAlerts();
  };

  return (
    <Sheet title="알림">
      <div className="panel-title small first">
        {stock?.name} 알림 만들기 <span className="sub">현재가 {price ? won(price) : '—'}원</span>
      </div>
      <div className="filters">
        <input className="search" inputMode="numeric" placeholder="목표가" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button
          className="chip on"
          onClick={() => {
            void add({ kind: 'price', price: Number(target.replace(/,/g, '')) });
            setTarget('');
          }}
        >
          목표가 알림
        </button>
        <button className="chip" onClick={() => add({ kind: 'candidate' })}>
          매매 후보 바뀌면 알림
        </button>
      </div>
      <div className="filters">
        <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="chip" onClick={() => add({ kind: 'strategy', strategyId })}>
          전략 신호 알림
        </button>
      </div>
      <p className="sub">
        체결과 손절·익절 자동 매도는 따로 등록하지 않아도 알려 줍니다. 알림은 서버가 감시하므로 이 화면을 닫아도 기록에 남습니다.
      </p>
      {permission === 'default' && (
        <button className="chip" onClick={() => Notification.requestPermission().then(setPermission)}>
          브라우저 알림 켜기
        </button>
      )}
      {permission === 'denied' && <p className="sub">브라우저 설정에서 알림이 막혀 있어 화면 안에서만 알려 드립니다.</p>}

      <div className="panel-title small">등록한 알림 {alertRules.length}개</div>
      <ul className="rows">
        {alertRules.map((r) => (
          <li key={r.id} className="row static">
            <div className="grow">
              <div className="name">{r.name}</div>
              <div className="sub">{ruleText(r)}</div>
            </div>
            <button className="chip" onClick={() => remove(r.id)}>
              삭제
            </button>
          </li>
        ))}
        {!alertRules.length && <li className="empty">등록한 알림이 없습니다.</li>}
      </ul>

      <div className="panel-title small">알림 기록</div>
      <ul className="rows">
        {alertEvents.map((e) => (
          <li key={e.id} className="row static">
            <div className="grow">
              <div className="name">{e.title}</div>
              <div className="sub wrap">{e.body}</div>
            </div>
            <span className="sub">{stamp(e.ts)}</span>
          </li>
        ))}
        {!alertEvents.length && <li className="empty">아직 울린 알림이 없습니다.</li>}
      </ul>
    </Sheet>
  );
}

// ---------- 매매 일지 ----------
export function JournalModal() {
  const { orders, refreshAccount, toast } = useStore();
  const filled = orders.filter((o) => o.status === 'filled');
  const sells = filled.filter((o) => o.side === 'sell' && o.realizedPnl !== undefined);
  const wins = sells.filter((o) => o.realizedPnl! > 0);
  const losses = sells.filter((o) => o.realizedPnl! < 0);
  const sum = (xs: typeof sells) => xs.reduce((a, o) => a + o.realizedPnl!, 0);
  const avgWin = wins.length ? sum(wins) / wins.length : 0;
  const avgLoss = losses.length ? -sum(losses) / losses.length : 0;

  const saveMemo = async (id: string, memo: string) => {
    try {
      await sendJson('PUT', `/api/orders/${id}/memo`, { memo });
      await refreshAccount();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Sheet title="매매 일지">
      <div className="stat-cards four">
        <div>
          <span className="sub">끝난 매매</span>
          <b>{sells.length}회</b>
          <span className="sub">
            이익 {wins.length} · 손실 {losses.length}
          </span>
        </div>
        <div>
          <span className="sub">이긴 비율</span>
          <b>{sells.length ? `${((wins.length / sells.length) * 100).toFixed(0)}%` : '—'}</b>
          <span className="sub">매도 체결 기준</span>
        </div>
        <div>
          <span className="sub">손익비</span>
          <b>{avgLoss ? (avgWin / avgLoss).toFixed(2) : '—'}</b>
          <span className="sub">
            평균 이익 {won(avgWin)} / 평균 손실 {won(avgLoss)}
          </span>
        </div>
        <div>
          <span className="sub">실현 손익 합계</span>
          <b className={dir(sum(sells))}>{signed(sum(sells))}원</b>
          <span className="sub">수수료·세금 포함</span>
        </div>
      </div>
      <p className="sub">손익비는 평균 이익을 평균 손실로 나눈 값입니다. 이긴 비율이 낮아도 손익비가 크면 수익이 날 수 있습니다.</p>

      <div className="panel-title small">체결 기록 · 이유를 적어 두세요</div>
      <ul className="rows">
        {filled.map((o) => (
          <li key={o.id} className="row static journal-row">
            <div className="grow">
              <div className="name">
                {o.name} <span className={o.side}>{o.side === 'buy' ? '매수' : '매도'}</span>{' '}
                <span className="sub">
                  {stamp(o.updatedAt)} · {won(o.qty)}주 · {won(o.avgFillPrice)}원{o.note ? ` · ${o.note}` : ''}
                </span>
              </div>
              <input
                className="search memo"
                placeholder="매매 이유, 느낀 점"
                defaultValue={o.memo ?? ''}
                onBlur={(e) => e.target.value !== (o.memo ?? '') && saveMemo(o.id, e.target.value)}
              />
            </div>
            {o.realizedPnl !== undefined && <b className={dir(o.realizedPnl)}>{signed(o.realizedPnl)}원</b>}
          </li>
        ))}
        {!filled.length && <li className="empty">아직 체결된 주문이 없습니다.</li>}
      </ul>
    </Sheet>
  );
}

// ---------- 전략 비교 ----------
export function MatrixModal() {
  const [interval, setIntervalKey] = useState(useStore.getState().interval);
  const [rows, setRows] = useState<StrategyMatrixRow[] | null>(null);
  const [error, setError] = useState('');
  const { select, setStrategy, setTab, openModal } = useStore();

  useEffect(() => {
    let alive = true;
    setRows(null);
    api<StrategyMatrixRow[]>(`/api/strategy-matrix?interval=${interval}`)
      .then((r) => alive && setRows(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [interval]);

  return (
    <Sheet title="전략 비교">
      <div className="filters">
        <select value={interval} onChange={(e) => setIntervalKey(e.target.value as typeof interval)}>
          {INTERVALS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}봉
            </option>
          ))}
        </select>
        <span className="sub">최근 500봉에 다섯 전략을 모의로 돌린 누적 수익률과 거래 횟수입니다. 칸을 누르면 차트에 화살표로 표시합니다.</span>
      </div>
      {error && <div className="problem">{error}</div>}
      {!rows && !error && <div className="empty">전 종목에 전략을 돌리는 중…</div>}
      {rows && (
        <div className="table-wrap">
          <table className="data-table matrix">
            <thead>
              <tr>
                <th className="left">종목</th>
                {STRATEGIES.map((s) => (
                  <th key={s.id}>{s.name.split(' · ')[0]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="static">
                  <td className="left">
                    <b>{r.name}</b>
                  </td>
                  {r.cells.map((c) => (
                    <td
                      key={c.strategyId}
                      className="cell"
                      onClick={() => {
                        select(r.symbol);
                        setStrategy(c.strategyId);
                        setTab('trade');
                        openModal(null);
                      }}
                    >
                      {c.trades ? (
                        <>
                          <b className={dir(c.totalReturn)}>{pct(c.totalReturn)}</b>
                          <div className="sub">
                            {c.trades}회 · 승 {(c.winRate * 100).toFixed(0)}%{c.holding ? ' · 보유 중' : ''}
                          </div>
                        </>
                      ) : (
                        <span className="sub">{c.holding ? '보유 중' : '신호 없음'}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="disclaimer">수수료·세금·체결 지연을 반영하지 않은 과거 모의 결과입니다. 앞으로의 수익을 뜻하지 않습니다.</p>
    </Sheet>
  );
}

// ---------- 글 모아보기 ----------
const SOURCE: Record<FeedSource, string> = { x: 'X', fmkorea: '에펨코리아' };
const authorLink = (a: Pick<FeedAuthor, 'source' | 'handle'>) =>
  a.source === 'x'
    ? `https://x.com/${encodeURIComponent(a.handle)}`
    : `https://www.fmkorea.com/search.php?mid=stock&search_target=nick_name&search_keyword=${encodeURIComponent(a.handle)}`;

export function FeedModal() {
  const feedRev = useStore((s) => s.feedRev);
  const toast = useStore((s) => s.toast);
  const [feed, setFeed] = useState<FeedState | null>(null);
  const [source, setSource] = useState<FeedSource>('x');
  const [handle, setHandle] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<FeedState>('/api/feed').then(setFeed).catch((e: Error) => toast(e.message, 'error'));
  }, [feedRev, toast]);

  const call = async (method: string, path: string, body?: unknown) => {
    setBusy(true);
    try {
      setFeed(await sendJson<FeedState>(method, path, body));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    setBusy(false);
  };

  if (!feed) {
    return (
      <Sheet title="글 모아보기">
        <div className="empty">불러오는 중…</div>
      </Sheet>
    );
  }

  return (
    <Sheet title="글 모아보기">
      <div className="filters">
        <select value={source} onChange={(e) => setSource(e.target.value as FeedSource)}>
          <option value="x">X 아이디</option>
          <option value="fmkorea">에펨코리아 닉네임</option>
        </select>
        <input className="search" placeholder={source === 'x' ? '@아이디' : '닉네임'} value={handle} onChange={(e) => setHandle(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />새 글 알림
        </label>
        <button
          className="chip on"
          disabled={busy || !handle.trim()}
          onClick={() => {
            void call('POST', '/api/feed/authors', { source, handle, notify });
            setHandle('');
          }}
        >
          등록
        </button>
      </div>

      <div className="notice">
        <p>
          <b>X</b>{' '}
          {feed.xEnabled
            ? `공식 API 로 ${feed.intervalMin}분마다 글 텍스트를 가져옵니다.`
            : '자동 수집이 꺼져 있습니다. 서버 .env 에 X_BEARER_TOKEN(X 개발자 포털에서 발급, 요금제에 따라 유료)을 넣으면 켜집니다. 그 전에는 "열기"로 바로 가기만 됩니다.'}
        </p>
        <p>
          <b>에펨코리아</b> 공식 API 가 없고 자동 수집을 막고 있어 서버가 글을 가져오지 않습니다. "열기"를 누르면 주식 게시판에서 그
          닉네임을 검색한 화면이 열립니다.
        </p>
      </div>

      <div className="panel-title small">
        등록한 사람 {feed.authors.length}명
        {feed.xEnabled && (
          <>
            <select className="right-chip" value={feed.intervalMin} onChange={(e) => call('PUT', '/api/feed/interval', { min: Number(e.target.value) })}>
              {[5, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m}분마다
                </option>
              ))}
            </select>
            <button className="chip" disabled={busy} onClick={() => call('POST', '/api/feed/poll')}>
              지금 가져오기
            </button>
          </>
        )}
      </div>
      <ul className="rows">
        {feed.authors.map((a) => (
          <li key={a.id} className="row static">
            <div className="grow">
              <div className="name">
                {a.source === 'x' ? '@' : ''}
                {a.handle} <span className="badge">{SOURCE[a.source]}</span> {a.notify && <span className="badge">알림</span>}
              </div>
              {a.error && <div className="sub warn">{a.error}</div>}
            </div>
            <a className="chip" href={authorLink(a)} target="_blank" rel="noreferrer noopener">
              열기
            </a>
            <button className="chip" onClick={() => call('DELETE', `/api/feed/authors/${a.id}`)}>
              삭제
            </button>
          </li>
        ))}
        {!feed.authors.length && <li className="empty">X 아이디나 에펨코리아 닉네임을 등록해 보세요.</li>}
      </ul>

      <div className="panel-title small">
        가져온 글 {feed.posts.length}개 {feed.lastPollAt && <span className="sub">마지막 확인 {stamp(feed.lastPollAt)}</span>}
      </div>
      <ul className="rows">
        {feed.posts.map((p) => (
          <li key={p.id} className="row static post">
            <div className="grow">
              <div className="sub">
                @{p.handle} · {stamp(p.ts)}
              </div>
              <div className="wrap">{p.text}</div>
            </div>
            <a className="chip" href={p.url} target="_blank" rel="noreferrer noopener">
              원문
            </a>
          </li>
        ))}
        {!feed.posts.length && <li className="empty">아직 가져온 글이 없습니다.</li>}
      </ul>
    </Sheet>
  );
}
