// QA 보고서(PPC_QA_테스트보고서.md)에서 고친 항목과 그 뒤에 추가한 기능
import { describe, expect, it } from 'vitest';
import { baseScenarios, previewNewOrder } from '../actions';
import { BUSY_ID_MESSAGE, createApi, qtyError } from '../api';
import { SUPPLIER_ORDER_LIMIT } from '../constants';
import { dashboardModel, staleDataReasons } from '../dashboard';
import { capacityError, supplierCapacityOf } from '../ordering';
import { coverQty, displayStatusOf, supplierLimitOf } from '../planning';
import { recommendSuppliers, splitPlan } from '../recommend';
import { demoState, partOf, reference, supplierOf } from '../reference';
import { productionParts } from '../repairs';
import { searchOffers } from '../search';
import { DuplicateKeyError, friendlyDbError, memoryStore, type Store } from '../store';

const BASE = '2026-10-05';
async function freshApi(store: Store = memoryStore()) {
  const api = createApi(store, () => BASE);
  await api.resetDemoData('0000');
  return api;
}
const engineDelay = (api: Awaited<ReturnType<typeof freshApi>>, delayDays = 5, reason = '납품 지연') =>
  api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason, delayDays, employeeNo: '0000' });

describe('BUG-001 중복 발주와 번호 충돌', () => {
  it('같은 날 같은 내용의 발주는 확인 없이는 한 번만 들어간다', async () => {
    const api = await freshApi();
    const input = { partCode: 'P013', supplierName: '대성메탈', qty: 7, employeeNo: '0000' };
    await api.createPurchaseOrder(input);
    await expect(api.createPurchaseOrder(input)).rejects.toThrow('같은 내용의 발주(PO-004)가 오늘 이미 있습니다');
    expect((await api.fetchState())!.purchaseOrders).toHaveLength(4);
    await api.createPurchaseOrder({ ...input, allowDuplicate: true });
    await api.createPurchaseOrder({ ...input, qty: 8 }); // 수량이 다르면 중복이 아니다
    expect((await api.fetchState())!.purchaseOrders.map((p) => p.id)).toEqual(['PO-001', 'PO-002', 'PO-003', 'PO-004', 'PO-005', 'PO-006']);
  });

  it('번호가 겹치면 새 번호로 다시 시도한다 (다른 사람이 같은 순간에 저장한 경우)', async () => {
    const inner = memoryStore();
    let collide = 2;
    const store: Store = {
      ...inner,
      async insert(table, rows) {
        if (table === 'purchase_orders' && rows.length === 1 && collide > 0) {
          collide -= 1;
          // 다른 사람이 같은 번호로 먼저 넣었다
          await inner.insert(table, [{ ...rows[0], created_by: '다른 사람', qty: 1, original_qty: 1 }]);
          throw new DuplicateKeyError(rows[0].id);
        }
        return inner.insert(table, rows);
      },
    };
    const api = await freshApi(store);
    const po = await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 7, employeeNo: '0000' });
    expect(po.id).toBe('PO-006'); // PO-004, PO-005는 다른 사람이 가져갔다
    expect((await api.fetchState())!.purchaseOrders).toHaveLength(6);
  });

  it('계속 겹치면 알기 쉬운 문구로 끝낸다', async () => {
    const inner = memoryStore();
    const api = await freshApi(inner);
    const store: Store = { ...inner, insert: async (table, rows) => (table === 'purchase_orders' ? Promise.reject(new DuplicateKeyError()) : inner.insert(table, rows)) };
    await expect(createApi(store, () => BASE).createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 7, employeeNo: '0000' })).rejects.toThrow(
      BUSY_ID_MESSAGE,
    );
    expect((await api.fetchState())!.purchaseOrders).toHaveLength(3);
  });
});

