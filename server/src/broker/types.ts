import type { Account, Bracket, Holding, Order, OrderRequest } from '../../../shared/types';

// 주문·계좌 공급자. paper(모의투자)와 toss(실계좌)가 같은 인터페이스를 구현한다.
export interface Broker {
  readonly name: string;
  readonly live: boolean;
  getAccount(): Promise<Account>;
  getHoldings(): Promise<Holding[]>;
  listOrders(): Promise<Order[]>;
  placeOrder(req: OrderRequest): Promise<Order>;
  cancelOrder(id: string): Promise<Order>;
  setMemo(id: string, memo: string): Promise<Order>;
  listBrackets(): Promise<Bracket[]>;
  cancelBracket(id: string): Promise<Bracket>;
  onOrder(cb: (o: Order) => void): void;
}

// 사용자에게 그대로 보여줄 수 있는 주문 거부 사유.
export class OrderError extends Error {}
