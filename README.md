# 인간을 찾아라

인간 플레이어가 AI인 척하며 살아남는 실시간 역튜링 테스트 게임입니다. 익명 채팅에 인간과 AI가 함께 참여하고, 매 라운드 모두가 **가장 인간으로 의심되는 참가자**를 지목합니다. 인간이 끝까지 정체를 숨기면 인간 승리, 인간이 모두 추방되면 AI 승리입니다.

## 게임 규칙

1. 방장이 방을 만들고 4자리 초대 코드를 공유합니다.
2. 일반 게임과 관전 모드는 모두 인간 1명부터 시작할 수 있습니다. 일반 게임에서 혼자 입장하면 선택한 AI들과 바로 플레이합니다.
3. 시작하면 인간과 AI 모두에게 `형용사+동물` 형식의 익명 이름이 배정됩니다. 실제 닉네임과 AI 여부는 공개 전까지 숨겨집니다.
4. 각 라운드는 `CHAT → VOTE → DEFENSE → REVEAL` 순서로 진행됩니다.
   - **CHAT (90초)**: 공개된 질문 카드를 소재로 자유롭게 대화합니다.
   - **심문권 (게임당 1회)**: 생존 인간 한 명이 다른 생존자를 지목해 15초 안에 고정 질문에 답하도록 압박합니다.
   - **VOTE (30초)**: 생존자는 자신을 제외한 한 명을 “가장 인간 같다”고 지목합니다. 시간 안에 고르지 않으면 기권입니다.
   - **DEFENSE (15초)**: 최다 득표자가 공개되고, 단 한 문장의 최후 변론으로 모두를 설득합니다.
   - **REVEAL (약 15초)**: 지목과 이유가 순서대로 나타난 뒤 최다 득표자가 추방됩니다. 동점이면 동점자 중 무작위로 정합니다.
5. 인간이 모두 추방되면 AI가 즉시 승리합니다. 설정한 마지막 라운드까지 인간이 한 명 이상 생존하면 인간이 승리합니다.
6. 추방자는 읽기 전용 관전자로 남습니다. 생존 인간 수는 게임 중 공개되지 않습니다.
7. 일반 게임의 관전자는 라운드마다 익명 참가자 한 명에게 “인간 예측”을 걸 수 있습니다. 정답과 순위는 게임 종료 때만 공개됩니다.
8. 관전 모드에서는 AI 6~8명이 서로 대화하고 투표합니다. 승패 없이 마지막에 “전원 AI였습니다”와 전체 정체를 공개합니다.
9. 종료 화면에는 명탐정·가장 인간 같았던 AI 등의 칭호가 나타나며, 1080×1350 PNG 결과 카드를 저장하거나 공유할 수 있습니다.
10. 종료 화면의 **다시 하기**를 누르면 같은 방의 로비로 돌아갑니다.

### 방장 설정

| 설정 | 값 | 동작 |
| --- | --- | --- |
| AI 수 | `1~8` 또는 `random` | 직접 지정하거나 시작 순간 서버가 비밀리에 결정 |
| AI 난이도 | `mild` / `spicy` | 순한맛은 랜덤·단순 추리를 늘리고, 매운맛은 대화 기반 모델 추리를 늘림 |
| 라운드 수 | 양의 정수, 기본 `3` | 인간이 남아 있을 때 진행할 최대 라운드 |
| 관전 모드 | ON/OFF | ON이면 접속 인간은 모두 관전자, AI 6~8명만 참가 |

`random`의 실제 AI 수와 현재 생존 인간 수는 게임 도중 어떤 클라이언트에도 공개하지 않습니다.

## 기술 구성

- 클라이언트: React 18, Vite, TypeScript, Tailwind CSS
- 서버: Node.js, Express, Socket.io, TypeScript
- AI: OpenAI Chat Completions API (`OPENAI_MODEL`, 기본 `gpt-4o-mini`)
- 상태 저장: 서버 프로세스의 `Map`에 보관하는 인메모리 상태
- 배포: Express가 빌드된 `client/dist`를 함께 제공하는 Railway 단일 Node 프로세스

