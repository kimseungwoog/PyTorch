import { useEffect, useState, type ReactNode } from 'react';
import type { ScreenerRow } from '../../../shared/types';
import { dir, pct, won } from '../format';
import { api, useStore, type IndicatorConfig } from '../store';
import { INTERVALS } from './ChartPanel';

export function Sheet({ title, children }: { title: string; children: ReactNode }) {
  const openModal = useStore((s) => s.openModal);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openModal(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openModal]);
  return (
    <div className="modal-back" onClick={() => openModal(null)}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{title}</h3>
          <button aria-label="닫기" onClick={() => openModal(null)}>
            ✕
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function useGoTo() {
  const { select, setTab, openModal } = useStore();
  return (symbol: string) => {
    select(symbol);
    setTab('trade');
    openModal(null);
  };
}

// ---------- 시장 순위 ----------
type RankKey = 'value' | 'changeRate' | 'volume';

export function RankModal() {
  const stocks = useStore((s) => s.stocks);
  const quotes = useStore((s) => s.quotes);
  const [key, setKey] = useState<RankKey>('value');
  const goTo = useGoTo();
  const rows = stocks
    .flatMap((s) => (quotes[s.symbol] ? [{ ...s, q: quotes[s.symbol] }] : []))
    .sort((a, b) => b.q[key] - a.q[key]);

  return (
    <Sheet title="시장 순위">
      <div className="toolbar">
        {(
          [
            ['value', '거래대금'],
            ['changeRate', '등락률'],
            ['volume', '거래량'],
          ] as Array<[RankKey, string]>
        ).map(([k, label]) => (
          <button key={k} className={`chip ${key === k ? 'on' : ''}`} onClick={() => setKey(k)}>
            {label}
          </button>
        ))}
      </div>
      <p className="sub">실시간 집계 · 등락률은 전일 대비 · 종목을 누르면 차트로 이동합니다.</p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>순위</th>
              <th className="left">종목</th>
              <th>현재가</th>
              <th>등락률</th>
              <th>거래대금</th>
              <th>거래량</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.symbol} onClick={() => goTo(r.symbol)}>
                <td>{i + 1}</td>
                <td className="left">
                  <b>{r.name}</b> <span className="sub">{r.symbol}</span>
                </td>
                <td>{won(r.q.price)}</td>
                <td className={dir(r.q.change)}>{pct(r.q.changeRate)}</td>
                <td>{won(r.q.value / 1e8)}억</td>
                <td>{won(r.q.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Sheet>
  );
}

// ---------- 조건·기술 스크리너 ----------
type SortKey = 'name' | 'score' | 'price' | 'changeRate' | 'gapRate' | 'volumeMultiple' | 'value';
const CAND = { buy: '매수 후보', sell: '매도 후보', watch: '관망' } as const;

export function ScreenerModal() {
  const [interval, setIntervalKey] = useState(useStore.getState().interval);
  const [rows, setRows] = useState<ScreenerRow[] | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'score', desc: true });
  const [candidate, setCandidate] = useState<'all' | ScreenerRow['candidate']>('all');
  const [rating, setRating] = useState('all');
  const [minChange, setMinChange] = useState('');
  const [minMultiple, setMinMultiple] = useState('');
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);
  const goTo = useGoTo();

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError('');
    api<ScreenerRow[]>(`/api/screener?interval=${interval}`)
      .then((r) => alive && setRows(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [interval, reload]);

  const q = query.trim().toLowerCase();
  const shown = (rows ?? [])
    .filter(
      (r) =>
        (candidate === 'all' || r.candidate === candidate) &&
        (rating === 'all' || r.rating === rating) &&
        (minChange === '' || r.changeRate * 100 >= Number(minChange)) &&
        (minMultiple === '' || (r.volumeMultiple ?? 0) >= Number(minMultiple)) &&
        (!q || r.name.toLowerCase().includes(q) || r.symbol.includes(q)),
    )
    .sort((a, b) => {
      const [x, y] = [a[sort.key] ?? -Infinity, b[sort.key] ?? -Infinity];
      const cmp = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.desc ? -cmp : cmp;
    });

  const th = (key: SortKey, label: string, left = false) => (
    <th className={left ? 'left sortable' : 'sortable'} onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : true })}>
      {label} {sort.key === key ? (sort.desc ? '↓' : '↑') : '↕'}
    </th>
  );

  return (
    <Sheet title="조건·기술 스크리너">
      <p className="sub">
        갭은 전일 종가 대비 시가, 거래량 배수는 직전 확정 봉을 그 앞 20봉 평균과 비교한 값입니다. 매매 후보는 선택한 주기의 종합
        평가와 20봉 평균선·RSI·MACD 를 함께 봅니다.
      </p>
      <div className="filters">
        <input className="search" placeholder="종목명·코드" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={interval} onChange={(e) => setIntervalKey(e.target.value as typeof interval)}>
          {INTERVALS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}봉
            </option>
          ))}
        </select>
        <select value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="all">전체 등급</option>
          {['적극 매수', '매수', '중립', '매도', '적극 매도'].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select value={candidate} onChange={(e) => setCandidate(e.target.value as typeof candidate)}>
          <option value="all">전체 매매 후보</option>
          <option value="buy">매수 후보</option>
          <option value="sell">매도 후보</option>
          <option value="watch">관망</option>
        </select>
        <input className="search" inputMode="decimal" placeholder="최소 등락 %" value={minChange} onChange={(e) => setMinChange(e.target.value)} />
        <input
          className="search"
          inputMode="decimal"
          placeholder="최소 거래량 배수"
          value={minMultiple}
          onChange={(e) => setMinMultiple(e.target.value)}
        />
        <button className="chip" onClick={() => setReload(reload + 1)}>
          새로고침
        </button>
      </div>
      {error && <div className="problem">{error}</div>}
      {!rows && !error && <div className="empty">전 종목을 분석하는 중…</div>}
      {rows && (
        <>
          <p className="sub">
            {rows.length}종목 분석 · {shown.length}종목 표시
          </p>
          <div className="table-wrap">
            <table className="data-table screener">
              <thead>
                <tr>
                  {th('name', '종목', true)}
                  {th('score', '기술 평가')}
                  <th>매매 후보</th>
                  <th className="left">판정 이유</th>
                  {th('price', '가격')}
                  {th('changeRate', '등락률')}
                  {th('gapRate', '갭')}
                  {th('volumeMultiple', '거래량 배수')}
                  {th('value', '거래대금')}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.symbol} onClick={() => goTo(r.symbol)}>
                    <td className="left">
                      <b>{r.name}</b> <span className="sub">{r.symbol}</span>
                    </td>
                    <td>
                      <span className={`pill ${r.score > 0.1 ? 'up' : r.score < -0.1 ? 'down' : ''}`}>{r.rating}</span>
                    </td>
                    <td className={r.candidate === 'buy' ? 'up' : r.candidate === 'sell' ? 'down' : 'sub'}>{CAND[r.candidate]}</td>
                    <td className="left why">{r.reason}</td>
                    <td>{won(r.price)}</td>
                    <td className={dir(r.changeRate)}>{pct(r.changeRate)}</td>
                    <td className={dir(r.gapRate)}>{pct(r.gapRate)}</td>
                    <td>{r.volumeMultiple === null ? '—' : `${r.volumeMultiple.toFixed(2)}배`}</td>
                    <td>{won(r.value / 1e8)}억</td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr>
                    <td colSpan={9} className="empty">
                      조건에 맞는 종목이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ---------- 지표 설정 ----------
const INDICATOR_LIST: Array<{ key: keyof Omit<IndicatorConfig, 'maLengths'>; code: string; name: string; where: '가격' | '아래 칸' }> = [
  { key: 'ma', code: 'MA', name: '이동평균선', where: '가격' },
  { key: 'ema', code: 'EMA', name: '지수 이동평균 20·50', where: '가격' },
  { key: 'boll', code: 'BOLL', name: '볼린저 밴드 20·2', where: '가격' },
  { key: 'donchian', code: 'DC', name: '돈치안 채널 20', where: '가격' },
  { key: 'vwap', code: 'VWAP', name: '거래량 가중 평균가 (하루 단위)', where: '가격' },
  { key: 'supertrend', code: 'SUPERTREND', name: '슈퍼트렌드 10·3', where: '가격' },
  { key: 'volume', code: 'VOL', name: '거래량', where: '아래 칸' },
  { key: 'rsi', code: 'RSI', name: 'RSI 14', where: '아래 칸' },
  { key: 'macd', code: 'MACD', name: 'MACD 12·26·9', where: '아래 칸' },
  { key: 'adx', code: 'ADX', name: 'ADX·DI 14', where: '아래 칸' },
  { key: 'stoch', code: 'STOCH', name: '스토캐스틱 %K 14', where: '아래 칸' },
  { key: 'mfi', code: 'MFI', name: 'MFI 14', where: '아래 칸' },
];

export function IndicatorModal() {
  const indicators = useStore((s) => s.indicators);
  const setIndicators = useStore((s) => s.setIndicators);
  const [query, setQuery] = useState('');
  const [lengths, setLengths] = useState(indicators.maLengths.join(', '));
  const q = query.trim().toLowerCase();

  const applyLengths = (text: string) => {
    setLengths(text);
    const parsed = text
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 2 && n <= 400)
      .slice(0, 6);
    if (parsed.length) setIndicators({ maLengths: parsed });
  };

  return (
    <Sheet title="지표">
      <input className="search" placeholder="지표 검색 (RSI, 볼린저 등)" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="ind-list">
        {INDICATOR_LIST.filter((i) => !q || i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)).map((i) => (
          <li key={i.key}>
            <label>
              <input type="checkbox" checked={indicators[i.key]} onChange={(e) => setIndicators({ [i.key]: e.target.checked })} />
              <b>{i.code}</b>
              <span className="grow">{i.name}</span>
              <span className="badge">{i.where}</span>
            </label>
            {i.key === 'ma' && indicators.ma && (
              <label className="ind-param">
                <span className="sub">기간 (쉼표로 구분, 최대 6개)</span>
                <input className="search" value={lengths} onChange={(e) => applyLengths(e.target.value)} />
              </label>
            )}
          </li>
        ))}
      </ul>
      <p className="sub">설정은 이 브라우저에 저장됩니다.</p>
    </Sheet>
  );
}
