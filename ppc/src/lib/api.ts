// DB 읽기/쓰기, 초기화 (DESIGN.md §5, §8)
// 저장할 내용은 actions.ts의 순수 함수가 만들고, 여기서는 그 결과를 DB에 쓰기만 한다.
import { buildAlternative, buildDisruption, buildPurchaseOrder } from './actions';
import { MAX_DELAY_DAYS, MIN_DELAY_DAYS } from './constants';
import { demoState, partOf, supplierOf } from './reference';
import { localStore, supabaseStore, type Row, type Store } from './store';
import { supabase } from './supabase';
import type {
  AppState,
  CustomerOrder,
  Disruption,
  LinePart,
  OriginalPoAction,
  PurchaseOrder,
  Settings,
} from './types';

// ── DB 행(snake_case) ↔ TS 객체(camelCase) ───────────────────────────────

const toSettings = (r: Row): Settings => ({
  baseDate: r.base_date as string,
  dailyCapacity: r.daily_capacity as number,
  leadTimeDays: r.lead_time_days as number,
  horizonDays: r.horizon_days as number,
});
const fromSettings = (s: Settings): Row => ({
  id: 1,
  base_date: s.baseDate,
  daily_capacity: s.dailyCapacity,
  lead_time_days: s.leadTimeDays,
  horizon_days: s.horizonDays,
});

const toLinePart = (r: Row): LinePart => ({
  partCode: r.part_code as string,
  qtyPerCar: r.qty_per_car as number,
  onHand: r.on_hand as number,
  sortOrder: r.sort_order as number,
});
const fromLinePart = (p: LinePart): Row => ({
  part_code: p.partCode,
  qty_per_car: p.qtyPerCar,
  on_hand: p.onHand,
  sort_order: p.sortOrder,
});

const toPurchaseOrder = (r: Row): PurchaseOrder => ({
  id: r.id as string,
  partCode: r.part_code as string,
  supplierName: r.supplier_name as string,
  qty: r.qty as number,
  originalQty: r.original_qty as number,
  orderDate: r.order_date as string,
  plannedArrival: r.planned_arrival as string,
  expectedArrival: r.expected_arrival as string,
  status: r.status as PurchaseOrder['status'],
  kind: r.kind as PurchaseOrder['kind'],
  disruptionId: (r.disruption_id as string | null) ?? null,
  createdBy: (r.created_by as string | null) ?? null,
  createdAt: (r.created_at as string) ?? '',
});
const fromPurchaseOrder = (po: PurchaseOrder): Row => ({
  id: po.id,
  part_code: po.partCode,
  supplier_name: po.supplierName,
  qty: po.qty,
  original_qty: po.originalQty,
  order_date: po.orderDate,
  planned_arrival: po.plannedArrival,
  expected_arrival: po.expectedArrival,
  status: po.status,
  kind: po.kind,
  disruption_id: po.disruptionId,
  created_by: po.createdBy,
  created_at: po.createdAt,
});

const toDisruption = (r: Row): Disruption => ({
  id: r.id as string,
  partCode: r.part_code as string,
  supplierName: r.supplier_name as string,
  materialName: r.material_name as string,
  reason: r.reason as string,
  delayDays: r.delay_days as number,
  detectedDate: r.detected_date as string,
  status: r.status as Disruption['status'],
  altSupplierName: (r.alt_supplier_name as string | null) ?? null,
  altQty: (r.alt_qty as number | null) ?? null,
  altPoId: (r.alt_po_id as string | null) ?? null,
  originalPoAction: (r.original_po_action as OriginalPoAction | null) ?? null,
  createdBy: (r.created_by as string | null) ?? null,
  createdAt: (r.created_at as string) ?? '',
  resolvedAt: (r.resolved_at as string | null) ?? null,
});
const fromDisruption = (d: Disruption): Row => ({
  id: d.id,
  part_code: d.partCode,
  supplier_name: d.supplierName,
  material_name: d.materialName,
  reason: d.reason,
  delay_days: d.delayDays,
  detected_date: d.detectedDate,
  status: d.status,
  alt_supplier_name: d.altSupplierName,
  alt_qty: d.altQty,
  alt_po_id: d.altPoId,
  original_po_action: d.originalPoAction,
  created_by: d.createdBy,
  created_at: d.createdAt,
  resolved_at: d.resolvedAt,
});

const toCustomerOrder = (r: Row): CustomerOrder => ({
  id: r.id as string,
  customer: r.customer as string,
  qty: r.qty as number,
  dueDate: r.due_date as string,
});
const fromCustomerOrder = (o: CustomerOrder): Row => ({
  id: o.id,
  customer: o.customer,
  qty: o.qty,
  due_date: o.dueDate,
});

