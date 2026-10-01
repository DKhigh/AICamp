// 차량 고유번호(시리얼): 알파벳 대문자와 숫자 8자리.
// 임의로 보이지만 계산으로 정하므로, 누가 언제 열어도 같은 차에는 같은 번호가 나온다 (DB에 저장하지 않는다).
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

/** 주문 한 건에 넣을 수 있는 차량 순번의 상한. MAX_ORDER_QTY(10만)보다 커야 번호가 겹치지 않는다 */
const CARS_PER_ORDER = 1_000_000;

/**
 * 주문의 n번째 차 → 고유번호. 전체 출차 순번이 아니라 '주문 번호 + 그 주문 안에서의 순번'으로 정한다.
 * 그래서 더 급한 주문이 앞에 끼어들어도 이 주문의 n번째 차는 같은 번호를 유지한다.
 * 주문에 배정되지 않은 차(재고용)는 orderId를 null로 준다.
 */
export function carSerialOf(orderId: string | null, indexInOrder: number): string {
  const orderNo = orderId ? Number(orderId.replace(/\D/g, '')) || 0 : 0;
  return serialOf(orderNo * CARS_PER_ORDER + indexInOrder);
}
