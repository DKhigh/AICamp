// 출차 일정과 수리 차량
import { describe, expect, it } from 'vitest';
import { baseScenarios } from '../actions';
import { demoState } from '../reference';
import { productionParts, repairCarViews, repairCars, repairPartNeeds } from '../repairs';
import { carSerialOf, serialOf } from '../serial';
import { shipmentSchedule } from '../shipments';

const SERIAL = /^[A-Z0-9]{8}$/;
/** 색상 코드가 맨 앞에 붙은 차량 고유번호: C01-YRI0V072 */
const COLORED_SERIAL = /^C0[1-5]-[A-Z0-9]{8}$/;

describe('차량 고유번호', () => {
  it('알파벳 대문자·숫자 8자리, 같은 순번이면 항상 같은 번호', () => {
    expect(serialOf(1)).toMatch(SERIAL);
    expect(serialOf(1)).toBe(serialOf(1));
    expect(serialOf(1)).not.toBe(serialOf(2));
  });

  it('순번이 다르면 번호가 겹치지 않는다', () => {
    const serials = Array.from({ length: 5000 }, (_, i) => serialOf(i + 1));
    expect(serials.every((s) => SERIAL.test(s))).toBe(true);
    expect(new Set(serials).size).toBe(5000);
  });
});

describe('일자별 출차', () => {
  const schedule = shipmentSchedule(demoState());
  const day = (date: string) => schedule.days.find((d) => d.date === date)!;

  it('10/7부터 매일 20대, 기간 합계 420대', () => {
    expect(day('2026-10-05').count).toBe(0);
    expect(day('2026-10-06').count).toBe(0);
    expect(day('2026-10-07').count).toBe(20);
    expect(day('2026-10-27').count).toBe(20);
    expect(schedule.total).toBe(420);
    expect(day('2026-10-17').cum).toBe(220);
  });

  it('하루 목록의 대수와 차량 수가 같고, 번호는 전체에서 겹치지 않는다', () => {
    const all = schedule.days.flatMap((d) => d.cars);
    expect(schedule.days.every((d) => d.cars.length === d.count)).toBe(true);
    expect(all).toHaveLength(420);
    expect(new Set(all.map((c) => c.serial)).size).toBe(420);
    expect(all.map((c) => c.seq)).toEqual(Array.from({ length: 420 }, (_, i) => i + 1));
  });

  it('차량은 납기 빠른 주문부터 배정된다 (60 · 80 · 80대), 나머지는 미배정', () => {
    const all = schedule.days.flatMap((d) => d.cars);
    const count = (id: string | null) => all.filter((c) => c.orderId === id).length;
    expect([count('CO-001'), count('CO-002'), count('CO-003'), count(null)]).toEqual([60, 80, 80, 200]);
    expect(all[59].orderId).toBe('CO-001');
    expect(all[60].orderId).toBe('CO-002');
  });
});

describe('고유번호는 주문과 그 주문 안의 순번으로 정한다 (BUG-015)', () => {
  it('더 급한 주문이 끼어들어도 기존 주문의 차량 번호는 바뀌지 않는다', () => {
    const state = demoState();
    const idsOf = (s: typeof state, orderId: string) =>
      shipmentSchedule(s)
        .days.flatMap((d) => d.cars)
        .filter((c) => c.orderId === orderId)
        .map((c) => c.serial.slice(4));
    const before = idsOf(state, 'CO-002');
    expect(before).toHaveLength(80);
    // 납기가 가장 빠른 긴급 주문 40대를 넣는다 → CO-002의 차는 뒤로 밀리지만 번호는 그대로다
    const urgent = { ...state, customerOrders: [...state.customerOrders, { id: 'CO-004', customer: '긴급', qty: 40, dueDate: '2026-10-08' }] };
    expect(idsOf(urgent, 'CO-002')).toEqual(before);
    expect(idsOf(urgent, 'CO-004')).toHaveLength(40);
    expect(idsOf(urgent, 'CO-004').some((id) => before.includes(id))).toBe(false);
  });

  it('주문·순번이 다르면 번호가 겹치지 않는다', () => {
    expect(carSerialOf('CO-001', 1)).toBe(carSerialOf('CO-001', 1));
    expect(carSerialOf('CO-001', 1)).not.toBe(carSerialOf('CO-002', 1));
    expect(carSerialOf('CO-001', 1)).not.toBe(carSerialOf(null, 1));
    const all = ['CO-001', 'CO-002', null].flatMap((id) => Array.from({ length: 2000 }, (_, i) => carSerialOf(id, i + 1)));
    expect(new Set(all).size).toBe(6000);
  });
});