```text
브라우저 (React/Vite)
  ├─ Socket.io: 방·채팅·투표·타이머 이벤트
  └─ HTTP: 프로덕션 SPA 정적 파일
                  │
Express + Socket.io 서버 (authoritative state machine)
  ├─ rooms: Map<roomCode, Room>
  ├─ LOBBY → CHAT → VOTE → DEFENSE → REVEAL → END
  ├─ AI 발화/투표 스케줄러
  └─ OpenAI Chat Completions ── 실패/키 없음 ──> mock 응답
```

타이머, 투표 집계, 추방, 승패 판정은 모두 서버가 결정합니다. 클라이언트는 서버가 보낸 `endsAt`을 기준으로 남은 시간을 표시하므로 탭마다 타이머가 달라져 게임 상태가 갈라지는 일을 피합니다.

### AI 에이전트 흐름

각 AI는 게임마다 중복되지 않는 성인 페르소나를 받고, 최근 채팅 30개와 현재 질문 카드를 바탕으로 한 문장짜리 반말을 생성합니다. CHAT 중 3초마다 생존 AI의 발화 여부를 평가합니다.

- 기본 발화 확률 25%, 최근 5개 메시지에서 지목되면 80%, 질문 카드에 답하지 않았으면 60%
- 15초 이상 조용하면 AI 한 명을 강제로 선택
- AI별 직전 발화 후 8초 cooldown, 라운드당 최소 2회·최대 6회
- 선택 후 1.5~6초간 익명 `chat:typing`, 여러 AI의 시작은 최소 2초 간격. 입력 중인 참가자의 이름은 AI 정체를 누출하지 않도록 보내지 않음
- 응답은 최대 30자로 후처리하고 15% 확률로 오타를 넣으며, 두 줄이면 0.7~1.5초 간격으로 나눠 전송
- 순한맛 투표는 약 30% 랜덤·45% 발화량 휴리스틱·25% 모델 추리, 매운맛은 약 15%·25%·60%로 동작
- 모델 투표는 채팅 생성과 분리된 JSON structured output 호출로 `{ target, reason }`을 받음
- 심문당한 AI와 최다 득표 AI는 일반 발화 확률을 기다리지 않고 짧은 반말 답변·변론을 강제로 생성

OpenAI 호출에는 기본적으로 temperature `1.1`, max tokens `60`을 사용합니다. 단, 기본 temperature만 허용하는 GPT-5.6 계열은 `1`을 사용합니다. 키가 없거나 호출·검증이 실패하면 아래의 mock 경로로 즉시 이어집니다.

## 로컬 실행

필수 도구는 Node.js 20 이상과 npm 10 이상입니다.

```bash
npm install
cp .env.example .env
npm run dev
```

PowerShell에서는 환경 파일을 다음처럼 복사할 수 있습니다.

```powershell
Copy-Item .env.example .env
npm run dev
```

기본 주소는 클라이언트 `http://localhost:5173`, 서버 `http://localhost:3000`입니다. 루트의 `npm run dev`는 두 workspace를 함께 실행하며, Vite 개발 서버가 Socket.io 요청을 Express 서버로 전달합니다.

프로덕션과 같은 방식으로 확인하려면 다음을 실행합니다.

```bash
npm run build
npm start
```

이 경우 `PORT`(기본 3000)의 Express 서버 하나가 API/Socket.io와 `client/dist`를 모두 제공합니다.

### 루트 명령어

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | client와 server 개발 서버를 동시에 실행 |
| `npm run build` | client를 먼저 빌드한 뒤 server TypeScript 빌드 |
| `npm start` | 빌드된 server를 단일 프로세스로 실행 |
| `npm test` | 타입 검사 후 mock Socket.IO 전체 E2E 실행 |
| `npm run test:e2e` | 임시 포트에서 서버를 띄워 6개 실시간 시나리오 실행 |
| `npm run metrics:playtest -- server.log` | 종료 로그에서 난이도별 인간 승률과 표본 수 집계 |
| `npm run typecheck` | 두 workspace의 TypeScript 검사 실행 |

## 환경 변수

루트 `.env.example`을 `.env`로 복사한 뒤 필요에 맞게 수정합니다.