describe('BUG-003 · BUG-009 공급 능력 (월 단위, 이미 받은 물량을 뺀다)', () => {
  it('남은 능력 = 월 공급가능량 − 최근 한 달 발주량', async () => {
    const api = await freshApi();
    const state = (await api.fetchState())!;
    // 시연 초기의 정기 계약 물량은 세지 않는다
    expect(supplierCapacityOf(state.purchaseOrders, supplierOf('한빛오토텍')!, BASE)).toMatchObject({ monthlyKg: 3231, usedKg: 0, remainingKg: 3231 });
    // 대성메탈에 배터리 50개(× 4kg) 발주 → 200kg 사용
    await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 50, employeeNo: '0000' });
    const after = (await api.fetchState())!;
    expect(supplierCapacityOf(after.purchaseOrders, supplierOf('대성메탈')!, BASE)).toMatchObject({ monthlyKg: 4955, usedKg: 200, remainingKg: 4755 });
    // 한 달(30일)이 지나면 다시 채워진다
    expect(supplierCapacityOf(after.purchaseOrders, supplierOf('대성메탈')!, '2026-11-03').usedKg).toBe(200);
    expect(supplierCapacityOf(after.purchaseOrders, supplierOf('대성메탈')!, '2026-11-04').usedKg).toBe(0);
  });

  it('공급 능력을 넘는 대체 발주는 확정할 수 없다', async () => {
    const api = await freshApi();
    await engineDelay(api);
    // 진성오토텍 월 3,696kg ÷ 1.5kg = 2,464개까지
    await expect(
      api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 2465, action: '유지', employeeNo: '0000' }),
    ).rejects.toThrow('진성오토텍의 남은 공급 능력 3,696kg을 넘습니다. 필요량 3,698kg · 이 업체에서 받을 수 있는 수량은 최대 2,464개입니다.');
    const state = (await api.fetchState())!;
    expect(state.purchaseOrders).toHaveLength(3);
    expect(state.disruptions[0].status).toBe('발생');
    await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 2464, action: '유지', employeeNo: '0000' });
  });

  it('이미 받은 물량이 있으면 추천에서 남은 능력으로 판단한다', async () => {
    const api = await freshApi();
    await engineDelay(api);
    await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 2400, action: '유지', employeeNo: '0000' });
    const state = (await api.fetchState())!;
    const usedKg = Object.fromEntries(reference.suppliers.map((s) => [s.name, supplierCapacityOf(state.purchaseOrders, s, BASE).usedKg]));
    const rec = recommendSuppliers({ part: partOf('P007'), excludeSupplierName: '한빛오토텍', suppliers: reference.suppliers, baseDate: BASE, qty: 100, usedKg });
    const jinseong = rec.ranked.find((c) => c.name === '진성오토텍')!;
    expect(jinseong).toMatchObject({ usedKg: 3600, remainingKg: 96, capacityOk: false, maxQty: 64 });
    expect(rec.ranked[rec.ranked.length - 1].name).toBe('진성오토텍'); // 공급할 수 없는 업체는 맨 뒤
    expect(capacityError(supplierCapacityOf(state.purchaseOrders, supplierOf('진성오토텍')!, BASE), '진성오토텍', partOf('P007'), 100)).toContain('최대 64개');
  });
});

describe('BUG-004 같은 발주에 차질이 또 생기면 지연 연장', () => {
  it('새 차질을 만들지 않고 기존 차질의 지연을 늘린다', async () => {
    const api = await freshApi();
    const first = await engineDelay(api, 7);
    expect(first).toMatchObject({ extended: false });
    const second = await engineDelay(api, 3, '품질 불량');
    expect(second.extended).toBe(true);
    expect(second.disruption).toMatchObject({ id: 'D-001', delayDays: 10 });
    const state = (await api.fetchState())!;
    expect(state.disruptions).toHaveLength(1);
    // 10/7 → 10/14 → 10/17, 연결은 D-001 그대로
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')).toMatchObject({ expectedArrival: '2026-10-17', status: '지연', disruptionId: 'D-001' });
    expect(state.logs.filter((l) => l.target === 'D-001').map((l) => l.action).reverse()).toEqual(['차질 등록', '지연 연장']);
    expect(state.logs.findIndex((l) => l.action === '지연 연장')).toBeLessThan(state.logs.findIndex((l) => l.action === '차질 등록'));
    expect(state.logs.find((l) => l.action === '지연 연장')!.detail).toContain('품질 불량 · +3일 (합계 10일)');
  });

  it('기다리기로 결정했던 차질은 연장되면 다시 결정해야 한다. 합계는 60일을 넘을 수 없다', async () => {
    const api = await freshApi();
    await engineDelay(api, 5);
    await api.decideWait({ disruptionId: 'D-001', employeeNo: '0000' });
    await engineDelay(api, 2);
    expect((await api.fetchState())!.disruptions[0]).toMatchObject({ status: '발생', delayDays: 7 });
    await expect(engineDelay(api, 54)).rejects.toThrow('지연일수 합계는 60일을 넘을 수 없습니다');
  });

  it('해결된 뒤에 생긴 차질은 새 차질이다', async () => {
    const api = await freshApi();
    await engineDelay(api, 5);
    await api.resolveDisruption({ disruptionId: 'D-001', employeeNo: '0000', arrivals: { 'PO-001': '2026-10-08' } });
    const again = await engineDelay(api, 2);
    expect(again).toMatchObject({ extended: false });
    expect(again.disruption.id).toBe('D-002');
    expect((await api.fetchState())!.purchaseOrders.find((p) => p.id === 'PO-001')).toMatchObject({ expectedArrival: '2026-10-10', disruptionId: 'D-002' });
  });
});

