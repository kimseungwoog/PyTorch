# TradeDeck

토스증권 Open API 를 쓰는 개인용 트레이딩 앱. 지금은 웹 1단계로, 모의 시세와 모의투자로 동작한다. 실제 돈은 움직이지 않는다.

설계와 앞으로의 단계는 [docs/DESIGN.md](docs/DESIGN.md) 에 있다.

## 실행

Node 22 이상이 필요하다.

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:5173 을 연다. 휴대폰 화면은 브라우저 개발자 도구의 기기 모드로 볼 수 있다.

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 서버(8787)와 웹(5173)을 함께 실행 |
| `npm test` | 모의투자·호가 단위·봉 계산 테스트 |
| `npm run typecheck` | 타입 검사 |
| `npm run build` | 웹 빌드 |
| `npm run toss:probe` | 토스증권 연결 점검 (조회만, 주문 없음) |

모의투자 잔고는 `server/data/paper.json` 에 저장된다. 지우면 처음(1,000만 원)으로 돌아간다.

## 토스증권 연결

1. 토스증권 WTS > 설정 > Open API 에서 키를 발급하고 내 IP 를 허용 목록에 등록한다.
2. `.env.example` 을 `.env` 로 복사해 `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`, `TOSS_ACCOUNT` 를 채운다.
3. `npm run toss:probe` 를 실행한다.

출력된 응답으로 시세·주문 어댑터를 완성한다. 자세한 순서는 설계 문서 5장에 있다.