// ── 입력 검증 (§8) ────────────────────────────────────────────────────────

export function qtyError(qty: number): string | null {
  return Number.isInteger(qty) && qty >= 1 ? null : '수량은 1 이상의 정수여야 합니다.';
}
export function delayDaysError(days: number): string | null {
  return Number.isInteger(days) && days >= MIN_DELAY_DAYS && days <= MAX_DELAY_DAYS
    ? null
    : `지연일수는 ${MIN_DELAY_DAYS}~${MAX_DELAY_DAYS} 사이의 정수여야 합니다.`;
}
function assertValid(error: string | null) {
  if (error) throw new Error(error);
}

export const CREATOR_REQUIRED_MESSAGE = '입력자 이름을 적어야 저장할 수 있습니다.';
export function creatorError(name: string | null): string | null {
  return name && name.trim() !== '' ? null : CREATOR_REQUIRED_MESSAGE;
}

export const EMPTY_DB_MESSAGE = 'DB에 데이터가 없습니다. [데이터 초기화]를 눌러 시연 데이터를 넣으세요.';

export function createApi(store: Store) {
  /** DB가 비어 있으면(설정 행이 없으면) null */
  async function fetchState(): Promise<AppState | null> {
    const [settings, lineParts, purchaseOrders, disruptions, customerOrders] = await Promise.all([
      store.select('settings'),
      store.select('line_parts'),
      store.select('purchase_orders'),
      store.select('disruptions'),
      store.select('customer_orders'),
    ]);
    if (settings.length === 0) return null;
    return {
      settings: toSettings(settings[0]),
      lineParts: lineParts.map(toLinePart).sort((a, b) => a.sortOrder - b.sortOrder),
      purchaseOrders: purchaseOrders.map(toPurchaseOrder).sort((a, b) => a.id.localeCompare(b.id)),
      disruptions: disruptions.map(toDisruption).sort((a, b) => a.id.localeCompare(b.id)),
      customerOrders: customerOrders.map(toCustomerOrder).sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  /** 저장 직전에 항상 최신 상태를 다시 읽는다 (다른 사람이 먼저 바꿨을 수 있다) */
  async function freshState(): Promise<AppState> {
    const state = await fetchState();
    if (!state) throw new Error(EMPTY_DB_MESSAGE);
    return state;
  }

  /** 5개 테이블을 전부 지우고 demo_state.json을 다시 넣는다 (§5 C-1) */
  async function resetDemoData(): Promise<void> {
    for (const table of ['disruptions', 'purchase_orders', 'customer_orders', 'line_parts', 'settings'] as const) {
      await store.clear(table);
    }
    const demo = demoState();
    await store.insert('settings', [fromSettings(demo.settings)]);
    await store.insert('line_parts', demo.lineParts.map(fromLinePart));
    await store.insert('customer_orders', demo.customerOrders.map(fromCustomerOrder));
    await store.insert('purchase_orders', demo.purchaseOrders.map(fromPurchaseOrder));
  }

  /** F1-2 부품 발주 */
  async function createPurchaseOrder(input: {
    partCode: string;
    supplierName: string;
    qty: number;
    createdBy: string | null;
  }): Promise<PurchaseOrder> {
    assertValid(qtyError(input.qty));
    assertValid(creatorError(input.createdBy));
    const supplier = supplierOf(input.supplierName);
    if (!supplier) throw new Error(`공급업체를 찾을 수 없습니다: ${input.supplierName}`);
    const state = await freshState();
    const po = buildPurchaseOrder({
      existing: state.purchaseOrders,
      partCode: input.partCode,
      supplier,
      qty: input.qty,
      baseDate: state.settings.baseDate,
      kind: '일반',
      createdBy: input.createdBy,
    });
    await store.insert('purchase_orders', [fromPurchaseOrder(po)]);
    return po;
  }

  /** F2-1 차질 발생: 차질을 넣고, 같은 부품·업체의 미입고 발주를 전부 지연시킨다 */
  async function registerDisruption(input: {
    partCode: string;
    supplierName: string;
    reason: string;
    delayDays: number;
    createdBy: string | null;
  }): Promise<Disruption> {
    assertValid(delayDaysError(input.delayDays));
    assertValid(creatorError(input.createdBy));
    const state = await freshState();
    const built = buildDisruption({
      state,
      part: partOf(input.partCode),
      supplierName: input.supplierName,
      reason: input.reason,
      delayDays: input.delayDays,
      createdBy: input.createdBy,
    });
    await store.insert('disruptions', [fromDisruption(built.disruption)]);
    for (const po of built.delayedPos) {
      await store.update('purchase_orders', po.id, {
        expected_arrival: po.expectedArrival,
        status: po.status,
        disruption_id: po.disruptionId,
      });
    }
    return built.disruption;
  }

  /** F2-4 [대체 발주 확정] */
  async function confirmAlternative(input: {
    disruptionId: string;
    supplierName: string;
    qty: number;
    action: OriginalPoAction;
    createdBy: string | null;
  }): Promise<PurchaseOrder> {
    assertValid(qtyError(input.qty));
    assertValid(creatorError(input.createdBy));
    const supplier = supplierOf(input.supplierName);
    if (!supplier) throw new Error(`공급업체를 찾을 수 없습니다: ${input.supplierName}`);
    const state = await freshState();
    const disruption = state.disruptions.find((d) => d.id === input.disruptionId);
    if (!disruption) throw new Error(`차질을 찾을 수 없습니다: ${input.disruptionId}`);
    if (disruption.status === '대체발주' || disruption.status === '해결') {
      throw new Error('이미 결정이 끝난 차질입니다. 새로고침해서 확인하세요.');
    }
    const built = buildAlternative({
      state,
      disruption,
      supplier,
      qty: input.qty,
      action: input.action,
      createdBy: input.createdBy,
    });
    // 1) 대체 발주 → 2) 원래 지연 발주 처리 → 3) 차질 상태
    await store.insert('purchase_orders', [fromPurchaseOrder(built.altPo)]);
    for (const po of built.changedOriginals) {
      await store.update('purchase_orders', po.id, { qty: po.qty, status: po.status });
    }
    await store.update('disruptions', disruption.id, {
      status: built.disruption.status,
      alt_supplier_name: built.disruption.altSupplierName,
      alt_qty: built.disruption.altQty,
      alt_po_id: built.disruption.altPoId,
      original_po_action: built.disruption.originalPoAction,
    });
    return built.altPo;
  }

  /** F2-4 [기다리기로 결정] */
  async function decideWait(disruptionId: string): Promise<void> {
    await store.update('disruptions', disruptionId, { status: '기다리기' });
  }

  /** (P1) [해결 완료] */
  async function resolveDisruption(disruptionId: string): Promise<void> {
    await store.update('disruptions', disruptionId, { status: '해결', resolved_at: new Date().toISOString() });
  }

  /** (P1) [입고 처리]: 재고에 더하고 발주를 입고완료로 바꾼다 */
  async function receivePurchaseOrder(poId: string): Promise<void> {
    const state = await freshState();
    const po = state.purchaseOrders.find((p) => p.id === poId);
    if (!po) throw new Error(`발주를 찾을 수 없습니다: ${poId}`);
    if (po.status !== '입고대기' && po.status !== '지연') {
      throw new Error(`이미 ${po.status} 상태인 발주입니다. 새로고침해서 확인하세요.`);
    }
    const part = state.lineParts.find((p) => p.partCode === po.partCode);
    if (!part) throw new Error(`라인 부품이 아닙니다: ${po.partCode}`);
    await store.update('line_parts', part.partCode, { on_hand: part.onHand + po.qty });
    await store.update('purchase_orders', po.id, { status: '입고완료' });
  }

  /** (P1) 설정 수정: 일일 투입과 리드타임 */
  async function updateSettings(input: { dailyCapacity: number; leadTimeDays: number }): Promise<void> {
    if (!Number.isInteger(input.dailyCapacity) || input.dailyCapacity < 1) {
      throw new Error('일일 투입은 1 이상의 정수여야 합니다.');
    }
    if (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0) {
      throw new Error('리드타임은 0 이상의 정수여야 합니다.');
    }
    await store.update('settings', 1, {
      daily_capacity: input.dailyCapacity,
      lead_time_days: input.leadTimeDays,
    });
  }

  return {
    mode: store.mode,
    fetchState,
    resetDemoData,
    createPurchaseOrder,
    registerDisruption,
    confirmAlternative,
    decideWait,
    resolveDisruption,
    receivePurchaseOrder,
    updateSettings,
  };
}

export type Api = ReturnType<typeof createApi>;

let singleton: Api | null = null;

/** 환경 변수가 있으면 Supabase(공유 DB), 없으면 이 브라우저에만 저장하는 로컬 데모 모드 */
export function getApi(): Api {
  if (!singleton) singleton = createApi(supabase ? supabaseStore(supabase) : localStore());
  return singleton;
}
