# PPC (Product Problem Clear) 프로토타입

생산관리자가 부품 재고와 발주를 한 화면에서 확인하고, 부품 공급에 차질이 생기면 대체 업체와 그 결과를 바로 비교해 결정하는 웹 프로그램입니다. 팀 ICBM · 설계 기준은 [docs/DESIGN.md](docs/DESIGN.md)(설계서 v0.2)입니다.

## 실행

Node.js 22.12 이상이 필요합니다. (없으면 `winget install OpenJS.NodeJS.LTS`)

```bash
cd ppc
npm install
npm run dev        # http://localhost:5173
```

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm test` | 단위 테스트 (설계서 §9 기대값, 저장 흐름, 대시보드 값) |
| `npm run build` | 타입 검사 + 배포용 빌드 (`dist/`) |
| `npm run data` | `data/ppc_data.xlsx` → `src/data/reference.json` 다시 만들기 (Excel을 고친 뒤 실행) |

## 저장 방식: 공유 DB / 로컬 데모

상단 바의 배지로 지금 어느 쪽인지 알 수 있습니다.

- **공유 DB** — `.env.local`에 Supabase 값이 있을 때. 같은 주소를 연 사람은 모두 같은 데이터를 봅니다(캠프 완성 기준).
- **로컬 데모** — 값이 없을 때. 이 브라우저(localStorage)에만 저장하고, 처음 열면 시연 데이터가 자동으로 들어갑니다. 다른 사람과 공유되지 않습니다.

### Supabase 연결 (설계서 부록 C-1)

1. Supabase 프로젝트를 만들고 SQL Editor에서 [supabase/schema.sql](supabase/schema.sql)을 실행합니다.
2. `.env.example`을 `.env.local`로 복사하고 두 값을 채웁니다.
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
   secret key(`sb_secret_…`)는 절대 넣지 않습니다. `.env.local`은 커밋하지 않습니다.
3. 개발 서버를 다시 시작하고, 화면의 **[시연 데이터 넣기]**(또는 [데이터 초기화])를 한 번 누릅니다.

### Vercel 배포 (설계서 부록 C-3)

- Root Directory: **`ppc`** (앱이 저장소의 하위 폴더에 있습니다)
- Framework Preset: Vite · Build Command `npm run build` · Output Directory `dist`
- Environment Variables에 위 두 값을 같은 이름으로 넣습니다. 값을 바꾸면 Redeploy해야 반영됩니다.
- `vercel.json`이 있어 `/disruptions/D-001` 같은 주소를 새로고침해도 404가 나지 않습니다.

## 화면

| 주소 | 내용 | 설계서 |
|---|---|---|
| `/` | 대시보드: KPI, 3D 차량 + 부품 재고 카드, 입고 예정 발주, 생산 예측, 주문 납기 현황 | F1-1 ~ F1-5 |
| `/disruptions/:id` | 차질 상세: 영향 분석, 대체 업체 추천, 기다리기 vs 대체 비교, 결정, 고객 안내 문구 | F2-2 ~ F2-4 |
| `/history` | 차질 목록과 전체 발주 목록 | C-2 (P1) |

상단 바에서 [+ 발주](F1-2), [⚠ 차질 발생](F2-1), [⟳ 새로고침], [데이터 초기화](C-1)를 쓸 수 있습니다.

### 3D 차량 뷰어

저장소 루트 `car-manager/`의 3D 스튜디오(three.js)를 대시보드의 '부품 재고' 영역으로 옮겼습니다. BOM 7개 부품(엔진·변속기·브레이크·서스펜션·조향·차체·배터리)이 핫스팟으로 붙어 있고, 누르면 그 부품으로 줌인하면서 재고·입고 현황 카드가 뜹니다. 부품 상태(차질 빨강 / 대응 중 파랑 / 주의 주황)는 핫스팟의 점과 해당 부품 메쉬의 색으로 표시됩니다. WebGL을 쓸 수 없는 브라우저에서는 도면 이미지로 대신합니다.

## 설계서와 다른 점 · 덧붙인 점

- **로컬 데모 모드** (설계서에 없음): Supabase 값이 없어도 앱을 띄워 볼 수 있게 넣었습니다. 공유가 필요한 시연에서는 반드시 Supabase를 연결하세요.
- **3D 차량 뷰어** (설계서에 없음): `car-manager`의 화면을 반영해 달라는 요청으로 추가했습니다. 이 때문에 `three`(r128 고정, car-manager와 같은 버전)가 의존성에 들어갑니다.
- **조사 처리**: 문구 T3의 `{부품}을`과 취소 경고의 `{부품}이`는 받침에 따라 을/를, 이/가를 고릅니다(예: "배터리를"). 엔진·조향처럼 받침이 있는 부품은 설계서 예문과 똑같이 나옵니다.
- **기간 내 미완료 주문**: 고객 안내 문구(T5)는 `lateDays > 0`인 주문만 만들고, 예측 기간 안에 끝나지 않는 주문은 안내 문구 대신 경고 한 줄을 보여 줍니다.
- `applyOriginalPoAction`은 어느 차질의 지연 발주인지 알아야 해서 `disruptionId` 인자를 하나 더 받습니다.