describe('BUG-005 실제 도착일을 넣고 차질 해결', () => {
  it('내일 이후 날짜: 그 날짜로 확정하고 예측을 다시 계산한다', async () => {
    const api = await freshApi();
    await engineDelay(api, 5); // 10/7 → 10/12, 정지 4일
    expect(baseScenarios((await api.fetchState())!).wait.lineStopDays).toBe(4);
    await expect(api.resolveDisruption({ disruptionId: 'D-001', employeeNo: '0000', arrivals: {} })).rejects.toThrow('PO-001의 실제 도착일을 입력하세요');
    await api.resolveDisruption({ disruptionId: 'D-001', employeeNo: 'ICBM-26007', arrivals: { 'PO-001': '2026-10-09' } });
    const state = (await api.fetchState())!;
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')).toMatchObject({ expectedArrival: '2026-10-09', plannedArrival: '2026-10-07', status: '입고대기' });
    expect(state.disruptions[0].status).toBe('해결');
    // 10/8 하루만 멈춘다 (10/9 도착)
    const { wait } = baseScenarios(state);
    expect(wait.stopDates).toEqual(['2026-10-08']);
    const log = state.logs.find((l) => l.action === '차질 해결')!;
    expect(log.actor).toBe('권태경(ICBM-26007)');
    expect(log.detail).toBe('PO-001 실제 도착일 10/9 확정 (지연 예상 10/12, 원래 10/7)');
    await expect(api.resolveDisruption({ disruptionId: 'D-001', employeeNo: '0000', arrivals: {} })).rejects.toThrow('이미 해결된 차질');
  });

  it('오늘이나 지난 날짜: 이미 들어온 것이므로 입고 처리한다', async () => {
    const api = await freshApi();
    await engineDelay(api, 5);
    await api.resolveDisruption({ disruptionId: 'D-001', employeeNo: '0000', arrivals: { 'PO-001': BASE } });
    const state = (await api.fetchState())!;
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')).toMatchObject({ status: '입고완료', expectedArrival: BASE });
    expect(state.lineParts.find((p) => p.partCode === 'P007')!.onHand).toBe(461);
    expect(baseScenarios(state).wait.lineStopDays).toBe(0);
    expect(state.logs.find((l) => l.action === '차질 해결')!.detail).toContain('입고 처리 +400개');
  });

  it('발주일보다 앞선 날짜는 받지 않는다', async () => {
    const api = await freshApi();
    await engineDelay(api, 5);
    await expect(api.resolveDisruption({ disruptionId: 'D-001', employeeNo: '0000', arrivals: { 'PO-001': '2026-10-01' } })).rejects.toThrow(
      '발주일(10/2)보다 빠를 수 없습니다',
    );
  });
});

