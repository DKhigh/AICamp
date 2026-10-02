// 발주 금액과 수량에 따른 납품 지연 (Excel '제품별_기준단가', '업체별_자재단가', '지연시간' 시트)
import { CAPACITY_WINDOW_DAYS, SUPPLIER_LIMIT_DAYS } from './constants';
import { diffDays } from './date';
import { num } from './format';
import { baseCodeOf } from './partcode';
import { isLimitExempt } from './planning';
import { materialOf, partOf, reference } from './reference';
import type { ISODate, Part, PurchaseOrder, Supplier } from './types';

// ── 금액 ──────────────────────────────────────────────────────────────────

/** 그 업체가 이 부품의 주요자재를 파는 단가(원/kg). 단가가 없으면 null */
export function pricePerKgOf(part: Part, supplierName: string): number | null {
  return reference.prices.find((p) => p.supplierName === supplierName && p.materialName === part.materialName)?.pricePerKg ?? null;
}

/** 그 부품 주요자재의 기준 단가(원/kg). Excel '자재' 시트 */
export function basePricePerKgOf(part: Part): number | null {
  return materialOf(part.materialName)?.pricePerKg ?? null;
}

/**
 * 부품 1개 값(원) = 부품 기준단가(원/개) × (그 업체의 자재 단가 ÷ 자재 기준 단가). 100원 단위로 맞춘다.
 * 기준단가는 Excel '제품별_기준단가'의 현실 단가이고, 업체마다 자재를 싸게·비싸게 파는 만큼 값이 달라진다.
 * 그 자재를 팔지 않는 업체는 null.
 */
export function unitPriceOf(part: Part, supplierName: string): number | null {
  const perKg = pricePerKgOf(part, supplierName);
  const basePerKg = basePricePerKgOf(part);
  if (perKg === null || basePerKg === null || basePerKg <= 0) return null;
  return Math.round((part.basePrice * perKg) / basePerKg / 100) * 100;
}

export function orderAmount(part: Part, supplierName: string, qty: number): number | null {
  const unit = unitPriceOf(part, supplierName);
  return unit === null ? null : unit * qty;
}

/**
 * 이 발주에 쓴 돈. 감량된 발주는 줄어든 수량으로, 취소한 발주는 0원으로 본다.
 * 금액은 DB에 저장하지 않고 Excel 단가로 계산한다 (Excel 단가를 고치면 과거 발주 금액도 같이 바뀐다).
 */
export function poAmount(po: PurchaseOrder): number {
  if (po.status === '취소') return 0;
  return orderAmount(partOf(po.partCode), po.supplierName, po.qty) ?? 0;
}

/** 취소되지 않았다면 썼을 금액 (취소한 발주를 이력에 보여 줄 때) */
export function poOriginalAmount(po: PurchaseOrder): number {
  return orderAmount(partOf(po.partCode), po.supplierName, po.status === '취소' && po.qty === 0 ? po.originalQty : po.qty) ?? 0;
}

export function totalSpent(pos: PurchaseOrder[]): number {
  return pos.reduce((sum, po) => sum + poAmount(po), 0);
}

// ── 업체의 남은 공급 능력 ────────────────────────────────────────────────

export interface SupplierCapacity {
  /** Excel '월 공급가능량' (kg) */
  monthlyKg: number;
  /** 최근 CAPACITY_WINDOW_DAYS일 동안 이 업체에 발주한 양 (kg). 취소한 발주는 뺀다 */
  usedKg: number;
  remainingKg: number;
}

/**
 * 공급 능력은 월 단위로 본다: 남은 능력 = 월 공급가능량 − 최근 한 달(30일) 동안 이 업체에 이미 발주한 양.
 * 일반·대체 발주와 이미 입고된 발주를 모두 센다 (그 달에 업체가 만들어야 했던 양이다).
 * 시연 초기 데이터의 정기 계약 물량은 세지 않는다: 월 공급가능량은 정기 계약 말고 추가로 댈 수 있는 양으로 본다
 * (정기 계약 물량이 월 공급가능량보다 큰 업체도 있다).
 */
