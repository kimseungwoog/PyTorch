import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { analyze, ratingLabel } from '../../shared/analysis';
import type { ClientMessage, Interval, OrderRequest, ScreenerRow, ServerMessage, ServerStatus } from '../../shared/types';
import { INTERVAL_SEC } from '../../shared/market';
import { PaperBroker } from './broker/paper';
import { OrderError } from './broker/types';
import { MockMarket } from './market/mock';

const env = process.env;
const PORT = Number(env.PORT ?? 8787);
// 이 서버에는 아직 로그인 기능이 없다. 기본값은 내 PC 에서만 접속되는 127.0.0.1 이다.
const HOST = env.HOST ?? '127.0.0.1';
const feeRate = Number(env.FEE_RATE ?? 0.00015);
const sellTaxRate = Number(env.SELL_TAX_RATE ?? 0.0015);
const maxOrderAmount = Number(env.MAX_ORDER_AMOUNT ?? 5_000_000);

if ((env.MARKET_PROVIDER ?? 'mock') !== 'mock' || (env.BROKER ?? 'paper') !== 'paper') {
  // 토스증권 어댑터는 실제 응답 스키마를 확인한 뒤 연결한다 (docs/DESIGN.md 5장).
  console.error('토스증권 연동은 아직 연결 전입니다. 먼저 `npm run toss:probe` 로 응답을 확인해 주세요.');
  process.exit(1);
}

const market = new MockMarket();
const broker = new PaperBroker(market, {
  initialCash: Number(env.PAPER_INITIAL_CASH ?? 10_000_000),
  feeRate,
  sellTaxRate,
  file: fileURLToPath(new URL('../data/paper.json', import.meta.url)),
});
await broker.init();
await market.start();

const app = express();
app.use(express.json());

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

app.get('/api/stocks', async (_req, res) => res.json(await market.listStocks()));
app.get('/api/quotes', async (_req, res) => res.json(await market.getQuotes()));

app.get('/api/candles/:symbol', async (req, res) => {
  const interval = String(req.query.interval ?? '1d') as Interval;
  if (!(interval in INTERVAL_SEC)) throw new OrderError('지원하지 않는 봉 주기입니다.');
  const count = Math.min(Number(req.query.count ?? 300) || 300, 1_000);
  res.json(await market.getCandles(req.params.symbol, interval, count));
});

// 스크리너: 전 종목의 기술 평가를 한 번에 계산한다.
app.get('/api/screener', async (req, res) => {
  const interval = String(req.query.interval ?? '1d') as Interval;
  if (!(interval in INTERVAL_SEC)) throw new OrderError('지원하지 않는 봉 주기입니다.');
  const stocks = await market.listStocks();
  const quotes = new Map((await market.getQuotes()).map((q) => [q.symbol, q]));
  const rows: ScreenerRow[] = [];
  for (const s of stocks) {
    const q = quotes.get(s.symbol);
    if (!q) continue;
    const candles = await market.getCandles(s.symbol, interval, 300);
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

app.get('/api/orderbook/:symbol', async (req, res) => res.json(await market.getOrderbook(req.params.symbol)));
app.get('/api/account', async (_req, res) => res.json(await broker.getAccount()));
app.get('/api/holdings', async (_req, res) => res.json(await broker.getHoldings()));
app.get('/api/orders', async (_req, res) => res.json(await broker.listOrders()));

app.post('/api/orders', async (req, res) => {
  const body = req.body as OrderRequest;
  const reqOrder: OrderRequest = {
    symbol: String(body.symbol),
    side: body.side,
    type: body.type,
    qty: Number(body.qty),
    price: body.price === undefined ? undefined : Number(body.price),
  };
  // 주문 금액 상한. 어떤 브로커를 쓰든 서버에서 한 번 더 막는다.
  const [quote] = await market.getQuotes([reqOrder.symbol]);
  const refPrice = reqOrder.type === 'limit' ? reqOrder.price : quote?.price;
  if (refPrice && reqOrder.qty * refPrice > maxOrderAmount) {
    throw new OrderError(`1회 주문 한도(${maxOrderAmount.toLocaleString('ko-KR')}원)를 넘었습니다.`);
  }
  res.status(201).json(await broker.placeOrder(reqOrder));
});

app.delete('/api/orders/:id', async (req, res) => res.json(await broker.cancelOrder(req.params.id)));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof OrderError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const subscriptions = new Map<WebSocket, string>(); // 소켓별 호가를 받는 종목

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
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
  for (const ws of wss.clients) send(ws, { type: 'quote', data: q });
  const watchers = [...subscriptions].filter(([, symbol]) => symbol === q.symbol);
  if (!watchers.length) return;
  const book = await market.getOrderbook(q.symbol);
  for (const [ws] of watchers) send(ws, { type: 'orderbook', data: book });
});

broker.onOrder((o) => {
  for (const ws of wss.clients) send(ws, { type: 'order', data: o });
});

server.listen(PORT, HOST, () => {
  console.log(`서버 실행: http://${HOST}:${PORT}  (시세=${market.name}, 주문=${broker.name})`);
});
