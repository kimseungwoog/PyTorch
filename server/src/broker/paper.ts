import { isOnTick } from '../../../shared/market';
import type { Account, Bracket, Holding, Order, OrderRequest, Quote } from '../../../shared/types';
import { loadJson, saveJson } from '../json';
import type { MarketProvider } from '../market/types';
import { OrderError, type Broker } from './types';

export interface PaperOptions {
  initialCash: number;
  feeRate: number; // 매수·매도 수수료율
  sellTaxRate: number; // 매도 시 거래세율
  file?: string; // 상태 저장 파일. 없으면 메모리에만 둔다.
}

interface State {
  cash: number;
  realizedPnl: number;
  positions: Record<string, { qty: number; avgPrice: number }>;
  orders: Order[];
  brackets: Bracket[];
  seq: number;
}

// 모의투자 브로커. 시세 공급자의 현재가로 체결을 흉내 낸다.
// 시장가는 현재가에 즉시 전량 체결, 지정가는 현재가가 주문가에 닿으면 주문가에 전량 체결한다.
// 매수에 손절가·익절가를 붙이면, 매수가 체결된 뒤 그 가격에 닿을 때 시장가로 자동 매도한다.
export class PaperBroker implements Broker {
  readonly name = 'paper';
  readonly live = false;
  private state: State;
  private names = new Map<string, string>();
  private last = new Map<string, number>();
  private listeners: Array<(o: Order) => void> = [];

  constructor(
    private market: MarketProvider,
    private opts: PaperOptions,
  ) {
    this.state = loadJson<State>(opts.file, {
      cash: opts.initialCash,
      realizedPnl: 0,
      positions: {},
      orders: [],
      brackets: [],
      seq: 0,
    });
    market.onQuote((q) => this.onQuote(q));
  }

  async init() {
    for (const s of await this.market.listStocks()) this.names.set(s.symbol, s.name);
    for (const q of await this.market.getQuotes()) this.last.set(q.symbol, q.price);
  }

  onOrder(cb: (o: Order) => void) {
    this.listeners.push(cb);
  }

  async getAccount(): Promise<Account> {
    const holdings = await this.getHoldings();
    const invested = holdings.reduce((a, h) => a + h.qty * h.avgPrice, 0);
    const value = holdings.reduce((a, h) => a + h.value, 0);
    return {
      currency: 'KRW',
      cash: this.state.cash,
      buyingPower: this.buyingPower(),
      invested,
      equity: this.state.cash + value,
      unrealizedPnl: value - invested,
      unrealizedPnlRate: invested ? (value - invested) / invested : 0,
      realizedPnl: this.state.realizedPnl,
      initialCash: this.opts.initialCash,
    };
  }

  async getHoldings(): Promise<Holding[]> {
    return Object.entries(this.state.positions).map(([symbol, p]) => {
      const price = this.last.get(symbol) ?? p.avgPrice;
      const value = p.qty * price;
      const cost = p.qty * p.avgPrice;
      return {
        symbol,
        name: this.names.get(symbol) ?? symbol,
        qty: p.qty,
        sellableQty: this.sellableQty(symbol),
        avgPrice: p.avgPrice,
        price,
        value,
        pnl: value - cost,
        pnlRate: cost ? (value - cost) / cost : 0,
      };
    });
  }

  async listOrders(): Promise<Order[]> {
    return [...this.state.orders].reverse();
  }

  async listBrackets(): Promise<Bracket[]> {
    return this.state.brackets.filter((b) => b.status === 'waiting' || b.status === 'active').reverse();
  }

  async placeOrder(req: OrderRequest): Promise<Order> {
    const price = this.last.get(req.symbol);
    if (price === undefined) throw new OrderError('알 수 없는 종목입니다.');
    if (req.side !== 'buy' && req.side !== 'sell') throw new OrderError('매수/매도 구분이 잘못됐습니다.');
    if (!Number.isInteger(req.qty) || req.qty <= 0) throw new OrderError('수량은 1주 이상의 정수여야 합니다.');
    if (req.type === 'limit') {
      if (!req.price || req.price <= 0) throw new OrderError('지정가 주문에는 가격이 필요합니다.');
      if (!isOnTick(req.price)) throw new OrderError('호가 단위에 맞지 않는 가격입니다.');
    } else if (req.type !== 'market') {
      throw new OrderError('주문 유형이 잘못됐습니다.');
    }

    const refPrice = req.type === 'limit' ? req.price! : price;
    const hasBracket = req.stopPrice !== undefined || req.takePrice !== undefined;
    if (hasBracket) {
      if (req.side !== 'buy') throw new OrderError('손절·익절은 매수 주문에만 붙일 수 있습니다.');
      if (req.stopPrice !== undefined && !(req.stopPrice > 0 && req.stopPrice < refPrice)) {
        throw new OrderError('손절가는 매수가보다 낮아야 합니다.');
      }
      if (req.takePrice !== undefined && !(req.takePrice > refPrice)) {
        throw new OrderError('익절가는 매수가보다 높아야 합니다.');
      }
    }
    if (req.side === 'buy') {
      const need = req.qty * refPrice * (1 + this.opts.feeRate);
      if (need > this.buyingPower()) throw new OrderError('주문 가능 금액이 부족합니다.');
    } else if (req.qty > this.sellableQty(req.symbol)) {
      throw new OrderError('매도 가능 수량이 부족합니다.');
    }

    const order = this.newOrder(req);
    if (hasBracket) {
      this.state.brackets.push({
        id: `B${++this.state.seq}`,
        parentId: order.id,
        symbol: order.symbol,
        name: order.name,
        qty: order.qty,
        stopPrice: req.stopPrice,
        takePrice: req.takePrice,
        status: 'waiting',
        createdAt: order.createdAt,
      });
    }
    if (req.type === 'market') this.fill(order, price);
    else if (this.crosses(order, price)) this.fill(order, order.price!);
    this.save();
    this.emit(order);
    return order;
  }