describe('BUG-007 대체 추천 수량은 재고를 뺀 부족분', () => {
  it('재고로 버틸 수 있으면 0 (대체 발주 불필요)', async () => {
    const api = await freshApi();
    // 브레이크(재고 22.5일치)를 기본 업체 태성모터스에 40개 발주한 뒤 7일 지연
    await api.createPurchaseOrder({ partCode: 'P001', supplierName: '태성모터스', qty: 40, employeeNo: '0000' });
    await api.registerDisruption({ partCode: 'P001', supplierName: '태성모터스', reason: '납품 지연', delayDays: 7, employeeNo: '0000' });
    const state = (await api.fetchState())!;
    expect(coverQty(state.settings, productionParts(state.lineParts), state.purchaseOrders, 'D-001')).toBe(0);
    const { wait } = baseScenarios(state);
    expect([wait.lineStopDays, wait.loss]).toEqual([0, 0]);
  });
});

describe('대체 수량이 50개를 넘으면 여러 업체에 나눠 발주', () => {
  const ranked = recommendSuppliers({ part: partOf('P007'), excludeSupplierName: '한빛오토텍', suppliers: reference.suppliers, baseDate: BASE, qty: 50 }).ranked;

  it('1순위에 50개, 다음 순위에 나머지', () => {
    const plan = splitPlan(ranked, 60, null, SUPPLIER_ORDER_LIMIT);
    expect(plan.allocations.map((a) => [a.supplier.name, a.qty])).toEqual([['에이스메탈', 50], ['진성오토텍', 10]]);
    expect(plan.shortBy).toBe(0);
    expect(splitPlan(ranked, 50, null, SUPPLIER_ORDER_LIMIT).allocations.map((a) => [a.supplier.name, a.qty])).toEqual([['에이스메탈', 50]]);
    // 첫 업체를 직접 고르면 그 업체부터 채운다
    expect(splitPlan(ranked, 80, '진성오토텍', SUPPLIER_ORDER_LIMIT).allocations.map((a) => [a.supplier.name, a.qty])).toEqual([
      ['진성오토텍', 50],
      ['에이스메탈', 30],
    ]);
    // 후보를 다 써도 모자라면 shortBy
    expect(splitPlan(ranked, 14 * 50 + 5, null, SUPPLIER_ORDER_LIMIT).shortBy).toBe(5);
  });

  it('나눠서 확정하면 업체마다 대체 발주가 따로 생긴다', async () => {
    const api = await freshApi();
    await engineDelay(api, 5);
    await api.confirmAlternative({
      disruptionId: 'D-001',
      supplierName: '에이스메탈',
      qty: 80,
      action: '유지',
      employeeNo: '0000',
      allocations: [
        { supplierName: '에이스메탈', qty: 50 },
        { supplierName: '진성오토텍', qty: 30 },
      ],
    });
    const state = (await api.fetchState())!;
    expect(state.purchaseOrders.filter((p) => p.kind === '대체').map((p) => [p.id, p.supplierName, p.qty, p.expectedArrival, p.disruptionId])).toEqual([
      ['PO-004', '에이스메탈', 50, '2026-10-07', 'D-001'],
      ['PO-005', '진성오토텍', 30, '2026-10-07', 'D-001'],
    ]);
    expect(state.disruptions[0]).toMatchObject({ status: '대체발주', altSupplierName: '에이스메탈, 진성오토텍', altQty: 80, altPoId: 'PO-004' });
    // 추천 수량 80개를 나눠 받으면 라인이 멈추지 않는다
    expect(baseScenarios(state).wait.lineStopDays).toBe(0);
    await expect(
      api.confirmAlternative({ disruptionId: 'D-001', supplierName: 'x', qty: 10, action: '유지', employeeNo: '0000', allocations: [{ supplierName: '동진오토', qty: 9 }] }),
    ).rejects.toThrow('업체별 수량의 합이 대체 수량과 다릅니다');
  });
});

