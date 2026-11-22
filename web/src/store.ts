import { create } from 'zustand';
import { applyTick } from '../../shared/market';
import type {
  Account,
  AlertEvent,
  AlertRule,
  Bracket,
  Candle,
  ClientMessage,
  Holding,
  Interval,
  Order,
  OrderRequest,
  Orderbook,
  Quote,
  RiskStatus,
  ServerMessage,
  ServerStatus,
  Stock,
} from '../../shared/types';

export type Tab = 'watch' | 'trade' | 'side' | 'orders';
export type Side = 'tech' | 'strategy' | 'asset';
export type ModalKind =
  | 'rank'
  | 'screener'
  | 'cost'
  | 'forecast'
  | 'indicators'
  | 'alerts'
  | 'journal'
  | 'matrix'
  | 'feed'
  | null;

// 차트에 직접 그린 선. 종목별로 브라우저에 저장된다.
export type Drawing = { type: 'h'; price: number } | { type: 't'; t1: number; p1: number; t2: number; p2: number };
export type DrawMode = 'h' | 't' | null;

// 차트에 올릴 지표 설정. 브라우저에 저장된다.
export interface IndicatorConfig {
  ma: boolean;
  maLengths: number[];
  ema: boolean;
  boll: boolean;
  donchian: boolean;
  vwap: boolean;
  supertrend: boolean;
  volume: boolean;
  rsi: boolean;
  macd: boolean;
  adx: boolean;
  stoch: boolean;
  mfi: boolean;
}

const DEFAULT_INDICATORS: IndicatorConfig = {
  ma: true,
  maLengths: [5, 20, 60],
  ema: false,
  boll: false,
  donchian: false,
  vwap: false,
  supertrend: false,
  volume: true,
  rsi: false,
  macd: false,
  adx: false,
  stoch: false,
  mfi: false,
};

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

interface State {
  status?: ServerStatus;
  stocks: Stock[];
  quotes: Record<string, Quote>;
  selected: string;
  interval: Interval;
  candles: Candle[]; // 선택 종목·주기의 봉. 체결이 들어오면 마지막 봉을 직접 고친다.
  candleRev: number; // 봉이 바뀔 때마다 1씩 오른다.
  indicators: IndicatorConfig;
  strategyId: string | null; // 차트에 화살표로 표시할 전략
  orderbook?: Orderbook;
  account?: Account;
  holdings: Holding[];
  orders: Order[];
  brackets: Bracket[];
  risk?: RiskStatus;
  alertRules: AlertRule[];
  alertEvents: AlertEvent[];
  feedRev: number; // 새 글이 들어오면 오른다
  drawings: Record<string, Drawing[]>;
  drawMode: DrawMode;
  favorites: string[];
  tab: Tab;
  side: Side;
  modal: ModalKind;
  ticketFill?: { price: number; qty?: number; stop?: number; take?: number; seq: number }; // 호가창·계산기에서 주문창으로 넘기는 값
  connected: boolean;
  toasts: Toast[];
  init(): Promise<void>;
  select(symbol: string): void;
  setChartInterval(interval: Interval): void;
  setIndicators(patch: Partial<IndicatorConfig>): void;
  setStrategy(id: string | null): void;
  setTab(tab: Tab): void;
  setSide(side: Side): void;
  openModal(modal: ModalKind): void;
  fillTicket(price: number, qty?: number, stop?: number, take?: number): void;
  setDrawMode(mode: DrawMode): void;
  addDrawing(d: Drawing): void;
  clearDrawings(): void;
  refreshAlerts(): Promise<void>;
  cancelBracket(id: string): Promise<void>;
  toggleFavorite(symbol: string): void;
  refreshAccount(): Promise<void>;
  placeOrder(req: OrderRequest): Promise<boolean>;
  cancelOrder(id: string): Promise<void>;
  toast(text: string, kind?: Toast['kind']): void;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `요청 실패 (${res.status})`);
  return json as T;
}

export const sendJson = <T>(method: string, path: string, body?: unknown) =>
  api<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

export const fetchCandles = (symbol: string, interval: Interval, count = 500) =>
  api<Candle[]>(`/api/candles/${symbol}?interval=${interval}&count=${count}`);

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장소를 쓸 수 없는 환경에서는 저장하지 않는다.
  }
}

let socket: WebSocket | undefined;
let toastSeq = 0;
let fillSeq = 0;
let loadSeq = 0;
let lastVolume: number | undefined;

