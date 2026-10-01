// 일자별 출차(완성) 차량 목록.
// - 출차 예정: 현재 예측(§6.4 시뮬레이션)의 완성 대수를 차량 한 대씩으로 펼친다 (오늘부터).
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
  /** 이 차에 들어간 차체의 색상. 그 색 차체가 있어야 이 색 차를 만들 수 있다 */
  colorCode: string | null;
  /** 이 차가 채우는 자동차 주문 (납기 빠른 순으로 배정). 주문 수량을 넘는 차는 null. 실적은 null */
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
 */
export function pastShipments(baseDate: ISODate): ShipDay[] {
  const { days, perDay, customers } = pastShipmentRule;
  // 색상은 Excel '차량색상' 시트의 색을 돌아가며 쓴다
  const colorCodes = reference.colors.map((c) => c.code);
  let cum = 0;
  return Array.from({ length: days }, (_, i): ShipDay => {
    const date = addDays(baseDate, i - days);
    const dayNo = diffDays(date, PAST_EPOCH);
    const customer = customers[Math.floor(Math.abs(dayNo) / 3) % customers.length] ?? null;
    const total = new Map<string, number>();
    const cars = Array.from({ length: perDay }, (_, k) => {
      const colorCode = colorCodes[(k + Math.abs(dayNo)) % colorCodes.length];
      total.set(colorCode, (total.get(colorCode) ?? 0) + 1);
      return { colorCode, id: serialOf(PAST_SERIAL_BASE + Math.abs(dayNo) * 1000 + k) };
    })
      .sort((a, b) => a.colorCode.localeCompare(b.colorCode))
      .map((car, k): ShipCar => ({ seq: k + 1, serial: `${car.colorCode}-${car.id}`, colorCode: car.colorCode, orderId: null, customer }));
    cum += perDay;
    return { date, count: perDay, cum, colors: sortedCounts(total), cars, past: true };
  });
}

export function shipmentSchedule(state: AppState): ShipSchedule {
  const { wait } = baseScenarios(state);
  const orders = wait.orders; // 납기 오름차순, cumNeed 포함
  // 완성일 → 그날 완성되는 차의 색상 구성 (투입한 날 쓴 차체 색)
  const colorsByDate = new Map(wait.sim.days.map((d) => [d.completeDate, d.colors]));
  const total = new Map<string, number>();
  const orderTotal = orders.reduce((sum, o) => sum + o.qty, 0);
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
      // 고유번호는 주문과 그 주문 안에서의 순번으로 정한다 (다른 주문이 끼어들어도 바뀌지 않는다)
      const id = carSerialOf(order?.id ?? null, order ? seq - (order.cumNeed - order.qty) : seq - orderTotal);
      return {
        seq,
        serial: colorCode ? `${colorCode}-${id}` : id,
        colorCode,
        orderId: order?.id ?? null,
        customer: order?.customer ?? null,
      };
    });
    return { date: row.date, count: row.completed, cum: row.cum, colors, cars, past: false };
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
