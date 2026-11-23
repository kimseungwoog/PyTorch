// 키움 REST API 연결 점검 스크립트. 조회만 하고 주문은 보내지 않는다.
// 실행: npm run kiwoom:probe   (.env 에 KIWOOM_APP_KEY / KIWOOM_SECRET_KEY 필요)
//
// 응답 원문을 그대로 출력한다(긴 목록은 앞 3개만). 이 출력으로 필드 이름을 확인해 시세 어댑터를 완성한다.
// 출력에는 키와 토큰이 들어가지 않으므로 그대로 붙여 넣어도 된다. 계좌번호 같은 개인 정보도 조회하지 않는다.
import WebSocket from 'ws';
import { KiwoomClient } from './client';

const { KIWOOM_APP_KEY, KIWOOM_SECRET_KEY } = process.env;
if (!KIWOOM_APP_KEY || !KIWOOM_SECRET_KEY) {
  console.error('.env 에 KIWOOM_APP_KEY 와 KIWOOM_SECRET_KEY 를 넣어 주세요.');
  process.exit(1);
}
const mock = process.env.KIWOOM_MOCK !== 'false';
const client = new KiwoomClient({ appKey: KIWOOM_APP_KEY, secretKey: KIWOOM_SECRET_KEY, mock });
const symbol = process.argv[2] ?? '005930';

// 긴 배열은 앞 3개만 남겨 출력한다.
const trim = (v: unknown): unknown =>
  Array.isArray(v)
    ? [...v.slice(0, 3).map(trim), ...(v.length > 3 ? [`… 외 ${v.length - 3}개`] : [])]
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x)]))
      : v;
const show = (v: unknown) => console.log(JSON.stringify(trim(v), null, 2));

console.log(`서버: ${client.baseUrl} (${mock ? '모의투자' : '실전'}) · 종목 ${symbol}`);

console.log('\n=== 1. 접근토큰 발급 (au10001) ===');
try {
  await client.getToken();
  console.log('성공');
} catch (e) {
  console.log(String(e));
  console.log('토큰을 받지 못해 여기서 멈춥니다. 앱키·시크릿키, 허용 IP 등록, 모의/실전 구분(KIWOOM_MOCK)을 확인해 주세요.');
  process.exit(1);
}

// TR 코드는 공개 자료로 확인했고, 경로는 일부만 확인됐다. 틀린 경로는 오류 응답으로 드러난다.
const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '');
const calls: Array<[string, string, string, Record<string, unknown>]> = [
  ['2. 주식기본정보 (ka10001)', 'ka10001', '/api/dostk/stkinfo', { stk_cd: symbol }],
  ['3. 주식호가 (ka10004)', 'ka10004', '/api/dostk/mrkcond', { stk_cd: symbol }],
  ['4. 일봉차트 (ka10081)', 'ka10081', '/api/dostk/chart', { stk_cd: symbol, base_dt: today, upd_stkpc_tp: '1' }],
  ['5. 분봉차트 (ka10080)', 'ka10080', '/api/dostk/chart', { stk_cd: symbol, tic_scope: '5', upd_stkpc_tp: '1' }],
];
for (const [label, apiId, path, body] of calls) {
  console.log(`\n=== ${label}: POST ${path} ===`);
  try {
    show(await client.request(apiId, path, body));
  } catch (e) {
    console.log(String(e));
  }
}

console.log('\n=== 6. 실시간 (주식체결 0B, 주식호가잔량 0D) · 10초 동안 수신 ===');
await new Promise<void>((resolve) => {
  const ws = new WebSocket(client.wsUrl);
  const seen: Record<string, number> = {};
  const done = () => {
    ws.close();
    console.log('받은 메시지 수:', seen);
    if (!Object.keys(seen).some((k) => k.startsWith('REAL'))) {
      console.log('실시간 자료가 오지 않았습니다. 장 운영 시간(평일 09:00~15:30)에 다시 실행해 보세요.');
    }
    resolve();
  };
  const timer = setTimeout(done, 10_000);
  ws.on('open', async () => ws.send(JSON.stringify({ trnm: 'LOGIN', token: await client.getToken() })));
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as { trnm?: string; data?: Array<{ type?: string }> };
    if (msg.trnm === 'PING') {
      ws.send(String(raw)); // 연결 유지용: 받은 그대로 돌려보낸다.
      return;
    }
    const key = msg.trnm === 'REAL' ? `REAL ${msg.data?.[0]?.type ?? ''}` : String(msg.trnm);
    seen[key] = (seen[key] ?? 0) + 1;
    if (seen[key] <= 2) show(msg); // 종류별로 앞 2개만 출력
    if (msg.trnm === 'LOGIN') {
      ws.send(JSON.stringify({ trnm: 'REG', grp_no: '1', refresh: '1', data: [{ item: [symbol], type: ['0B', '0D'] }] }));
    }
  });
  ws.on('error', (e) => {
    console.log('웹소켓 오류:', e.message);
    clearTimeout(timer);
    done();
  });
});
process.exit(0);
