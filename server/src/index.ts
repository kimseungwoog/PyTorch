import { createServer } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { analyze, ratingLabel } from '../../shared/analysis';
import { INTERVAL_SEC } from '../../shared/market';
import { replay, STRATEGIES } from '../../shared/strategies';
import type {
  ClientMessage,
  FeedSource,
  Interval,
  NewAlertRule,
  OrderRequest,
  ScreenerRow,
  ServerMessage,
  ServerStatus,
  StrategyMatrixRow,
} from '../../shared/types';
import { AlertEngine } from './alerts';
import { PaperBroker } from './broker/paper';
import { OrderError } from './broker/types';
import { Feed } from './feed';
import { dataFile } from './json';
import { MockMarket } from './market/mock';
import { Risk } from './risk';

const env = process.env;
const PORT = Number(env.PORT ?? 8787);
// 이 서버에는 아직 로그인 기능이 없다. 기본값은 내 PC 에서만 접속되는 127.0.0.1 이다.
const HOST = env.HOST ?? '127.0.0.1';
const feeRate = Number(env.FEE_RATE ?? 0.00015);
const sellTaxRate = Number(env.SELL_TAX_RATE ?? 0.0015);
const maxOrderAmount = Number(env.MAX_ORDER_AMOUNT ?? 5_000_000);

if ((env.MARKET_PROVIDER ?? 'mock') !== 'mock' || (env.BROKER ?? 'paper') !== 'paper') {
  // 증권사 어댑터는 실제 응답 스키마를 확인한 뒤 연결한다 (docs/DESIGN.md 5장).
  console.error('증권사 연동은 아직 연결 전입니다. 먼저 `npm run toss:probe` 로 응답을 확인해 주세요.');
  process.exit(1);
}

const market = new MockMarket();
const broker = new PaperBroker(market, {
  initialCash: Number(env.PAPER_INITIAL_CASH ?? 10_000_000),
  feeRate,
  sellTaxRate,
  file: dataFile('paper.json'),
});
const risk = new Risk(broker, Number(env.DAILY_LOSS_LIMIT ?? 300_000), dataFile('risk.json'));
const alerts = new AlertEngine(market, dataFile('alerts.json'));
const feed = new Feed(env.X_BEARER_TOKEN || undefined, dataFile('feed.json'));
await broker.init();
await market.start();
await risk.status();
setInterval(() => void alerts.scan().catch(console.error), 10_000);
feed.start();

const app = express();
app.use(express.json());

const interval = (req: Request): Interval => {
  const v = String(req.query.interval ?? '1d') as Interval;
  if (!(v in INTERVAL_SEC)) throw new OrderError('지원하지 않는 봉 주기입니다.');
  return v;
};

app.get('/api/status', (_req, res) => {
  const status: ServerStatus = {
    marketProvider: market.name,
    broker: broker.name,
    live: broker.live,
    feeRate,
    sellTaxRate,
    maxOrderAmount,
  };
  res.json(status);
});

// ---------- 시세 ----------
app.get('/api/stocks', async (_req, res) => res.json(await market.listStocks()));
app.get('/api/quotes', async (_req, res) => res.json(await market.getQuotes()));
app.get('/api/orderbook/:symbol', async (req, res) => res.json(await market.getOrderbook(req.params.symbol)));
app.get('/api/candles/:symbol', async (req, res) => {
  const count = Math.min(Number(req.query.count ?? 300) || 300, 1_000);
  res.json(await market.getCandles(req.params.symbol, interval(req), count));
});

// ---------- 분석 ----------
// 스크리너: 전 종목의 기술 평가를 한 번에 계산한다.
app.get('/api/screener', async (req, res) => {
  const iv = interval(req);
  const quotes = new Map((await market.getQuotes()).map((q) => [q.symbol, q]));
  const rows: ScreenerRow[] = [];
  for (const s of await market.listStocks()) {
    const q = quotes.get(s.symbol);
    if (!q) continue;
    const candles = await market.getCandles(s.symbol, iv, 300);
    const a = analyze(candles);
    // 거래량 배수는 진행 중인 마지막 봉을 빼고 확정 봉으로 계산한다.
    const done = candles.slice(0, -1);
    const prior = done.slice(-21, -1);
    const avg = prior.reduce((x, c) => x + c.volume, 0) / (prior.length || 1);
    rows.push({
      symbol: s.symbol,
      name: s.name,
      price: q.price,
      changeRate: q.changeRate,
      gapRate: (q.open - q.prevClose) / q.prevClose,
      volumeMultiple: prior.length === 20 && avg > 0 ? done[done.length - 1].volume / avg : null,
      value: q.value,
      score: a.scores.all,
      rating: ratingLabel(a.scores.all),
      candidate: a.candidate,
      reason: a.reason,
    });
  }
  res.json(rows);
});

// 전략 비교: 모든 전략을 전 종목의 과거 봉에 돌린 결과.
app.get('/api/strategy-matrix', async (req, res) => {
  const iv = interval(req);
  const rows: StrategyMatrixRow[] = [];
  for (const s of await market.listStocks()) {
    const candles = await market.getCandles(s.symbol, iv, 500);
    rows.push({
      symbol: s.symbol,
      name: s.name,
      cells: STRATEGIES.map((st) => {
        const r = replay(st, candles);
        return { strategyId: st.id, trades: r.trades, winRate: r.winRate, totalReturn: r.totalReturn, holding: r.holding };
      }),
    });
  }
  res.json(rows);
});

