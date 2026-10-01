// 날짜는 시간대 없는 'YYYY-MM-DD' 문자열로만 다룬다 (DESIGN.md §0-5, §6.1).
// 더하기와 차이 계산은 전부 UTC 기준이라 실행 환경의 시간대에 영향을 받지 않는다.
import type { ISODate } from './types';

const DAY_MS = 86_400_000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function toUtcMs(d: ISODate): number {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

export function addDays(d: ISODate, n: number): ISODate {
  return new Date(toUtcMs(d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** a - b (일) */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUtcMs(a) - toUtcMs(b)) / DAY_MS);
}

/** '2026-10-07' → '10/7' */
export function formatMD(d: ISODate): string {
  const [, m, day] = d.split('-').map(Number);
  return `${m}/${day}`;
}

/** '2026-10-05' → '2026-10-05(월)' */
export function formatWithWeekday(d: ISODate): string {
  return `${d}(${WEEKDAYS[new Date(toUtcMs(d)).getUTCDay()]})`;
}
