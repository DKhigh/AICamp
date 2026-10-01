# PPC 프로젝트 규칙
- 설계 기준은 docs/DESIGN.md다. 작업 전에 관련 절을 읽는다. 문서와 코드가 다르면 문서가 맞다.
- 계산 로직은 src/lib/*.ts 순수 함수에만 둔다. 계산을 바꾸면 npm test를 통과시킨다.
- 날짜는 'YYYY-MM-DD' 문자열과 src/lib/date.ts 유틸만 쓴다.
- UI 문구는 한국어로 쓴다. 새 라이브러리를 추가하기 전에 이유를 먼저 말한다.
- .env.local은 커밋하지 않는다.
- 한 번에 하나의 Phase(DESIGN.md §10)만 작업하고, 끝나면 '완료 확인' 결과를 보고한다.

## 코드 지도
- `src/lib/planning.ts` 생산 가능 대수·시뮬레이션·주문 예측 (§6.2~§6.7, §6.9-1)
- `src/lib/recommend.ts` 대체 업체 추천 (§6.8) / `src/lib/messages.ts` 문구 T1~T5 (§6.10)
- `src/lib/actions.ts` 저장할 내용을 만드는 순수 함수 (발주·차질·대체 확정). `api.ts`는 그 결과를 DB에 쓰기만 한다
- 저장하는 작업은 모두 사원번호를 받고(`authorize`) 활동 기록(`activity_log`)을 남긴다. 확인 창은 `EmployeeConfirmModal`을 쓰고 `window.confirm`은 쓰지 않는다
- 생산 계산은 수리용을 뺀 재고(`repairs.ts productionParts`)로 한다. DB의 재고는 그대로 둔다
- `src/lib/store.ts` DB 접근: Supabase(공유) / 로컬(localStorage). 환경 변수가 없으면 로컬 데모 모드
- `src/lib/dashboard.ts` 대시보드에 보여 줄 값 계산
- `src/components/car/` 3D 차량 뷰어 (저장소 루트 `car-manager/`의 3D 스튜디오를 옮긴 것, three r128 고정)
- 테스트: `src/lib/__tests__/` — planning(§9 기대값), api(저장 흐름), dashboard(화면 값)

## 명령
- `npm run dev` 개발 서버 / `npm test` 단위 테스트 / `npm run build` 타입 검사 + 빌드
- `npm run data` Excel(data/ppc_data.xlsx 하나만) → src/data/reference.json, employees.json 다시 만들기
- `npm run qr` 발표용 QR 무늬(src/data/qr.json) 다시 만들기 — 배포 주소가 바뀔 때만
