// 저장 흐름 (DESIGN.md §5 '완료 확인'). 메모리 저장소로 DB 없이 확인한다.
import { describe, expect, it } from 'vitest';
import { baseScenarios, NO_OPEN_PO_MESSAGE } from '../actions';
import { createApi, EMPTY_DB_MESSAGE } from '../api';
import { cautionOf } from '../cautions';
import { todayISO } from '../clock';
import { buildable, displayStatusOf, isCancellable, openPos, supplierLimitOf, partStatusOf, sortByArrival, stockOnHand, stockWithIncoming } from '../planning';
import { productionParts } from '../repairs';
import { memoryStore } from '../store';
import type { AppState } from '../types';

/** 입고 예정 포함 생산 가능 대수 (수리용 재고 제외) */
const buildableIncoming = (state: AppState) => {
  const parts = productionParts(state.lineParts);
  return buildable(parts, stockWithIncoming(parts, state.purchaseOrders));
};

async function freshApi() {
  const api = createApi(memoryStore(), () => '2026-10-05');
  await api.resetDemoData('0000');
  return api;
}

describe('데이터 초기화 (C-1)', () => {
  it('빈 DB는 null, 초기화하면 §4.3 값이 들어간다', async () => {
    const api = createApi(memoryStore(), () => '2026-10-05');
    expect(await api.fetchState()).toBeNull();
    await expect(api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 1, employeeNo: '0000' })).rejects.toThrow(
      EMPTY_DB_MESSAGE,
    );
    await api.resetDemoData('0000');
    const state = (await api.fetchState())!;
    expect(state.settings).toEqual({ baseDate: '2026-10-05', dailyCapacity: 20, leadTimeDays: 2, horizonDays: 21 });
    expect(state.lineParts.map((p) => p.partCode)).toEqual([
      'P007', 'P024', 'P001', 'P004', 'P010', 'P012-C01', 'P012-C02', 'P012-C03', 'P012-C04', 'P012-C05', 'P013',
    ]);
    expect(state.purchaseOrders).toHaveLength(3);
    expect(state.customerOrders).toHaveLength(3);
    expect(state.disruptions).toHaveLength(0);
  });

  it('초기화는 그동안 바뀐 내용을 모두 되돌린다', async () => {
    const api = await freshApi();
    await api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, employeeNo: '0000' });
    await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 50, employeeNo: '0000' });
    await api.resetDemoData('0000');
    const state = (await api.fetchState())!;
    expect(state.disruptions).toHaveLength(0);
    expect(state.purchaseOrders.map((p) => [p.id, p.status])).toEqual([
      ['PO-001', '입고대기'],
      ['PO-002', '입고대기'],
      ['PO-003', '입고대기'],
    ]);
  });
});

describe('F1-2 발주 저장', () => {
  it('배터리 50개 · 대성메탈 → PO-004, 기본 납기 5일 + 수량 지연 30일 = 11/9, 입고 예정 포함 440대', async () => {
    const api = await freshApi();
    await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 50, employeeNo: '0000' });
    const state = (await api.fetchState())!;
    const po = state.purchaseOrders.find((p) => p.id === 'PO-004')!;
    expect(po).toMatchObject({
      partCode: 'P013',
      supplierName: '대성메탈',
      qty: 50,
      originalQty: 50,
      orderDate: '2026-10-05',
      plannedArrival: '2026-11-09',
      expectedArrival: '2026-11-09',
      status: '입고대기',
      kind: '일반',
      createdBy: '테스트(0000)',
    });
    expect(buildableIncoming(state)).toBe(440);
  });

  it('수량은 1 이상의 정수', async () => {
    const api = await freshApi();
    for (const qty of [0, -5, 1.5, NaN]) {
      await expect(api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty, employeeNo: '0000' })).rejects.toThrow(
        '수량은 1 이상의 정수',
      );
    }
    expect((await api.fetchState())!.purchaseOrders).toHaveLength(3);
  });
});