| 이름 | 필수 여부 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | 선택 | 빈 값 | 값이 없으면 mock 모드. 값이 있으면 실제 Chat Completions 호출 |
| `OPENAI_MODEL` | 선택 | `gpt-4o-mini` | AI 채팅과 투표에 사용할 모델 |
| `PORT` | 선택 | `3000` | Express/Socket.io 수신 포트. Railway가 배포 시 주입 |
| `CLIENT_ORIGIN` | 선택 | 빈 값 | 분리 배포 시 허용할 브라우저 Origin. 여러 값은 쉼표로 구분 |
| `GAME_TIME_SCALE` | 테스트 전용 | `1` | 페이즈·AI·재접속 타이머 배율. 실제 배포에서는 `1` 유지 |
| `RATE_LIMIT_DISABLED` | E2E 전용 | 빈 값 | `1`이면 요청 제한 해제. 공개 배포에서는 설정 금지 |

`.env`는 Git에서 제외됩니다. API 키를 클라이언트 변수나 브라우저 코드에 넣지 마세요.

## Mock 모드

`OPENAI_API_KEY`를 비우거나 정의하지 않으면 자동으로 mock 모드가 됩니다.

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
PORT=3000
```

mock 모드에서도 AI 발화 판단, typing 지연, 메시지 분할, 투표, 리빌, 라운드 진행과 최종 결과까지 전체 흐름이 동작합니다. 실제 API 호출도 최대 두 차례 재시도한 뒤 실패하면 같은 mock 경로로 폴백하므로 외부 장애가 게임 상태 머신을 멈추지 않습니다.

## Railway 배포

이 저장소는 루트의 `railway.json`으로 단일 서비스 배포를 구성합니다.

1. GitHub 저장소를 Railway 새 프로젝트의 서비스에 연결합니다.
2. 서비스의 Root Directory는 저장소 루트로 둡니다.
3. 첫 공개 데모는 `OPENAI_API_KEY`를 등록하지 않은 mock 모드가 안전합니다. 실제 AI를 쓸 때만 서버 Variables에 `OPENAI_API_KEY`, 필요하면 `OPENAI_MODEL`을 등록합니다. `PORT`는 Railway가 자동 주입하므로 직접 고정하지 않는 편이 좋습니다.
4. 배포하면 Railway가 `npm install --include=dev && npm run build`를 실행하고 `npm start`로 서버 하나를 시작합니다.
5. **Generate Domain**으로 공개 도메인을 만든 뒤 `/health`가 성공하는지 확인합니다.

API 키 없이 배포하면 공개 데모용 mock 모드로 그대로 동작합니다. 공개 서버는 IP별 연결·방 생성·참가 속도를 제한하고 채팅 제한은 참가자별로 분리합니다. 방은 최대 10명, 서버 전체는 최대 100개 방을 유지합니다. 로비/종료 방은 15분 무활동 시, 모든 방은 최대 2시간 후 정리됩니다. 방과 플레이어 정보는 메모리에만 있으므로 호스팅 인스턴스는 반드시 1개로 유지해야 합니다. 재배포나 프로세스 재시작 시 진행 중인 방은 복구되지 않습니다.

## 현재 공개 데모

- 전체 앱: [find-the-human-kimberry.onrender.com](https://find-the-human-kimberry.onrender.com/)
- GitHub Pages 클라이언트: [kimberry-snu.github.io/find-the-human](https://kimberry-snu.github.io/find-the-human/)

Render 무료 Web Service는 일정 시간 요청이 없으면 휴면하므로 첫 접속이 늦을 수 있습니다. 두 주소는 같은 Socket.io 서버를 사용하며, 공개 서버는 비용 사고를 막기 위해 기본적으로 OpenAI 키 없는 Mock AI 모드로 운영합니다.

## GitHub Pages 배포

GitHub Pages에는 `client/dist` 정적 프런트만 배포됩니다. Socket.IO 게임 상태와 OpenAI 호출은 Node 서버에서 실행되므로, 전체 멀티플레이를 사용하려면 Railway 등 HTTPS/WSS가 가능한 곳에 서버도 배포해야 합니다.

1. GitHub 저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 설정합니다.
2. **Settings → Secrets and variables → Actions → Variables**에 `VITE_SOCKET_URL`을 만들고 공개 Node 서버 주소(예: `https://example.up.railway.app`)를 입력합니다.
3. `main` 브랜치에 push하거나 **Actions → Deploy client to GitHub Pages → Run workflow**를 실행합니다.

