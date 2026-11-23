// 키움 REST API 클라이언트: 토큰 발급·캐시와 공통 헤더.
//
// 키움에는 API 가 세 가지 있다. 이 앱이 쓰는 것은 "키움 REST API"(openapi.kiwoom.com 에서 신청) 하나뿐이다.
// "Open API+"와 "해외파생 OpenAPI-W"는 윈도우에 설치하는 OCX 방식이라 이 서버에서 쓸 수 없다.
//
// 공개 자료로 확인한 내용:
//   - 실전 https://api.kiwoom.com , 모의투자 https://mockapi.kiwoom.com
//   - 토큰: POST /oauth2/token  본문 { grant_type: 'client_credentials', appkey, secretkey }
//           응답의 token, expires_dt(만료 시각)
//   - 호출: POST 경로 + 헤더 authorization: Bearer 토큰, api-id: TR 코드, (연속 조회) cont-yn, next-key
//   - 실시간: wss://api.kiwoom.com:10000/api/dostk/websocket  → LOGIN 뒤 REG 로 종목·항목 등록
// 응답 필드 이름은 실제 키로 호출해 확인한 뒤 어댑터에 반영한다 (npm run kiwoom:probe).

export interface KiwoomConfig {
  appKey: string;
  secretKey: string;
  mock: boolean; // true 면 모의투자 서버
}

export class KiwoomApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`키움 API 오류 ${status}: ${body.slice(0, 300)}`);
  }
}

export class KiwoomClient {
  private token?: { value: string; expiresAt: number };
  private pending?: Promise<string>;

  constructor(private cfg: KiwoomConfig) {}

  get baseUrl(): string {
    return this.cfg.mock ? 'https://mockapi.kiwoom.com' : 'https://api.kiwoom.com';
  }

  get wsUrl(): string {
    return `${this.cfg.mock ? 'wss://mockapi.kiwoom.com' : 'wss://api.kiwoom.com'}:10000/api/dostk/websocket`;
  }

  // TR 하나를 호출한다. 조회 전용으로만 쓰며, 주문 TR 은 어댑터를 만들 때 따로 다룬다.
  async request<T>(apiId: string, path: string, body: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(new URL(path, this.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          authorization: `Bearer ${await this.getToken()}`,
          'api-id': apiId,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401 && attempt === 0) {
        this.token = undefined;
        continue;
      }
      throw new KiwoomApiError(res.status, await res.text());
    }
  }

  getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return Promise.resolve(this.token.value);
    this.pending ??= this.issueToken().finally(() => (this.pending = undefined));
    return this.pending;
  }

  private async issueToken(): Promise<string> {
    const res = await fetch(new URL('/oauth2/token', this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: this.cfg.appKey, secretkey: this.cfg.secretKey }),
    });
    const text = await res.text();
    if (!res.ok) throw new KiwoomApiError(res.status, text);
    const json = JSON.parse(text) as { token?: string; expires_dt?: string; return_msg?: string };
    if (!json.token) throw new KiwoomApiError(res.status, json.return_msg ?? text);
    this.token = { value: json.token, expiresAt: parseExpiry(json.expires_dt) };
    return json.token;
  }
}

// expires_dt 는 한국 시간 "YYYYMMDDHHmmss" 꼴로 알려져 있다. 읽지 못하면 1시간으로 본다.
export function parseExpiry(text: string | undefined, now = Date.now()): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text ?? '');
  if (!m) return now + 3_600_000;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return Date.UTC(y, mo - 1, d, h - 9, mi, s);
}