  async cancelOrder(id: string): Promise<Order> {
    const order = this.state.orders.find((o) => o.id === id);
    if (!order) throw new OrderError('주문을 찾을 수 없습니다.');
    if (order.status !== 'open') throw new OrderError('이미 체결됐거나 취소된 주문입니다.');
    order.status = 'cancelled';
    order.updatedAt = Date.now();
    for (const b of this.state.brackets) if (b.parentId === id && b.status === 'waiting') b.status = 'cancelled';
    this.save();
    this.emit(order);
    return order;
  }

  async cancelBracket(id: string): Promise<Bracket> {
    const b = this.state.brackets.find((x) => x.id === id);
    if (!b || (b.status !== 'waiting' && b.status !== 'active')) throw new OrderError('취소할 자동 매도가 없습니다.');
    b.status = 'cancelled';
    this.save();
    return b;
  }

  async setMemo(id: string, memo: string): Promise<Order> {
    const order = this.state.orders.find((o) => o.id === id);
    if (!order) throw new OrderError('주문을 찾을 수 없습니다.');
    order.memo = memo.slice(0, 500);
    this.save();
    return order;
  }

  private newOrder(req: OrderRequest, note?: string): Order {
    const now = Date.now();
    const order: Order = {
      id: `P${++this.state.seq}`,
      name: this.names.get(req.symbol) ?? req.symbol,
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      qty: req.qty,
      price: req.type === 'limit' ? req.price : undefined,
      memo: req.memo?.slice(0, 500) || undefined,
      note,
      filledQty: 0,
      avgFillPrice: 0,
      fee: 0,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    this.state.orders.push(order);
    return order;
  }

  private onQuote(q: Quote) {
    this.last.set(q.symbol, q.price);
    let changed = false;
    for (const o of this.state.orders) {
      if (o.status === 'open' && o.symbol === q.symbol && this.crosses(o, q.price)) {
        this.fill(o, o.price!);
        this.emit(o);
        changed = true;
      }
    }
    for (const b of this.state.brackets) {
      if (b.status !== 'active' || b.symbol !== q.symbol) continue;
      const hit =
        b.stopPrice !== undefined && q.price <= b.stopPrice
          ? 'stop'
          : b.takePrice !== undefined && q.price >= b.takePrice
            ? 'take'
            : null;
      if (!hit) continue;
      // 그 사이 직접 판 수량이 있으면 남은 만큼만 판다.
      const qty = Math.min(b.qty, this.sellableQty(b.symbol));
      b.status = qty > 0 ? 'done' : 'cancelled';
      b.result = hit;
      if (qty > 0) {
        const order = this.newOrder(
          { symbol: b.symbol, side: 'sell', type: 'market', qty },
          hit === 'stop' ? '손절 자동 매도' : '익절 자동 매도',
        );
        this.fill(order, q.price);
        this.emit(order);
      }
      changed = true;
    }
    if (changed) this.save();
  }

  private crosses(o: Order, price: number): boolean {
    return o.side === 'buy' ? price <= o.price! : price >= o.price!;
  }

  private fill(o: Order, price: number) {
    const amount = o.qty * price;
    const pos = this.state.positions[o.symbol] ?? { qty: 0, avgPrice: 0 };
    if (o.side === 'buy') {
      o.fee = Math.floor(amount * this.opts.feeRate);
      this.state.cash -= amount + o.fee;
      pos.avgPrice = (pos.qty * pos.avgPrice + amount) / (pos.qty + o.qty);
      pos.qty += o.qty;
      this.state.positions[o.symbol] = pos;
      for (const b of this.state.brackets) if (b.parentId === o.id && b.status === 'waiting') b.status = 'active';
    } else {
      o.fee = Math.floor(amount * (this.opts.feeRate + this.opts.sellTaxRate));
      o.realizedPnl = (price - pos.avgPrice) * o.qty - o.fee;
      this.state.cash += amount - o.fee;
      this.state.realizedPnl += o.realizedPnl;
      pos.qty -= o.qty;
      if (pos.qty === 0) delete this.state.positions[o.symbol];
    }
    o.filledQty = o.qty;
    o.avgFillPrice = price;
    o.status = 'filled';
    o.updatedAt = Date.now();
  }

  private buyingPower(): number {
    const reserved = this.state.orders
      .filter((o) => o.status === 'open' && o.side === 'buy')
      .reduce((a, o) => a + o.qty * o.price! * (1 + this.opts.feeRate), 0);
    return Math.floor(this.state.cash - reserved);
  }

  private sellableQty(symbol: string): number {
    const held = this.state.positions[symbol]?.qty ?? 0;
    const reserved = this.state.orders
      .filter((o) => o.status === 'open' && o.side === 'sell' && o.symbol === symbol)
      .reduce((a, o) => a + o.qty, 0);
    return held - reserved;
  }

  private emit(o: Order) {
    for (const cb of this.listeners) cb({ ...o });
  }

  private save() {
    saveJson(this.opts.file, this.state);
  }
}
