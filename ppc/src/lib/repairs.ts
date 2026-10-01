// 입고되어 수리 중인 차량 (시연용 고정 데이터, src/data/repair_cars.json).
// 수리에 쓸 부품은 재고에서 따로 잡아 둔다: 생산 가능 대수와 생산 예측은 그만큼을 뺀 재고로 계산한다.
import repairJson from '../data/repair_cars.json';
import { addDays, diffDays } from './date';
import { DEMO_BASE_DATE } from './reference';
import type { ISODate, LinePart } from './types';

export interface RepairPartUse {
  partCode: string;
  qty: number;
}

export interface RepairCar {
  /** 색상 코드 + 고유번호: 'C02-T3G7U0MK' */
  serial: string;
  colorCode: string;
  receivedDate: ISODate;
  status: string;
  /** 고장 난 곳 */
  faultArea: string;
  symptom: string;
  /** 수리에 소모하는 부품 */
  parts: RepairPartUse[];
}

export const repairCars = repairJson as RepairCar[];

/** 입고일을 기준일(오늘)에 맞춰 옮긴 목록. JSON의 날짜는 설계서 기준일(10/5)을 기준으로 적혀 있다 */
export function repairCarsAt(baseDate: ISODate): RepairCar[] {
  const offset = diffDays(baseDate, DEMO_BASE_DATE);
  return repairCars.map((car) => ({ ...car, receivedDate: addDays(car.receivedDate, offset) }));
}

/** 부품별 수리 소요량 합계 */
export function repairNeedByPart(cars: RepairCar[] = repairCars): Record<string, number> {
  const needed: Record<string, number> = {};
  for (const car of cars) {
    for (const use of car.parts) needed[use.partCode] = (needed[use.partCode] ?? 0) + use.qty;
  }
  return needed;
}

/**
 * 생산에 쓸 수 있는 재고 = 현재 재고 − 수리용으로 잡아 둔 수량.
 * 수리 소요가 재고보다 많으면 생산용은 0이다 (모자라는 만큼은 수리 차량이 '부품 대기'가 된다).
 * DB의 재고(on_hand)는 그대로 두고, 계산할 때만 이 함수를 거친다.
 */
export function productionParts(lineParts: LinePart[], cars: RepairCar[] = repairCars): LinePart[] {
  const needed = repairNeedByPart(cars);
  return lineParts.map((p) => {
    const need = needed[p.partCode] ?? 0;
    return need === 0 ? p : { ...p, onHand: Math.max(0, p.onHand - need) };
  });
}

export interface RepairPartNeed {
  partCode: string;
  /** 수리 중인 차량 전체가 필요로 하는 수량 */
  needed: number;
  onHand: number;
  /** 재고에서 수리용으로 잡아 둔 수량 = min(needed, onHand) */
  reserved: number;
  /** 생산에 쓸 수 있는 수량 = onHand - reserved */
  available: number;
  enough: boolean;
}

/** 부품별 수리 소요량과 현재 재고 비교 */
export function repairPartNeeds(cars: RepairCar[], lineParts: LinePart[]): RepairPartNeed[] {
  const needed = repairNeedByPart(cars);
  return lineParts
    .filter((p) => p.partCode in needed)
    .map((p) => {
      const need = needed[p.partCode];
      const reserved = Math.min(need, p.onHand);
      return { partCode: p.partCode, needed: need, onHand: p.onHand, reserved, available: p.onHand - reserved, enough: p.onHand >= need };
    });
}

export const WAITING_FOR_PARTS = '부품 대기';

export interface RepairCarView extends RepairCar {
  /** 재고가 모자라 이 차에 배정하지 못한 부품. 있으면 status는 '부품 대기' */
  missing: RepairPartUse[];
}

/**
 * 수리 차량의 화면 상태. 먼저 입고된 차부터 재고를 배정하고, 필요한 부품을 다 받지 못한 차는 '부품 대기'로 보여 준다.
 * (재고가 충분한데 '부품 대기'로 나오는 일이 없도록 재고에서 계산한다.)
 */
export function repairCarViews(cars: RepairCar[], lineParts: LinePart[]): RepairCarView[] {
  const left: Record<string, number> = Object.fromEntries(lineParts.map((p) => [p.partCode, p.onHand]));
  const order = [...cars].sort((a, b) => (a.receivedDate === b.receivedDate ? 0 : a.receivedDate < b.receivedDate ? -1 : 1));
  const missingBySerial = new Map<string, RepairPartUse[]>();
  for (const car of order) {
    const missing = car.parts
      .map((use) => ({ partCode: use.partCode, qty: use.qty - Math.min(use.qty, left[use.partCode] ?? 0) }))
      .filter((m) => m.qty > 0);
    // 다 받을 수 있을 때만 재고를 배정한다 (일부만 받아서는 수리를 끝낼 수 없다)
    if (missing.length === 0) {
      for (const use of car.parts) left[use.partCode] -= use.qty;
    }
    missingBySerial.set(car.serial, missing);
  }
  return cars.map((car) => {
    const missing = missingBySerial.get(car.serial) ?? [];
    return { ...car, missing, status: missing.length > 0 ? WAITING_FOR_PARTS : car.status };
  });
}
