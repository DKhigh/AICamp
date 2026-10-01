// 출차 일정과 수리 차량
import { describe, expect, it } from 'vitest';
import { demoState } from '../reference';
import { repairCars, repairPartNeeds } from '../repairs';
import { serialOf } from '../serial';
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
    expect(needs.find((n) => n.partCode === 'P001')).toMatchObject({ needed: 6, onHand: 1800, enough: true });
    expect(needs.find((n) => n.partCode === 'P007')).toMatchObject({ needed: 1, onHand: 60, enough: true });
  });
});
