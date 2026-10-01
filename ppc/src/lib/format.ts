// 표기 규칙 (DESIGN.md §8): 숫자는 천 단위 콤마
export function num(n: number): string {
  return n.toLocaleString('en-US');
}

/** 받침 유무에 맞는 조사를 붙인다: withParticle('엔진', '이', '가') → '엔진이' */
export function withParticle(word: string, withFinal: string, withoutFinal: string): string {
  const code = word.charCodeAt(word.length - 1);
  const isHangul = code >= 0xac00 && code <= 0xd7a3;
  const hasFinal = isHangul ? (code - 0xac00) % 28 !== 0 : false;
  return word + (hasFinal ? withFinal : withoutFinal);
}

/** D-day 표기 (§5 F1-3) */
export function ddayLabel(dday: number): string {
  if (dday > 0) return `D-${dday}`;
  if (dday === 0) return 'D-Day';
  return `예정일 ${-dday}일 지남`;
}

/** 기록 시각 표기 (기기 현지 시각): '2026-10-02T00:12:00.000Z' → '10/2 09:12' */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 금액 표기: 732000 → '732,000원' */
export function won(n: number): string {
  return `${num(Math.round(n))}원`;
}
