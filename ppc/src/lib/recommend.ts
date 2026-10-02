// 대체 업체 추천 (DESIGN.md §6.8)
import { GRADE_EXCELLENT_MIN, GRADE_NORMAL_MIN } from './constants';
import { addDays } from './date';
import type { Disruption, ISODate, Part, RateGrade, Supplier } from './types';

export function gradeOf(onTimeRate: number): RateGrade {
  if (onTimeRate >= GRADE_EXCELLENT_MIN) return '우수';
  if (onTimeRate >= GRADE_NORMAL_MIN) return '보통';
  return '위험';
}

/** 발주할 수 있는 업체 상태 (Excel 공급업체 시트의 '상태'). 이 밖의 상태(예: 거래 중지)는 후보에서 뺀다 */
export const ORDERABLE_STATUSES = ['우수', '정상', '주의'];
/** 조심해서 써야 하는 상태: 발주는 되지만 경고를 띄우고 추천에서는 뒤로 미룬다 */
export const CAUTION_STATUS = '주의';

/** 그 소재를 공급할 수 있고 발주할 수 있는 상태인 업체. 소재 비교는 정확히 일치로만 한다 (§4.2-2) */
export function suppliersFor(materialName: string, suppliers: Supplier[]): Supplier[] {
  return suppliers.filter((s) => s.materials.includes(materialName) && ORDERABLE_STATUSES.includes(s.status));
}

/**
 * 해결되지 않은 차질이 있는 업체 이름. Excel의 업체 상태는 '정상'으로 고정이라,
 * 지금 문제가 있는 업체인지는 진행 중인 차질로 판단한다 (부품이 달라도 그 업체는 추천하지 않는다).
 */
export function disruptedSupplierNames(disruptions: Disruption[]): string[] {
  return [...new Set(disruptions.filter((d) => d.status !== '해결').map((d) => d.supplierName))];
}

export interface Candidate extends Supplier {
  rank: number;
  arrival: ISODate;
  grade: RateGrade;
  requiredKg: number;
  /** 최근 한 달 동안 이 업체에 이미 발주한 양 (kg) */
  usedKg: number;
  /** 월 공급가능량 − usedKg */
  remainingKg: number;
  /** 필요한 양을 남은 공급 능력으로 댈 수 있는지 */
  capacityOk: boolean;
  /** 남은 공급 능력으로 받을 수 있는 최대 수량 */
  maxQty: number;
}

export interface Recommendation {
  total: number;
  riskCount: number;
  ranked: Candidate[];
  /** 후보에서 뺀 업체: 진행 중인 차질이 있는 곳 */
  excludedDisrupted: Supplier[];
  /** 후보에서 뺀 업체: 지연된 원래 발주보다도 늦게 오는 곳 */
  excludedTooLate: Supplier[];
}

export interface AltAllocation {
  supplier: Candidate;
  qty: number;
}

/**
 * 대체 수량이 한 업체 한도(50개)를 넘으면 여러 업체에 나눠 발주하는 계획을 만든다.
 * 고른 업체(없으면 1순위)에 먼저 한도만큼, 남은 수량은 순위대로 다음 업체에 넣는다.
 * 각 업체에는 한도와 남은 공급 능력 가운데 작은 쪽까지만 넣는다. shortBy > 0이면 후보를 다 써도 모자란다.
 */
export function splitPlan(ranked: Candidate[], qty: number, firstName: string | null, perSupplierMax: number): { allocations: AltAllocation[]; shortBy: number } {
  const first = ranked.find((c) => c.name === firstName);
  const order = first ? [first, ...ranked.filter((c) => c !== first)] : ranked;
  const allocations: AltAllocation[] = [];
  let remaining = qty;
  for (const supplier of order) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, perSupplierMax, supplier.maxQty);
    if (take <= 0) continue;
    allocations.push({ supplier, qty: take });
    remaining -= take;
  }
  return { allocations, shortBy: Math.max(0, remaining) };
}

export const RANK_RULE_TEXT =
  '① 남은 공급 능력으로 필요한 양을 댈 수 있는지 ② 납기 준수율 80% 미만(위험)과 상태 \'주의\' 업체는 뒤로 ③ 빨리 오는 순 ④ 준수율 높은 순 ⑤ 공급량 큰 순 · 진행 중인 차질이 있는 업체와 원래 발주보다 늦게 오는 업체는 제외';

export function recommendSuppliers(params: {
  part: Part;
  /** 차질이 생긴 원래 업체 (후보에서 뺀다) */
  excludeSupplierName: string;
  suppliers: Supplier[];
  baseDate: ISODate;
  /** 현재 대체 수량 칸의 값 */
  qty: number;
  /** 업체 이름 → 최근 한 달 동안 이미 발주한 양(kg). 없으면 0으로 본다 */
  usedKg?: Record<string, number>;
  /** 진행 중인 차질이 있는 업체 (후보에서 뺀다) */
  disruptedSuppliers?: string[];
  /** 지연된 원래 발주의 도착 예정일. 이보다 늦게 오는 업체는 대체하는 의미가 없어 뺀다 */
  originalArrival?: ISODate | null;
}): Recommendation {
  const { part, excludeSupplierName, suppliers, baseDate, qty, usedKg = {}, disruptedSuppliers = [], originalArrival = null } = params;
  const requiredKg = qty * part.kgPerUnit;

  const pool = suppliersFor(part.materialName, suppliers).filter((s) => s.name !== excludeSupplierName);
  const excludedDisrupted = pool.filter((s) => disruptedSuppliers.includes(s.name));
  const healthy = pool.filter((s) => !disruptedSuppliers.includes(s.name));
  const isTooLate = (s: Supplier) => originalArrival !== null && addDays(baseDate, s.altLeadDays) > originalArrival;
  const excludedTooLate = healthy.filter(isTooLate);

  const candidates = healthy
    .filter((s) => !isTooLate(s))
    .map((s): Candidate => {
      const used = usedKg[s.name] ?? 0;
      const remainingKg = Math.max(0, s.monthlyCapacityKg - used);
      return {
        ...s,
        rank: 0,
        arrival: addDays(baseDate, s.altLeadDays),
        grade: gradeOf(s.onTimeRate),
        requiredKg,
        usedKg: used,
        remainingKg,
        capacityOk: requiredKg <= remainingKg + 1e-9,
        maxQty: Math.floor(remainingKg / part.kgPerUnit + 1e-9),
      };
    });

  const isRisk = (c: Candidate) => (c.grade === '위험' ? 1 : 0);
  candidates.sort(
    (a, b) =>
      Number(b.capacityOk) - Number(a.capacityOk) ||
      isRisk(a) - isRisk(b) || // 위험 업체는 빨라도 후순위
      Number(a.status === CAUTION_STATUS) - Number(b.status === CAUTION_STATUS) || // 상태 '주의' 업체도 뒤로
      a.altLeadDays - b.altLeadDays ||
      b.onTimeRate - a.onTimeRate ||
      b.monthlyCapacityKg - a.monthlyCapacityKg ||
      a.code.localeCompare(b.code),
  );
  candidates.forEach((c, i) => (c.rank = i + 1));

  return {
    total: candidates.length,
    riskCount: candidates.filter((c) => c.grade === '위험').length,
    ranked: candidates,
    excludedDisrupted,
    excludedTooLate,
  };
}