// ---------- 계좌·주문 ----------
app.get('/api/account', async (_req, res) => res.json(await broker.getAccount()));
app.get('/api/holdings', async (_req, res) => res.json(await broker.getHoldings()));
app.get('/api/orders', async (_req, res) => res.json(await broker.listOrders()));
app.get('/api/brackets', async (_req, res) => res.json(await broker.listBrackets()));
app.delete('/api/brackets/:id', async (req, res) => res.json(await broker.cancelBracket(req.params.id)));
app.get('/api/risk', async (_req, res) => res.json(await risk.status()));
app.put('/api/risk', async (req, res) => {
  risk.setLimit(Number((req.body as { limit?: number }).limit));
  res.json(await risk.status());
});

const optional = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

app.post('/api/orders', async (req, res) => {
  const body = req.body as OrderRequest;
  const reqOrder: OrderRequest = {
    symbol: String(body.symbol),
    side: body.side,
    type: body.type,
    qty: Number(body.qty),
    price: optional(body.price),
    stopPrice: optional(body.stopPrice),
    takePrice: optional(body.takePrice),
    memo: typeof body.memo === 'string' ? body.memo : undefined,
  };
  // 아래 두 가지는 어떤 브로커를 쓰든 서버에서 막는다.
  const [quote] = await market.getQuotes([reqOrder.symbol]);
  const refPrice = reqOrder.type === 'limit' ? reqOrder.price : quote?.price;
  if (refPrice && reqOrder.qty * refPrice > maxOrderAmount) {
    throw new OrderError(`1회 주문 한도(${maxOrderAmount.toLocaleString('ko-KR')}원)를 넘었습니다.`);
  }
  if (reqOrder.side === 'buy' && (await risk.status()).blocked) {
    throw new OrderError('오늘 손실이 하루 한도에 닿아 매수를 막았습니다. 매도는 할 수 있습니다.');
  }
  res.status(201).json(await broker.placeOrder(reqOrder));
});

app.delete('/api/orders/:id', async (req, res) => res.json(await broker.cancelOrder(req.params.id)));
app.put('/api/orders/:id/memo', async (req, res) =>
  res.json(await broker.setMemo(req.params.id, String((req.body as { memo?: string }).memo ?? ''))),
);

// ---------- 알림 ----------
app.get('/api/alerts', (_req, res) => res.json({ rules: alerts.rules, events: alerts.events }));
app.post('/api/alerts', async (req, res) => res.status(201).json(await alerts.add(req.body as NewAlertRule)));
app.delete('/api/alerts/:id', (req, res) => {
  alerts.remove(req.params.id);
  res.json({ ok: true });
});

// ---------- 새 글 알림 ----------
app.get('/api/feed', (_req, res) => res.json(feed.snapshot()));
app.post('/api/feed/authors', (req, res) => {
  const b = req.body as { source: FeedSource; handle: string; notify?: boolean };
  feed.addAuthor(b.source, String(b.handle ?? ''), b.notify !== false);
  void feed.poll().then(() => broadcast({ type: 'feed' }));
  res.status(201).json(feed.snapshot());
});
app.delete('/api/feed/authors/:id', (req, res) => {
  feed.removeAuthor(req.params.id);
  res.json(feed.snapshot());
});
app.put('/api/feed/interval', (req, res) => {
  feed.setInterval(Number((req.body as { min?: number }).min));
  res.json(feed.snapshot());
});
app.post('/api/feed/poll', async (_req, res) => {
  await feed.poll();
  res.json(feed.snapshot());
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof OrderError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

// ---------- 실시간 ----------
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const subscriptions = new Map<WebSocket, string>(); // 소켓별 호가를 받는 종목

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMessage) {
  for (const ws of wss.clients) send(ws, msg);
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as ClientMessage;
      if (msg.type === 'subscribe') subscriptions.set(ws, String(msg.symbol));
    } catch {
      // 형식이 잘못된 메시지는 무시한다.
    }
  });
  ws.on('close', () => subscriptions.delete(ws));
});

market.onQuote(async (q) => {
  broadcast({ type: 'quote', data: q });
  const watchers = [...subscriptions].filter(([, symbol]) => symbol === q.symbol);
  if (!watchers.length) return;
  const book = await market.getOrderbook(q.symbol);
  for (const [ws] of watchers) send(ws, { type: 'orderbook', data: book });
});

broker.onOrder((o) => {
  broadcast({ type: 'order', data: o });
  if (o.status === 'filled') {
    const side = o.side === 'buy' ? '매수' : '매도';
    alerts.push(
      `${o.name} ${o.note ?? `${side} 체결`}`,
      `${o.qty.toLocaleString('ko-KR')}주 · ${o.avgFillPrice.toLocaleString('ko-KR')}원`,
      o.symbol,
    );
  }
});

alerts.onEvent((e) => broadcast({ type: 'alert', data: e }));

const SOURCE_NAME = { x: 'X', fmkorea: '에펨코리아', tradingview: '트레이딩뷰' } as const;
feed.onNewPosts((posts, author) => {
  // 글마다 링크가 달린 알림을 하나씩 남긴다. 한꺼번에 많이 올라와도 5개까지만 울린다.
  for (const p of posts.slice(0, 5).reverse()) {
    alerts.push(`${SOURCE_NAME[author.source]} · ${author.handle} 새 글`, p.text.slice(0, 120), undefined, p.url);
  }
  broadcast({ type: 'feed' });
});

server.listen(PORT, HOST, () => {
  console.log(`서버 실행: http://${HOST}:${PORT}  (시세=${market.name}, 주문=${broker.name})`);
});
