// Excel(ppc_data.xlsx) 기반 기능: 주의사항 · 수량 지연 · 색상별 차체 · 발주 권한자 · 발주 금액
import { describe, expect, it } from 'vitest';
import { baseScenarios, buildDisruption, withDisruption } from '../actions';
import { createApi } from '../api';
import { cautionOf } from '../cautions';
import { dashboardModel } from '../dashboard';
import { authorize, employeeError, employees, findEmployee } from '../employees';
import { orderAmount, poAmount, pricePerKgOf, qtyDelayOf, totalSpent, unitPriceOf } from '../ordering';
import { bottleneckOf, buildable, simulate, stockOnHand, stockWithIncoming } from '../planning';
import { colorOf, demoState, partOf, reference } from '../reference';
import { shipmentSchedule } from '../shipments';
import { memoryStore } from '../store';
import type { AppState, LinePart } from '../types';

const BASE = '2026-10-05';
async function freshApi() {
  const api = createApi(memoryStore(), () => BASE);
  await api.resetDemoData('0000');
  return api;
}
const order = (api: Awaited<ReturnType<typeof freshApi>>, partCode: string, supplierName: string, qty: number) =>
  api.createPurchaseOrder({ partCode, supplierName, qty, employeeNo: '0000' });

/** 차체 재고만 바꾼 상태 */
function withBodies(stock: Record<string, number>): AppState {
  const state = demoState();
  return {
    ...state,
    lineParts: state.lineParts.map((p): LinePart => (p.partCode in stock ? { ...p, onHand: stock[p.partCode] } : p)),
  };
}

describe('1. 주의사항은 Excel 시트에서 읽는다', () => {
  it('7개 부품 모두 있고, 색상별 차체는 차체 주의사항을 쓴다', () => {
    expect(reference.cautions).toHaveLength(7);
    for (const name of ['엔진', '변속기', '브레이크', '서스펜션', '조향', '차체', '배터리']) expect(cautionOf(name), name).toBeTruthy();
    expect(cautionOf('엔진')).toBe(
      '차량의 동력을 발생시키는 핵심 부품입니다. 외관 손상, 주요 연결부 및 조립 상태를 확인하고, 보관·운송 시 충격과 오염에 주의하십시오.',
    );
    expect(cautionOf(partOf('P012').name)).toContain('차량의 기본 구조와 안전성을 유지하는');
    expect(cautionOf('없는 부품')).toBeNull();
  });
});

describe('2. 같은 업체에 많이 발주할수록 늦게 온다 (Excel 지연시간)', () => {
  it('Excel 표를 일수로 읽는다', () => {
    const tiers = (name: string) => reference.qtyDelays.find((d) => d.partName === name)!.tiers.map((t) => [t.minQty, t.days]);
    expect(tiers('엔진')).toEqual([[1, 3], [10, 14], [50, 60]]);
    expect(tiers('배터리')).toEqual([[1, 1], [10, 7], [50, 30]]);
    expect(tiers('차체')).toEqual([[1, 4], [10, 14], [50, 90]]);
  });

  it('수량 단계: 1~9개 · 10~49개 · 50개', () => {
    const { purchaseOrders } = demoState();
    const days = (code: string, supplier: string, qty: number) => qtyDelayOf(purchaseOrders, partOf(code), supplier, qty, BASE).days;
    expect([1, 9, 10, 49, 50].map((q) => days('P013', '대성메탈', q))).toEqual([1, 1, 7, 7, 30]);
    expect([1, 10, 50].map((q) => days('P007', '진성오토텍', q))).toEqual([3, 14, 60]);
    expect([1, 10, 50].map((q) => days('P012-C01', '동아기공', q))).toEqual([4, 14, 90]);
  });

  it('도착 예정일 = 기준일 + 업체 기본 납기 + 수량 지연', async () => {
    const api = await freshApi();
    // 대성메탈 기본 납기 5일
    expect((await order(api, 'P013', '대성메탈', 5)).expectedArrival).toBe('2026-10-11'); // +5 +1
    // 같은 업체에 5개 더: 합쳐서 10개 → 1주일 단계. 같은 날 같은 내용이라 '중복이 아님'을 확인해야 들어간다
    await expect(order(api, 'P013', '대성메탈', 5)).rejects.toThrow('같은 내용의 발주(PO-004)가 오늘 이미 있습니다');
    const second = await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 5, employeeNo: '0000', allowDuplicate: true });
    expect(second.expectedArrival).toBe('2026-10-17'); // +5 +7
    expect(second.plannedArrival).toBe(second.expectedArrival);
    // 먼저 넣은 발주의 날짜는 바뀌지 않는다
    expect((await api.fetchState())!.purchaseOrders.find((p) => p.id === 'PO-004')!.expectedArrival).toBe('2026-10-11');
  });

  it('업체가 다르면 따로 세고, 취소한 발주는 세지 않는다', async () => {
    const api = await freshApi();
    const first = await order(api, 'P013', '대성메탈', 9);
    expect((await order(api, 'P013', '진성오토텍', 9)).expectedArrival).toBe('2026-10-10'); // 진성 4일 + 1일
    await api.cancelPurchaseOrder({ poId: first.id, employeeNo: '0000' });
    expect((await order(api, 'P013', '대성메탈', 9)).expectedArrival).toBe('2026-10-11'); // 다시 1일 단계 (취소한 발주는 중복으로도 보지 않는다)
  });

  it('색상만 다른 차체는 같은 부품으로 합쳐서 센다', async () => {
    const api = await freshApi();
    expect((await order(api, 'P012-C01', '동아기공', 5)).expectedArrival).toBe('2026-10-16'); // 동아 7일 + 4일
    expect((await order(api, 'P012-C02', '동아기공', 5)).expectedArrival).toBe('2026-10-26'); // 합쳐 10개 → 7 + 14
  });

  it('대체(긴급) 발주에는 수량 지연을 더하지 않는다', async () => {
    const api = await freshApi();
    await api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, employeeNo: '0000' });
    const alt = await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 50, action: '유지', employeeNo: '0000' });
    expect(alt.expectedArrival).toBe('2026-10-07'); // 대체 납기 2일 그대로
  });
});