describe('BUG-011 추천 후보에서 빼는 업체', () => {
  it('진행 중인 차질이 있는 업체와 원래 발주보다 늦게 오는 업체', () => {
    const rec = recommendSuppliers({
      part: partOf('P007'),
      excludeSupplierName: '한빛오토텍',
      suppliers: reference.suppliers,
      baseDate: BASE,
      qty: 50,
      disruptedSuppliers: ['에이스메탈'],
      originalArrival: '2026-10-09', // 대체 납기 4일까지만 의미가 있다
    });
    expect(rec.excludedDisrupted.map((s) => s.name)).toEqual(['에이스메탈']);
    expect(rec.excludedTooLate.length).toBeGreaterThan(0);
    expect(rec.ranked.every((c) => c.name !== '에이스메탈' && c.arrival <= '2026-10-09')).toBe(true);
    expect(rec.total).toBe(14 - 1 - rec.excludedTooLate.length);
  });

  it('차질 진행 중인 업체로는 대체 발주를 확정할 수 없다', async () => {
    const api = await freshApi();
    await engineDelay(api, 5);
    // 서스펜션(태성모터스)에도 차질
    await api.registerDisruption({ partCode: 'P004', supplierName: '태성모터스', reason: '납품 지연', delayDays: 7, employeeNo: '0000' });
    // 태성모터스는 철강 소재 업체라 차체 차질의 후보가 될 수 있지만, 지금은 차질 중이다
    await api.createPurchaseOrder({ partCode: 'P012-C01', supplierName: '동아기공', qty: 9, employeeNo: '0000' });
    await api.registerDisruption({ partCode: 'P012-C01', supplierName: '동아기공', reason: '납품 지연', delayDays: 3, employeeNo: '0000' });
    await expect(
      api.confirmAlternative({ disruptionId: 'D-003', supplierName: '태성모터스', qty: 5, action: '유지', employeeNo: '0000' }),
    ).rejects.toThrow('태성모터스는 진행 중인 차질이 있어 대체 업체로 고를 수 없습니다');
  });
});

describe('BUG-010 수량 상한과 오류 문구', () => {
  it('수량은 100,000 이하', async () => {
    expect(qtyError(100_000)).toBeNull();
    expect(qtyError(100_001)).toBe('수량은 100,000 이하여야 합니다.');
    const api = await freshApi();
    await expect(api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 99_999_999_999, employeeNo: '0000' })).rejects.toThrow('100,000 이하');
    await expect(api.addCustomerOrder({ customer: 'A', qty: 5_000_000, dueDate: '2026-10-20', employeeNo: '0000' })).rejects.toThrow('100,000 이하');
  });

  it('DB 오류 원문 대신 알기 쉬운 문구를 보여 준다', () => {
    expect(friendlyDbError({ code: '22003', message: 'value "99999999999" is out of range for type integer' }).message).toBe('숫자가 너무 큽니다. 더 작은 값을 입력하세요.');
    expect(friendlyDbError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBeInstanceOf(DuplicateKeyError);
    expect(friendlyDbError({ message: 'TypeError: Failed to fetch' }).message).toContain('서버에 연결하지 못했습니다');
  });
});

describe('BUG-014 납기 추가 전에 경고할 내용', () => {
  const state = demoState();

  it('리드타임보다 빠른 납기와 기간 안에 못 만드는 수량', () => {
    const today = previewNewOrder(state, { qty: 10, dueDate: BASE });
    expect(today.earliestDone).toBe('2026-10-07');
    expect(today.mine).toMatchObject({ doneDate: '2026-10-07', lateDays: 2 });
    const huge = previewNewOrder(state, { qty: 5000, dueDate: '2026-10-25' });
    expect(huge.mine.lateDays).toBeNull();
    expect([huge.periodEnd, huge.periodTotal]).toEqual(['2026-10-27', 420]);
  });

  it('급한 주문을 넣으면 뒤로 밀려 납기를 놓치는 기존 주문을 알려 준다', () => {
    const urgent = previewNewOrder(state, { qty: 40, dueDate: '2026-10-09' });
    expect(urgent.mine.lateDays).toBeLessThanOrEqual(0);
    expect(urgent.newlyLate.map((o) => o.id)).toEqual(['CO-001', 'CO-002', 'CO-003']);
    expect(previewNewOrder(state, { qty: 40, dueDate: '2026-10-25' }).newlyLate).toEqual([]);
  });
});

