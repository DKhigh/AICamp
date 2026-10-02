// DESIGN.md §4.5
export type ISODate = string; // 'YYYY-MM-DD'

// reference.json (Excel)
export interface Part {
  code: string;
  name: string;
  category: string;
  materialName: string;
  defaultSupplier: string;
  kgPerUnit: number;
  /** 색상별 변형(차체)일 때만: 기본 부품 코드와 색상 코드 */
  baseCode?: string;
  colorCode?: string;
}
export interface Supplier {
  code: string;
  name: string;
  materials: string[];
  leadDays: number;
  altLeadDays: number;
  status: string;
  monthlyCapacityKg: number;
  onTimeRate: number;
}
export interface Material {
  code: string;
  name: string;
  unit: string;
  defaultSupplier: string;
  leadDays: number;
  altAvgLeadDays: number;
}
/** 차질 발생 창의 '시연 예시' 버튼 (시연 데이터 demo_state.json. Excel에서 오지 않는다) */
export interface DisruptionExample {
  id: string;
  partCode: string;
  supplierName: string;
  reason: string;
  delayDays: number;
}
/** 업체별 자재 공급단가 (원/kg) */
export interface SupplierPrice {
  supplierName: string;
  materialName: string;
  pricePerKg: number;
}
export interface CarColor {
  code: string;
  name: string;
  description: string;
}
export interface PartCaution {
  partName: string;
  text: string;
}
/** 발주 수량에 따른 납품 지연. tiers는 minQty 오름차순 */
export interface QtyDelay {
  partName: string;
  tiers: { minQty: number; days: number; label: string }[];
}
export interface Reference {
  parts: Part[];
  suppliers: Supplier[];
  materials: Material[];
  prices: SupplierPrice[];
  colors: CarColor[];
  cautions: PartCaution[];
  qtyDelays: QtyDelay[];
}

// DB
export interface Settings {
  baseDate: ISODate;
  dailyCapacity: number;
  leadTimeDays: number;
  horizonDays: number;
}
export interface LinePart {
  partCode: string;
  qtyPerCar: number;
  onHand: number;
  sortOrder: number;
}
export type PoStatus = '입고대기' | '지연' | '입고완료' | '취소';
export type PoKind = '일반' | '대체';
export interface PurchaseOrder {
  id: string;
  partCode: string;
  supplierName: string;
  qty: number;
  originalQty: number;
  orderDate: ISODate;
  plannedArrival: ISODate;
  expectedArrival: ISODate;
  status: PoStatus;
  kind: PoKind;
  disruptionId: string | null;
  createdBy: string | null;
  createdAt: string;
}
export type DisruptionStatus = '발생' | '기다리기' | '대체발주' | '해결';
export type OriginalPoAction = '유지' | '감량' | '취소';
export interface Disruption {
  id: string;
  partCode: string;
  supplierName: string;
  materialName: string;
  reason: string;
  delayDays: number;
  detectedDate: ISODate;
  status: DisruptionStatus;
  altSupplierName: string | null;
  altQty: number | null;
  altPoId: string | null;
  originalPoAction: OriginalPoAction | null;
  createdBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
export type RateGrade = '우수' | '보통' | '위험'; // §2.2 A10, gradeOf(onTimeRate)
export interface CustomerOrder {
  id: string;
  customer: string;
  qty: number;
  dueDate: ISODate;
  /** 주문한 차량 색상 (Excel '차량색상'의 색상 코드). 그 색 차체로 만든다. 없으면 색을 가리지 않는다 */
  colorCode?: string | null;
}

/** 활동 기록: 누가 언제 무엇을 했는지. 저장하는 작업마다 한 줄씩 남긴다 */
export interface ActivityLog {
  id: string;
  /** 기록한 시각 (ISO) */
  at: string;
  /** '이름(사원번호)' */
  actor: string;
  /** '발주 등록', '차질 해결', '납기 취소' … */
  action: string;
  /** 대상 번호: 'PO-004', 'D-001', 'CO-002' … 없으면 빈 문자열 */
  target: string;
  detail: string;
}

/** DB에서 읽은 화면 상태 전체. 계산 결과는 여기에 넣지 않는다 (§8) */
export interface AppState {
  settings: Settings;
  lineParts: LinePart[];
  purchaseOrders: PurchaseOrder[];
  disruptions: Disruption[];
  customerOrders: CustomerOrder[];
  /** 최신 순 */
  logs: ActivityLog[];
  /** false면 DB에 activity_log 테이블이 없어 기록이 저장되지 않는다 (supabase/migration_activity_log.sql 실행 전) */
  logReady: boolean;
}
