// 발주 금액과 수량에 따른 납품 지연 (Excel '업체별_자재단가', '지연시간' 시트)
import { SUPPLIER_LIMIT_DAYS } from './constants';
import { diffDays } from './date';
import { baseCodeOf } from './partcode';
import { partOf, reference } from './reference';
import type { ISODate, Part, PurchaseOrder } from './types';

// ── 금액 ──────────────────────────────────────────────────────────────────

/** 그 업체가 이 부품의 주요자재를 파는 단가(원/kg). 단가가 없으면 null */
export function pricePerKgOf(part: Part, supplierName: string): number | null {
  return reference.prices.find((p) => p.supplierName === supplierName && p.materialName === part.materialName)?.pricePerKg ?? null;
}

/** 부품 1개 값(원) = 자재 단가(원/kg) × 부품 1개당 소재 필요량(kg) */
export function unitPriceOf(part: Part, supplierName: string): number | null {
  const perKg = pricePerKgOf(part, supplierName);
  return perKg === null ? null : Math.round(perKg * part.kgPerUnit);
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
        po.kind === '일반' &&
        po.status !== '취소' &&
        po.createdBy !== null &&
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