describe('활동 기록 (BUG-005 · 006 · 008 · 018 · 021)', () => {
  it('초기화하면 초기 발주·주문이 지난 날짜에 입력한 기록으로 만들어진다', async () => {
    const api = await freshApi();
    const state = (await api.fetchState())!;
    expect(state.logReady).toBe(true);
    // 모든 발주일과 기록 시각이 기준일보다 앞이다 (마지막의 '데이터 초기화'만 지금)
    expect(state.purchaseOrders.every((po) => po.orderDate < BASE)).toBe(true);
    expect(state.purchaseOrders.map((po) => po.createdBy)).toEqual(['이영수(ICBM-26001) · 정기 계약', '윤도경(ICBM-26018) · 정기 계약', '권태경(ICBM-26007) · 정기 계약']);
    const seeded = state.logs.filter((l) => l.action !== '데이터 초기화');
    expect(seeded.map((l) => `${l.action} ${l.target}`).sort()).toEqual([
      '납기 추가 CO-001', '납기 추가 CO-002', '납기 추가 CO-003', '발주 등록 PO-001', '발주 등록 PO-002', '발주 등록 PO-003',
    ]);
    expect(seeded.every((l) => new Date(l.at).getTime() < new Date(2026, 9, 5).getTime())).toBe(true);
    expect(state.logs.filter((l) => l.action === '데이터 초기화').map((l) => l.actor)).toEqual(['테스트(0000)']);
    // 정기 계약 물량은 주간 한도에 넣지 않는다
    expect(supplierLimitOf(state.purchaseOrders, '태성모터스', BASE).used).toBe(0);
    expect(state.purchaseOrders.map((po) => displayStatusOf(po, BASE))).toEqual(['입고대기', '입고대기', '입고대기']);
    expect(staleDataReasons(state)).toEqual([]);
  });

  it('DB의 정수 열에 들어갈 값은 모두 정수다 (초기화가 중간에 실패하지 않게)', () => {
    const demo = demoState(BASE);
    for (const p of demo.lineParts) {
      expect([p.partCode, Number.isInteger(p.sortOrder), Number.isInteger(p.onHand), Number.isInteger(p.qtyPerCar)]).toEqual([p.partCode, true, true, true]);
    }
    expect(new Set(demo.lineParts.map((p) => p.sortOrder)).size).toBe(demo.lineParts.length);
    expect(demo.purchaseOrders.every((po) => Number.isInteger(po.qty) && Number.isInteger(po.originalQty))).toBe(true);
    expect(demo.customerOrders.every((o) => Number.isInteger(o.qty))).toBe(true);
  });

  it('납기 추가·취소가 기록에 남고, 취소한 주문 번호는 다시 쓰지 않는다 (BUG-021)', async () => {
    const api = await freshApi();
    const added = await api.addCustomerOrder({ customer: '한울모빌리티', qty: 40, dueDate: '2026-10-25', employeeNo: 'ICBM-26012' });
    await api.removeCustomerOrder({ orderId: added.id, employeeNo: 'ICBM-26001' });
    const state = (await api.fetchState())!;
    expect(state.customerOrders.map((o) => o.id)).toEqual(['CO-001', 'CO-002', 'CO-003']);
    const logs = state.logs.filter((l) => l.target === 'CO-004').reverse();
    expect(logs.map((l) => [l.action, l.actor, l.detail])).toEqual([
      ['납기 추가', '박해성(ICBM-26012)', '한울모빌리티 40대 · 납기 10/25'],
      ['납기 취소', '이영수(ICBM-26001)', '한울모빌리티 40대 · 납기 10/25 주문을 취소(삭제)함'],
    ]);
    expect((await api.addCustomerOrder({ customer: '새 주문', qty: 1, dueDate: '2026-10-25', employeeNo: '0000' })).id).toBe('CO-005');
  });

  it('저장하는 작업마다 누가 했는지 남는다', async () => {
    const api = await freshApi();
    const po = await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 5, employeeNo: 'ICBM-26018' });
    await api.cancelPurchaseOrder({ poId: po.id, employeeNo: 'ICBM-26018' });
    await engineDelay(api, 5);
    await api.decideWait({ disruptionId: 'D-001', employeeNo: 'ICBM-26024' });
    await api.receivePurchaseOrder({ poId: 'PO-003', employeeNo: 'ICBM-26031' });
    await api.updateSettings({ dailyCapacity: 25, leadTimeDays: 2, employeeNo: 'ICBM-26001' });
    const logs = (await api.fetchState())!.logs.filter((l) => !l.id.startsWith('seed-') && l.action !== '데이터 초기화');
    expect(logs.map((l) => [l.action, l.target, l.actor]).reverse()).toEqual([
      ['발주 등록', 'PO-004', '윤도경(ICBM-26018)'],
      ['발주 취소', 'PO-004', '윤도경(ICBM-26018)'],
      ['차질 등록', 'D-001', '테스트(0000)'],
      ['기다리기 결정', 'D-001', '임형민(ICBM-26024)'],
      ['입고 처리', 'PO-003', '최민준(ICBM-26031)'],
      ['생산 설정 변경', '', '이영수(ICBM-26001)'],
    ]);
    expect(logs.find((l) => l.action === '생산 설정 변경')!.detail).toBe('일일 투입 20 → 25대 · 리드타임 2 → 2일');
    expect(logs.find((l) => l.action === '입고 처리')!.detail).toBe('조향 +340개 (재고 101 → 441개) · 세진정밀');
  });

  it('활동 기록 테이블이 없는 DB에서도 작업은 되고, 없다는 것을 알려 준다', async () => {
    const inner = memoryStore();
    const noLog: Store = {
      ...inner,
      select: (table) => (table === 'activity_log' ? Promise.reject(new Error('relation does not exist')) : inner.select(table)),
      insert: (table, rows) => (table === 'activity_log' ? Promise.reject(new Error('relation does not exist')) : inner.insert(table, rows)),
      clear: (table) => (table === 'activity_log' ? Promise.reject(new Error('relation does not exist')) : inner.clear(table)),
    };
    const api = await freshApi(noLog);
    await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 5, employeeNo: '0000' });
    const state = (await api.fetchState())!;
    expect([state.logReady, state.logs.length, state.purchaseOrders.length]).toEqual([false, 0, 4]);
  });
});

