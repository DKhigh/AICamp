-- 활동 기록 테이블 추가 (이미 만들어 둔 Supabase 프로젝트에서 한 번만 실행)
-- Supabase 대시보드 → SQL Editor → 이 파일 내용을 붙여 넣고 Run → 앱에서 [데이터 초기화]
-- 여러 번 실행해도 안전하다.

create table if not exists activity_log (
  id text primary key,                 -- 앱에서 만든 고유값
  at timestamptz not null default now(),
  actor text not null,                 -- '이름(사원번호)'
  action text not null,                -- '발주 등록' | '차질 해결' | '납기 취소' …
  target text not null default '',     -- 'PO-004' | 'D-001' | 'CO-002'
  detail text not null default ''
);

alter table activity_log enable row level security;
drop policy if exists demo_all on activity_log;
create policy demo_all on activity_log for all to anon using (true) with check (true);