describe('F2-1 차질 저장', () => {
  it('사례2: PO-001이 10/12 지연으로 바뀐다', async () => {
    const api = await freshApi();
    const d = await api.registerDisruption({
      partCode: 'P007',
      supplierName: '한빛오토텍',
      reason: '납품 지연',
      delayDays: 5,
      employeeNo: 'ICBM-26012',
    });
    expect(d.extended).toBe(false);
    expect(d.disruption.id).toBe('D-001');
    expect(d.disruption.createdBy).toBe('박해성(ICBM-26012)');
    const state = (await api.fetchState())!;
    expect(state.disruptions[0]).toMatchObject({ status: '발생', materialName: '알루미늄 소재', detectedDate: '2026-10-05' });
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')).toMatchObject({
      plannedArrival: '2026-10-07',
      expectedArrival: '2026-10-12',
      status: '지연',
      disruptionId: 'D-001',
    });
    // 입고 예정 표 순서: PO-003(10/8) → PO-002(10/9) → PO-001(10/12)
    expect(sortByArrival(openPos(state.purchaseOrders)).map((p) => p.id)).toEqual(['PO-003', 'PO-002', 'PO-001']);
  });

  it('입고 예정 발주가 없는 부품(변속기)은 막히고 아무것도 저장되지 않는다', async () => {
    const api = await freshApi();
    await expect(
      api.registerDisruption({ partCode: 'P024', supplierName: '태성모터스', reason: '납품 지연', delayDays: 3, employeeNo: '0000' }),
    ).rejects.toThrow(NO_OPEN_PO_MESSAGE);
    expect((await api.fetchState())!.disruptions).toHaveLength(0);
  });

  it('지연일수는 1~60', async () => {
    const api = await freshApi();
    for (const delayDays of [0, 61, 2.5]) {
      await expect(
        api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays, employeeNo: '0000' }),
      ).rejects.toThrow('지연일수는 1~60');
    }
  });
});

describe('F2-4 결정 저장', () => {
  async function case2() {
    const api = await freshApi();
    await api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, employeeNo: '0000' });
    return api;
  }

  it('유지: PO-004 대체 발주가 생기고 PO-001은 400 · 10/12 · 지연으로 남는다', async () => {
    const api = await case2();
    await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 100, action: '유지', employeeNo: '0000' });
    const state = (await api.fetchState())!;
    expect(state.purchaseOrders.find((p) => p.id === 'PO-004')).toMatchObject({
      kind: '대체',
      supplierName: '진성오토텍',
      qty: 100,
      expectedArrival: '2026-10-07',
      disruptionId: 'D-001',
    });
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')).toMatchObject({ qty: 400, expectedArrival: '2026-10-12', status: '지연' });
    expect(state.disruptions[0]).toMatchObject({
      status: '대체발주',
      altSupplierName: '진성오토텍',
      altQty: 100,
      altPoId: 'PO-004',
      originalPoAction: '유지',
    });
    // 주문 납기 현황이 모두 충족으로 돌아오고 엔진 카드는 '대응 중'
    const { wait } = baseScenarios(state);
    expect(wait.orders.map((o) => o.doneDate)).toEqual(['2026-10-09', '2026-10-13', '2026-10-17']);
    expect(wait.lateOrders).toHaveLength(0);
    const engine = state.lineParts.find((p) => p.partCode === 'P007')!;
    expect(partStatusOf(engine, state.disruptions, state.settings.dailyCapacity)).toBe('대응 중');
  });

  it('감량: PO-001이 300 (원래 400)', async () => {
    const api = await case2();
    await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 100, action: '감량', employeeNo: '0000' });
    const state = (await api.fetchState())!;
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')).toMatchObject({ qty: 300, originalQty: 400, status: '지연' });
  });

  it('취소(400개): PO-001이 입고 예정 표에서 사라지고 취소로 남는다', async () => {
    const api = await case2();
    await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 400, action: '취소', employeeNo: '0000' });
    const state = (await api.fetchState())!;
    expect(openPos(state.purchaseOrders).map((p) => p.id)).not.toContain('PO-001');
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')).toMatchObject({ status: '취소', qty: 400 });
  });

  it('이미 결정한 차질은 다시 확정할 수 없다', async () => {
    const api = await case2();
    await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 100, action: '유지', employeeNo: '0000' });
    await expect(
      api.confirmAlternative({ disruptionId: 'D-001', supplierName: '동진오토', qty: 100, action: '유지', employeeNo: '0000' }),
    ).rejects.toThrow('이미 결정이 끝난 차질');
    expect((await api.fetchState())!.purchaseOrders).toHaveLength(4);
  });

  it('기다리기 → 해결 완료 (사원번호 필요)', async () => {
    const api = await case2();
    await expect(api.decideWait({ disruptionId: 'D-001', employeeNo: '' })).rejects.toThrow('사원번호를 입력');
    await expect(api.decideWait({ disruptionId: 'D-001', employeeNo: '9999' })).rejects.toThrow('명단에 없는 사원번호');
    expect((await api.fetchState())!.disruptions[0].status).toBe('발생');
    await api.decideWait({ disruptionId: 'D-001', employeeNo: 'ICBM-26001' });
    expect((await api.fetchState())!.disruptions[0].status).toBe('기다리기');
    await expect(api.resolveDisruption({ disruptionId: 'D-001', employeeNo: '9999', arrivals: { 'PO-001': '2026-10-09' } })).rejects.toThrow(
      '명단에 없는 사원번호',
    );
    await api.resolveDisruption({ disruptionId: 'D-001', employeeNo: '0000', arrivals: { 'PO-001': '2026-10-09' } });
    const d = (await api.fetchState())!.disruptions[0];
    expect(d.status).toBe('해결');
    expect(d.resolvedAt).not.toBeNull();
  });
});

