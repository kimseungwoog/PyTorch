import { analyze } from '../../shared/analysis';
import { replay, STRATEGIES } from '../../shared/strategies';
import type { AlertEvent, AlertRule, NewAlertRule, Quote } from '../../shared/types';
import { OrderError } from './broker/types';
import { loadJson, saveJson } from './json';
import type { MarketProvider } from './market/types';

const CANDIDATE = { buy: '매수 후보', sell: '매도 후보', watch: '관망' } as const;
const won = (n: number) => n.toLocaleString('ko-KR');

interface State {
  rules: AlertRule[];
  events: AlertEvent[];
  seq: number;
}

// 알림 규칙을 서버에서 감시한다. 앱을 꺼 두어도 서버가 돌고 있으면 기록이 남는다.
//  - price: 목표가에 닿으면 한 번 울리고 사라진다.
//  - candidate: 일봉 기준 매매 후보(매수 후보·매도 후보·관망)가 바뀌면 울린다.
//  - strategy: 일봉 기준으로 전략의 새 매수·매도 신호가 나오면 울린다.
export class AlertEngine {
  private state: State;
  private seen = new Map<string, string>(); // 규칙별로 마지막에 본 상태
  private listeners: Array<(e: AlertEvent) => void> = [];

  constructor(
    private market: MarketProvider,
    private file?: string,
  ) {
    this.state = loadJson<State>(file, { rules: [], events: [], seq: 0 });
    market.onQuote((q) => this.onQuote(q));
  }

  onEvent(cb: (e: AlertEvent) => void) {
    this.listeners.push(cb);
  }

  get rules(): AlertRule[] {
    return this.state.rules;
  }

  get events(): AlertEvent[] {
    return this.state.events;
  }

  async add(input: NewAlertRule): Promise<AlertRule> {
    const stock = (await this.market.listStocks()).find((s) => s.symbol === input.symbol);
    const [quote] = await this.market.getQuotes([input.symbol]);
    if (!stock || !quote) throw new OrderError('알 수 없는 종목입니다.');
    const base = { id: `A${++this.state.seq}`, symbol: stock.symbol, name: stock.name, createdAt: Date.now() };
    let rule: AlertRule;
    if (input.kind === 'price') {
      const price = Number(input.price);
      if (!(price > 0) || price === quote.price) throw new OrderError('현재가와 다른 목표가를 넣어 주세요.');
      rule = { ...base, kind: 'price', price, op: price > quote.price ? 'gte' : 'lte' };
    } else if (input.kind === 'strategy') {
      if (!STRATEGIES.some((s) => s.id === input.strategyId)) throw new OrderError('알 수 없는 전략입니다.');
      rule = { ...base, kind: 'strategy', strategyId: input.strategyId };
    } else {
      rule = { ...base, kind: 'candidate' };
    }
    this.state.rules.push(rule);
    this.save();
    return rule;
  }

  remove(id: string) {
    this.state.rules = this.state.rules.filter((r) => r.id !== id);
    this.seen.delete(id);
    this.save();
  }

  push(title: string, body: string, symbol?: string, url?: string) {
    const event: AlertEvent = { id: `E${++this.state.seq}`, ts: Date.now(), title, body, symbol, url };
    this.state.events = [event, ...this.state.events].slice(0, 100);
    this.save();
    for (const cb of this.listeners) cb(event);
  }

  private onQuote(q: Quote) {
    for (const r of this.state.rules) {
      if (r.kind !== 'price' || r.symbol !== q.symbol) continue;
      if (r.op === 'gte' ? q.price >= r.price : q.price <= r.price) {
        this.state.rules = this.state.rules.filter((x) => x !== r);
        this.push(`${r.name} 목표가 도달`, `현재가 ${won(q.price)}원 (목표 ${won(r.price)}원 ${r.op === 'gte' ? '이상' : '이하'})`, r.symbol);
      }
    }
  }

  // 일봉으로 계산하는 규칙을 한 번 훑는다. 처음 본 상태는 기준으로만 삼고 울리지 않는다.
  async scan() {
    for (const r of [...this.state.rules]) {
      if (r.kind === 'price') continue;
      const candles = await this.market.getCandles(r.symbol, '1d', 300);
      let now: string;
      let message: [string, string];
      if (r.kind === 'candidate') {
        const a = analyze(candles);
        now = a.candidate;
        message = [`${r.name} · ${CANDIDATE[a.candidate]}(으)로 바뀜`, a.reason];
      } else {
        const strategy = STRATEGIES.find((s) => s.id === r.strategyId);
        if (!strategy) continue;
        const sig = replay(strategy, candles).signals.at(-1);
        now = sig ? `${sig.time}:${sig.type}` : '';
        message = sig
          ? [`${r.name} · ${strategy.name} ${sig.type === 'entry' ? '매수' : '매도'} 신호`, `${sig.reason} · ${won(sig.price)}원`]
          : ['', ''];
      }
      const before = this.seen.get(r.id);
      this.seen.set(r.id, now);
      if (before !== undefined && before !== now && message[0]) this.push(message[0], message[1], r.symbol);
    }
  }

  private save() {
    saveJson(this.file, this.state);
  }
}