function sendWs(msg: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export const useStore = create<State>((set, get) => {
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}/ws`);
    socket.onopen = () => {
      set({ connected: true });
      sendWs({ type: 'subscribe', symbol: get().selected });
    };
    socket.onclose = () => {
      set({ connected: false });
      setTimeout(connect, 1_500);
    };
    socket.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      if (msg.type === 'quote') {
        const q = msg.data;
        const s = get();
        const patch: Partial<State> = { quotes: { ...s.quotes, [q.symbol]: q } };
        if (q.symbol === s.selected && s.candles.length) {
          const delta = lastVolume === undefined ? 0 : Math.max(0, q.volume - lastVolume);
          lastVolume = q.volume;
          applyTick(s.candles, s.interval, q.price, delta, Math.floor(q.ts / 1000));
          patch.candleRev = s.candleRev + 1;
        }
        set(patch);
      } else if (msg.type === 'orderbook') {
        if (msg.data.symbol === get().selected) set({ orderbook: msg.data });
      } else if (msg.type === 'order') {
        const o = msg.data;
        if (o.status === 'filled') {
          get().toast(`${o.name} ${o.qty}주 ${o.side === 'buy' ? '매수' : '매도'} 체결`);
        }
        void get().refreshAccount();
      } else if (msg.type === 'alert') {
        const e = msg.data;
        set((s) => ({ alertEvents: [e, ...s.alertEvents].slice(0, 100) }));
        // 체결 알림은 위에서 이미 띄웠다.
        if (!e.title.includes('체결')) get().toast(e.title);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const n = new Notification(e.title, { body: e.body });
          if (e.url) n.onclick = () => window.open(e.url, '_blank', 'noopener');
        }
        void get().refreshAlerts();
      } else if (msg.type === 'feed') {
        set((s) => ({ feedRev: s.feedRev + 1 }));
      }
    };
  }

  async function loadCandles() {
    const { selected, interval } = get();
    if (!selected) return;
    const seq = ++loadSeq;
    lastVolume = undefined;
    set({ candles: [], candleRev: get().candleRev + 1 });
    try {
      const candles = await fetchCandles(selected, interval);
      if (seq === loadSeq) set({ candles, candleRev: get().candleRev + 1 });
    } catch (e) {
      get().toast((e as Error).message, 'error');
    }
  }

  return {
    stocks: [],
    quotes: {},
    selected: '',
    interval: loadJson<Interval>('interval', '1d'),
    candles: [],
    candleRev: 0,
    indicators: { ...DEFAULT_INDICATORS, ...loadJson<Partial<IndicatorConfig>>('indicators', {}) },
    strategyId: null,
    holdings: [],
    orders: [],
    brackets: [],
    alertRules: [],
    alertEvents: [],
    feedRev: 0,
    drawings: loadJson<Record<string, Drawing[]>>('drawings', {}),
    drawMode: null,
    favorites: loadJson<string[]>('favorites', []),
    tab: 'watch',
    side: 'tech',
    modal: null,
    connected: false,
    toasts: [],

    async init() {
      const [status, stocks, quotes] = await Promise.all([
        api<ServerStatus>('/api/status'),
        api<Stock[]>('/api/stocks'),
        api<Quote[]>('/api/quotes'),
      ]);
      set({
        status,
        stocks,
        quotes: Object.fromEntries(quotes.map((q) => [q.symbol, q])),
        selected: stocks[0]?.symbol ?? '',
      });
      await Promise.all([get().refreshAccount(), get().refreshAlerts(), loadCandles()]);
      connect();
    },

    select(symbol) {
      if (symbol === get().selected) return;
      set({ selected: symbol, orderbook: undefined, ticketFill: undefined, drawMode: null });
      sendWs({ type: 'subscribe', symbol });
      void loadCandles();
    },

    setChartInterval(interval) {
      if (interval === get().interval) return;
      saveJson('interval', interval);
      set({ interval });
      void loadCandles();
    },

    setIndicators(patch) {
      const indicators = { ...get().indicators, ...patch };
      saveJson('indicators', indicators);
      set({ indicators });
    },

    setStrategy: (strategyId) => set({ strategyId }),
    setTab: (tab) => set({ tab }),
    setSide: (side) => set({ side }),
    openModal: (modal) => set({ modal }),
    fillTicket: (price, qty, stop, take) => set({ ticketFill: { price, qty, stop, take, seq: ++fillSeq } }),
    setDrawMode: (drawMode) => set({ drawMode }),

    addDrawing(d) {
      const { selected, drawings } = get();
      const next = { ...drawings, [selected]: [...(drawings[selected] ?? []), d] };
      saveJson('drawings', next);
      set({ drawings: next, drawMode: null });
    },

    clearDrawings() {
      const { selected, drawings } = get();
      const next = { ...drawings, [selected]: [] };
      saveJson('drawings', next);
      set({ drawings: next, drawMode: null });
    },

    async refreshAlerts() {
      const { rules, events } = await api<{ rules: AlertRule[]; events: AlertEvent[] }>('/api/alerts');
      set({ alertRules: rules, alertEvents: events });
    },

    async cancelBracket(id) {
      try {
        await api(`/api/brackets/${id}`, { method: 'DELETE' });
        get().toast('자동 매도를 취소했습니다.');
        await get().refreshAccount();
      } catch (e) {
        get().toast((e as Error).message, 'error');
      }
    },

    toggleFavorite(symbol) {
      const cur = get().favorites;
      const favorites = cur.includes(symbol) ? cur.filter((s) => s !== symbol) : [...cur, symbol];
      saveJson('favorites', favorites);
      set({ favorites });
    },

    async refreshAccount() {
      const [account, holdings, orders, brackets, risk] = await Promise.all([
        api<Account>('/api/account'),
        api<Holding[]>('/api/holdings'),
        api<Order[]>('/api/orders'),
        api<Bracket[]>('/api/brackets'),
        api<RiskStatus>('/api/risk'),
      ]);
      set({ account, holdings, orders, brackets, risk });
    },

    async placeOrder(req) {
      try {
        const o = await api<Order>('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (o.status === 'open') get().toast('주문이 접수됐습니다.');
        await get().refreshAccount();
        return true;
      } catch (e) {
        get().toast((e as Error).message, 'error');
        return false;
      }
    },

    async cancelOrder(id) {
      try {
        await api(`/api/orders/${id}`, { method: 'DELETE' });
        get().toast('주문을 취소했습니다.');
        await get().refreshAccount();
      } catch (e) {
        get().toast((e as Error).message, 'error');
      }
    },

    toast(text, kind = 'ok') {
      const id = ++toastSeq;
      set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3_000);
    },
  };
});