describe('P1 입고 처리 · 설정 수정', () => {
  it('입고 처리: 재고에 더하고 입고완료', async () => {
    const api = await freshApi();
    await api.receivePurchaseOrder({ poId: 'PO-001', employeeNo: '0000' });
    const state = (await api.fetchState())!;
    expect(state.lineParts.find((p) => p.partCode === 'P007')!.onHand).toBe(461);
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')!.status).toBe('입고완료');
    // 엔진이 들어와 병목이 서스펜션(90대)으로 바뀐다
    expect(buildable(state.lineParts, stockOnHand(state.lineParts))).toBe(90);
    await expect(api.receivePurchaseOrder({ poId: 'PO-001', employeeNo: '0000' })).rejects.toThrow('이미 입고완료 상태');
    await expect(api.receivePurchaseOrder({ poId: 'PO-003', employeeNo: '' })).rejects.toThrow('사원번호를 입력');
  });

  it('설정 수정: 일일 투입과 리드타임', async () => {
    const api = await freshApi();
    await api.updateSettings({ dailyCapacity: 10, leadTimeDays: 3, employeeNo: '0000' });
    expect((await api.fetchState())!.settings).toMatchObject({ dailyCapacity: 10, leadTimeDays: 3, baseDate: '2026-10-05' });
    await expect(api.updateSettings({ dailyCapacity: 0, leadTimeDays: 2, employeeNo: '0000' })).rejects.toThrow('일일 투입은 1 이상');
    // 상한과 사원번호 (BUG-008)
    await expect(api.updateSettings({ dailyCapacity: 100000, leadTimeDays: 2, employeeNo: '0000' })).rejects.toThrow('1,000 이하');
    await expect(api.updateSettings({ dailyCapacity: 20, leadTimeDays: 100, employeeNo: '0000' })).rejects.toThrow('리드타임은 0 이상 30 이하');
    await expect(api.updateSettings({ dailyCapacity: 20, leadTimeDays: 2, employeeNo: '' })).rejects.toThrow('사원번호를 입력');
    await expect(api.updateSettings({ dailyCapacity: 20, leadTimeDays: 2, employeeNo: '9999' })).rejects.toThrow('명단에 없는 사원번호');
    expect((await api.fetchState())!.settings).toMatchObject({ dailyCapacity: 10, leadTimeDays: 3 });
  });
});

