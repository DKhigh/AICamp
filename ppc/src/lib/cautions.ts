// 부품별 주의사항 (data/cautions.txt = 저장소 루트의 '주의사항.txt').
// 형식: 부품명 한 줄, 다음 줄부터 내용, 빈 줄로 구분.
import cautionsText from '../../data/cautions.txt?raw';

export function parseCautions(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const [name, ...body] = block.trim().split('\n');
    if (name && body.length > 0) map.set(name.trim(), body.join(' ').trim());
  }
  return map;
}

const cautions = parseCautions(cautionsText);

/** 부품명(엔진, 변속기 …)의 주의사항. 없으면 null */
export function cautionOf(partName: string): string | null {
  return cautions.get(partName) ?? null;
}
