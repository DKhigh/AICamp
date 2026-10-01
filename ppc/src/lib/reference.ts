// Excel에서 만든 참조 데이터 (DESIGN.md §3.3). 바뀌지 않으므로 DB에 넣지 않는다.
import demoJson from '../data/demo_state.json';
import referenceJson from '../data/reference.json';
import { addDays, diffDays } from './date';
import { baseCodeOf, colorCodeOf } from './partcode';
import type {
  AppState,
  CarColor,
  CustomerOrder,
  LinePart,
  Part,
  PoKind,
  PoStatus,
  PurchaseOrder,
  Reference,
  Settings,
  Supplier,
} from './types';

export const reference = referenceJson as Reference;

const partByCode = new Map(reference.parts.map((p) => [p.code, p]));
const supplierByName = new Map(reference.suppliers.map((s) => [s.name, s]));

/** 색상별 변형 코드('P012-C01')는 기본 부품에 색상을 붙여 돌려준다: 차체(화이트) */
export function partOf(code: string): Part {
  const baseCode = baseCodeOf(code);
  const base = partByCode.get(baseCode);
  if (!base) throw new Error(`부품 카탈로그에 없는 코드입니다: ${code}`);
  const colorCode = colorCodeOf(code);
  if (!colorCode) return base;
  const color = colorOf(colorCode);
  return { ...base, code, name: `${base.name}(${color?.name ?? colorCode})`, baseCode, colorCode };
}

export function colorOf(code: string | null | undefined): CarColor | undefined {
  return reference.colors.find((c) => c.code === code);
}

export function supplierOf(name: string): Supplier | undefined {
  return supplierByName.get(name);
}

export function materialOf(name: string) {
  return reference.materials.find((m) => m.name === name);
}

/** demo_state.json의 날짜가 기준으로 삼는 날 (설계서 §4.3의 기준일) */
export const DEMO_BASE_DATE = (demoJson.settings as Settings).baseDate;

/**
 * §4.3 시연용 가상값. [데이터 초기화]가 DB를 이 상태로 되돌린다.
 * 기준일은 항상 오늘이므로, 발주일·도착 예정일·납기를 baseDate에 맞춰 같은 간격으로 옮긴다
 * (기준일이 10/5이면 설계서의 날짜 그대로다).
 */
export function demoState(baseDate: string = DEMO_BASE_DATE): AppState {
  const createdAt = new Date().toISOString();
  const offset = diffDays(baseDate, DEMO_BASE_DATE);
  const shift = (d: string) => addDays(d, offset);
  return {
    settings: { ...(demoJson.settings as Settings), baseDate },
    lineParts: demoJson.lineParts as LinePart[],
    purchaseOrders: demoJson.purchaseOrders.map(
      (po): PurchaseOrder => ({
        ...po,
        orderDate: shift(po.orderDate),
        plannedArrival: shift(po.plannedArrival),
        expectedArrival: shift(po.expectedArrival),
        status: po.status as PoStatus,
        kind: po.kind as PoKind,
        disruptionId: null,
        createdBy: null,
        createdAt,
      }),
    ),
    disruptions: [],
    customerOrders: (demoJson.customerOrders as CustomerOrder[]).map((o) => ({ ...o, dueDate: shift(o.dueDate) })),
  };
}