describe('사원번호 권한 (발주 · 발주 취소 · 데이터 초기화)', () => {
  it('명단에 없는 사원번호나 빈 값으로는 발주할 수 없다', async () => {
    const api = await freshApi();
    for (const employeeNo of ['', '   ', '9999', 'abcd']) {
      await expect(api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 50, employeeNo })).rejects.toThrow('사원번호');
    }
    await api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, employeeNo: '0000' });
    await expect(
      api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 100, action: '유지', employeeNo: '9999' }),
    ).rejects.toThrow('명단에 없는 사원번호');
    expect((await api.fetchState())!.purchaseOrders).toHaveLength(3);
  });

  it('명단에 있는 사원번호면 발주되고 이력에 이름(사원번호)가 남는다', async () => {
    const api = await freshApi();
    const po = await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 50, employeeNo: ' icbm-26001 ' });
    expect(po.createdBy).toBe('이영수(ICBM-26001)');
  });

  it('데이터 초기화도 같은 명단으로 확인한다', async () => {
    const api = await freshApi();
    await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 50, employeeNo: '0000' });
    await expect(api.resetDemoData('9999')).rejects.toThrow('명단에 없는 사원번호');
    await expect(api.resetDemoData('')).rejects.toThrow('사원번호를 입력');
    expect((await api.fetchState())!.purchaseOrders).toHaveLength(4);
    await api.resetDemoData('ICBM-26012');
    expect((await api.fetchState())!.purchaseOrders).toHaveLength(3);
  });

  it('차질 등록도 사원번호가 있어야 한다 (자유 입력 이름이 아니다)', async () => {
    const api = await freshApi();
    for (const employeeNo of ['', '  ', '박해성', '9999']) {
      await expect(
        api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, employeeNo }),
      ).rejects.toThrow('사원번호');
    }
    expect((await api.fetchState())!.disruptions).toHaveLength(0);
  });
});

describe('발주대기와 발주 취소', () => {
  it('발주한 당일의 일반 발주만 발주대기다', async () => {
    const api = await freshApi();
    await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 50, employeeNo: '0000' });
    const state = (await api.fetchState())!;
    const shown = Object.fromEntries(state.purchaseOrders.map((p) => [p.id, displayStatusOf(p, state.settings.baseDate)]));
    // 시연 초기 발주 3건은 모두 기준일 이전(10/2, 10/4)에 넣은 것이고, 오늘 넣은 PO-004만 발주대기다
    expect(shown).toEqual({ 'PO-001': '입고대기', 'PO-002': '입고대기', 'PO-003': '입고대기', 'PO-004': '발주대기' });
  });

  it('발주대기는 사원번호가 맞으면 취소되고, 입고 예정과 예측에서 빠진다', async () => {
    const api = await freshApi();
    await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 50, employeeNo: '0000' });
    await expect(api.cancelPurchaseOrder({ poId: 'PO-004', employeeNo: '9999' })).rejects.toThrow('명단에 없는 사원번호');
    await expect(api.cancelPurchaseOrder({ poId: 'PO-004', employeeNo: '' })).rejects.toThrow('사원번호를 입력');
    expect((await api.fetchState())!.purchaseOrders.find((p) => p.id === 'PO-004')!.status).toBe('입고대기');

    await api.cancelPurchaseOrder({ poId: 'PO-004', employeeNo: 'ICBM-26018' });
    const state = (await api.fetchState())!;
    expect(state.purchaseOrders.find((p) => p.id === 'PO-004')!.status).toBe('취소');
    expect(buildableIncoming(state)).toBe(430);
    await expect(api.cancelPurchaseOrder({ poId: 'PO-004', employeeNo: '0000' })).rejects.toThrow('이미 취소된 발주');
  });

  it('발주한 당일이 지난 발주는 취소할 수 없다', async () => {
    const api = await freshApi();
    await expect(api.cancelPurchaseOrder({ poId: 'PO-001', employeeNo: '0000' })).rejects.toThrow('발주한 당일의 발주대기 상태에서만');
    expect((await api.fetchState())!.purchaseOrders.find((p) => p.id === 'PO-001')!.status).toBe('입고대기');
  });

  it('지연된 발주와 대체 발주는 당일이어도 취소 대상이 아니다', async () => {
    const api = await freshApi();
    // PO-002를 지연시키고 대체 발주를 낸다
    await api.registerDisruption({ partCode: 'P004', supplierName: '태성모터스', reason: '납품 지연', delayDays: 7, employeeNo: '0000' });
    const alt = await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진우기공', qty: 560, action: '유지', employeeNo: '0000' });
    const state = (await api.fetchState())!;
    expect(isCancellable(state.purchaseOrders.find((p) => p.id === 'PO-002')!, state.settings.baseDate)).toBe(false);
    expect(isCancellable(state.purchaseOrders.find((p) => p.id === alt.id)!, state.settings.baseDate)).toBe(false);
    await expect(api.cancelPurchaseOrder({ poId: alt.id, employeeNo: '0000' })).rejects.toThrow('발주대기 상태에서만');
  });
});

