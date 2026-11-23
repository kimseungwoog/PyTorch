import { describe, expect, it } from 'vitest';
import type { Candle, Quote, Stock } from '../../shared/types';
import { AlertEngine } from '../src/alerts';
import { PaperBroker } from '../src/broker/paper';
import { authorLink, Feed, robotsAllows } from '../src/feed';
import type { MarketProvider } from '../src/market/types';
import { Risk } from '../src/risk';

class FakeMarket implements MarketProvider {
  name = 'fake';
  price = 70_000;
  candles: Candle[] = [];
  private cbs: Array<(q: Quote) => void> = [];
  async start() {}
  stop() {}
  async listStocks(): Promise<Stock[]> {
    return [{ symbol: 'A', name: '테스트', market: 'KR', currency: 'KRW' }];
  }
  quote(): Quote {
    const p = this.price;
    return { symbol: 'A', price: p, prevClose: p, change: 0, changeRate: 0, open: p, high: p, low: p, volume: 0, value: 0, ts: 0 };
  }
  async getQuotes() {
    return [this.quote()];
  }
  async getCandles() {
    return this.candles;
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

async function setup() {
  const market = new FakeMarket();
  const broker = new PaperBroker(market, { initialCash: 1_000_000, feeRate: 0, sellTaxRate: 0 });
  await broker.init();
  return { market, broker };
}

describe('손절·익절 묶음 주문', () => {
  it('손절가에 닿으면 자동으로 판다', async () => {
    const { market, broker } = await setup();
    await broker.placeOrder({ symbol: 'A', side: 'buy', type: 'market', qty: 10, stopPrice: 68_000, takePrice: 75_000, memo: '돌파' });
    expect((await broker.listBrackets())[0].status).toBe('active');
    market.move(69_000);
    expect(await broker.getHoldings()).toHaveLength(1);
    market.move(67_900);
    expect(await broker.getHoldings()).toEqual([]);
    const [sell, buy] = await broker.listOrders();
    expect(sell).toMatchObject({ side: 'sell', note: '손절 자동 매도', avgFillPrice: 67_900, realizedPnl: -21_000 });
    expect(buy.memo).toBe('돌파');
    expect(await broker.listBrackets()).toEqual([]);
  });

  it('익절가에 닿으면 자동으로 판다', async () => {
    const { market, broker } = await setup();
    await broker.placeOrder({ symbol: 'A', side: 'buy', type: 'market', qty: 10, stopPrice: 68_000, takePrice: 75_000 });
    market.move(75_100);
    expect((await broker.listOrders())[0]).toMatchObject({ note: '익절 자동 매도', realizedPnl: 51_000 });
  });

  it('지정가 매수가 체결되기 전에는 움직이지 않고, 매수를 취소하면 함께 사라진다', async () => {
    const { market, broker } = await setup();
    const o = await broker.placeOrder({ symbol: 'A', side: 'buy', type: 'limit', qty: 5, price: 69_000, stopPrice: 67_000 });
    expect((await broker.listBrackets())[0].status).toBe('waiting');
    market.move(69_500);
    await broker.cancelOrder(o.id);
    expect(await broker.listBrackets()).toEqual([]);
  });

  it('직접 판 뒤에는 남은 수량만 판다', async () => {
    const { market, broker } = await setup();
    await broker.placeOrder({ symbol: 'A', side: 'buy', type: 'market', qty: 10, stopPrice: 68_000 });
    await broker.placeOrder({ symbol: 'A', side: 'sell', type: 'market', qty: 7 });
    market.move(67_000);
    expect((await broker.listOrders())[0]).toMatchObject({ qty: 3, note: '손절 자동 매도' });
  });

  it('잘못된 손절·익절가는 거부한다', async () => {
    const { broker } = await setup();
    await expect(broker.placeOrder({ symbol: 'A', side: 'buy', type: 'market', qty: 1, stopPrice: 71_000 })).rejects.toThrow('손절가');
    await expect(broker.placeOrder({ symbol: 'A', side: 'buy', type: 'market', qty: 1, takePrice: 69_000 })).rejects.toThrow('익절가');
  });
});

describe('하루 손실 한도', () => {
  it('오늘 시작 자산보다 한도만큼 줄면 차단 상태가 된다', async () => {
    const { market, broker } = await setup();
    const risk = new Risk(broker, 50_000);
    expect(await risk.status()).toMatchObject({ dayPnl: 0, blocked: false });
    await broker.placeOrder({ symbol: 'A', side: 'buy', type: 'market', qty: 10 });
    market.move(66_000);
    expect(await risk.status()).toMatchObject({ dayPnl: -40_000, blocked: false });
    market.move(65_000);
    expect(await risk.status()).toMatchObject({ dayPnl: -50_000, blocked: true });
    risk.setLimit(0);
    expect((await risk.status()).blocked).toBe(false);
  });
});

describe('알림', () => {
  it('목표가에 닿으면 한 번 울리고 규칙이 사라진다', async () => {
    const market = new FakeMarket();
    const alerts = new AlertEngine(market);
    const rule = await alerts.add({ symbol: 'A', kind: 'price', price: 72_000 });
    expect(rule).toMatchObject({ kind: 'price', op: 'gte' });
    market.move(71_000);
    expect(alerts.events).toHaveLength(0);
    market.move(72_000);
    market.move(73_000);
    expect(alerts.events).toHaveLength(1);
    expect(alerts.events[0].title).toContain('목표가 도달');
    expect(alerts.rules).toHaveLength(0);
  });

  it('매매 후보가 바뀔 때만 울린다', async () => {
    const market = new FakeMarket();
    const bar = (i: number, close: number): Candle => ({ time: i * 86_400, open: close, high: close + 1, low: close - 1, close, volume: 100 });
    const alerts = new AlertEngine(market);
    await alerts.add({ symbol: 'A', kind: 'candidate' });
    market.candles = Array.from({ length: 200 }, (_, i) => bar(i, 1000 + i * 5)); // RSI 100 → 관망
    await alerts.scan();
    await alerts.scan();
    expect(alerts.events).toHaveLength(0);
    market.candles = Array.from({ length: 200 }, (_, i) => bar(i, 1000 + i * 3 + (i % 2 ? -8 : 8))); // 매수 후보
    await alerts.scan();
    expect(alerts.events).toHaveLength(1);
    expect(alerts.events[0].title).toContain('매수 후보');
  });
});

describe('새 글 알림', () => {
  const tweets = (ids: string[]) => ({ data: ids.map((id) => ({ id, text: `글 ${id}`, created_at: '2026-11-22T00:00:00Z' })) });
  const page = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => String(body),
  });

  it('X: 처음 확인한 글은 알리지 않고, 그 뒤 새 글만 알린다', async () => {
    const calls: string[] = [];
    const responses = [{ data: { id: '99' } }, tweets(['2', '1']), tweets(['3'])];
    const feed = new Feed('token', undefined, async (url, init) => {
      calls.push(url);
      expect(init?.headers?.Authorization).toBe('Bearer token');
      return page(200, responses.shift());
    });
    const notified: string[] = [];
    feed.onNewPosts((posts) => notified.push(...posts.map((p) => p.url)));
    feed.addAuthor('x', '@someone', true);

    await feed.poll();
    expect(calls[0]).toContain('/users/by/username/someone');
    expect(feed.snapshot().posts.map((p) => p.id)).toEqual(['2', '1']);
    expect(notified).toEqual([]);

    await feed.poll();
    expect(calls[2]).toContain('since_id=2');
    expect(notified).toEqual(['https://x.com/someone/status/3']);
  });

  it('X: 토큰이 없거나 오류가 나면 그 사람에게 표시한다', async () => {
    const noToken = new Feed(undefined, undefined, async () => {
      throw new Error('호출되면 안 됨');
    });
    noToken.addAuthor('x', 'someone', true);
    await noToken.poll();
    expect(noToken.snapshot().authors[0].error).toContain('토큰');

    const denied = new Feed('token', undefined, async () => page(403, {}));
    denied.addAuthor('x', 'someone', true);
    await denied.poll();
    expect(denied.snapshot().authors[0].error).toContain('403');
  });

  it('트레이딩뷰: RSS 에서 제목과 링크를 읽고 새 글만 알린다', async () => {
    const item = (n: number) =>
      `<item><title><![CDATA[아이디어 ${n}]]></title><link>https://www.tradingview.com/chart/X/${n}/</link><pubDate>Sun, 22 Nov 2026 0${n}:00:00 GMT</pubDate></item>`;
    let items = [item(1)];
    const feed = new Feed(undefined, undefined, async (url) =>
      url.endsWith('/robots.txt') ? page(200, 'User-agent: *\nDisallow: /private/') : page(200, `<rss><channel>${items.join('')}</channel></rss>`),
    );
    const notified: string[] = [];
    feed.onNewPosts((posts) => notified.push(...posts.map((p) => `${p.text}|${p.url}`)));
    feed.addAuthor('tradingview', 'chartist', true);
    await feed.poll();
    items = [item(2), item(1)];
    await feed.poll();
    expect(notified).toEqual(['아이디어 2|https://www.tradingview.com/chart/X/2/']);
    expect(feed.snapshot().posts.map((p) => p.text)).toEqual(['아이디어 2', '아이디어 1']);
  });

  it('에펨코리아: 검색 화면의 글 링크를 읽는다', async () => {
    const html = '<a href="/best">인기</a><a href="/1234567890" class="t">삼전 <b>분석</b></a><a href="/index.php?mid=stock&amp;document_srl=1234567891">하닉 전망</a>';
    const feed = new Feed(undefined, undefined, async (url) => (url.endsWith('/robots.txt') ? page(404, '') : page(200, html)));
    feed.addAuthor('fmkorea', '주식고수', true);
    await feed.poll();
    expect(feed.snapshot().posts.map((p) => [p.text, p.url]).sort()).toEqual([
      ['삼전 분석', 'https://www.fmkorea.com/1234567890'],
      ['하닉 전망', 'https://www.fmkorea.com/1234567891'],
    ]);
  });

  it('사이트가 허용하지 않거나 막으면 우회하지 않고 알려 준다', async () => {
    const calls: string[] = [];
    const disallowed = new Feed(undefined, undefined, async (url) => {
      calls.push(url);
      return page(200, 'User-agent: *\nDisallow: /search.php');
    });
    disallowed.addAuthor('fmkorea', '주식고수', true);
    await disallowed.poll();
    expect(calls).toEqual(['https://www.fmkorea.com/robots.txt']);
    expect(disallowed.snapshot().authors[0].error).toContain('허용하지 않습니다');

    const blocked = new Feed(undefined, undefined, async (url) => (url.endsWith('/robots.txt') ? page(404, '') : page(430, '')));
    blocked.addAuthor('fmkorea', '주식고수', true);
    await blocked.poll();
    expect(blocked.snapshot().authors[0].error).toContain('430');
  });

  it('robots.txt 규칙 해석과 바로 가기 주소', () => {
    const robots = 'User-agent: bad\nDisallow: /\n\nUser-agent: *\nDisallow: /search\nAllow: /search/public\nDisallow: /*.json$';
    expect(robotsAllows(robots, '/feed/?username=a')).toBe(true);
    expect(robotsAllows(robots, '/search.php?x=1')).toBe(false);
    expect(robotsAllows(robots, '/search/public/1')).toBe(true);
    expect(robotsAllows(robots, '/a/b.json')).toBe(false);
    expect(authorLink({ source: 'fmkorea', handle: '주식고수' })).toContain('search_target=nick_name');
    expect(authorLink({ source: 'tradingview', handle: 'chartist' })).toBe('https://www.tradingview.com/u/chartist/');
    expect(() => new Feed(undefined).addAuthor('x', '한글아이디', true)).toThrow();
  });
});

describe('키움 클라이언트', () => {
  it('만료 시각(한국 시간)을 읽고, 읽지 못하면 1시간으로 본다', async () => {
    const { parseExpiry } = await import('../src/kiwoom/client');
    expect(parseExpiry('20261123153000')).toBe(Date.UTC(2026, 10, 23, 6, 30, 0));
    expect(parseExpiry(undefined, 1_000)).toBe(3_601_000);
  });
});