describe('3. 차량 색상과 색상별 차체', () => {
  it('Excel 색상 5종, 차체는 색상마다 따로 있는 라인 부품이다', () => {
    expect(reference.colors.map((c) => [c.code, c.name])).toEqual([
      ['C01', '화이트'], ['C02', '블랙'], ['C03', '레드'], ['C04', '블루'], ['C05', '그레이'],
    ]);
    const bodies = demoState().lineParts.filter((p) => p.partCode.startsWith('P012-'));
    expect(bodies.map((p) => [partOf(p.partCode).name, p.onHand])).toEqual([
      ['차체(화이트)', 120], ['차체(블랙)', 100], ['차체(레드)', 60], ['차체(블루)', 80], ['차체(그레이)', 80],
    ]);
    expect(partOf('P012-C03')).toMatchObject({ baseCode: 'P012', colorCode: 'C03', materialName: '철강 소재', defaultSupplier: '동아기공' });
    expect(colorOf('C04')?.name).toBe('블루');
  });

  it('대시보드 수치는 그대로: 60대 / 430대, 차체는 합계 440대로 본다', () => {
    const model = dashboardModel(demoState());
    expect([model.kpi.buildableNow, model.kpi.buildableIncoming]).toEqual([60, 430]);
    expect(model.kpi.bottleneckIncoming?.name).toBe('배터리');
    expect(model.parts).toHaveLength(7);
    const body = model.parts.find((p) => p.part.code === 'P012')!;
    expect([body.linePart.onHand, body.cars, body.coverage, body.status]).toEqual([440, 440, 22, '정상']);
    expect(body.variants!.map((v) => [v.part.colorCode, v.linePart.onHand, v.status])).toEqual([
      ['C01', 120, '정상'], ['C02', 100, '정상'], ['C03', 60, '정상'], ['C04', 80, '정상'], ['C05', 80, '정상'],
    ]);
  });

  it('출차 차량의 고유번호는 색상 코드로 시작하고, 색상별 대수는 쓴 차체 수와 같다', () => {
    const state = demoState();
    const schedule = shipmentSchedule(state);
    const cars = schedule.days.flatMap((d) => d.cars);
    expect(cars).toHaveLength(420);
    expect(cars.every((c) => /^C0[1-5]-[A-Z0-9]{8}$/.test(c.serial) && c.serial.startsWith(`${c.colorCode}-`))).toBe(true);
    expect(new Set(cars.map((c) => c.serial)).size).toBe(420);
    // 날짜별 색상 합계 = 그날 출차 대수
    expect(schedule.days.every((d) => d.colors.reduce((sum, c) => sum + c.count, 0) === d.count)).toBe(true);

    // 색상별 출차 대수 = 그 색 차체가 줄어든 수
    const { wait } = baseScenarios(state);
    for (const c of schedule.colors) {
      const code = `P012-${c.colorCode}`;
      const before = state.lineParts.find((p) => p.partCode === code)!.onHand;
      expect(before - wait.sim.endStock[code], code).toBe(c.count);
    }
    expect(schedule.colors.reduce((sum, c) => sum + c.count, 0)).toBe(420);
    // 차체 440개 중 420개를 쓰고 20개가 남는다
    const left = state.lineParts.filter((p) => p.partCode.startsWith('P012-')).reduce((sum, p) => sum + wait.sim.endStock[p.partCode], 0);
    expect(left).toBe(20);
  });

  it('그 색 차체가 없으면 그 색 차는 만들 수 없다', () => {
    const state = withBodies({ 'P012-C01': 440, 'P012-C02': 0, 'P012-C03': 0, 'P012-C04': 0, 'P012-C05': 0 });
    const schedule = shipmentSchedule(state);
    expect(schedule.colors).toEqual([{ colorCode: 'C01', count: 420 }]);
    expect(schedule.days.flatMap((d) => d.cars).every((c) => c.serial.startsWith('C01-'))).toBe(true);

    const noRed = shipmentSchedule(withBodies({ 'P012-C03': 0 }));
    expect(noRed.colors.some((c) => c.colorCode === 'C03')).toBe(false);
  });

  it('차체가 모자라면 색을 합친 수만큼만 만들고 병목은 차체다', () => {
    const state = withBodies({ 'P012-C01': 10, 'P012-C02': 5, 'P012-C03': 0, 'P012-C04': 0, 'P012-C05': 0 });
    const incoming = stockWithIncoming(state.lineParts, state.purchaseOrders);
    expect(buildable(state.lineParts, incoming)).toBe(15);
    expect(bottleneckOf(state.lineParts, incoming)?.partCode).toBe('P012');
    expect(buildable(state.lineParts, stockOnHand(state.lineParts))).toBe(15);
    const sim = simulate(state.settings, state.lineParts, []);
    expect(sim.totalInput).toBe(15);
    expect(sim.days[0]).toMatchObject({ input: 15, kind: '감산', bottleneck: 'P012' });
    expect(sim.days[0].colors).toEqual([{ colorCode: 'C01', count: 10 }, { colorCode: 'C02', count: 5 }]);
    expect(dashboardModel(state).kpi.bottleneckNow?.name).toBe('차체');
  });

  it('색상별 차체는 따로 발주하고 따로 입고된다', async () => {
    const api = await freshApi();
    const po = await order(api, 'P012-C03', '동아기공', 9);
    expect(po.partCode).toBe('P012-C03');
    await api.receivePurchaseOrder({ poId: po.id, employeeNo: '0000' });
    const state = (await api.fetchState())!;
    const stock = Object.fromEntries(state.lineParts.filter((p) => p.partCode.startsWith('P012-')).map((p) => [p.partCode, p.onHand]));
    expect(stock).toEqual({ 'P012-C01': 120, 'P012-C02': 100, 'P012-C03': 69, 'P012-C04': 80, 'P012-C05': 80 });
  });

  it('색상별 차체 한 종류에만 차질을 등록할 수 있다', async () => {
    const api = await freshApi();
    await order(api, 'P012-C02', '동아기공', 9);
    const state = (await api.fetchState())!;
    const built = buildDisruption({ state, part: partOf('P012-C02'), supplierName: '동아기공', reason: '납품 지연', delayDays: 3, createdBy: 'A' });
    const model = dashboardModel(withDisruption(state, built));
    const body = model.parts.find((p) => p.part.code === 'P012')!;
    expect(body.status).toBe('차질');
    expect(body.variants!.map((v) => v.status)).toEqual(['정상', '차질', '정상', '정상', '정상']);
  });
});

