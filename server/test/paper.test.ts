import { describe, expect, it } from 'vitest';
import { applyTick, bucketStart, isOnTick, roundToTick, tickSize } from '../../shared/market';
import type { Candle, Quote, Stock } from '../../shared/types';
import { PaperBroker } from '../src/broker/paper';
import type { MarketProvider } from '../src/market/types';

class FakeMarket implements MarketProvider {
  name = 'fake';
  price = 70_000;
  private cbs: Array<(q: Quote) => void> = [];
  async start() {}
  stop() {}
  async listStocks(): Promise<Stock[]> {
    return [{ symbol: 'A', name: '테스트', market: 'KR', currency: 'KRW' }];
  }
  quote(): Quote {
    const p = this.price;
    return { symbol: 'A', price: p, prevClose: p, change: 0, changeRate: 0, open: p, high: p, low: p, volume: 0, ts: 0 };
  }
  async getQuotes() {
    return [this.quote()];
  }
  async getCandles() {
    return [];
  }
  async getOrderbook() {
    return { symbol: 'A', asks: [], bids: [], ts: 0 };
  }
  onQuote(cb: (q: Quote) => void) {
    this.cbs.push(cb);
  }
  move(price: number) {
    this.price = price;
    for (const cb of this.cbs) cb(this.quote());
  }
}

async function setup(feeRate = 0, sellTaxRate = 0) {
  const market = new FakeMarket();
  const broker = new PaperBroker(market, { initialCash: 1_000_000, feeRate, sellTaxRate });
  await broker.init();
  return { market, broker };
}

describe('호가 단위', () => {
  it('가격대별 호가 단위', () => {
    expect(tickSize(1_999)).toBe(1);
    expect(tickSize(2_000)).toBe(5);
    expect(tickSize(71_000)).toBe(100);
    expect(tickSize(500_000)).toBe(1_000);
  });
  it('호가 단위로 반올림', () => {
    expect(roundToTick(71_049)).toBe(71_000);
    expect(roundToTick(71_001, 'up')).toBe(71_100);
    expect(isOnTick(71_050)).toBe(false);
  });
});

describe('봉 갱신', () => {
  it('같은 봉이면 갱신하고 시간이 넘어가면 새 봉을 만든다', () => {
    const candles: Candle[] = [];
    applyTick(candles, '1m', 100, 5, 60);
    applyTick(candles, '1m', 110, 5, 90);
    applyTick(candles, '1m', 105, 1, 120);
    expect(candles).toEqual([
      { time: 60, open: 100, high: 110, low: 100, close: 110, volume: 10 },
      { time: 120, open: 105, high: 105, low: 105, close: 105, volume: 1 },
    ]);
  });
  it('일봉은 한국 시간 자정에 시작한다', () => {
    // 2026-01-02 00:30 KST = 2026-01-01 15:30 UTC
    const ts = Date.UTC(2026, 0, 1, 15, 30) / 1000;
    expect(bucketStart(ts, '1d')).toBe(Date.UTC(2026, 0, 1, 15, 0) / 1000);
  });
});

describe('모의투자 브로커', () => {
  it('시장가 매수는 현재가에 즉시 체결된다', async () => {
    const { broker } = await setup();
    const o = await broker.placeOrder({ symbol: 'A', side: 'buy', type: 'market', qty: 10 });
    expect(o.status).toBe('filled');
    expect(o.avgFillPrice).toBe(70_000);
    const acc = await broker.getAccount();
    expect(acc.cash).toBe(300_000);
    expect(acc.equity).toBe(1_000_000);
  });

  it('지정가 매수는 가격이 닿을 때 체결된다', async () => {
    const { broker, market } = await setup();
    const o = await broker.placeOrder({ symbol: 'A', side: 'buy', type: 'limit', qty: 5, price: 69_000 });
    expect(o.status).toBe('open');
    expect((await broker.getAccount()).buyingPower).toBe(655_000);
    market.move(69_500);
    expect((await broker.listOrders())[0].status).toBe('open');
    market.move(68_900);
    const filled = (await broker.listOrders())[0];
    expect(filled.status).toBe('filled');
    expect(filled.avgFillPrice).toBe(69_000);
  });

  it('잔액이나 보유 수량을 넘는 주문은 거부한다', async () => {
    const { broker } = await setup();
    await expect(broker.placeOrder({ symbol: 'A', side: 'buy', type: 'market', qty: 15 })).rejects.toThrow('부족');
    await expect(broker.placeOrder({ symbol: 'A', side: 'sell', type: 'market', qty: 1 })).rejects.toThrow('부족');
    await expect(broker.placeOrder({ symbol: 'A', side: 'buy', type: 'limit', qty: 1, price: 70_050 })).rejects.toThrow(
      '호가 단위',
    );
  });

  it('미체결 매도 수량만큼 매도 가능 수량이 줄고, 취소하면 돌아온다', async () => {
    const { broker } = await setup();
    await broker.placeOrder({ symbol: 'A', side: 'buy', type: 'market', qty: 10 });
    const sell = await broker.placeOrder({ symbol: 'A', side: 'sell', type: 'limit', qty: 7, price: 72_000 });
    expect((await broker.getHoldings())[0].sellableQty).toBe(3);
    await expect(broker.placeOrder({ symbol: 'A', side: 'sell', type: 'market', qty: 4 })).rejects.toThrow('부족');
    await broker.cancelOrder(sell.id);
    expect((await broker.getHoldings())[0].sellableQty).toBe(10);
  });

  it('매도 시 수수료와 세금을 빼고 실현손익을 계산한다', async () => {
    const { broker, market } = await setup(0.001, 0.002);
    await broker.placeOrder({ symbol: 'A', side: 'buy', type: 'market', qty: 10 }); // 70만원 + 수수료 700
    market.move(80_000);
    const sell = await broker.placeOrder({ symbol: 'A', side: 'sell', type: 'market', qty: 10 }); // 80만원 - 2,400
    expect(sell.fee).toBe(2_400);
    const acc = await broker.getAccount();
    expect(acc.cash).toBe(1_000_000 - 700_700 + 797_600);
    expect(acc.realizedPnl).toBe(100_000 - 2_400);
    expect(await broker.getHoldings()).toEqual([]);
  });
});