describe('주문한 색상의 차체로 만든다', () => {
  const state = demoState();
  const carsOf = (s: typeof state, orderId: string | null) =>
    shipmentSchedule(s)
      .days.flatMap((d) => d.cars)
      .filter((c) => c.orderId === orderId);

  it('시연 주문: 화이트 60 · 블랙 80 · 블루 80, 재고용 차는 남은 차체로', () => {
    expect(state.customerOrders.map((o) => [o.id, o.colorCode])).toEqual([['CO-001', 'C01'], ['CO-002', 'C02'], ['CO-003', 'C04']]);
    expect(new Set(carsOf(state, 'CO-001').map((c) => c.colorCode))).toEqual(new Set(['C01']));
    expect(new Set(carsOf(state, 'CO-002').map((c) => c.colorCode))).toEqual(new Set(['C02']));
    expect(new Set(carsOf(state, 'CO-003').map((c) => c.colorCode))).toEqual(new Set(['C04']));
    expect(carsOf(state, 'CO-003')).toHaveLength(80);
    // 블루 차체 80개는 CO-003이 다 쓰므로 재고용 차에는 블루가 없다
    expect(carsOf(state, null).some((c) => c.colorCode === 'C04')).toBe(false);
    expect(carsOf(state, null)).toHaveLength(200);
  });

  it('그 색 차체가 모자라면 그 주문은 다 만들지 못하고, 색이 있는 다음 주문을 먼저 만든다', () => {
    // 레드 100대 주문: 레드 차체는 60개뿐이다
    const red = { ...state, customerOrders: [{ id: 'CO-009', customer: '레드', qty: 100, dueDate: '2026-10-06', colorCode: 'C03' }, ...state.customerOrders] };
    const { wait } = baseScenarios(red);
    const byId = Object.fromEntries(wait.orders.map((o) => [o.id, o.doneDate]));
    expect(byId['CO-009']).toBeNull();
    expect(carsOf(red, 'CO-009')).toHaveLength(60);
    // 레드가 떨어진 뒤에는 화이트 주문(CO-001)을 이어서 만든다: 60 + 60대 → 10/12 완료
    expect(byId['CO-001']).toBe('2026-10-12');
    expect(wait.lateOrders.map((o) => o.id)).toContain('CO-009');
  });

  it('색을 정하지 않은 주문은 재고가 가장 많은 색으로 만든다', () => {
    const any = { ...state, customerOrders: [{ id: 'CO-001', customer: 'A', qty: 3, dueDate: '2026-10-10', colorCode: null }] };
    expect(carsOf(any, 'CO-001').map((c) => c.colorCode)).toEqual(['C01', 'C01', 'C01']);
  });
});

