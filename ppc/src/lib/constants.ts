// 관리자가 바꿀 수 있는 기준값 (DESIGN.md §2.2 A10, §5 F1-1)

/** 납기 준수율이 이 값 이상이면 '우수' */
export const GRADE_EXCELLENT_MIN = 95;
/** 납기 준수율이 이 값 이상이면 '보통', 미만이면 '위험' */
export const GRADE_NORMAL_MIN = 80;
/** 위험 업체는 예정일보다 이만큼 늦게 올 수 있다고 본다 */
export const RISK_LATE_DAYS = 2;
/** 재고 일수가 이 값 미만이면 '주의' */
export const LOW_COVERAGE_DAYS = 5;

export const DISRUPTION_REASONS = ['납품 지연', '품질 불량', '설비 고장', '물류 문제', '기타'] as const;
export const MIN_DELAY_DAYS = 1;
export const MAX_DELAY_DAYS = 60;

/** (P1) 자동 새로고침 간격 */
export const AUTO_REFRESH_MS = 10_000;

/** 업체 한 곳에 일반 발주로 넣을 수 있는 수량 한도 */
export const SUPPLIER_ORDER_LIMIT = 50;
/** 한도에 넣는 기간: 발주일로부터 이 일수가 지나면 그 발주분의 한도가 풀린다 */
export const SUPPLIER_LIMIT_DAYS = 7;
