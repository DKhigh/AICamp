// 일자별 출차(완성) 차량 목록.
// - 출차 예정: 현재 예측(§6.4 시뮬레이션)이 투입한 차를 완성일에 한 대씩 놓는다 (오늘부터).
//   어느 주문의 차인지, 무슨 색 차체를 썼는지는 시뮬레이션이 정한다: 주문이 요구한 색의 차체로 만든다.
// - 출차 실적: 기준일 이전 며칠 동안 이미 출차한 차량. 시연 데이터의 규칙(demo_state.json pastShipments)으로 만든다.
import { baseScenarios } from './actions';
import { addDays, diffDays } from './date';
import type { ColorCount } from './planning';
import { pastShipmentRule, reference } from './reference';
import { carSerialOf, serialOf } from './serial';
import type { AppState, ISODate } from './types';

export interface ShipCar {
  /** 출차 순번. 예정은 오늘부터의 누적 순번, 실적은 그날 안에서의 순번 */
  seq: number;
  /** 색상 코드 + 고유번호: 'C01-XXXXXXXX'. 색상별 차체가 없는 옛 데이터면 색상 코드 없이 8자리 */
  serial: string;
  /** 이 차에 들어간 차체의 색상 = 주문이 요구한 색 (재고용 차는 재고가 가장 많던 색) */
  colorCode: string | null;
  /** 이 차가 채우는 자동차 주문. 주문에 배정되지 않은 재고용 차는 null. 실적은 null */
  orderId: string | null;
  customer: string | null;
}

export interface ShipDay {
  date: ISODate;
  count: number;
  /** 그날까지의 누적 출차 대수 (실적은 실적끼리, 예정은 예정끼리) */
  cum: number;
  colors: ColorCount[];
  cars: ShipCar[];
  /** true면 이미 출차한 실적, false면 예측 */
  past: boolean;
}

export interface ShipSchedule {
  /** 오늘부터의 출차 예정 */
  days: ShipDay[];
  total: number;
  /** 예정 기간 전체의 색상별 출차 대수 */
  colors: ColorCount[];
  /** 기준일 이전의 출차 실적 (오래된 날부터) */
  past: ShipDay[];
  pastTotal: number;
  pastColors: ColorCount[];
}

const sortedCounts = (total: Map<string, number>): ColorCount[] =>
  [...total.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([colorCode, count]) => ({ colorCode, count }));

// 실적 차량의 고유번호가 주문 차량(carSerialOf)과 겹치지 않도록 멀리 떨어진 번호대를 쓴다
const PAST_SERIAL_BASE = 2_000_000_000_000;
const PAST_EPOCH = '2026-01-01';

/**
 * 기준일 이전 며칠의 출차 실적. 날짜마다 정해진 규칙으로 만들기 때문에
 * 어느 날 열어 보아도 같은 날짜에는 같은 차량(고유번호·색상)이 나온다.
 * 하루는 한 납품처의 차이고, 색상은 납품처마다 Excel '차량색상'의 색 가운데 하나다.
 */
export function pastShipments(baseDate: ISODate): ShipDay[] {
  const { days, perDay, customers } = pastShipmentRule;
  const colorCodes = reference.colors.map((c) => c.code);
  let cum = 0;
  return Array.from({ length: days }, (_, i): ShipDay => {
    const date = addDays(baseDate, i - days);
    const dayNo = Math.abs(diffDays(date, PAST_EPOCH));
    // 사흘마다 납품처가 바뀌고, 납품처가 바뀌면 주문 색상도 바뀐다
    const block = Math.floor(dayNo / 3);
    const customer = customers[block % customers.length] ?? null;
    const colorCode = colorCodes[block % colorCodes.length] ?? null;
    const cars = Array.from({ length: perDay }, (_, k): ShipCar => {
      const id = serialOf(PAST_SERIAL_BASE + dayNo * 1000 + k);
      return { seq: k + 1, serial: colorCode ? `${colorCode}-${id}` : id, colorCode, orderId: null, customer };
    });
    cum += perDay;
    return { date, count: perDay, cum, colors: colorCode ? [{ colorCode, count: perDay }] : [], cars, past: true };
  });
}

export function shipmentSchedule(state: AppState): ShipSchedule {
  const { wait } = baseScenarios(state);
  const orderById = new Map(wait.orders.map((o) => [o.id, o]));
  // 완성일 → 그날 완성되는 차 (투입한 날 정해진 주문과 차체 색)
  const carsByDate = new Map(wait.sim.days.map((d) => [d.completeDate, d.cars]));
  const total = new Map<string, number>();
  // 고유번호는 주문과 그 주문 안에서의 순번으로 정한다 (다른 주문이 끼어들어도 바뀌지 않는다)
  const builtPerOrder = new Map<string | null, number>();
  let seq = 0;

  const days = wait.sim.cumulative.map((row): ShipDay => {
    const dayColors = new Map<string, number>();
    const cars = (carsByDate.get(row.date) ?? []).map((car): ShipCar => {
      seq += 1;
      const index = (builtPerOrder.get(car.orderId) ?? 0) + 1;
      builtPerOrder.set(car.orderId, index);
      if (car.colorCode) {
        total.set(car.colorCode, (total.get(car.colorCode) ?? 0) + 1);
        dayColors.set(car.colorCode, (dayColors.get(car.colorCode) ?? 0) + 1);
      }
      const id = carSerialOf(car.orderId, index);
      return {
        seq,
        serial: car.colorCode ? `${car.colorCode}-${id}` : id,
        colorCode: car.colorCode,
        orderId: car.orderId,
        customer: car.orderId ? (orderById.get(car.orderId)?.customer ?? null) : null,
      };
    });
    return { date: row.date, count: row.completed, cum: row.cum, colors: sortedCounts(dayColors), cars, past: false };
  });

  const past = pastShipments(state.settings.baseDate);
  const pastTotal = new Map<string, number>();
  for (const day of past) for (const c of day.colors) pastTotal.set(c.colorCode, (pastTotal.get(c.colorCode) ?? 0) + c.count);

  return {
    days,
    total: seq,
    colors: sortedCounts(total),
    past,
    pastTotal: past.reduce((sum, d) => sum + d.count, 0),
    pastColors: sortedCounts(pastTotal),
  };
}
