// 토스증권 Open API 클라이언트: 토큰 발급·캐시, 그룹별 호출 한도, 공통 헤더.
//
// 공개 자료로 확인한 내용만 구현했다.
//   - 토큰: POST {base}/oauth2/token (grant_type=client_credentials)
//   - 계좌·주문 요청에는 X-Tossinvest-Account 헤더가 추가로 필요
//   - 호출 한도: 시세 초당 10회, 주문 초당 6회 (09:00~09:10 은 3회)
//   - 토큰을 새로 발급하면 이전 토큰이 무효가 된다는 자료가 있어 발급은 한 번에 하나만 한다.
// 응답 스키마는 실제 키로 호출해 확인한 뒤 어댑터(market.ts, broker.ts)에 반영한다.

export interface TossConfig {
  clientId: string;
  clientSecret: string;
  account?: string;
  baseUrl: string;
}

export type RateGroup = 'market' | 'order';

class RateLimiter {
  private stamps: number[] = [];
  constructor(private perSecond: () => number) {}

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 1_000);
      if (this.stamps.length < this.perSecond()) {
        this.stamps.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, 1_000 - (now - this.stamps[0]) + 5));
    }
  }
}

function orderLimit(): number {
  // 장 시작 직후 10분(한국 시간)은 주문 한도가 절반이다.
  const kst = new Date(Date.now() + 9 * 3_600_000);
  return kst.getUTCHours() === 9 && kst.getUTCMinutes() < 10 ? 3 : 6;
}

export class TossApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`토스증권 API 오류 ${status}: ${body.slice(0, 300)}`);
  }
}

export class TossClient {
  private token?: { value: string; expiresAt: number };
  private pending?: Promise<string>;
  private limiters: Record<RateGroup, RateLimiter> = {
    market: new RateLimiter(() => 10),
    order: new RateLimiter(orderLimit),
  };

  constructor(private cfg: TossConfig) {}

  async request<T>(
    group: RateGroup,
    method: 'GET' | 'POST',
    path: string,
    opts: { query?: Record<string, string>; body?: unknown; account?: boolean } = {},
  ): Promise<T> {
    const url = new URL(path, this.cfg.baseUrl);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

    for (let attempt = 0; ; attempt++) {
      await this.limiters[group].take();
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.getToken()}` };
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      if (opts.account) {
        if (!this.cfg.account) throw new Error('TOSS_ACCOUNT 가 설정되지 않았습니다.');
        headers['X-Tossinvest-Account'] = this.cfg.account;
      }
      const res = await fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      if (res.ok) return (await res.json()) as T;
      // 토큰 만료는 한 번만 재발급해 재시도한다. 주문(POST)은 중복 주문 위험이 있어 429 에도 재시도하지 않는다.
      if (res.status === 401 && attempt === 0) {
        this.token = undefined;
        continue;
      }
      if (res.status === 429 && method === 'GET' && attempt < 3) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw new TossApiError(res.status, await res.text());
    }
  }

  private getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return Promise.resolve(this.token.value);
    this.pending ??= this.issueToken().finally(() => (this.pending = undefined));
    return this.pending;
  }

  private async issueToken(): Promise<string> {
    const res = await fetch(new URL('/oauth2/token', this.cfg.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
    });
    if (!res.ok) throw new TossApiError(res.status, await res.text());
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3_600) * 1_000 };
    return json.access_token;
  }
}