export function supplierCapacityOf(pos: PurchaseOrder[], supplier: Supplier, baseDate: ISODate): SupplierCapacity {
  const usedKg = pos
    .filter(
      (po) =>
        po.supplierName === supplier.name &&
        po.status !== '취소' &&
        !(po.kind === '일반' && isLimitExempt(po)) &&
        po.orderDate <= baseDate &&
        diffDays(baseDate, po.orderDate) < CAPACITY_WINDOW_DAYS,
    )
    .reduce((sum, po) => sum + po.qty * partOf(po.partCode).kgPerUnit, 0);
  return { monthlyKg: supplier.monthlyCapacityKg, usedKg, remainingKg: Math.max(0, supplier.monthlyCapacityKg - usedKg) };
}

/** 남은 공급 능력으로 받을 수 있는 최대 수량 */
export function maxQtyByCapacity(capacity: SupplierCapacity, part: Part): number {
  // 소수 계산 오차로 1개가 모자라게 나오지 않도록 아주 작은 값을 더한다
  return Math.floor(capacity.remainingKg / part.kgPerUnit + 1e-9);
}

/** 공급 능력을 넘으면 안내 문구, 아니면 null */
export function capacityError(capacity: SupplierCapacity, supplierName: string, part: Part, qty: number): string | null {
  const requiredKg = qty * part.kgPerUnit;
  if (requiredKg <= capacity.remainingKg + 1e-9) return null;
  const used = capacity.usedKg > 0 ? ` (월 ${num(capacity.monthlyKg)}kg 중 ${num(Math.round(capacity.usedKg))}kg은 최근 한 달 발주에 이미 씀)` : '';
  return `${supplierName}의 남은 공급 능력 ${num(Math.round(capacity.remainingKg))}kg${used}을 넘습니다. 필요량 ${num(
    Math.round(requiredKg),
  )}kg · 이 업체에서 받을 수 있는 수량은 최대 ${num(maxQtyByCapacity(capacity, part))}개입니다.`;
}

// ── 수량에 따른 납품 지연 ─────────────────────────────────────────────────

export interface QtyDelayResult {
  /** 이 업체에 최근 일주일 동안 넣은 같은 부품의 일반 발주 수량 (이번 발주 제외) */
  already: number;
  /** already + 이번 수량: 이 값으로 단계를 정한다 */
  cumulative: number;
  /** 기본 납기에 더해지는 일수 */
  days: number;
  /** Excel에 적힌 표기 ('1주일') */
  label: string;
  /** 적용된 단계의 최소 수량 */
  tierMinQty: number;
}

/**
 * 같은 업체에 같은 부품을 많이 시킬수록 늦게 온다. 단계는 Excel '지연시간' 시트:
 * 엔진이면 1개부터 3일, 10개부터 2주, 50개부터 2개월.
 * 나눠서 시켜도 피할 수 없도록, 그 업체에 최근 일주일 동안 넣은 같은 부품의 발주 수량을 합쳐서 단계를 정한다.
 * 색상만 다른 차체는 같은 부품으로 센다. 시연 초기 발주·대체(긴급) 발주·취소한 발주는 세지 않는다.
 */
export function qtyDelayOf(pos: PurchaseOrder[], part: Part, supplierName: string, qty: number, baseDate: ISODate): QtyDelayResult {
  const baseCode = baseCodeOf(part.code);
  const already = pos
    .filter(
      (po) =>
        po.supplierName === supplierName &&
        baseCodeOf(po.partCode) === baseCode &&
        !isLimitExempt(po) &&
        po.status !== '취소' &&
        po.orderDate <= baseDate &&
        diffDays(baseDate, po.orderDate) < SUPPLIER_LIMIT_DAYS,
    )
    .reduce((sum, po) => sum + po.originalQty, 0);
  const cumulative = already + qty;
  const tiers = reference.qtyDelays.find((d) => d.partName === partOf(baseCode).name)?.tiers ?? [];
  const tier = [...tiers].reverse().find((t) => cumulative >= t.minQty);
  return {
    already,
    cumulative,
    days: tier?.days ?? 0,
    label: tier?.label ?? '없음',
    tierMinQty: tier?.minQty ?? 0,
  };
}
