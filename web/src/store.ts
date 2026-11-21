import { create } from 'zustand';
import type {
  Account,
  ClientMessage,
  Holding,
  Order,
  OrderRequest,
  Orderbook,
  Quote,
  ServerMessage,
  ServerStatus,
  Stock,
} from '../../shared/types';

export type Tab = 'watch' | 'trade' | 'asset' | 'orders';

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
  orderbook?: Orderbook;
  account?: Account;
  holdings: Holding[];
  orders: Order[];
  favorites: string[];
  tab: Tab;
  ticketPrice?: number; // 호가창에서 고른 가격
  connected: boolean;
  toasts: Toast[];
  init(): Promise<void>;
  select(symbol: string): void;
  setTab(tab: Tab): void;
  setTicketPrice(price: number): void;
  toggleFavorite(symbol: string): void;
  refreshAccount(): Promise<void>;
  placeOrder(req: OrderRequest): Promise<boolean>;
  cancelOrder(id: string): Promise<void>;
  toast(text: string, kind?: Toast['kind']): void;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `요청 실패 (${res.status})`);
  return json as T;
}

export const fetchCandles = (symbol: string, interval: string) =>
  api<import('../../shared/types').Candle[]>(`/api/candles/${symbol}?interval=${interval}&count=300`);

function loadFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem('favorites') ?? '[]') as string[];
  } catch {
    return [];
  }
}

let socket: WebSocket | undefined;
let toastSeq = 0;

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
        set((s) => ({ quotes: { ...s.quotes, [msg.data.symbol]: msg.data } }));
      } else if (msg.type === 'orderbook') {
        if (msg.data.symbol === get().selected) set({ orderbook: msg.data });
      } else if (msg.type === 'order') {
        const o = msg.data;
        if (o.status === 'filled') {
          get().toast(`${o.name} ${o.qty}주 ${o.side === 'buy' ? '매수' : '매도'} 체결`);
        }
        void get().refreshAccount();
      }
    };
  }

  return {
    stocks: [],
    quotes: {},
    selected: '',
    holdings: [],
    orders: [],
    favorites: loadFavorites(),
    tab: 'watch',
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
      await get().refreshAccount();
      connect();
    },

    select(symbol) {
      if (symbol === get().selected) return;
      set({ selected: symbol, orderbook: undefined, ticketPrice: undefined });
      sendWs({ type: 'subscribe', symbol });
    },

    setTab: (tab) => set({ tab }),
    setTicketPrice: (ticketPrice) => set({ ticketPrice }),

    toggleFavorite(symbol) {
      const cur = get().favorites;
      const favorites = cur.includes(symbol) ? cur.filter((s) => s !== symbol) : [...cur, symbol];
      localStorage.setItem('favorites', JSON.stringify(favorites));
      set({ favorites });
    },

    async refreshAccount() {
      const [account, holdings, orders] = await Promise.all([
        api<Account>('/api/account'),
        api<Holding[]>('/api/holdings'),
        api<Order[]>('/api/orders'),
      ]);
      set({ account, holdings, orders });
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