describe('4. 발주 권한자 (Excel 발주권한자 시트)', () => {
  it('Excel의 6명과 테스트 번호 0000만 통과한다', () => {
    expect(employees.map((e) => e.no)).toEqual([
      'ICBM-26001', 'ICBM-26007', 'ICBM-26012', 'ICBM-26018', 'ICBM-26024', 'ICBM-26031', '0000',
    ]);
    expect(authorize('ICBM-26012')).toBe('박해성(ICBM-26012)');
    expect(authorize(' icbm-26031 ')).toBe('최민준(ICBM-26031)');
    expect(authorize('0000')).toBe('테스트(0000)');
    expect(findEmployee('ICBM-26007')).toMatchObject({ name: '권태경', dept: '구매팀', rank: '과장' });
  });

  it('명단에 없는 번호(예전 임시 번호 포함)는 막힌다', () => {
    for (const no of ['1001', '1002', 'ICBM-26002', 'ICBM-2600', 'EMP-26001', '00000', '']) {
      expect(employeeError(no), no).not.toBeNull();
    }
    expect(() => authorize('1001')).toThrow('발주 권한자 명단에 없는 사원번호');
  });
});

describe('5. 발주 금액 (Excel 업체별_자재단가)', () => {
  it('부품 1개 값 = 기준단가(원/개) × (업체의 자재 단가 ÷ 자재 기준 단가), 100원 단위', () => {
    // 기준단가는 Excel 제품별_기준단가 (현실 단가)
    expect(Object.fromEntries(['P007', 'P024', 'P001', 'P004', 'P010', 'P012', 'P013'].map((c) => [partOf(c).name, partOf(c).basePrice]))).toEqual({
      엔진: 4200000, 변속기: 2400000, 브레이크: 180000, 서스펜션: 380000, 조향: 420000, 차체: 220000, 배터리: 1600000,
    });
    expect(pricePerKgOf(partOf('P013'), '대성메탈')).toBe(3660);
    expect(unitPriceOf(partOf('P013'), '대성메탈')).toBe(1521000); // 1,600,000원 × 3,660 ÷ 3,850
    expect(unitPriceOf(partOf('P007'), '한빛오토텍')).toBe(4243600); // 4,200,000원 × 3,890 ÷ 3,850
    expect(unitPriceOf(partOf('P007'), '진성오토텍')).toBe(4210900); // 같은 부품도 업체마다 다르다
    expect(unitPriceOf(partOf('P012-C02'), '동아기공')).toBe(209400); // 색이 달라도 차체 값은 같다
    expect(orderAmount(partOf('P013'), '대성메탈', 50)).toBe(76050000);
    // 그 자재를 팔지 않는 업체는 단가가 없다
    expect(unitPriceOf(partOf('P013'), '태성모터스')).toBeNull();
  });

  it('공급 가능한 모든 업체·자재에 단가가 있다', () => {
    for (const s of reference.suppliers) {
      for (const m of s.materials) {
        expect(reference.prices.some((p) => p.supplierName === s.name && p.materialName === m), `${s.name}/${m}`).toBe(true);
      }
    }
  });

  it('발주마다 쓴 돈과 합계', async () => {
    const api = await freshApi();
    let state = (await api.fetchState())!;
    const amounts = Object.fromEntries(state.purchaseOrders.map((p) => [p.id, poAmount(p)]));
    expect(amounts).toEqual({ 'PO-001': 1697440000, 'PO-002': 524720000, 'PO-003': 149804000 });
    expect(totalSpent(state.purchaseOrders)).toBe(2371964000);

    const po = await order(api, 'P013', '대성메탈', 50);
    expect(poAmount(po)).toBe(76050000);
    state = (await api.fetchState())!;
    expect(totalSpent(state.purchaseOrders)).toBe(2448014000);
    expect(dashboardModel(state).poRows.find((r) => r.po.id === po.id)!.amount).toBe(76050000);

    // 취소하면 쓴 돈에서 빠진다
    await api.cancelPurchaseOrder({ poId: po.id, employeeNo: '0000' });
    state = (await api.fetchState())!;
    expect(poAmount(state.purchaseOrders.find((p) => p.id === po.id)!)).toBe(0);
    expect(totalSpent(state.purchaseOrders)).toBe(2371964000);
  });

  it('대체 발주는 대체 업체 단가로, 감량하면 원래 발주 금액도 줄어든다', async () => {
    const api = await freshApi();
    await api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, employeeNo: '0000' });
    const alt = await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 50, action: '감량', employeeNo: '0000' });
    expect(poAmount(alt)).toBe(210545000); // 4,210,900원 × 50
    const state = (await api.fetchState())!;
    expect(poAmount(state.purchaseOrders.find((p) => p.id === 'PO-001')!)).toBe(1485260000); // 4,243,600원 × 350
  });
});
