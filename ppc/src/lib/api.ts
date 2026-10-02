// DB 읽기/쓰기, 초기화 (DESIGN.md §5, §8)
// 저장할 내용은 actions.ts의 순수 함수가 만들고, 여기서는 그 결과를 DB에 쓰기만 한다.
// 저장하는 작업은 모두 사원번호를 확인하고(authorize), 끝나면 활동 기록(activity_log)에 한 줄을 남긴다.
import {
  activeDisruptionFor,
  buildAlternative,
  buildDisruption,
  buildExtension,
  buildPurchaseOrder,
  buildResolution,
  nextId,
} from './actions';
import { MAX_DAILY_CAPACITY, MAX_DELAY_DAYS, MAX_LEAD_TIME_DAYS, MAX_ORDER_QTY, MIN_DELAY_DAYS } from './constants';
import { today } from './clock';
import { formatMD } from './date';
import { authorize } from './employees';
import { num, won } from './format';
import { capacityError, orderAmount, qtyDelayOf, supplierCapacityOf } from './ordering';
import { duplicateOrderOf, isCancellable, supplierLimitError, supplierLimitOf } from './planning';
import { disruptedSupplierNames } from './recommend';
import { colorOf, demoState, partOf, supplierOf } from './reference';
import { DuplicateKeyError, localStore, supabaseStore, type Row, type Store } from './store';
import { supabase } from './supabase';
import type {
  ActivityLog,
  AppState,
  CustomerOrder,
  Disruption,
  ISODate,
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
  colorCode: (r.color_code as string | null | undefined) ?? null,
});
const fromCustomerOrder = (o: CustomerOrder): Row => ({
  id: o.id,
  customer: o.customer,
  qty: o.qty,
  due_date: o.dueDate,
  color_code: o.colorCode ?? null,
});

const toLog = (r: Row): ActivityLog => ({
  id: r.id as string,
  at: (r.at as string) ?? '',
  actor: (r.actor as string) ?? '',
  action: (r.action as string) ?? '',
  target: (r.target as string) ?? '',
  detail: (r.detail as string) ?? '',
});
const fromLog = (l: ActivityLog): Row => ({ id: l.id, at: l.at, actor: l.actor, action: l.action, target: l.target, detail: l.detail });

function newLogId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── 입력 검증 (§8) ────────────────────────────────────────────────────────

export function qtyError(qty: number): string | null {
  if (!Number.isInteger(qty) || qty < 1) return '수량은 1 이상의 정수여야 합니다.';
  if (qty > MAX_ORDER_QTY) return `수량은 ${num(MAX_ORDER_QTY)} 이하여야 합니다.`;
  return null;
}
export function delayDaysError(days: number): string | null {
  return Number.isInteger(days) && days >= MIN_DELAY_DAYS && days <= MAX_DELAY_DAYS
    ? null
    : `지연일수는 ${MIN_DELAY_DAYS}~${MAX_DELAY_DAYS} 사이의 정수여야 합니다.`;
}
export function dailyCapacityError(n: number): string | null {
  return Number.isInteger(n) && n >= 1 && n <= MAX_DAILY_CAPACITY ? null : `일일 투입은 1 이상 ${num(MAX_DAILY_CAPACITY)} 이하의 정수여야 합니다.`;
}
export function leadTimeError(n: number): string | null {
  return Number.isInteger(n) && n >= 0 && n <= MAX_LEAD_TIME_DAYS ? null : `리드타임은 0 이상 ${MAX_LEAD_TIME_DAYS} 이하의 정수여야 합니다.`;
}
function assertValid(error: string | null) {
  if (error) throw new Error(error);
}

export const EMPTY_DB_MESSAGE = 'DB에 데이터가 없습니다. [데이터 초기화]를 눌러 시연 데이터를 넣으세요.';
export const BUSY_ID_MESSAGE = '다른 사람과 같은 순간에 저장해서 번호가 겹쳤습니다. 잠시 뒤 다시 시도하세요.';

