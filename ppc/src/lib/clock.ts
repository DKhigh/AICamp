// 기준일(오늘). 항상 이 화면을 연 기기의 오늘 날짜를 쓴다.
// 시연 리허설이나 검증에서 날짜를 고정하고 싶을 때만 VITE_BASE_DATE=YYYY-MM-DD 를 준다.
import type { ISODate } from './types';

/** 기기 현지 시각의 오늘을 'YYYY-MM-DD'로 */
export function todayISO(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function today(): ISODate {
  const fixed = import.meta.env.VITE_BASE_DATE;
  return fixed && /^\d{4}-\d{2}-\d{2}$/.test(fixed) ? fixed : todayISO();
}
