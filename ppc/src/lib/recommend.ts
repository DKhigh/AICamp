// 대체 업체 추천 (DESIGN.md §6.8)
import { GRADE_EXCELLENT_MIN, GRADE_NORMAL_MIN } from './constants';
import { addDays } from './date';
import type { ISODate, Part, RateGrade, Supplier } from './types';

export function gradeOf(onTimeRate: number): RateGrade {
  if (onTimeRate >= GRADE_EXCELLENT_MIN) return '우수';
  if (onTimeRate >= GRADE_NORMAL_MIN) return '보통';
  return '위험';
}

/** 그 소재를 공급할 수 있고 상태가 '정상'인 업체. 소재 비교는 정확히 일치로만 한다 (§4.2-2) */
export function suppliersFor(materialName: string, suppliers: Supplier[]): Supplier[] {
  return suppliers.filter((s) => s.materials.includes(materialName) && s.status === '정상');
}

export interface Candidate extends Supplier {
  rank: number;
  arrival: ISODate;
  grade: RateGrade;
  requiredKg: number;
  capacityOk: boolean;
}

export interface Recommendation {
  total: number;
  riskCount: number;
  ranked: Candidate[];
}

export const RANK_RULE_TEXT =
  '① 필요한 양을 공급할 수 있는지 ② 납기 준수율 80% 미만(위험)은 뒤로 ③ 빨리 오는 순 ④ 준수율 높은 순 ⑤ 공급량 큰 순';

export function recommendSuppliers(params: {
  part: Part;
  /** 차질이 생긴 원래 업체 (후보에서 뺀다) */
  excludeSupplierName: string;
  suppliers: Supplier[];
  baseDate: ISODate;
  /** 현재 대체 수량 칸의 값 */
  qty: number;
}): Recommendation {
  const { part, excludeSupplierName, suppliers, baseDate, qty } = params;
  const requiredKg = qty * part.kgPerUnit;

  const candidates = suppliersFor(part.materialName, suppliers)
    .filter((s) => s.name !== excludeSupplierName)
    .map((s) => ({
      ...s,
      rank: 0,
      arrival: addDays(baseDate, s.altLeadDays),
      grade: gradeOf(s.onTimeRate),
      requiredKg,
      capacityOk: requiredKg <= s.monthlyCapacityKg,
    }));

  const isRisk = (c: Candidate) => (c.grade === '위험' ? 1 : 0);
  candidates.sort(
    (a, b) =>
      Number(b.capacityOk) - Number(a.capacityOk) ||
      isRisk(a) - isRisk(b) || // 위험 업체는 빨라도 후순위
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
  };
}
