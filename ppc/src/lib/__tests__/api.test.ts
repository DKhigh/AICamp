// 저장 흐름 (DESIGN.md §5 '완료 확인'). 메모리 저장소로 DB 없이 확인한다.
import { describe, expect, it } from 'vitest';
import { baseScenarios, NO_OPEN_PO_MESSAGE } from '../actions';
import { createApi, EMPTY_DB_MESSAGE } from '../api';
import { buildable, openPos, partStatusOf, sortByArrival, stockOnHand, stockWithIncoming } from '../planning';
import { memoryStore } from '../store';

async function freshApi() {
  const api = createApi(memoryStore());
  await api.resetDemoData();
  return api;
}

describe('데이터 초기화 (C-1)', () => {
  it('빈 DB는 null, 초기화하면 §4.3 값이 들어간다', async () => {
    const api = createApi(memoryStore());
    expect(await api.fetchState()).toBeNull();
    await expect(api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 1, createdBy: '테스트' })).rejects.toThrow(
      EMPTY_DB_MESSAGE,
    );
    await api.resetDemoData();
    const state = (await api.fetchState())!;
    expect(state.settings).toEqual({ baseDate: '2026-10-05', dailyCapacity: 20, leadTimeDays: 2, horizonDays: 21 });
    expect(state.lineParts.map((p) => p.partCode)).toEqual(['P007', 'P024', 'P001', 'P004', 'P010', 'P012', 'P013']);
    expect(state.purchaseOrders).toHaveLength(3);
    expect(state.customerOrders).toHaveLength(3);
    expect(state.disruptions).toHaveLength(0);
  });

  it('초기화는 그동안 바뀐 내용을 모두 되돌린다', async () => {
    const api = await freshApi();
    await api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, createdBy: 'A' });
    await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 100, createdBy: 'A' });
    await api.resetDemoData();
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
  it('배터리 100개 · 대성메탈 → PO-004, 10/10, 입고 예정 포함 440대', async () => {
    const api = await freshApi();
    await api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 100, createdBy: '박해성' });
    const state = (await api.fetchState())!;
    const po = state.purchaseOrders.find((p) => p.id === 'PO-004')!;
    expect(po).toMatchObject({
      partCode: 'P013',
      supplierName: '대성메탈',
      qty: 100,
      originalQty: 100,
      orderDate: '2026-10-05',
      plannedArrival: '2026-10-10',
      expectedArrival: '2026-10-10',
      status: '입고대기',
      kind: '일반',
      createdBy: '박해성',
    });
    expect(buildable(state.lineParts, stockWithIncoming(state.lineParts, state.purchaseOrders))).toBe(440);
  });

  it('수량은 1 이상의 정수', async () => {
    const api = await freshApi();
    for (const qty of [0, -5, 1.5, NaN]) {
      await expect(api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty, createdBy: '테스트' })).rejects.toThrow(
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
      createdBy: '박해성',
    });
    expect(d.id).toBe('D-001');
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
      api.registerDisruption({ partCode: 'P024', supplierName: '태성모터스', reason: '납품 지연', delayDays: 3, createdBy: '테스트' }),
    ).rejects.toThrow(NO_OPEN_PO_MESSAGE);
    expect((await api.fetchState())!.disruptions).toHaveLength(0);
  });

  it('지연일수는 1~60', async () => {
    const api = await freshApi();
    for (const delayDays of [0, 61, 2.5]) {
      await expect(
        api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays, createdBy: '테스트' }),
      ).rejects.toThrow('지연일수는 1~60');
    }
  });
});

describe('F2-4 결정 저장', () => {
  async function case2() {
    const api = await freshApi();
    await api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, createdBy: 'A' });
    return api;
  }

  it('유지: PO-004 대체 발주가 생기고 PO-001은 400 · 10/12 · 지연으로 남는다', async () => {
    const api = await case2();
    await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 100, action: '유지', createdBy: 'A' });
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
    await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 100, action: '감량', createdBy: 'A' });
    const state = (await api.fetchState())!;
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')).toMatchObject({ qty: 300, originalQty: 400, status: '지연' });
  });

  it('취소(400개): PO-001이 입고 예정 표에서 사라지고 취소로 남는다', async () => {
    const api = await case2();
    await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 400, action: '취소', createdBy: 'A' });
    const state = (await api.fetchState())!;
    expect(openPos(state.purchaseOrders).map((p) => p.id)).not.toContain('PO-001');
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')).toMatchObject({ status: '취소', qty: 400 });
  });

  it('이미 결정한 차질은 다시 확정할 수 없다', async () => {
    const api = await case2();
    await api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 100, action: '유지', createdBy: 'A' });
    await expect(
      api.confirmAlternative({ disruptionId: 'D-001', supplierName: '동진오토', qty: 100, action: '유지', createdBy: 'B' }),
    ).rejects.toThrow('이미 결정이 끝난 차질');
    expect((await api.fetchState())!.purchaseOrders).toHaveLength(4);
  });

  it('기다리기 → 해결 완료', async () => {
    const api = await case2();
    await api.decideWait('D-001');
    expect((await api.fetchState())!.disruptions[0].status).toBe('기다리기');
    await api.resolveDisruption('D-001');
    const d = (await api.fetchState())!.disruptions[0];
    expect(d.status).toBe('해결');
    expect(d.resolvedAt).not.toBeNull();
  });
});

describe('P1 입고 처리 · 설정 수정', () => {
  it('입고 처리: 재고에 더하고 입고완료', async () => {
    const api = await freshApi();
    await api.receivePurchaseOrder('PO-001');
    const state = (await api.fetchState())!;
    expect(state.lineParts.find((p) => p.partCode === 'P007')!.onHand).toBe(460);
    expect(state.purchaseOrders.find((p) => p.id === 'PO-001')!.status).toBe('입고완료');
    // 엔진이 들어와 병목이 서스펜션(90대)으로 바뀐다
    expect(buildable(state.lineParts, stockOnHand(state.lineParts))).toBe(90);
    await expect(api.receivePurchaseOrder('PO-001')).rejects.toThrow('이미 입고완료 상태');
  });

  it('설정 수정: 일일 투입과 리드타임', async () => {
    const api = await freshApi();
    await api.updateSettings({ dailyCapacity: 10, leadTimeDays: 3 });
    expect((await api.fetchState())!.settings).toMatchObject({ dailyCapacity: 10, leadTimeDays: 3, baseDate: '2026-10-05' });
    await expect(api.updateSettings({ dailyCapacity: 0, leadTimeDays: 2 })).rejects.toThrow('일일 투입은 1 이상');
  });
});

describe('입력자는 공백이면 안 된다', () => {
  it('발주·차질·대체 발주 모두 이름이 없으면 저장하지 않는다', async () => {
    const api = await freshApi();
    for (const createdBy of [null, '', '   ']) {
      await expect(api.createPurchaseOrder({ partCode: 'P013', supplierName: '대성메탈', qty: 100, createdBy })).rejects.toThrow('입력자 이름');
      await expect(
        api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, createdBy }),
      ).rejects.toThrow('입력자 이름');
    }
    await api.registerDisruption({ partCode: 'P007', supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, createdBy: 'A' });
    await expect(
      api.confirmAlternative({ disruptionId: 'D-001', supplierName: '진성오토텍', qty: 100, action: '유지', createdBy: ' ' }),
    ).rejects.toThrow('입력자 이름');
    const state = (await api.fetchState())!;
    expect(state.purchaseOrders).toHaveLength(3);
    expect(state.disruptions).toHaveLength(1);
  });
});