워크플로는 저장소 이름으로 Vite base path를 자동 계산하므로 프로젝트 Pages의 `/저장소명/` 경로에서도 정적 자산이 정상 로드됩니다. `VITE_SOCKET_URL`은 브라우저에 포함되는 공개 주소일 뿐 비밀값이 아닙니다. `OPENAI_API_KEY`는 반드시 Node 서버의 환경 변수에만 등록하고 GitHub Pages 변수나 클라이언트 코드에는 넣지 마세요.

## Socket.io 이벤트 계약

이벤트 이름은 아래 목록을 그대로 사용합니다. `client → server` 요청에서 검증에 실패하면 서버는 요청자에게 `error`를 보냅니다.

### client → server

| 이벤트 | payload / 응답 | 용도 |
| --- | --- | --- |
| `room:create` | `{ nickname }` → ack `{ code, playerId }` | 새 방 생성 및 방장 입장 |
| `room:join` | `{ code, nickname }` → ack `{ code, playerId }` | 초대 코드로 입장 |
| `room:rejoin` | `{ playerId, code }` → ack `{ code, playerId }` | 새로고침·일시 단절 뒤 기존 플레이어 복구 |
| `room:start` | `{ aiCount: number \| 'random', rounds, spectatorMode, difficulty }` | 방장 설정으로 게임 시작 |
| `chat:send` | `{ text }` | CHAT 단계 메시지 전송, 최대 140자 |
| `vote:cast` | `{ targetAnonName }` | VOTE 단계에서 생존한 다른 참가자 지목 |
| `interrogation:use` | `{ targetAnonName }` | CHAT에서 게임당 한 번 다른 생존자 심문 |
| `spectator:bet` | `{ targetAnonName }` | 일반 게임 관전자가 라운드당 한 번 인간 예측 |
| `room:again` | 없음 | 종료된 같은 방을 로비 상태로 초기화 |

### server → client

| 이벤트 | payload | 용도 |
| --- | --- | --- |
| `room:state` | `{ players[], settings, hostId, defenseMessageSent? }` | 로비 참가자·방장·설정 및 변론 제출 상태 동기화 |
| `game:start` | `{ yourAnonName, isSpectator, participants: string[] }` | 개인 익명 이름과 섞인 참가자 목록 전달 |
| `phase:change` | `{ phase, endsAt, round, questionCard?, defenseTarget? }` | CHAT/VOTE/DEFENSE/REVEAL/END 전환과 서버 마감 시각 전달 |
| `chat:new` | `{ from, text, ts }` | 인간 또는 AI의 새 채팅 메시지 |
| `chat:typing` | `{ isTyping }` | 정체를 드러내지 않는 익명 typing 표시/해제 |
| `interrogation:start` | `{ target, question, endsAt }` | 사용자를 숨긴 시스템 긴급 심문과 서버 마감 시각 |
| `interrogation:end` | `{ target, question, answered, endedAt }` | 답변 또는 시간 만료로 심문 종료 |
| `vote:reveal` | `{ items: [{ voter, target, reason }], eliminated: { anonName, wasAI, revealName } }` | 순차 지목 연출과 추방자 공개 |
| `game:over` | `{ winner, reveal, awards, betLeaderboard }` | 승자·전체 정체·칭호·관전자 순위 공개 |
| `room:closed` | `{ code, reason }` | TTL 만료 방의 세션을 지우고 시작 화면으로 복귀 |
| `error` | `{ message }` | 유효성·권한·방 상태 오류 |

브라우저는 받은 `{ playerId, roomCode }`를 `localStorage`에 저장하고 다음 접속에서 `room:rejoin`을 먼저 시도합니다. 복구할 방이나 플레이어가 없으면 저장값을 지우고 홈으로 돌아갑니다.

## 구현 결정 사항

명시되지 않은 세부 동작은 데모 안정성과 모바일 플레이를 우선해 다음처럼 정했습니다.

