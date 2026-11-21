// 토스증권 Open API 연결 점검 스크립트. 조회 전용이며 주문은 보내지 않는다.
// 실행: npm run toss:probe  (.env 에 TOSS_CLIENT_ID / TOSS_CLIENT_SECRET / TOSS_ACCOUNT 필요)
//
// 응답 원문을 그대로 출력한다. 이 출력으로 필드 이름을 확인한 뒤 시세·주문 어댑터를 완성한다.
import { TossClient } from './client';

const { TOSS_CLIENT_ID, TOSS_CLIENT_SECRET, TOSS_ACCOUNT } = process.env;
if (!TOSS_CLIENT_ID || !TOSS_CLIENT_SECRET) {
  console.error('.env 에 TOSS_CLIENT_ID 와 TOSS_CLIENT_SECRET 을 넣어 주세요.');
  process.exit(1);
}

const client = new TossClient({
  clientId: TOSS_CLIENT_ID,
  clientSecret: TOSS_CLIENT_SECRET,
  account: TOSS_ACCOUNT,
  baseUrl: process.env.TOSS_BASE_URL ?? 'https://openapi.tossinvest.com',
});

// 공개 자료에서 경로가 확인된 조회 API.
const probes: Array<{ label: string; path: string; query?: Record<string, string>; account?: boolean }> = [
  { label: '종목 정보', path: '/api/v1/stocks', query: { symbols: '005930' } },
  { label: '계좌 목록', path: '/api/v1/accounts' },
  { label: '보유 종목', path: '/api/v1/holdings', account: true },
];

for (const p of probes) {
  console.log(`\n=== ${p.label}: GET ${p.path} ===`);
  if (p.account && !TOSS_ACCOUNT) {
    console.log('TOSS_ACCOUNT 가 없어 건너뜀');
    continue;
  }
  try {
    const json = await client.request('market', 'GET', p.path, { query: p.query, account: p.account });
    console.log(JSON.stringify(json, null, 2));
  } catch (e) {
    console.log(String(e));
  }
}
