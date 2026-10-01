// Excel에서 만든 참조 데이터 (DESIGN.md §3.3). 바뀌지 않으므로 DB에 넣지 않는다.
import demoJson from '../data/demo_state.json';
import referenceJson from '../data/reference.json';
import type {
  AppState,
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

export function partOf(code: string): Part {
  const part = partByCode.get(code);
  if (!part) throw new Error(`부품 카탈로그에 없는 코드입니다: ${code}`);
  return part;
}

export function supplierOf(name: string): Supplier | undefined {
  return supplierByName.get(name);
}

export function materialOf(name: string) {
  return reference.materials.find((m) => m.name === name);
}

/** §4.3 시연용 가상값. [데이터 초기화]가 DB를 이 상태로 되돌린다 */
export function demoState(): AppState {
  const createdAt = new Date().toISOString();
  return {
    settings: demoJson.settings as Settings,
    lineParts: demoJson.lineParts as LinePart[],
    purchaseOrders: demoJson.purchaseOrders.map(
      (po): PurchaseOrder => ({
        ...po,
        status: po.status as PoStatus,
        kind: po.kind as PoKind,
        disruptionId: null,
        createdBy: null,
        createdAt,
      }),
    ),
    disruptions: [],
    customerOrders: demoJson.customerOrders as CustomerOrder[],
  };
}