describe('부품 주의사항', () => {
  it('Excel 주의사항 시트의 7개 부품을 모두 읽는다', () => {
    for (const name of ['엔진', '변속기', '브레이크', '서스펜션', '조향', '차체', '배터리']) {
      expect(cautionOf(name), name).toBeTruthy();
    }
    expect(cautionOf('엔진')).toBe(
      '차량의 동력을 발생시키는 핵심 부품입니다. 외관 손상, 주요 연결부 및 조립 상태를 확인하고, 보관·운송 시 충격과 오염에 주의하십시오.',
    );
    expect(cautionOf('없는 부품')).toBeNull();
  });
});

describe('납기 추가 · 납기 취소 (사원번호 필요)', () => {
  it('납기 추가: CO-004가 생기고 예측에 반영된다', async () => {
    const api = await freshApi();
    const order = await api.addCustomerOrder({ customer: ' 한울모빌리티 ', qty: 100, dueDate: '2026-10-25', employeeNo: '0000' });
    expect(order).toEqual({ id: 'CO-004', customer: '한울모빌리티', qty: 100, dueDate: '2026-10-25', colorCode: null });
    const state = (await api.fetchState())!;
    const { wait } = baseScenarios(state);
    // 누적 320대 → 10/22 완료 (10/7부터 하루 20대)
    expect(wait.orders.map((o) => [o.id, o.doneDate])).toContainEqual(['CO-004', '2026-10-22']);
  });

  it('권한이 없거나 입력이 틀리면 추가하지 않는다', async () => {
    const api = await freshApi();
    const ok = { customer: '한울모빌리티', qty: 100, dueDate: '2026-10-25', employeeNo: '0000' };
    await expect(api.addCustomerOrder({ ...ok, employeeNo: '9999' })).rejects.toThrow('명단에 없는 사원번호');
    await expect(api.addCustomerOrder({ ...ok, employeeNo: '' })).rejects.toThrow('사원번호를 입력');
    await expect(api.addCustomerOrder({ ...ok, customer: '  ' })).rejects.toThrow('고객 이름');
    await expect(api.addCustomerOrder({ ...ok, qty: 0 })).rejects.toThrow('수량은 1 이상');
    await expect(api.addCustomerOrder({ ...ok, dueDate: '2026-10-04' })).rejects.toThrow('기준일보다 빠를 수 없습니다');
    await expect(api.addCustomerOrder({ ...ok, dueDate: '' })).rejects.toThrow('납기 날짜');
    expect((await api.fetchState())!.customerOrders).toHaveLength(3);
  });

  it('납기 취소: 주문이 지워지고 남은 주문의 완료일이 당겨진다', async () => {
    const api = await freshApi();
    await expect(api.removeCustomerOrder({ orderId: 'CO-001', employeeNo: '9999' })).rejects.toThrow('명단에 없는 사원번호');
    expect((await api.fetchState())!.customerOrders).toHaveLength(3);
    await api.removeCustomerOrder({ orderId: 'CO-001', employeeNo: 'ICBM-26001' });
    const state = (await api.fetchState())!;
    expect(state.customerOrders.map((o) => o.id)).toEqual(['CO-002', 'CO-003']);
    expect(baseScenarios(state).wait.orders.map((o) => o.doneDate)).toEqual(['2026-10-10', '2026-10-14']);
    await expect(api.removeCustomerOrder({ orderId: 'CO-001', employeeNo: 'ICBM-26001' })).rejects.toThrow('이미 지워진 주문');
  });
});

