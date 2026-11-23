# TradeDeck

키움 REST API 를 쓰는 개인용 트레이딩 앱. 지금은 웹 단계로, 모의 시세와 모의투자로 동작한다. 실제 돈은 움직이지 않는다.

- **거래**: 실시간 시세, 봉 차트, 호가, 지정가·시장가 주문, 자산·주문 내역
- **분석**: 기술 상태 판정과 매매 후보, 타점·비중 계산, 차트 지표 12종, 원가 분포 추정, 시장 순위, 스크리너, 전략 전광판, 주가 경로 추정

- **보조**: 알림, 손절·익절 묶음 주문, 하루 손실 한도, 매매 일지, 차트에 선 그리기, 전략 비교, 새 글 알림(X·트레이딩뷰·에펨코리아)

분석 결과는 이 앱의 모의 규칙으로 계산한 참고값이며 투자 권유가 아니다.

설계와 앞으로의 단계는 [docs/DESIGN.md](docs/DESIGN.md) 에 있다.

## 실행

이 앱은 **본인 PC 에서** 실행한다. 증권사 API 는 등록한 IP 에서만 호출할 수 있기 때문이다.

1. [Node.js](https://nodejs.org) 22 이상(LTS)을 설치한다.
2. 코드를 받는다. 터미널(윈도우는 PowerShell)에서:

   ```bash
   git clone -b ccr-28c0ad52-4e3ces https://github.com/kimseungwoog/PyTorch.git tradedeck
   cd tradedeck
   ```

   git 이 없으면 GitHub 저장소 화면에서 브랜치를 `ccr-28c0ad52-4e3ces` 로 바꾸고 Code > Download ZIP 으로 받아 압축을 푼 뒤, 그 폴더에서 터미널을 연다.
3. 그 폴더(안에 `package.json` 이 보이는 곳)에서:

   ```bash
   npm install
   npm run dev
   ```

4. 브라우저에서 http://localhost:5173 을 연다. 끌 때는 터미널에서 Ctrl+C.

휴대폰 화면은 브라우저 개발자 도구(F12)의 기기 모드로 볼 수 있다.

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 서버(8787)와 웹(5173)을 함께 실행 |
| `npm test` | 모의투자·호가 단위·봉·지표·판정·전략 테스트 |
| `npm run typecheck` | 타입 검사 |
| `npm run build` | 웹 빌드 |
| `npm run kiwoom:probe` | 키움 REST API 연결 점검 (조회만, 주문 없음) |
| `npm run toss:probe` | 토스증권 연결 점검 (조회만, 주문 없음) |

모의투자 잔고, 알림, 손실 한도, 새 글 알림 설정은 `server/data/` 에 저장된다. 폴더를 지우면 처음(1,000만 원)으로 돌아간다.

## 키움 REST API 연결

키움에는 API 가 세 가지 있고, 이 앱은 **키움 REST API** 만 쓴다.

| 이름 | 방식 | 이 앱에서 |
| --- | --- | --- |
| 키움 REST API | 인터넷 주소로 호출 (윈도우·맥·리눅스) | 사용 |
| Open API+ | 윈도우에 설치하는 OCX | 사용 불가 |
| 해외파생 OpenAPI-W | 윈도우에 설치하는 OCX, 해외선물·옵션 전용 | 사용 불가 |

1. https://openapi.kiwoom.com 에서 로그인해 API 사용 신청을 하고, 앱키·시크릿키를 발급받고 내 PC 의 IP 를 등록한다. 처음에는 모의투자용으로 받는 것을 권한다.
2. `.env.example` 을 `.env` 로 복사해 `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY` 를 채운다. 실전 키라면 `KIWOOM_MOCK=false`.
3. `npm run kiwoom:probe` 를 실행한다. 실시간 자료는 장 운영 시간(평일 09:00~15:30)에만 온다.

출력에는 키와 토큰이 들어가지 않는다. 이 출력으로 응답 형식을 확인해 실제 시세를 연결한다.

## 토스증권 연결 (선택)

1. 토스증권 WTS > 설정 > Open API 에서 키를 발급하고 내 IP 를 허용 목록에 등록한다.
2. `.env.example` 을 `.env` 로 복사해 `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`, `TOSS_ACCOUNT` 를 채운다.
3. `npm run toss:probe` 를 실행한다.

출력된 응답으로 시세·주문 어댑터를 완성한다. 자세한 순서는 설계 문서 5장에 있다.
