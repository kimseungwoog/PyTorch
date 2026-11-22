import type { RiskStatus } from '../../shared/types';
import { OrderError, type Broker } from './broker/types';
import { loadJson, saveJson } from './json';

interface State {
  day: string; // 한국 시간 날짜
  startEquity: number; // 그날 처음 본 자산
  limit: number;
}

const kstDay = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

// 하루 손실 한도: 오늘 시작 자산보다 한도만큼 줄면 그날 매수를 막는다. 매도는 막지 않는다.
export class Risk {
  private state: State;

  constructor(
    private broker: Broker,
    defaultLimit: number,
    private file?: string,
  ) {
    this.state = loadJson<State>(file, { day: '', startEquity: 0, limit: defaultLimit });
  }

  async status(): Promise<RiskStatus> {
    const { equity } = await this.broker.getAccount();
    if (this.state.day !== kstDay()) {
      this.state = { ...this.state, day: kstDay(), startEquity: equity };
      saveJson(this.file, this.state);
    }
    const dayPnl = equity - this.state.startEquity;
    const { limit } = this.state;
    return { limit, dayPnl, blocked: limit > 0 && dayPnl <= -limit };
  }

  setLimit(limit: number) {
    if (!Number.isFinite(limit) || limit < 0) throw new OrderError('한도는 0 이상의 금액이어야 합니다.');
    this.state.limit = Math.floor(limit);
    saveJson(this.file, this.state);
  }
}