describe('업체별 발주 한도 (일주일 50개)', () => {
  const order = (api: Awaited<ReturnType<typeof freshApi>>, qty: number, supplierName = '대성메탈') =>
    api.createPurchaseOrder({ partCode: 'P013', supplierName, qty, employeeNo: '0000' });

  it('한 업체에 50개까지만 발주된다 (여러 번에 나눠도 합산)', async () => {
    const api = await freshApi();
    await order(api, 30);
    await order(api, 20);
    await expect(order(api, 1)).rejects.toThrow('대성메탈 발주 한도(일주일 50개)를 넘습니다. 남은 수량은 0개입니다. 10/12부터 한도가 풀립니다.');
    await expect(order(api, 51, '진성오토텍')).rejects.toThrow('남은 수량은 50개입니다.');
    expect((await api.fetchState())!.purchaseOrders).toHaveLength(5);
  });

  it('한도는 업체마다 따로 센다', async () => {
    const api = await freshApi();
    await order(api, 50);
    await order(api, 50, '진성오토텍');
    const state = (await api.fetchState())!;
    expect(supplierLimitOf(state.purchaseOrders, '대성메탈', '2026-10-05')).toMatchObject({ used: 50, remaining: 0, releaseDate: '2026-10-12' });
    expect(supplierLimitOf(state.purchaseOrders, '세광소재', '2026-10-05')).toMatchObject({ used: 0, remaining: 50, releaseDate: null });
  });

  it('취소한 발주는 한도에서 빠진다', async () => {
    const api = await freshApi();
    const po = await order(api, 50);
    await api.cancelPurchaseOrder({ poId: po.id, employeeNo: '0000' });
    await order(api, 50);
    expect((await api.fetchState())!.purchaseOrders.filter((p) => p.status !== '취소')).toHaveLength(4);
  });

  it('일주일이 지나면 한도가 풀린다', async () => {
    let now = '2026-10-05';
    const api = createApi(memoryStore(), () => now);
    await api.resetDemoData('0000');
    await order(api, 50);
    now = '2026-10-11'; // 6일 뒤: 아직 잠김
    await expect(order(api, 1)).rejects.toThrow('발주 한도');
    now = '2026-10-12'; // 7일 뒤: 풀림
    const po = await order(api, 50);
    expect(po.orderDate).toBe('2026-10-12');
  });

  it('시연 초기 발주와 대체(긴급) 발주는 한도에 넣지 않는다', async () => {
    const api = await freshApi();
    const state = (await api.fetchState())!;
    // 한빛오토텍에는 초기 발주 PO-001 400개가 있지만 한도는 비어 있다
    expect(supplierLimitOf(state.purchaseOrders, '한빛오토텍', '2026-10-05').used).toBe(0);
    await api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, employeeNo: '0000' });
    await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 100, action: '유지', employeeNo: '0000' });
    expect(supplierLimitOf((await api.fetchState())!.purchaseOrders, '진성오토텍', '2026-10-05').used).toBe(0);
  });
});

describe('기준일은 항상 오늘', () => {
  it('DB에 저장된 날짜와 상관없이 오늘을 기준일로 쓴다', async () => {
    let now = '2026-10-05';
    const api = createApi(memoryStore(), () => now);
    await api.resetDemoData('0000');
    expect((await api.fetchState())!.settings.baseDate).toBe('2026-10-05');
    now = '2026-10-08';
    const state = (await api.fetchState())!;
    expect(state.settings.baseDate).toBe('2026-10-08');
    // 3일이 지나면 10/7 예정이던 PO-001은 예정일이 지났다
    expect(displayStatusOf(state.purchaseOrders.find((p) => p.id === 'PO-002')!, state.settings.baseDate)).toBe('입고대기');
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')!.expectedArrival).toBe('2026-10-07');
    await expect(api.cancelPurchaseOrder({ poId: 'PO-002', employeeNo: '0000' })).rejects.toThrow('발주한 당일');
  });

  it('데이터 초기화는 시연 데이터의 날짜를 오늘에 맞춰 옮긴다', async () => {
    const api = createApi(memoryStore(), () => '2026-11-20');
    await api.resetDemoData('0000');
    const state = (await api.fetchState())!;
    expect(state.purchaseOrders.map((p) => [p.id, p.orderDate, p.expectedArrival])).toEqual([
      ['PO-001', '2026-11-17', '2026-11-22'],
      ['PO-002', '2026-11-19', '2026-11-24'],
      ['PO-003', '2026-11-17', '2026-11-23'],
    ]);
    expect(state.customerOrders.map((o) => o.dueDate)).toEqual(['2026-11-25', '2026-11-29', '2026-12-03']);
    // 날짜만 옮겼으므로 결과는 설계서와 같다: 모든 주문 충족(여유 1일)
    expect(baseScenarios(state).wait.orders.map((o) => o.lateDays)).toEqual([-1, -1, -1]);
  });

  it('todayISO는 기기 현지 날짜를 YYYY-MM-DD로 돌려준다', () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(todayISO(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});