- 서버를 단일 진실 공급원으로 두고 클라이언트는 상태 전환을 직접 확정하지 않습니다. 단계 타이머도 서버의 절대 시각 `endsAt`을 사용합니다.
- 초대 코드는 대문자로 정규화하며, 이미 사용 중인 코드와 충돌하면 다시 생성합니다. 닉네임은 공백을 정리한 뒤 같은 방 안에서 중복을 거부합니다.
- AI 수 `random`은 시작 순간 인간 수를 기준으로 `인간 수-1 ~ 인간 수+2` 범위에서 고르되 최소 2·최대 8로 보정하고, 확정 수나 생존 인간 카운터를 별도 payload/UI로 노출하지 않습니다. 다만 스펙상 전체 익명 참가자 목록도 제공하므로 로비 인원을 기억한 사용자는 총원으로 초기 AI 수를 추론할 수 있습니다.
- 참가자 표시 순서와 익명 이름, AI 페르소나는 게임마다 섞으며 같은 게임 안에서는 중복 배정하지 않습니다.
- 전원 기권이면 아무도 추방하지 않고 다음 라운드로 진행합니다. 최다 득표 동률은 서버가 동률 후보 중 무작위로 결정합니다.
- 최다 득표자는 VOTE 종료 순간 한 번만 확정합니다. DEFENSE 중에는 투표를 바꿀 수 없고, 변론이 끝나도 같은 대상이 REVEAL에서 공개됩니다.
- 심문권은 방 전체에서 게임당 한 번이며 먼저 사용한 생존 인간에게 적용됩니다. 누가 사용했는지는 공개 payload에서 숨겨 인간 정체 단서가 되지 않게 하고, AI는 즉시 강제 답변하며 인간은 평소 채팅 입력으로 답합니다.
- 관전자 베팅의 정답 여부와 점수는 END 전까지 다른 사용자에게 보내지 않습니다. AI-only 관전 모드에서는 인간 예측 베팅을 막습니다.
- `room:rejoin`의 비밀 토큰은 본인에게만 보내며, 다른 참가자의 목록에는 재접속에 사용할 수 없는 공개 ID만 제공합니다.
- 게임 중 새로 입장한 사람과 추방된 사람은 읽기 전용 관전자입니다. 관전자는 채팅과 투표를 보지만 제출할 수 없습니다.
- 연결이 끊긴 인간은 60초 동안 자리를 보존합니다. 그 안에 `room:rejoin`하면 이어서 참여하고, 초과하면 자동 추방·정체 공개 후 기존 `playerId`를 만료시킵니다. 같은 사용자가 다시 들어오려면 일반 `room:join`으로 새 관전자 세션을 받아야 합니다.
- 공개된 추방 정체는 게임 내 이력으로 누적해 재접속 스냅샷에서도 복원합니다. 여러 자동 추방이 동시에 발생하면 클라이언트가 공개 카드를 큐로 순차 재생합니다.
- 방장이 나가면 현재 연결된 다음 인간에게 방장 권한을 넘깁니다. 인메모리 구조이므로 서버 재시작을 넘는 재접속은 지원하지 않습니다.
- OpenAI 키가 없거나 응답이 실패·지연·형식 오류인 경우 mock 응답을 사용합니다. 전송 오류는 최초 요청과 두 번의 재시도까지만 허용하고 페이즈 마감에 맞춰 취소합니다. AI 투표 대상이 유효하지 않으면 한 번 다시 요청하고, 다시 실패하면 가능한 대상 중 무작위로 투표합니다.
- Chat Completions의 현재 토큰 제한 필드인 `max_completion_tokens: 60`을 사용하고, AI 투표는 엄격한 `json_schema` Structured Output으로 받습니다. 요청된 기본 모델 `gpt-4o-mini`는 그대로 유지합니다.
- AI의 답변은 최대 30자로 정리하고, 두 줄은 두 메시지로 나눕니다. 15% 오타 주입과 1.5~6초 typing 지연을 적용하되 단계가 바뀌면 예약된 채팅을 폐기합니다.
- Mock 질문 답변도 20개 카드의 의미에 맞춰 생성하며, 일부 응답은 두 줄로 만들어 API 키 없이도 메시지 분할 경로를 실행합니다.
- 리빌 목록은 모바일 내부 스크롤과 자동 이동을 사용하고, 참가자가 많으면 서버가 0.8초 공개 간격에 맞춰 REVEAL 시간을 15초보다 길게 자동 확장합니다.
- 프로덕션은 한 Node 프로세스가 정적 SPA와 Socket.io를 함께 제공해 별도 CORS 설정이나 두 서비스 간 배포 순서 문제를 만들지 않습니다.

