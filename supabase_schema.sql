-- 설정 (항상 1행)
create table settings (
  id int primary key default 1 check (id = 1),
  base_date date not null,
  daily_capacity int not null check (daily_capacity > 0),
  lead_time_days int not null check (lead_time_days >= 0),
  horizon_days int not null check (horizon_days > 0)
);

-- 자동차 1대 BOM + 현재 재고
create table line_parts (
  part_code text primary key,          -- 'P007' (reference.json parts.code)
  qty_per_car int not null check (qty_per_car > 0),
  on_hand int not null check (on_hand >= 0),
  sort_order int not null
);

-- 발주
create table purchase_orders (
  id text primary key,                 -- 'PO-001' (앱에서 생성: 기존 최대 번호 + 1)
  part_code text not null,
  supplier_name text not null,
  qty int not null check (qty >= 0),   -- 현재 수량 (감량되면 줄어듦, 0이면 상태 '취소')
  original_qty int not null,           -- 발주할 때 수량 (바꾸지 않음)
  order_date date not null,
  planned_arrival date not null,       -- 발주할 때 정해진 도착 예정일 (바꾸지 않음)
  expected_arrival date not null,      -- 차질을 반영한 현재 예상 도착일
  status text not null default '입고대기' check (status in ('입고대기','지연','입고완료','취소')),
  kind text not null default '일반' check (kind in ('일반','대체')),
  disruption_id text,                  -- 지연 원인 또는 대체 발주의 원인 차질
  created_by text,
  created_at timestamptz not null default now()
);

-- 차질
create table disruptions (
  id text primary key,                 -- 'D-001'
  part_code text not null,
  supplier_name text not null,
  material_name text not null,
  reason text not null,                -- 납품 지연 | 품질 불량 | 설비 고장 | 물류 문제 | 기타
  delay_days int not null check (delay_days between 1 and 60),
  detected_date date not null,         -- 등록 시점의 base_date
  status text not null default '발생' check (status in ('발생','기다리기','대체발주','해결')),
  alt_supplier_name text,
  alt_qty int,
  alt_po_id text,
  original_po_action text check (original_po_action in ('유지','감량','취소')),  -- 대체 발주 때 원래 발주 처리 방법
  created_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- 자동차 주문
create table customer_orders (
  id text primary key,                 -- 'CO-001'
  customer text not null,
  qty int not null check (qty > 0),
  due_date date not null
);

-- 시연용: 로그인 없이 누구나 읽기/쓰기 (§12 Q9)
alter table settings        enable row level security;
alter table line_parts      enable row level security;
alter table purchase_orders enable row level security;
alter table disruptions     enable row level security;
alter table customer_orders enable row level security;
create policy demo_all on settings        for all to anon using (true) with check (true);
create policy demo_all on line_parts      for all to anon using (true) with check (true);
create policy demo_all on purchase_orders for all to anon using (true) with check (true);
create policy demo_all on disruptions     for all to anon using (true) with check (true);
create policy demo_all on customer_orders for all to anon using (true) with check (true);
