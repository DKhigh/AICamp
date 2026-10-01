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

/** 발주·대체 발주·자동차 주문 한 건의 수량 상한 (입력 실수와 DB 정수 범위 초과를 막는다) */
export const MAX_ORDER_QTY = 100_000;
/** 생산 설정 상한 */
export const MAX_DAILY_CAPACITY = 1_000;
export const MAX_LEAD_TIME_DAYS = 30;

/** 업체의 '월 공급가능량'에서 빼는 기간: 최근 이 일수 동안 그 업체에 발주한 양(kg)을 이미 쓴 것으로 본다 */
export const CAPACITY_WINDOW_DAYS = 30;

/** (P1) 자동 새로고침 간격 */
export const AUTO_REFRESH_MS = 10_000;

/** 업체 한 곳에 일반 발주로 넣을 수 있는 수량 한도 */
export const SUPPLIER_ORDER_LIMIT = 50;
/** 한도에 넣는 기간: 발주일로부터 이 일수가 지나면 그 발주분의 한도가 풀린다 */
export const SUPPLIER_LIMIT_DAYS = 7;
/** 시연 초기 발주의 입력자 끝에 붙는 표시. 정기 계약 물량은 주간 발주 한도와 수량 지연에서 뺀다 */
export const CONTRACT_MARK = ' · 정기 계약';
