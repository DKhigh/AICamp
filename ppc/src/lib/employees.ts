// 발주 권한자 명단 (Excel '발주권한자' 시트 → src/data/employees.json).
// 발주·발주 취소·납기 추가/취소·데이터 초기화는 명단에 있는 사원번호를 입력해야 할 수 있다. 권한은 하나로, 나누지 않는다.
// 주의: 화면에서 하는 확인이라 실수 방지용이다. 명단은 앱에 들어 있고 DB 자체는 열려 있어 보안 장치는 아니다.
import employeesJson from '../data/employees.json';

export interface Employee {
  no: string;
  name: string;
  dept: string;
  rank?: string;
}

/** 테스트용 사원번호. Excel 명단과 상관없이 항상 통과한다 */
export const TEST_EMPLOYEE: Employee = { no: '0000', name: '테스트', dept: '시연' };

export const employees: Employee[] = [...(employeesJson as Employee[]), TEST_EMPLOYEE];

export const EMPLOYEE_REQUIRED_MESSAGE = '사원번호를 입력하세요.';
export const EMPLOYEE_UNKNOWN_MESSAGE = '발주 권한자 명단에 없는 사원번호입니다. 발주·발주 취소·데이터 초기화 권한이 없습니다.';

/** 앞뒤 공백과 대소문자는 구분하지 않는다: ' icbm-26001 ' → 'ICBM-26001' */
export function findEmployee(no: string | null | undefined): Employee | null {
  const key = (no ?? '').trim().toUpperCase();
  return employees.find((e) => e.no === key) ?? null;
}

export function employeeError(no: string | null | undefined): string | null {
  if (!no || no.trim() === '') return EMPLOYEE_REQUIRED_MESSAGE;
  return findEmployee(no) ? null : EMPLOYEE_UNKNOWN_MESSAGE;
}

/** 권한이 없으면 예외. 있으면 이력에 남길 이름을 돌려준다: '이영수(ICBM-26001)' */
export function authorize(no: string | null | undefined): string {
  const error = employeeError(no);
  if (error) throw new Error(error);
  const e = findEmployee(no)!;
  return `${e.name}(${e.no})`;
}
