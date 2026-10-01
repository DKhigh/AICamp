// 저장할 내용을 만드는 순수 함수 (DESIGN.md §5 F1-2, F2-1, F2-4).
// api.ts는 이 함수들이 돌려준 값을 그대로 DB에 쓴다. 테스트도 같은 함수를 쓴다.
import { addDays } from './date';
import {
  applyOriginalPoAction,
  arrivalsFromPos,
  changedPos,
  evaluateScenario,
  openPos,
  type Arrival,
  type ScenarioOutcome,
} from './planning';
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
}): PurchaseOrder {
  const { existing, partCode, supplier, qty, baseDate, kind, createdBy } = params;
  // 일반 발주는 기본 납기, 대체(긴급) 발주는 대체 납기 (§2.2 A3)
  const arrival = addDays(baseDate, kind === '대체' ? supplier.altLeadDays : supplier.leadDays);
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

/** buildDisruption 결과를 상태에 반영 (로컬 미리보기·테스트용) */
export function withDisruption(state: AppState, built: ReturnType<typeof buildDisruption>): AppState {
  const patched = new Map(built.delayedPos.map((po) => [po.id, po]));
  return {
    ...state,
    disruptions: [...state.disruptions, built.disruption],
    purchaseOrders: state.purchaseOrders.map((po) => patched.get(po.id) ?? po),
  };
}

export function buildAlternative(params: {
  state: AppState;
  disruption: Disruption;
  supplier: Supplier;
  qty: number;
  action: OriginalPoAction;
  createdBy: string | null;
}): { altPo: PurchaseOrder; changedOriginals: PurchaseOrder[]; disruption: Disruption } {
  const { state, disruption, supplier, qty, action, createdBy } = params;
  const altPo = buildPurchaseOrder({
    existing: state.purchaseOrders,
    partCode: disruption.partCode,
    supplier,
    qty,
    baseDate: state.settings.baseDate,
    kind: '대체',
    disruptionId: disruption.id,
    createdBy,
  });
  const after = applyOriginalPoAction(state.purchaseOrders, disruption.id, action, qty);
  return {
    altPo,
    changedOriginals: changedPos(state.purchaseOrders, after),
    disruption: {
      ...disruption,
      status: '대체발주',
      altSupplierName: supplier.name,
      altQty: qty,
      altPoId: altPo.id,
      originalPoAction: action,
    },
  };
}

// ── §6.6 시나리오 묶음 ───────────────────────────────────────────────────

export interface BaseScenarios {
  normal: ScenarioOutcome;
  /** 현재 예측 = 기다리기 */
  wait: ScenarioOutcome;
}

export function baseScenarios(state: AppState): BaseScenarios {
  const { settings, lineParts, customerOrders, purchaseOrders } = state;
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
}): ScenarioOutcome {
  const { state, disruption, altLeadDays, qty, action, normalTotalInput, lateDays = 0 } = params;
  const pos = applyOriginalPoAction(state.purchaseOrders, disruption.id, action, qty);
  const virtual: Arrival = {
    partCode: disruption.partCode,
    qty,
    date: addDays(state.settings.baseDate, altLeadDays + lateDays),
  };
  return evaluateScenario(
    state.settings,
    state.lineParts,
    state.customerOrders,
    [...arrivalsFromPos(pos, 'expected'), virtual],
    normalTotalInput,
  );
}