describe('출차 실적 (기준일 이전)', () => {
  const schedule = shipmentSchedule(demoState());

  it('지난 7일 동안 매일 20대, 날짜는 모두 기준일보다 앞이다', () => {
    expect(schedule.past.map((d) => d.date)).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    expect(schedule.past.every((d) => d.past && d.count === 20 && d.cars.length === 20)).toBe(true);
    expect(schedule.pastTotal).toBe(140);
    expect(schedule.days.every((d) => !d.past && d.date >= '2026-10-05')).toBe(true);
  });

  it('색상은 Excel 차량색상의 색이고, 고유번호는 예정 차량과 겹치지 않는다', () => {
    const pastCars = schedule.past.flatMap((d) => d.cars);
    expect(pastCars.every((c) => COLORED_SERIAL.test(c.serial) && c.serial.startsWith(c.colorCode + '-'))).toBe(true);
    // 하루는 한 납품처의 차라 색이 하나다
    expect(schedule.past.every((d) => d.colors.length === 1 && d.colors[0].count === 20)).toBe(true);
    expect(schedule.pastColors.every((c) => ['C01', 'C02', 'C03', 'C04', 'C05'].includes(c.colorCode))).toBe(true);
    expect(schedule.pastColors.reduce((sum, c) => sum + c.count, 0)).toBe(140);
    const all = [...pastCars, ...schedule.days.flatMap((d) => d.cars)].map((c) => c.serial.slice(4));
    expect(new Set(all).size).toBe(140 + 420);
  });

  it('같은 날짜의 실적은 기준일이 바뀌어도 같은 차량이다', () => {
    const later = shipmentSchedule(demoState('2026-10-07'));
    const day = (s: typeof schedule, date: string) => s.past.find((d) => d.date === date)!.cars.map((c) => c.serial);
    expect(day(later, '2026-10-03')).toEqual(day(schedule, '2026-10-03'));
  });
});

describe('수리 중인 차량', () => {
  it('고유번호 형식이 맞고 서로 겹치지 않는다', () => {
    expect(repairCars.length).toBeGreaterThan(0);
    expect(repairCars.every((c) => COLORED_SERIAL.test(c.serial) && c.serial.startsWith(c.colorCode + '-'))).toBe(true);
    expect(new Set(repairCars.map((c) => c.serial)).size).toBe(repairCars.length);
  });

  it('소모 부품은 모두 라인 부품이고, 부품별 소요량을 합산한다', () => {
    const { lineParts } = demoState();
    const codes = new Set(lineParts.map((p) => p.partCode));
    expect(repairCars.every((c) => c.parts.length > 0 && c.parts.every((u) => codes.has(u.partCode) && u.qty >= 1))).toBe(true);
    const needs = repairPartNeeds(repairCars, lineParts);
    expect(needs.find((n) => n.partCode === 'P001')).toMatchObject({ needed: 6, onHand: 1806, reserved: 6, available: 1800, enough: true });
    expect(needs.find((n) => n.partCode === 'P007')).toMatchObject({ needed: 1, onHand: 61, reserved: 1, available: 60, enough: true });
  });

  it('수리용 부품은 생산용 재고에서 뺀다 (BUG-016)', () => {
    const { lineParts } = demoState();
    const prod = Object.fromEntries(productionParts(lineParts).map((p) => [p.partCode, p.onHand]));
    expect(prod).toMatchObject({ P007: 60, P024: 450, P001: 1800, P004: 360, P010: 100, P013: 430, 'P012-C01': 120 });
    // 원본은 바꾸지 않는다
    expect(lineParts.find((p) => p.partCode === 'P007')!.onHand).toBe(61);
  });

  it("'부품 대기'는 재고로 계산한다: 재고가 있으면 대기가 아니고, 없으면 대기다", () => {
    const { lineParts } = demoState();
    expect(repairCarViews(repairCars, lineParts).some((c) => c.status === '부품 대기')).toBe(false);
    const noEngine = lineParts.map((p) => (p.partCode === 'P007' ? { ...p, onHand: 0 } : p));
    const waiting = repairCarViews(repairCars, noEngine).filter((c) => c.status === '부품 대기');
    expect(waiting.map((c) => [c.serial, c.missing])).toEqual([['C05-R4T8B1ZN', [{ partCode: 'P007', qty: 1 }]]]);
    // 수리 소요가 재고보다 많으면 생산용은 0이다
    expect(productionParts(noEngine).find((p) => p.partCode === 'P007')!.onHand).toBe(0);
    expect(repairPartNeeds(repairCars, noEngine).find((n) => n.partCode === 'P007')).toMatchObject({ reserved: 0, available: 0, enough: false });
  });
});
