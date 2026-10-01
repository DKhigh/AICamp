// 일자별 출차(완성) 차량 목록. 현재 예측(§6.4 시뮬레이션)의 완성 대수를 차량 한 대씩으로 펼친다.
import { baseScenarios } from './actions';
import { serialOf } from './serial';
import type { AppState, ISODate } from './types';

export interface ShipCar {
  /** 1부터 시작하는 출차 순번 */
  seq: number;
  serial: string;
  /** 이 차가 채우는 자동차 주문 (납기 빠른 순으로 배정). 주문 수량을 넘는 차는 null */
  orderId: string | null;
  customer: string | null;
}

export interface ShipDay {
  date: ISODate;
  count: number;
  /** 그날까지의 누적 출차 대수 */
  cum: number;
  cars: ShipCar[];
}

export interface ShipSchedule {
  days: ShipDay[];
  total: number;
}

export function shipmentSchedule(state: AppState): ShipSchedule {
  const { wait } = baseScenarios(state);
  const orders = wait.orders; // 납기 오름차순, cumNeed 포함
  let seq = 0;
  const days = wait.sim.cumulative.map((row): ShipDay => {
    const cars: ShipCar[] = [];
    for (let i = 0; i < row.completed; i++) {
      seq += 1;
      const order = orders.find((o) => seq <= o.cumNeed) ?? null;
      cars.push({ seq, serial: serialOf(seq), orderId: order?.id ?? null, customer: order?.customer ?? null });
    }
    return { date: row.date, count: row.completed, cum: row.cum, cars };
  });
  return { days, total: seq };
}
