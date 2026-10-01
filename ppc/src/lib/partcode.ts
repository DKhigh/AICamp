// 부품 코드 규칙. 색상별 변형은 '기본코드-색상코드'다: 차체 P012의 화이트는 'P012-C01'.
// 같은 기본코드의 변형들은 서로 대체 관계라, 차 한 대에는 그중 하나만 들어간다.

export function baseCodeOf(code: string): string {
  const i = code.indexOf('-');
  return i < 0 ? code : code.slice(0, i);
}

/** 색상별 변형이면 색상 코드('C01'), 아니면 null */
export function colorCodeOf(code: string): string | null {
  const i = code.indexOf('-');
  return i < 0 ? null : code.slice(i + 1);
}

export function variantCode(baseCode: string, colorCode: string): string {
  return `${baseCode}-${colorCode}`;
}
