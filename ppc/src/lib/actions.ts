// 저장할 내용을 만드는 순수 함수 (DESIGN.md §5 F1-2, F2-1, F2-4).
// api.ts는 이 함수들이 돌려준 값을 그대로 DB에 쓴다. 테스트도 같은 함수를 쓴다.
import { MAX_DELAY_DAYS } from './constants';
import { addDays, formatMD } from './date';
import {
  applyOriginalPoAction,
  arrivalsFromPos,
  changedPos,
  evaluateScenario,
  isLate,
  openPos,
  type Arrival,
  type OrderForecast,
  type ScenarioOutcome,
} from './planning';
import { productionParts } from './repairs';
import type {
  AppState,
  Disruption,
  ISODate,
  OriginalPoAction,
  Part,
  PurchaseOrder,
  Supplier,
} from './types';

/** 'PO-' + 3자리 (기존 최대 번호 + 1) */
export function nextId(prefix: string, existingIds: string[]): string {
  const max = existingIds.reduce((m, id) => {
    const n = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export function buildPurchaseOrder(params: {
  existing: PurchaseOrder[];
  partCode: string;
  supplier: Supplier;
  qty: number;
  baseDate: ISODate;
  kind: '일반' | '대체';
  disruptionId?: string | null;
  createdBy: string | null;
  /** 발주 수량에 따른 납품 지연(일). 일반 발주에만 더한다 */
  extraDays?: number;
}): PurchaseOrder {
  const { existing, partCode, supplier, qty, baseDate, kind, createdBy } = params;
  // 일반 발주는 기본 납기 + 수량 지연, 대체(긴급) 발주는 대체 납기 (§2.2 A3)
  const arrival = addDays(baseDate, kind === '대체' ? supplier.altLeadDays : supplier.leadDays + (params.extraDays ?? 0));
  return {
    id: nextId(
      'PO-',
      existing.map((po) => po.id),
    ),
    partCode,
    supplierName: supplier.name,
    qty,
    originalQty: qty,
    orderDate: baseDate,
    plannedArrival: arrival,
    expectedArrival: arrival,
    status: '입고대기',
    kind,
    disruptionId: params.disruptionId ?? null,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

/** 차질을 등록할 수 있는 발주: 같은 부품·같은 업체의 미입고 발주 전부 */
export function affectedPos(pos: PurchaseOrder[], partCode: string, supplierName: string): PurchaseOrder[] {
  return openPos(pos).filter((po) => po.partCode === partCode && po.supplierName === supplierName);
}

/** 같은 부품·업체에 이미 있는, 해결되지 않은 차질. 있으면 새 차질을 만들지 않고 그 차질의 지연을 연장한다 */
export function activeDisruptionFor(disruptions: Disruption[], partCode: string, supplierName: string): Disruption | null {
  return disruptions.find((d) => d.status !== '해결' && d.partCode === partCode && d.supplierName === supplierName) ?? null;
}

export const NO_OPEN_PO_MESSAGE =
  '이 부품·업체의 입고 예정 발주가 없어 지연을 반영할 수 없습니다. 먼저 발주를 등록하세요.';

export function buildDisruption(params: {
  state: AppState;
  part: Part;
  supplierName: string;
  reason: string;
  delayDays: number;
  createdBy: string | null;
}): { disruption: Disruption; delayedPos: PurchaseOrder[] } {
  const { state, part, supplierName, reason, delayDays, createdBy } = params;
  const targets = affectedPos(state.purchaseOrders, part.code, supplierName);
  if (targets.length === 0) throw new Error(NO_OPEN_PO_MESSAGE);

  const disruption: Disruption = {
    id: nextId(
      'D-',
      state.disruptions.map((d) => d.id),
    ),
    partCode: part.code,
    supplierName,
    materialName: part.materialName,
    reason,
    delayDays,
    detectedDate: state.settings.baseDate,
    status: '발생',
    altSupplierName: null,
    altQty: null,
    altPoId: null,
    originalPoAction: null,
    createdBy,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  const delayedPos = targets.map((po) => ({
    ...po,
    expectedArrival: addDays(po.expectedArrival, delayDays),
    status: '지연' as const,
    disruptionId: disruption.id,
  }));
  return { disruption, delayedPos };
}

/**
 * 지연 연장: 진행 중인 차질이 있는 부품·업체에 지연이 더 생겼을 때.
 * 새 차질을 만들지 않고 그 차질의 지연일수를 늘린다 (발주가 다른 차질로 옮겨 가 연결이 끊기지 않게 한다).
 * 같은 부품·업체의 미입고 발주는 모두 extraDays만큼 더 밀린다.
 * '기다리기'로 결정해 둔 차질은 지연이 달라졌으므로 '발생'으로 되돌려 다시 결정하게 한다.
 */
export function buildExtension(params: {
  state: AppState;
  disruption: Disruption;
  extraDays: number;
}): { disruption: Disruption; delayedPos: PurchaseOrder[] } {
  const { state, disruption, extraDays } = params;
  const total = disruption.delayDays + extraDays;
  if (total > MAX_DELAY_DAYS) {
    throw new Error(
      `지연일수 합계는 ${MAX_DELAY_DAYS}일을 넘을 수 없습니다. (${disruption.id} 현재 ${disruption.delayDays}일 + 추가 ${extraDays}일 = ${total}일)`,
    );
  }
  const targets = affectedPos(state.purchaseOrders, disruption.partCode, disruption.supplierName);
  if (targets.length === 0) throw new Error(NO_OPEN_PO_MESSAGE);
  return {
    disruption: { ...disruption, delayDays: total, status: disruption.status === '기다리기' ? '발생' : disruption.status },
    delayedPos: targets.map((po) => ({
      ...po,
      expectedArrival: addDays(po.expectedArrival, extraDays),
      status: '지연' as const,
      disruptionId: disruption.id,
    })),
  };
}

/** buildDisruption · buildExtension 결과를 상태에 반영 (로컬 미리보기·테스트용) */
export function withDisruption(state: AppState, built: ReturnType<typeof buildDisruption>): AppState {
  const patched = new Map(built.delayedPos.map((po) => [po.id, po]));
  const known = state.disruptions.some((d) => d.id === built.disruption.id);
  return {
    ...state,
    disruptions: known
      ? state.disruptions.map((d) => (d.id === built.disruption.id ? built.disruption : d))
      : [...state.disruptions, built.disruption],
    purchaseOrders: state.purchaseOrders.map((po) => patched.get(po.id) ?? po),
  };
}

/** 이 차질 때문에 지연 중인 미입고 발주. 해결할 때 실제 도착일을 받아야 하는 발주다 */
export function resolvablePos(pos: PurchaseOrder[], disruptionId: string): PurchaseOrder[] {
  return pos.filter((po) => po.disruptionId === disruptionId && po.status === '지연');
}

/**
 * 차질 해결: 지연 중이던 발주가 실제로 언제 들어왔는지(들어오는지)를 받아 확정한다.
 * - 오늘이거나 이미 지난 날짜: 이미 들어온 것이므로 입고 처리한다 (재고에 더하고 '입고완료')
 * - 내일 이후 날짜: 그 날짜에 들어오는 것으로 확정한다 ('입고대기', 도착 예정일을 그 날짜로)
 * 어느 쪽이든 생산 예측은 이 날짜로 다시 계산된다. 발주일보다 앞선 날짜는 받을 수 없다.
 */
export function buildResolution(params: {
  state: AppState;
  disruption: Disruption;
  /** 발주번호 → 실제 도착일 */
  arrivals: Record<string, ISODate>;
}): { changedPos: PurchaseOrder[]; received: PurchaseOrder[] } {
  const { state, disruption, arrivals } = params;
  const baseDate = state.settings.baseDate;
  const changed = resolvablePos(state.purchaseOrders, disruption.id).map((po): PurchaseOrder => {
    const date = arrivals[po.id];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${po.id}의 실제 도착일을 입력하세요.`);
    if (date < po.orderDate) throw new Error(`${po.id}의 실제 도착일은 발주일(${formatMD(po.orderDate)})보다 빠를 수 없습니다.`);
    return { ...po, expectedArrival: date, status: date <= baseDate ? '입고완료' : '입고대기' };
  });
  return { changedPos: changed, received: changed.filter((po) => po.status === '입고완료') };
}

export function buildAlternative(params: {
  state: AppState;
  disruption: Disruption;
  supplier: Supplier;
  qty: number;
  action: OriginalPoAction;
  createdBy: string | null;
  /** 여러 업체에 나눠 발주할 때: 업체별 수량 (합계가 qty). 없으면 supplier 한 곳에 전량 */
  allocations?: { supplier: Supplier; qty: number }[];
}): { altPo: PurchaseOrder; altPos: PurchaseOrder[]; changedOriginals: PurchaseOrder[]; disruption: Disruption } {
  const { state, disruption, supplier, qty, action, createdBy } = params;
  const allocations = params.allocations ?? [{ supplier, qty }];
  const altPos: PurchaseOrder[] = [];
  for (const a of allocations) {
    altPos.push(
      buildPurchaseOrder({
        existing: [...state.purchaseOrders, ...altPos],
        partCode: disruption.partCode,
        supplier: a.supplier,
        qty: a.qty,
        baseDate: state.settings.baseDate,
        kind: '대체',
        disruptionId: disruption.id,
        createdBy,
      }),
    );
  }
  const after = applyOriginalPoAction(state.purchaseOrders, disruption.id, action, qty);
  return {
    altPo: altPos[0],
    altPos,
    changedOriginals: changedPos(state.purchaseOrders, after),
    disruption: {
      ...disruption,
      status: '대체발주',
      altSupplierName: allocations.map((a) => a.supplier.name).join(', '),
      altQty: qty,
      altPoId: altPos[0].id,
      originalPoAction: action,
    },
  };
}

// ── §6.6 시나리오 묶음 ───────────────────────────────────────────────────
// 여기서부터는 DB에서 읽은 상태(state)를 받는다. 재고는 수리용으로 잡아 둔 수량을 뺀 '생산용 재고'로 계산한다.

export interface BaseScenarios {
  normal: ScenarioOutcome;
  /** 현재 예측 = 기다리기 */
  wait: ScenarioOutcome;
}

export function baseScenarios(state: AppState): BaseScenarios {
  const { settings, customerOrders, purchaseOrders } = state;
  const lineParts = productionParts(state.lineParts);
  const normal = evaluateScenario(settings, lineParts, customerOrders, arrivalsFromPos(purchaseOrders, 'planned'));
  const wait = evaluateScenario(
    settings,
    lineParts,
    customerOrders,
    arrivalsFromPos(purchaseOrders, 'expected'),
    normal.sim.totalInput,
  );
  return { normal, wait };
}

/** 대체 시나리오. lateDays를 주면 '대체 · 늦을 경우' (위험 업체) */
export function altScenario(params: {
  state: AppState;
  disruption: Disruption;
  altLeadDays: number;
  qty: number;
  action: OriginalPoAction;
  normalTotalInput: number;
  lateDays?: number;
  /** 여러 업체에 나눠 발주할 때: 업체별 대체 납기와 수량 (합계가 qty). 없으면 altLeadDays에 전량 */
  allocations?: { altLeadDays: number; qty: number }[];
}): ScenarioOutcome {
  const { state, disruption, altLeadDays, qty, action, normalTotalInput, lateDays = 0 } = params;
  const pos = applyOriginalPoAction(state.purchaseOrders, disruption.id, action, qty);
  const virtual = (params.allocations ?? [{ altLeadDays, qty }]).map(
    (a): Arrival => ({
      partCode: disruption.partCode,
      qty: a.qty,
      date: addDays(state.settings.baseDate, a.altLeadDays + lateDays),
    }),
  );
  return evaluateScenario(
    state.settings,
    productionParts(state.lineParts),
    state.customerOrders,
    [...arrivalsFromPos(pos, 'expected'), ...virtual],
    normalTotalInput,
  );
}

// ── 납기 추가 미리보기 ───────────────────────────────────────────────────

export interface OrderPreview {
  /** 추가하려는 주문의 예상 완료일과 지연 */
  mine: OrderForecast;
  /** 이 주문을 넣으면 새로 납기를 넘기게 되는 기존 주문 */
  newlyLate: OrderForecast[];
  /** 오늘 투입한 차가 완성되는 날: 이보다 빠른 납기는 맞출 수 없다 */
  earliestDone: ISODate;
  /** 예측 기간의 마지막 날과 그때까지 만들 수 있는 대수 */
  periodEnd: ISODate;
  periodTotal: number;
}

/** 납기를 추가하기 전에 그 주문이 납기를 맞출 수 있는지, 다른 주문을 밀어내는지 미리 계산한다 */
export function previewNewOrder(state: AppState, draft: { qty: number; dueDate: ISODate; colorCode?: string | null }): OrderPreview {
  const { wait } = baseScenarios(state);
  const cumulative = wait.sim.cumulative;
  // 실제로 받을 번호를 쓴다: 납기가 같은 주문끼리는 번호 순으로 배정되기 때문이다
  const draftId = nextId(
    'CO-',
    state.customerOrders.map((o) => o.id),
  );
  const after = evaluateScenario(
    state.settings,
    productionParts(state.lineParts),
    [...state.customerOrders, { id: draftId, customer: '', qty: draft.qty, dueDate: draft.dueDate, colorCode: draft.colorCode ?? null }],
    arrivalsFromPos(state.purchaseOrders, 'expected'),
  ).orders;
  const lateBefore = new Set(wait.orders.filter(isLate).map((o) => o.id));
  const last = cumulative[cumulative.length - 1];
  return {
    mine: after.find((o) => o.id === draftId)!,
    newlyLate: after.filter((o) => o.id !== draftId && isLate(o) && !lateBefore.has(o.id)),
    earliestDone: addDays(state.settings.baseDate, state.settings.leadTimeDays),
    periodEnd: last?.date ?? state.settings.baseDate,
    periodTotal: last?.cum ?? 0,
  };
}