describe('예전 형식 데이터 감지', () => {
  it('색상 구분 없는 차체나 기준일보다 뒤 날짜의 기록이 있으면 초기화를 안내한다', () => {
    const state = demoState();
    const legacy = {
      ...state,
      lineParts: [...state.lineParts.filter((p) => !p.partCode.startsWith('P012-')), { partCode: 'P012', qtyPerCar: 1, onHand: 440, sortOrder: 6 }],
      purchaseOrders: state.purchaseOrders.map((po) => ({ ...po, orderDate: '2026-10-09' })),
    };
    expect(staleDataReasons(legacy)).toHaveLength(2);
    // 예전 형식이어도 화면 계산은 된다
    expect(dashboardModel(legacy).kpi.buildableNow).toBe(60);
  });
});

describe('발주 검색', () => {
  const state = demoState();

  it('부품명으로 찾으면 그 부품을 파는 업체가 가격이 싼 순으로 나온다', () => {
    const offers = searchOffers(state, '엔진');
    expect(offers).toHaveLength(15);
    expect(offers.every((o) => o.part.name === '엔진' && o.unitPrice !== null)).toBe(true);
    const prices = offers.map((o) => o.unitPrice!);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(offers.find((o) => o.supplier.name === '한빛오토텍')).toMatchObject({ unitPrice: 5835, leadDays: 5, altLeadDays: 4, onTimeRate: 93, grade: '보통', isDefault: true });
  });

  it('업체명·소재·여러 낱말로 찾을 수 있고, 차체는 한 줄로 묶는다', () => {
    expect(searchOffers(state, '대성메탈').map((o) => o.part.name).sort()).toEqual(['배터리', '엔진']);
    expect(searchOffers(state, '배터리 대성메탈').map((o) => [o.part.name, o.supplier.name, o.unitPrice])).toEqual([['배터리', '대성메탈', 14640]]);
    const body = searchOffers(state, '차체');
    expect(new Set(body.map((o) => o.part.code))).toEqual(new Set(['P012']));
    expect(body[0].orderPartCode).toBe('P012-C01');
    expect(searchOffers(state, '없는말')).toEqual([]);
    expect(searchOffers(state, '').length).toBeGreaterThan(50);
  });
});
