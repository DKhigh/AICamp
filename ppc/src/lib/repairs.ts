// 입고되어 수리 중인 차량 (시연용 고정 데이터, src/data/repair_cars.json).
// DB에 넣지 않으므로 화면에서 바뀌지 않고, 수리에 쓰는 부품은 표시만 한다(생산 재고·예측 계산에는 넣지 않는다).
import repairJson from '../data/repair_cars.json';
import type { ISODate, LinePart } from './types';

export interface RepairPartUse {
  partCode: string;
  qty: number;
}

export interface RepairCar {
  serial: string;
  receivedDate: ISODate;
  status: string;
  /** 고장 난 곳 */
  faultArea: string;
  symptom: string;
  /** 수리에 소모하는 부품 */
  parts: RepairPartUse[];
}

export const repairCars = repairJson as RepairCar[];

export interface RepairPartNeed {
  partCode: string;
  /** 수리 중인 차량 전체가 필요로 하는 수량 */
  needed: number;
  onHand: number;
  enough: boolean;
}

/** 부품별 수리 소요량과 현재 재고 비교 */
export function repairPartNeeds(cars: RepairCar[], lineParts: LinePart[]): RepairPartNeed[] {
  const needed = new Map<string, number>();
  for (const car of cars) {
    for (const use of car.parts) needed.set(use.partCode, (needed.get(use.partCode) ?? 0) + use.qty);
  }
  return lineParts
    .filter((p) => needed.has(p.partCode))
    .map((p) => {
      const need = needed.get(p.partCode)!;
      return { partCode: p.partCode, needed: need, onHand: p.onHand, enough: p.onHand >= need };
    });
}
