// 부품별 주의사항 (Excel '주의사항' 시트 → reference.json)
import { reference } from './reference';

/** 부품명(엔진, 변속기, 차체 …)의 주의사항. 없으면 null */
export function cautionOf(partName: string): string | null {
  return reference.cautions.find((c) => c.partName === partName)?.text ?? null;
}
