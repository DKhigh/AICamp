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
export interface DelayPreset {
  id: string;
  reason: string;
  supplierName: string;
  materialName: string;
  delayDays: number;
  compareCount: number;
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
  delayPresets: DelayPreset[];
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
}

/** DB에서 읽은 화면 상태 전체. 계산 결과는 여기에 넣지 않는다 (§8) */
export interface AppState {
  settings: Settings;
  lineParts: LinePart[];
  purchaseOrders: PurchaseOrder[];
  disruptions: Disruption[];
  customerOrders: CustomerOrder[];
}
