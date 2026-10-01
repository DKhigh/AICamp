// 차량 고유번호(시리얼): 알파벳 대문자와 숫자 8자리.
// 임의로 보이지만 순번에서 계산하므로, 누가 언제 열어도 같은 차에는 같은 번호가 나온다 (DB에 저장하지 않는다).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SPACE = ALPHABET.length ** 8; // 36^8
// SPACE와 서로소인 곱수 → 순번마다 서로 다른 번호가 나온다 (순열)
const MULTIPLIER = 1_000_000_007_117;
const OFFSET = 918_273_645_011;

export function serialOf(seq: number): string {
  let n = Number((BigInt(seq) * BigInt(MULTIPLIER) + BigInt(OFFSET)) % BigInt(SPACE));
  let out = '';
  for (let i = 0; i < 8; i++) {
    out = ALPHABET[n % 36] + out;
    n = Math.floor(n / 36);
  }
  return out;
}
