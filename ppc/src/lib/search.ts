// 발주 검색: 어떤 부품을 어느 업체에서 얼마에, 며칠 만에, 납기 준수율 몇 %로 살 수 있는지 찾는다. 순수 함수.
import { maxQtyByCapacity, supplierCapacityOf, unitPriceOf, type SupplierCapacity } from './ordering';
import { openPos, partGroups, sortByArrival, supplierLimitOf, type SupplierLimit } from './planning';
import { disruptedSupplierNames, gradeOf, suppliersFor } from './recommend';
import { partOf, reference, supplierOf } from './reference';
import type { AppState, Disruption, Part, PurchaseOrder, RateGrade, Supplier } from './types';

export interface Offer {
  /** 부품 (색상별 차체는 '차체' 한 줄로 묶는다) */
  part: Part;
  /** 발주 창을 열 때 쓸 부품 코드 (차체는 첫 번째 색) */
  orderPartCode: string;
  supplier: Supplier;
  /** 부품 1개 값(원). 단가가 없으면 null */
  unitPrice: number | null;
  /** 일반 발주 기본 납기(일) */
  leadDays: number;
  /** 대체(긴급) 발주 납기(일) */
  altLeadDays: number;
  onTimeRate: number;
  grade: RateGrade;
  isDefault: boolean;
  /** 이번 주에 이 업체에 더 넣을 수 있는 일반 발주 수량 (주간 한도) */
  limitRemaining: number;
  /** 남은 월 공급 능력으로 받을 수 있는 최대 수량 */
  maxQty: number;
  /** 진행 중인 차질이 있는 업체 */
  disrupted: boolean;
}

export interface SupplierProfile {
  supplier: Supplier;
  grade: RateGrade;
  /** 이 업체에서 살 수 있는 라인 부품 (가격이 싼 순이 아니라 라인 순) */
  offers: Offer[];
  /** 월 공급가능량과 최근 한 달 발주량 (kg) */
  capacity: SupplierCapacity;
  /** 이번 주 일반 발주 한도 */
  limit: SupplierLimit;
  /** 해결되지 않은 차질 */
  activeDisruptions: Disruption[];
  /** 이 업체에 넣어 둔 미입고 발주 */
  openOrders: PurchaseOrder[];
}

/** 업체 한 곳의 정보: 연락처, 납품하는 부품과 가격, 준수율, 발주 가능량 */
export function supplierProfile(state: AppState, supplierName: string): SupplierProfile | null {
  const supplier = supplierOf(supplierName);
  if (!supplier) return null;
  const baseDate = state.settings.baseDate;
  return {
    supplier,
    grade: gradeOf(supplier.onTimeRate),
    offers: searchOffers(state, '').filter((o) => o.supplier.name === supplier.name),
    capacity: supplierCapacityOf(state.purchaseOrders, supplier, baseDate),
    limit: supplierLimitOf(state.purchaseOrders, supplier.name, baseDate),
    activeDisruptions: state.disruptions.filter((d) => d.status !== '해결' && d.supplierName === supplier.name),
    openOrders: sortByArrival(openPos(state.purchaseOrders).filter((po) => po.supplierName === supplier.name)),
  };
}

/** 검색창 자동완성 후보: 라인 부품 이름 → 그 부품을 파는 업체 이름 → 소재 이름 (중복 없이) */
export function searchSuggestions(state: AppState): string[] {
  const parts = partGroups(state.lineParts).map((g) => partOf(g.code));
  const suppliers = parts.flatMap((p) => suppliersFor(p.materialName, reference.suppliers).map((s) => s.name)).sort((a, b) => a.localeCompare(b, 'ko'));
  return [...new Set([...parts.map((p) => p.name), ...suppliers, ...parts.map((p) => p.materialName)])];
}

/**
 * 검색어를 공백으로 나눠, 모든 낱말이 부품명·부품 코드·분류·소재·업체명·업체 코드 가운데 어딘가에 들어 있는 줄만 남긴다.
 * 검색어가 비어 있으면 전부. 부품 순서(라인 순) → 가격이 싼 순 → 납기가 빠른 순으로 정렬한다.
 */
export function searchOffers(state: AppState, query: string): Offer[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const disrupted = disruptedSupplierNames(state.disruptions);
  const baseDate = state.settings.baseDate;
  const offers: Offer[] = [];

  for (const group of partGroups(state.lineParts)) {
    const part = partOf(group.code);
    for (const supplier of suppliersFor(part.materialName, reference.suppliers)) {
      const haystack = [part.name, part.code, part.category, part.materialName, supplier.name, supplier.code].join(' ').toLowerCase();
      if (!words.every((w) => haystack.includes(w))) continue;
      offers.push({
        part,
        orderPartCode: group.parts[0].partCode,
        supplier,
        unitPrice: unitPriceOf(part, supplier.name),
        leadDays: supplier.leadDays,
        altLeadDays: supplier.altLeadDays,
        onTimeRate: supplier.onTimeRate,
        grade: gradeOf(supplier.onTimeRate),
        isDefault: supplier.name === part.defaultSupplier,
        limitRemaining: supplierLimitOf(state.purchaseOrders, supplier.name, baseDate).remaining,
        maxQty: maxQtyByCapacity(supplierCapacityOf(state.purchaseOrders, supplier, baseDate), part),
        disrupted: disrupted.includes(supplier.name),
      });
    }
  }
  const order = new Map(partGroups(state.lineParts).map((g, i) => [g.code, i]));
  return offers.sort(
    (a, b) =>
      order.get(a.part.code)! - order.get(b.part.code)! ||
      (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity) ||
      a.leadDays - b.leadDays ||
      a.supplier.code.localeCompare(b.supplier.code),
  );
}
