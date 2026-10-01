// 일자별 출차(완성) 차량 목록. 현재 예측(§6.4 시뮬레이션)의 완성 대수를 차량 한 대씩으로 펼친다.
import { baseScenarios } from './actions';
import type { ColorCount } from './planning';
import { serialOf } from './serial';
import type { AppState, ISODate } from './types';

export interface ShipCar {
  /** 1부터 시작하는 출차 순번 */
  seq: number;
  /** 색상 코드 + 고유번호: 'C01-YRI0V072'. 색상별 차체가 없는 옛 데이터면 색상 코드 없이 8자리 */
  serial: string;
  /** 이 차에 들어간 차체의 색상. 그 색 차체가 있어야 이 색 차를 만들 수 있다 */
  colorCode: string | null;
  /** 이 차가 채우는 자동차 주문 (납기 빠른 순으로 배정). 주문 수량을 넘는 차는 null */
  orderId: string | null;
  customer: string | null;
}

export interface ShipDay {
  date: ISODate;
  count: number;
  /** 그날까지의 누적 출차 대수 */
  cum: number;
  colors: ColorCount[];
  cars: ShipCar[];
}

export interface ShipSchedule {
  days: ShipDay[];
  total: number;
  /** 기간 전체의 색상별 출차 대수 */
  colors: ColorCount[];
}

export function shipmentSchedule(state: AppState): ShipSchedule {
  const { wait } = baseScenarios(state);
  const orders = wait.orders; // 납기 오름차순, cumNeed 포함
  // 완성일 → 그날 완성되는 차의 색상 구성 (투입한 날 쓴 차체 색)
  const colorsByDate = new Map(wait.sim.days.map((d) => [d.completeDate, d.colors]));
  const total = new Map<string, number>();
  let seq = 0;

  const days = wait.sim.cumulative.map((row): ShipDay => {
    const colors = colorsByDate.get(row.date) ?? [];
    // 색상 코드 순으로 한 대씩 펼친다. 색상 정보가 없으면(옛 데이터) 색 없이 대수만큼
    const carColors: (string | null)[] = colors.flatMap((c) => Array<string>(c.count).fill(c.colorCode));
    while (carColors.length < row.completed) carColors.push(null);

    const cars = carColors.slice(0, row.completed).map((colorCode): ShipCar => {
      seq += 1;
      const order = orders.find((o) => seq <= o.cumNeed) ?? null;
      if (colorCode) total.set(colorCode, (total.get(colorCode) ?? 0) + 1);
      return {
        seq,
        serial: colorCode ? `${colorCode}-${serialOf(seq)}` : serialOf(seq),
        colorCode,
        orderId: order?.id ?? null,
        customer: order?.customer ?? null,
      };
    });
    return { date: row.date, count: row.completed, cum: row.cum, colors, cars };
  });

  return {
    days,
    total: seq,
    colors: [...total.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([colorCode, count]) => ({ colorCode, count })),
  };
}
