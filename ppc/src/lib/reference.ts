// Excel에서 만든 참조 데이터 (DESIGN.md §3.3). 바뀌지 않으므로 DB에 넣지 않는다.
import demoJson from '../data/demo_state.json';
import referenceJson from '../data/reference.json';
import { CONTRACT_MARK } from './constants';
import { addDays, diffDays, formatMD } from './date';
import { num } from './format';
import { baseCodeOf, colorCodeOf, variantCode } from './partcode';
import type {
  ActivityLog,
  AppState,
  CarColor,
  DisruptionExample,
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

/** 차질 발생 창의 '시연 예시' 버튼 */
export const disruptionExamples = demoJson.disruptionExamples as DisruptionExample[];

/** 지난 출차 실적을 만드는 규칙 (shipments.ts) */
export const pastShipmentRule = demoJson.pastShipments as { days: number; perDay: number; customers: string[] };

/**
 * 시연 초기의 라인 부품. 차체는 Excel '차량색상' 시트의 색상마다 한 줄씩 만든다 (P012-C01 …):
 * Excel에 색상을 더하거나 빼고 `npm run data`를 돌리면 차체 종류도 그대로 따라 바뀐다.
 * 색상별 초기 재고는 시연값(demo_state.json bodyStock)이고, 거기에 없는 색은 defaultOnHand를 쓴다.
 */
function demoLineParts(): LinePart[] {
  const body = demoJson.bodyStock;
  const byName = body.onHandByColorName as Record<string, number>;
  const bodies = reference.colors.map(
    (color, i): LinePart => ({
      partCode: variantCode(body.partCode, color.code),
      qtyPerCar: body.qtyPerCar,
      onHand: byName[color.name] ?? body.defaultOnHand,
      // 차체들은 조향(5)과 배터리(100) 사이에 색상 코드 순으로 놓는다. DB의 sort_order는 정수 열이다
      sortOrder: body.sortOrder + i,
    }),
  );
  return [...(demoJson.lineParts as LinePart[]), ...bodies].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 'YYYY-MM-DD' + 'HH:mm' (기기 현지 시각) → ISO 시각 */
function atLocal(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

/**
 * §4.3 시연용 가상값. [데이터 초기화]가 DB를 이 상태로 되돌린다.
 * 기준일은 항상 오늘이므로, 발주일·도착 예정일·납기를 baseDate에 맞춰 같은 간격으로 옮긴다
 * (기준일이 10/5이면 설계서의 날짜 그대로다).
 * 초기 발주와 주문은 '지난 며칠 사이에 담당자가 입력해 둔 것'으로 만든다:
 * 발주일·입력 시각은 모두 기준일보다 앞이고, 그때의 활동 기록(logs)도 함께 만든다.
 */
export function demoState(baseDate: string = DEMO_BASE_DATE): AppState {
  const offset = diffDays(baseDate, DEMO_BASE_DATE);
  const shift = (d: string) => addDays(d, offset);

  const purchaseOrders = demoJson.purchaseOrders.map(
    ({ loggedTime, ...po }): PurchaseOrder => ({
      ...po,
      orderDate: shift(po.orderDate),
      plannedArrival: shift(po.plannedArrival),
      expectedArrival: shift(po.expectedArrival),
      status: po.status as PoStatus,
      kind: po.kind as PoKind,
      disruptionId: null,
      createdAt: atLocal(shift(po.orderDate), loggedTime),
    }),
  );
  // 주문 색상은 색 이름으로 적어 두고 Excel '차량색상'의 코드로 바꾼다 (Excel에 그 색이 없으면 색을 가리지 않는 주문)
  const colorCodeByName = (name: string) => reference.colors.find((c) => c.name === name)?.code ?? null;
  const customerOrders = demoJson.customerOrders.map((o) => ({
    id: o.id,
    customer: o.customer,
    qty: o.qty,
    dueDate: shift(o.dueDate),
    colorCode: colorCodeByName(o.colorName),
  }));

  const logs: ActivityLog[] = [
    ...demoJson.customerOrders.map((o) => ({
      id: `seed-${o.id}`,
      at: atLocal(shift(o.addedDate), o.loggedTime),
      actor: o.addedBy,
      action: '납기 추가',
      target: o.id,
      detail: `${o.customer} ${num(o.qty)}대 · ${o.colorName} · 납기 ${formatMD(shift(o.dueDate))}`,
    })),
    ...purchaseOrders.map((po, i) => ({
      id: `seed-${po.id}`,
      at: po.createdAt,
      actor: (po.createdBy ?? '').replace(CONTRACT_MARK, ''),
      action: '발주 등록',
      target: po.id,
      detail: `${partOf(po.partCode).name} ${num(po.qty)}개 · ${po.supplierName} · 도착 예정 ${formatMD(po.plannedArrival)}${
        demoJson.purchaseOrders[i].createdBy.endsWith(CONTRACT_MARK) ? ' · 정기 계약' : ''
      }`,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    settings: { ...(demoJson.settings as Settings), baseDate },
    lineParts: demoLineParts(),
    purchaseOrders,
    disruptions: [],
    customerOrders,
    logs,
    logReady: true,
  };
}