## 테스트

### 자동 검사

```bash
npm run typecheck
npm test
npm run build
```

`npm test`는 빈 OpenAI 키와 임시 포트, 축소된 테스트 타이머를 사용합니다. 일반 1인+AI 3명 및 2인+AI 3명 게임, 심문, 관전자 베팅, 최후 변론, 엔딩 칭호, 3라운드, 재접속, 세션 탈취 방어, 정체 비공개 계약, 권한·입력 검증, 자동 추방, 관전 AI-only, 랜덤 AI 모드를 실제 Socket.IO 연결로 확인하고 자식 서버를 자동 정리합니다.

심사용 60초 진행 순서, 녹화 체크리스트와 승률 표기 원칙은 [데모 런북](docs/DEMO_RUNBOOK.md)에 정리했습니다. 게임 종료 로그는 채팅 원문이나 닉네임 없이 `game_complete` JSON 한 줄을 남기며 `npm run metrics:playtest`로 난이도별 인간 승률을 집계할 수 있습니다.

빌드 후 `npm start`를 실행하고 `http://localhost:3000/health`도 확인합니다.

### 핵심 수동 시나리오

1. `OPENAI_API_KEY`를 비운 채 개발 서버를 시작합니다.
2. 한 브라우저에서 방을 만든 뒤 AI 3명, 1라운드, 관전 모드 OFF로 혼자 시작해 전체 흐름을 확인합니다.
3. 멀티플레이도 확인하려면 일반 창과 시크릿 창(또는 서로 다른 브라우저)에서 각각 닉네임을 입력합니다.
4. 첫 창에서 방을 만들고 둘째 창에서 4자리 코드로 참가한 뒤, 방장이 AI 3명, 3라운드, 관전 모드 OFF로 시작합니다.
5. 다음 항목을 끝까지 확인합니다.
   - 질문 카드와 서버 기준 타이머가 두 탭에서 같은 단계로 바뀌는가
   - AI가 typing을 보인 뒤 말하고, 가끔 오타 및 분할 메시지를 보내는가
   - CHAT에서만 입력할 수 있고 VOTE에서는 자신을 제외한 생존자만 고를 수 있는가
   - AI의 지목 이유가 한 건씩 나타난 뒤 추방 카드가 뒤집히는가
   - 추방자가 관전자 UI로 전환되고 최종 결과에 모든 정체가 나타나는가
   - **다시 하기**가 같은 방 로비로 복귀시키는가
6. 진행 중 한 탭을 새로고침해 `room:rejoin`으로 같은 익명 참가자가 복구되는지 확인합니다.
7. AI 수를 `random`으로 바꿔 실제 AI 수가 게임 중 노출되지 않는지 확인합니다.
8. 새 방에서 관전 모드 ON으로 시작해 AI 6~8명만 플레이하고 마지막에 “전원 AI였습니다”가 나타나는지 확인합니다.

### 엣지 케이스 체크

- 동일 닉네임 거부, 잘못된/없는 초대 코드 오류
- 비방장의 시작 요청 및 단계에 맞지 않는 채팅·투표 거부
- 140자를 넘는 메시지 거부, 공백 메시지 거부
- 인간 미투표와 전원 기권 처리
- 동률 무작위 추방
- 방장 이탈 시 권한 위임
- 연결 해제 후 60초 안 재접속 및 60초 초과 자동 추방
- 게임 도중 참가자의 자동 관전자 전환
- OpenAI 오류 시 재시도 뒤 mock 폴백
- 개발자 도구의 375px 너비에서 홈, 로비, 게임, 투표, 리빌, 결과 화면의 가로 넘침 여부

## 알려진 운영 제약

- 데이터베이스가 없어 서버 재시작·재배포 시 방과 게임 상태가 사라집니다.
- 여러 프로세스나 replica 사이의 상태 공유가 없으므로 수평 확장을 지원하지 않습니다.
- 초대 코드는 짧고 공개 데모를 위한 값이며 인증이나 비공개 로비 보안 수단이 아닙니다.
