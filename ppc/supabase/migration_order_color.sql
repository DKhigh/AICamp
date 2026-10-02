-- 자동차 주문에 차량 색상 추가 (이미 만들어 둔 Supabase 프로젝트에서 한 번만 실행)
-- Supabase 대시보드 → SQL Editor → 이 파일 내용을 붙여 넣고 Run → 앱에서 [데이터 초기화]
-- 여러 번 실행해도 안전하다.

alter table customer_orders add column if not exists color_code text;  -- 'C01' … (Excel '차량색상'의 색상 코드)

-- PostgREST가 새 열을 바로 알아보게 한다
notify pgrst, 'reload schema';