/** 번호(PO-004 등)를 매겨 넣는 작업을, 번호가 겹치면 최신 상태를 다시 읽어 새 번호로 몇 번 더 시도한다 */
async function withFreshId<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (!(e instanceof DuplicateKeyError)) throw e;
      if (attempt >= 4) throw new Error(BUSY_ID_MESSAGE);
    }
  }
}

/** clock: 기준일(오늘)을 돌려주는 함수. 기준일은 DB 값이 아니라 항상 오늘이다 */
export function createApi(store: Store, clock: () => string = today) {
  let lastLogMs = 0;

  /** DB가 비어 있으면(설정 행이 없으면) null */
  async function fetchState(): Promise<AppState | null> {
    const [settings, lineParts, purchaseOrders, disruptions, customerOrders, logs] = await Promise.all([
      store.select('settings'),
      store.select('line_parts'),
      store.select('purchase_orders'),
      store.select('disruptions'),
      store.select('customer_orders'),
      // 활동 기록 테이블이 아직 없는 DB에서도 화면은 떠야 한다 (기록만 저장되지 않는다)
      store.select('activity_log').catch(() => null),
    ]);
    if (settings.length === 0) return null;
    return {
      settings: { ...toSettings(settings[0]), baseDate: clock() },
      lineParts: lineParts.map(toLinePart).sort((a, b) => a.sortOrder - b.sortOrder),
      purchaseOrders: purchaseOrders.map(toPurchaseOrder).sort((a, b) => a.id.localeCompare(b.id)),
      disruptions: disruptions.map(toDisruption).sort((a, b) => a.id.localeCompare(b.id)),
      customerOrders: customerOrders.map(toCustomerOrder).sort((a, b) => a.id.localeCompare(b.id)),
      logs: (logs ?? []).map(toLog).sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? 1 : -1)),
      logReady: logs !== null,
    };
  }

  /** 저장 직전에 항상 최신 상태를 다시 읽는다 (다른 사람이 먼저 바꿨을 수 있다) */
  async function freshState(): Promise<AppState> {
    const state = await fetchState();
    if (!state) throw new Error(EMPTY_DB_MESSAGE);
    return state;
  }

  /** 활동 기록 한 줄. 기록을 남기지 못해도(테이블 없음 등) 이미 끝난 작업을 실패로 만들지 않는다 */
  async function log(actor: string, action: string, target: string, detail: string): Promise<void> {
    // 같은 순간에 남긴 기록도 순서가 뒤바뀌지 않게, 시각이 항상 앞의 기록보다 뒤가 되도록 한다
    lastLogMs = Math.max(Date.now(), lastLogMs + 1);
    try {
      await store.insert('activity_log', [fromLog({ id: newLogId(), at: new Date(lastLogMs).toISOString(), actor, action, target, detail })]);
    } catch {
      // 화면의 이력 페이지가 '기록 테이블 없음'을 따로 알려 준다
    }
  }

  /**
   * 자동차 주문 저장. DB에 color_code 열이 아직 없으면(supabase/migration_order_color.sql 실행 전)
   * 색상 없이 저장한다: 그 주문은 색을 가리지 않는 주문이 되고, 화면이 SQL 실행을 안내한다.
   */
  async function insertCustomerOrders(orders: CustomerOrder[]): Promise<void> {
    try {
      await store.insert('customer_orders', orders.map(fromCustomerOrder));
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes('color_code')) throw e;
      await store.insert(
        'customer_orders',
        orders.map((o) => {
          const { color_code: _dropped, ...row } = fromCustomerOrder(o);
          return row;
        }),
      );
    }
  }

  /** [데이터 초기화]: 명단에 있는 사원번호가 있어야 한다 (§5 C-1) */
  async function resetDemoData(employeeNo: string): Promise<void> {
    const actor = authorize(employeeNo);
    await writeDemoData();
    await log(actor, '데이터 초기화', '', '모든 데이터를 시연 초기 상태로 되돌림');
  }

  /** 로컬 데모 모드에서 처음 열 때 자동으로 시연 데이터를 넣는다. 공유 DB에서는 쓰지 않는다 */
  async function seedLocalDemo(): Promise<void> {
    if (store.mode !== 'local') throw new Error('공유 DB는 [데이터 초기화]로만 채울 수 있습니다.');
    await writeDemoData();
  }

  /** 테이블을 전부 지우고 demo_state.json을 다시 넣는다. 날짜와 기록 시각은 오늘 기준의 과거로 만든다 */
  async function writeDemoData(): Promise<void> {
    for (const table of ['disruptions', 'purchase_orders', 'customer_orders', 'line_parts', 'settings'] as const) {
      await store.clear(table);
    }
    const demo = demoState(clock());
    await store.insert('settings', [fromSettings(demo.settings)]);
    await store.insert('line_parts', demo.lineParts.map(fromLinePart));
    await insertCustomerOrders(demo.customerOrders);
    await store.insert('purchase_orders', demo.purchaseOrders.map(fromPurchaseOrder));
    try {
      await store.clear('activity_log');
      await store.insert('activity_log', demo.logs.map(fromLog));
    } catch {
      // 활동 기록 테이블이 없는 DB
    }
  }

  /** F1-2 부품 발주 */
  async function createPurchaseOrder(input: {
    partCode: string;
    supplierName: string;
    qty: number;
    /** 발주 권한 확인용 사원번호. 이력에는 '이름(사원번호)'로 남는다 */
    employeeNo: string;
    /** 같은 날 같은 내용의 발주가 이미 있어도 넣는다 (화면에서 확인을 받은 경우) */
    allowDuplicate?: boolean;
  }): Promise<PurchaseOrder> {
    assertValid(qtyError(input.qty));
    const createdBy = authorize(input.employeeNo);
    const supplier = supplierOf(input.supplierName);
    if (!supplier) throw new Error(`공급업체를 찾을 수 없습니다: ${input.supplierName}`);
    const part = partOf(input.partCode);

    const po = await withFreshId(async () => {
      const state = await freshState();
      const { purchaseOrders, settings } = state;
      // 한도·공급 능력·중복은 최신 상태로 확인한다 (다른 사람이 방금 같은 업체에 발주했을 수 있다)
      assertValid(supplierLimitError(supplierLimitOf(purchaseOrders, supplier.name, settings.baseDate), supplier.name, input.qty));
      assertValid(capacityError(supplierCapacityOf(purchaseOrders, supplier, settings.baseDate), supplier.name, part, input.qty));
      const duplicate = duplicateOrderOf(purchaseOrders, input, settings.baseDate);
      if (duplicate && !input.allowDuplicate) {
        throw new Error(
          `같은 내용의 발주(${duplicate.id})가 오늘 이미 있습니다. 실수로 두 번 누른 것이 아니라면 '같은 발주를 한 번 더 넣습니다'에 표시하고 다시 등록하세요.`,
        );
      }
      const built = buildPurchaseOrder({
        existing: purchaseOrders,
        partCode: input.partCode,
        supplier,
        qty: input.qty,
        baseDate: settings.baseDate,
        kind: '일반',
        createdBy,
        // 같은 업체에 많이 시킬수록 늦게 온다 (Excel '지연시간')
        extraDays: qtyDelayOf(purchaseOrders, part, supplier.name, input.qty, settings.baseDate).days,
      });
      await store.insert('purchase_orders', [fromPurchaseOrder(built)]);
      return built;
    });
    const amount = orderAmount(part, supplier.name, po.qty);
    await log(
      createdBy,
      '발주 등록',
      po.id,
      `${part.name} ${num(po.qty)}개 · ${supplier.name}${amount === null ? '' : ` · ${won(amount)}`} · 도착 예정 ${formatMD(po.expectedArrival)}`,
    );
    return po;
  }

  /** 발주 취소: '발주대기'(발주한 당일의 일반 발주)만, 명단에 있는 사원번호로만 할 수 있다 */
  async function cancelPurchaseOrder(input: { poId: string; employeeNo: string }): Promise<void> {
    const actor = authorize(input.employeeNo);
    const state = await freshState();
    const po = state.purchaseOrders.find((p) => p.id === input.poId);
    if (!po) throw new Error(`발주를 찾을 수 없습니다: ${input.poId}`);
    if (!isCancellable(po, state.settings.baseDate)) {
      throw new Error(
        po.status === '취소'
          ? '이미 취소된 발주입니다. 새로고침해서 확인하세요.'
          : '발주 취소는 발주한 당일의 발주대기 상태에서만 할 수 있습니다.',
      );
    }
    await store.update('purchase_orders', po.id, { status: '취소' });
    await log(actor, '발주 취소', po.id, `${partOf(po.partCode).name} ${num(po.qty)}개 · ${po.supplierName}`);
  }

  /**
   * F2-1 차질 발생: 차질을 넣고, 같은 부품·업체의 미입고 발주를 전부 지연시킨다.
   * 그 부품·업체에 해결되지 않은 차질이 이미 있으면 새 차질을 만들지 않고 그 차질의 지연을 연장한다.
   */
  async function registerDisruption(input: {
    partCode: string;
    supplierName: string;
    reason: string;
    delayDays: number;
    employeeNo: string;
  }): Promise<{ disruption: Disruption; extended: boolean }> {
    assertValid(delayDaysError(input.delayDays));
    const actor = authorize(input.employeeNo);
    const part = partOf(input.partCode);

    const state = await freshState();
    const existing = activeDisruptionFor(state.disruptions, input.partCode, input.supplierName);
    if (existing) {
      const built = buildExtension({ state, disruption: existing, extraDays: input.delayDays });
      await store.update('disruptions', existing.id, { delay_days: built.disruption.delayDays, status: built.disruption.status });
      for (const po of built.delayedPos) {
        await store.update('purchase_orders', po.id, {
          expected_arrival: po.expectedArrival,
          status: po.status,
          disruption_id: po.disruptionId,
        });
      }
      await log(
        actor,
        '지연 연장',
        existing.id,
        `${part.name} · ${input.supplierName} · ${input.reason} · +${input.delayDays}일 (합계 ${built.disruption.delayDays}일) · ` +
          built.delayedPos.map((po) => `${po.id} 도착 ${formatMD(po.expectedArrival)}`).join(', ') +
          (existing.status === '기다리기' ? " · '대응하지 않음' 결정을 다시 검토" : ''),
      );
      return { disruption: built.disruption, extended: true };
    }

    const built = await withFreshId(async () => {
      const fresh = await freshState();
      const b = buildDisruption({
        state: fresh,
        part,
        supplierName: input.supplierName,
        reason: input.reason,
        delayDays: input.delayDays,
        createdBy: actor,
      });
      await store.insert('disruptions', [fromDisruption(b.disruption)]);
      return b;
    });
    for (const po of built.delayedPos) {
      await store.update('purchase_orders', po.id, {
        expected_arrival: po.expectedArrival,
        status: po.status,
        disruption_id: po.disruptionId,
      });
    }
    await log(
      actor,
      '차질 등록',
      built.disruption.id,
      `${part.name} · ${input.supplierName} · ${input.reason} · ${input.delayDays}일 지연 · ` +
        built.delayedPos.map((po) => `${po.id} 도착 ${formatMD(po.expectedArrival)}`).join(', '),
    );
    return { disruption: built.disruption, extended: false };
  }

  /** F2-4 [대체 발주 확정] */
  async function confirmAlternative(input: {
    disruptionId: string;
    supplierName: string;
    qty: number;
    action: OriginalPoAction;
    employeeNo: string;
    /** 여러 업체에 나눠 발주할 때: 업체별 수량 (합계가 qty여야 한다). 없으면 supplierName 한 곳에 전량 */
    allocations?: { supplierName: string; qty: number }[];
  }): Promise<PurchaseOrder> {
    assertValid(qtyError(input.qty));
    const createdBy = authorize(input.employeeNo);
    const allocations = (input.allocations ?? [{ supplierName: input.supplierName, qty: input.qty }]).map((a) => {
      assertValid(qtyError(a.qty));
      const supplier = supplierOf(a.supplierName);
      if (!supplier) throw new Error(`공급업체를 찾을 수 없습니다: ${a.supplierName}`);
      return { supplier, qty: a.qty };
    });
    if (allocations.reduce((sum, a) => sum + a.qty, 0) !== input.qty) throw new Error('업체별 수량의 합이 대체 수량과 다릅니다.');
    if (new Set(allocations.map((a) => a.supplier.name)).size !== allocations.length) throw new Error('같은 업체가 두 번 들어 있습니다.');

    const built = await withFreshId(async () => {
      const state = await freshState();
      const disruption = state.disruptions.find((d) => d.id === input.disruptionId);
      if (!disruption) throw new Error(`차질을 찾을 수 없습니다: ${input.disruptionId}`);
      if (disruption.status === '대체발주' || disruption.status === '해결') {
        throw new Error('이미 결정이 끝난 차질입니다. 새로고침해서 확인하세요.');
      }
      const disrupted = disruptedSupplierNames(state.disruptions);
      for (const a of allocations) {
        if (disrupted.includes(a.supplier.name)) {
          throw new Error(`${a.supplier.name}는 진행 중인 차질이 있어 대체 업체로 고를 수 없습니다.`);
        }
        // 공급 능력이 모자라는 업체로는 확정할 수 없다 (이미 받은 물량을 뺀 남은 능력으로 본다)
        assertValid(
          capacityError(supplierCapacityOf(state.purchaseOrders, a.supplier, state.settings.baseDate), a.supplier.name, partOf(disruption.partCode), a.qty),
        );
      }
      const b = buildAlternative({ state, disruption, supplier: allocations[0].supplier, qty: input.qty, action: input.action, createdBy, allocations });
      // 1) 대체 발주 → 2) 원래 지연 발주 처리 → 3) 차질 상태
      await store.insert('purchase_orders', b.altPos.map(fromPurchaseOrder));
      return b;
    });
    for (const po of built.changedOriginals) {
      await store.update('purchase_orders', po.id, { qty: po.qty, status: po.status });
    }
    await store.update('disruptions', built.disruption.id, {
      status: built.disruption.status,
      alt_supplier_name: built.disruption.altSupplierName,
      alt_qty: built.disruption.altQty,
      alt_po_id: built.disruption.altPoId,
      original_po_action: built.disruption.originalPoAction,
    });
    await log(
      createdBy,
      '대체 발주 확정',
      built.disruption.id,
      built.altPos.map((po) => `${po.supplierName} ${num(po.qty)}개 (${po.id} · 도착 예정 ${formatMD(po.expectedArrival)})`).join(' + ') +
        ` · 원래 발주 ${input.action}`,
    );
    return built.altPo;
  }

  /** F2-4 [기다리기로 결정] */
  async function decideWait(input: { disruptionId: string; employeeNo: string }): Promise<void> {
    const actor = authorize(input.employeeNo);
    const state = await freshState();
    const disruption = state.disruptions.find((d) => d.id === input.disruptionId);
    if (!disruption) throw new Error(`차질을 찾을 수 없습니다: ${input.disruptionId}`);
    if (disruption.status !== '발생') throw new Error('이미 결정이 끝난 차질입니다. 새로고침해서 확인하세요.');
    await store.update('disruptions', disruption.id, { status: '기다리기' });
    await log(actor, '대응하지 않음', disruption.id, `${partOf(disruption.partCode).name} · ${disruption.supplierName} · ${disruption.delayDays}일 지연에 대체 발주 없이 원래 발주를 기다리기로 함`);
  }

  /**
   * (P1) [해결 완료]: 지연 중이던 발주의 실제 도착일을 받아 확정한다.
   * 그 발주는 '지연'에서 '입고대기'로 돌아가고, 생산 예측은 확정된 날짜로 다시 계산된다.
   */
  async function resolveDisruption(input: {
    disruptionId: string;
    employeeNo: string;
    /** 발주번호 → 실제 도착일. 이 차질로 지연 중인 발주마다 있어야 한다 */
    arrivals: Record<string, ISODate>;
  }): Promise<void> {
    const actor = authorize(input.employeeNo);
    const state = await freshState();
    const disruption = state.disruptions.find((d) => d.id === input.disruptionId);
    if (!disruption) throw new Error(`차질을 찾을 수 없습니다: ${input.disruptionId}`);
    if (disruption.status === '해결') throw new Error('이미 해결된 차질입니다. 새로고침해서 확인하세요.');
    const { changedPos, received } = buildResolution({ state, disruption, arrivals: input.arrivals });
    // 이미 들어온 발주는 재고에 더한다 (같은 부품의 발주가 여러 건이면 합쳐서 한 번에)
    const add = new Map<string, number>();
    for (const po of received) add.set(po.partCode, (add.get(po.partCode) ?? 0) + po.qty);
    for (const [partCode, qty] of add) {
      const part = state.lineParts.find((p) => p.partCode === partCode);
      if (!part) throw new Error(`라인 부품이 아닙니다: ${partCode}`);
      await store.update('line_parts', partCode, { on_hand: part.onHand + qty });
    }
    for (const po of changedPos) {
      await store.update('purchase_orders', po.id, { expected_arrival: po.expectedArrival, status: po.status });
    }
    await store.update('disruptions', disruption.id, { status: '해결', resolved_at: new Date().toISOString() });
    const before = new Map(state.purchaseOrders.map((po) => [po.id, po.expectedArrival]));
    await log(
      actor,
      '차질 해결',
      disruption.id,
      changedPos.length === 0
        ? '지연 중인 발주 없음'
        : changedPos
            .map(
              (po) =>
                `${po.id} 실제 도착일 ${formatMD(po.expectedArrival)}${po.status === '입고완료' ? ` · 입고 처리 +${num(po.qty)}개` : ' 확정'} (지연 예상 ${formatMD(before.get(po.id)!)}, 원래 ${formatMD(po.plannedArrival)})`,
            )
            .join(', '),
    );
  }

  /** (P1) [입고 처리]: 재고에 더하고 발주를 입고완료로 바꾼다 */
  async function receivePurchaseOrder(input: { poId: string; employeeNo: string }): Promise<void> {
    const actor = authorize(input.employeeNo);
    const state = await freshState();
    const po = state.purchaseOrders.find((p) => p.id === input.poId);
    if (!po) throw new Error(`발주를 찾을 수 없습니다: ${input.poId}`);
    if (po.status !== '입고대기' && po.status !== '지연') {
      throw new Error(`이미 ${po.status} 상태인 발주입니다. 새로고침해서 확인하세요.`);
    }
    const part = state.lineParts.find((p) => p.partCode === po.partCode);
    if (!part) throw new Error(`라인 부품이 아닙니다: ${po.partCode}`);
    await store.update('line_parts', part.partCode, { on_hand: part.onHand + po.qty });
    await store.update('purchase_orders', po.id, { status: '입고완료' });
    await log(actor, '입고 처리', po.id, `${partOf(po.partCode).name} +${num(po.qty)}개 (재고 ${num(part.onHand)} → ${num(part.onHand + po.qty)}개) · ${po.supplierName}`);
  }

  /**
   * 납기 추가: 한 고객의 주문을 색상별 수량으로 받아, 색상마다 자동차 주문을 하나씩 넣는다
   * (화이트 10대 + 블랙 10대 → CO-004 화이트 10대, CO-005 블랙 10대). 납기 현황에는 색상별로 한 줄씩 나온다.
   */
  async function addCustomerOrders(input: {
    customer: string;
    dueDate: string;
    /** 색상별 수량. colorCode는 Excel '차량색상'의 색상 코드 (null이면 색을 가리지 않는 주문) */
    items: { colorCode: string | null; qty: number }[];
    employeeNo: string;
  }): Promise<CustomerOrder[]> {
    const customer = input.customer.trim();
    if (customer === '') throw new Error('고객 이름을 입력하세요.');
    if (input.items.length === 0) throw new Error('색상별 수량을 하나 이상 입력하세요.');
    for (const item of input.items) {
      assertValid(qtyError(item.qty));
      if (item.colorCode !== null && !colorOf(item.colorCode)) throw new Error(`차량 색상을 찾을 수 없습니다: ${item.colorCode}`);
    }
    if (new Set(input.items.map((i) => i.colorCode)).size !== input.items.length) throw new Error('같은 색상이 두 번 들어 있습니다.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new Error('납기 날짜를 선택하세요.');
    const actor = authorize(input.employeeNo);
    const orders = await withFreshId(async () => {
      const state = await freshState();
      if (input.dueDate < state.settings.baseDate) throw new Error('납기는 기준일보다 빠를 수 없습니다.');
      // 취소한 주문의 번호를 다시 쓰지 않도록 활동 기록에 남은 번호도 함께 본다
      const used = [...state.customerOrders.map((o) => o.id), ...state.logs.map((l) => l.target)];
      const built = input.items.map((item): CustomerOrder => {
        const id = nextId('CO-', used);
        used.push(id);
        return { id, customer, qty: item.qty, dueDate: input.dueDate, colorCode: item.colorCode };
      });
      await insertCustomerOrders(built);
      return built;
    });
    for (const order of orders) {
      await log(
        actor,
        '납기 추가',
        order.id,
        `${order.customer} ${num(order.qty)}대${order.colorCode ? ` · ${colorOf(order.colorCode)!.name}` : ''} · 납기 ${formatMD(order.dueDate)}`,
      );
    }
    return orders;
  }

  /** 납기 추가 (한 가지 색) */
  async function addCustomerOrder(input: { customer: string; qty: number; dueDate: string; colorCode?: string | null; employeeNo: string }): Promise<CustomerOrder> {
    const [order] = await addCustomerOrders({
      customer: input.customer,
      dueDate: input.dueDate,
      items: [{ colorCode: input.colorCode ?? null, qty: input.qty }],
      employeeNo: input.employeeNo,
    });
    return order;
  }

  /** 납기 취소: 자동차 주문을 목록에서 지우고, 취소했다는 사실을 활동 기록에 남긴다 */
  async function removeCustomerOrder(input: { orderId: string; employeeNo: string }): Promise<void> {
    const actor = authorize(input.employeeNo);
    const state = await freshState();
    const order = state.customerOrders.find((o) => o.id === input.orderId);
    if (!order) throw new Error(`이미 지워진 주문입니다: ${input.orderId}. 새로고침해서 확인하세요.`);
    await store.remove('customer_orders', input.orderId);
    await log(actor, '납기 취소', order.id, `${order.customer} ${num(order.qty)}대 · 납기 ${formatMD(order.dueDate)} 주문을 취소(삭제)함`);
  }

  /** (P1) 설정 수정: 일일 투입과 리드타임 */
  async function updateSettings(input: { dailyCapacity: number; leadTimeDays: number; employeeNo: string }): Promise<void> {
    assertValid(dailyCapacityError(input.dailyCapacity));
    assertValid(leadTimeError(input.leadTimeDays));
    const actor = authorize(input.employeeNo);
    const { settings } = await freshState();
    await store.update('settings', 1, {
      daily_capacity: input.dailyCapacity,
      lead_time_days: input.leadTimeDays,
    });
    await log(
      actor,
      '생산 설정 변경',
      '',
      `일일 투입 ${num(settings.dailyCapacity)} → ${num(input.dailyCapacity)}대 · 리드타임 ${settings.leadTimeDays} → ${input.leadTimeDays}일`,
    );
  }

  return {
    mode: store.mode,
    fetchState,
    resetDemoData,
    seedLocalDemo,
    createPurchaseOrder,
    cancelPurchaseOrder,
    registerDisruption,
    confirmAlternative,
    decideWait,
    resolveDisruption,
    receivePurchaseOrder,
    addCustomerOrder,
    addCustomerOrders,
    removeCustomerOrder,
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
