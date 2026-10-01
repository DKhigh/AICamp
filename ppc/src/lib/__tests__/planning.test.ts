// DESIGN.md §9 기대값. 숫자를 바꾸려면 설계서를 먼저 고친다.
import { describe, expect, it } from 'vitest';
import {
  altScenario,
  baseScenarios,
  buildAlternative,
  buildDisruption,
  buildPurchaseOrder,
  nextId,
  NO_OPEN_PO_MESSAGE,
  withDisruption,
} from '../actions';
import { RISK_LATE_DAYS } from '../constants';
import { addDays, diffDays, formatMD, formatWithWeekday } from '../date';
import { ddayLabel } from '../format';
import { customerNotices, disruptionMessage, impactMessage, recommendMessage, resultMessage, riskLateMessage } from '../messages';
import {
  applyOriginalPoAction,
  bottleneckOf,
  buildable,
  carsFromPart,
  coverageDays,
  coverQty,
  cumAt,
  delayedQtyOf,
  nextArrivalOf,
  openPos,
  partStatusOf,
  recommendedQty,
  sortByArrival,
  stockOnHand,
  stockWithIncoming,
  stopBreakdown,
  stopSummary,
  type ScenarioOutcome,
} from '../planning';
import { gradeOf, recommendSuppliers, suppliersFor } from '../recommend';
import { demoState, materialOf, partOf, reference, supplierOf } from '../reference';
import type { AppState, OriginalPoAction } from '../types';

const D = (md: string) => {
  const [m, d] = md.split('/').map(Number);
  return `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Excel 사례 버튼과 같은 방식으로 차질을 등록한다 (§5 F2-1) */
function registerCase(presetId: string, state: AppState = demoState()) {
  const preset = reference.delayPresets.find((p) => p.id === presetId)!;
  const linePart = state.lineParts.find((lp) => {
    const part = partOf(lp.partCode);
    return part.defaultSupplier === preset.supplierName && part.materialName === preset.materialName;
  })!;
  const part = partOf(linePart.partCode);
  const built = buildDisruption({
    state,
    part,
    supplierName: preset.supplierName,
    reason: preset.reason,
    delayDays: preset.delayDays,
    createdBy: '테스트',
  });
  return { state: withDisruption(state, built), disruption: built.disruption, part, linePart, preset };
}

function recommendFor(c: ReturnType<typeof registerCase>, qty: number) {
  return recommendSuppliers({
    part: c.part,
    excludeSupplierName: c.disruption.supplierName,
    suppliers: reference.suppliers,
    baseDate: c.state.settings.baseDate,
    qty,
  });
}

function runAlt(
  c: ReturnType<typeof registerCase>,
  supplierName: string,
  action: OriginalPoAction,
  qty: number,
  lateDays = 0,
): ScenarioOutcome {
  const { normal } = baseScenarios(c.state);
  return altScenario({
    state: c.state,
    disruption: c.disruption,
    altLeadDays: supplierOf(supplierName)!.altLeadDays,
    qty,
    action,
    normalTotalInput: normal.sim.totalInput,
    lateDays,
  });
}

const doneDates = (o: ScenarioOutcome) => Object.fromEntries(o.orders.map((x) => [x.id, x.doneDate]));
const lateDays = (o: ScenarioOutcome) => Object.fromEntries(o.orders.map((x) => [x.id, x.lateDays]));

describe('date.ts (§6.1)', () => {
  it('날짜 더하기·차이·표기', () => {
    expect(addDays('2026-10-05', 2)).toBe('2026-10-07');
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-10-05', -5)).toBe('2026-09-30');
    expect(diffDays('2026-10-07', '2026-10-05')).toBe(2);
    expect(diffDays('2026-10-05', '2026-10-07')).toBe(-2);
    expect(formatMD('2026-10-07')).toBe('10/7');
    expect(formatWithWeekday('2026-10-05')).toBe('2026-10-05(월)');
  });

  it('D-day 표기 (§5 F1-3)', () => {
    expect(ddayLabel(3)).toBe('D-3');
    expect(ddayLabel(0)).toBe('D-Day');
    expect(ddayLabel(-2)).toBe('예정일 2일 지남');
  });
});

describe('reference.json (§4.2)', () => {
  it('변환 결과 개수', () => {
    expect(reference.parts).toHaveLength(30);
    expect(reference.suppliers).toHaveLength(48);
    expect(reference.materials).toHaveLength(7);
    expect(reference.delayPresets).toHaveLength(3);
  });

  it('업체 납기는 정수', () => {
    for (const s of reference.suppliers) {
      expect(Number.isInteger(s.leadDays)).toBe(true);
      expect(Number.isInteger(s.altLeadDays)).toBe(true);
    }
  });

  it('소재 비교는 정확히 일치 (철강 ≠ 합금강)', () => {
    const steel = suppliersFor('철강 소재', reference.suppliers);
    expect(steel.every((s) => s.materials.includes('철강 소재'))).toBe(true);
    expect(steel.some((s) => s.name === '세진정밀')).toBe(false); // 단조강·합금강만 공급
  });

  it('등급 기준 (§2.2 A10)', () => {
    expect(gradeOf(95)).toBe('우수');
    expect(gradeOf(94)).toBe('보통');
    expect(gradeOf(80)).toBe('보통');
    expect(gradeOf(79)).toBe('위험');
    expect(gradeOf(supplierOf('한빛오토텍')!.onTimeRate)).toBe('위험');
    expect(gradeOf(supplierOf('세진정밀')!.onTimeRate)).toBe('보통');
    expect(gradeOf(supplierOf('태성모터스')!.onTimeRate)).toBe('보통');
  });
});

describe('§9.1 초기 상태 (기준일 10/5)', () => {
  const state = demoState();
  const { settings, lineParts, purchaseOrders } = state;
  const onHand = stockOnHand(lineParts);

  it('부품별 가능 대수', () => {
    const cars = Object.fromEntries(lineParts.map((p) => [partOf(p.partCode).name, carsFromPart(p, onHand)]));
    expect(cars).toEqual({ 엔진: 60, 변속기: 450, 브레이크: 450, 서스펜션: 90, 조향: 100, 차체: 440, 배터리: 430 });
  });

  it('재고 일수와 카드 상태 (§5 F1-1)', () => {
    const days = Object.fromEntries(lineParts.map((p) => [p.partCode, coverageDays(p, settings.dailyCapacity)]));
    expect(days).toEqual({ P007: 3, P024: 22.5, P001: 22.5, P004: 4.5, P010: 5, P012: 22, P013: 21.5 });
    const status = Object.fromEntries(
      lineParts.map((p) => [p.partCode, partStatusOf(p, state.disruptions, settings.dailyCapacity)]),
    );
    expect(status.P007).toBe('주의');
    expect(status.P004).toBe('주의');
    expect(status.P010).toBe('정상');
    expect(status.P024).toBe('정상');
  });

  it('현재 재고로 생산 가능 60대 (병목 엔진)', () => {
    expect(buildable(lineParts, onHand)).toBe(60);
    expect(bottleneckOf(lineParts, onHand)?.partCode).toBe('P007');
  });

  it('입고 예정 포함 430대 (병목 배터리)', () => {
    const incoming = stockWithIncoming(lineParts, purchaseOrders);
    expect(buildable(lineParts, incoming)).toBe(430);
    expect(bottleneckOf(lineParts, incoming)?.partCode).toBe('P013');
  });

  it('오늘 투입 가능 20대', () => {
    expect(Math.min(settings.dailyCapacity, buildable(lineParts, onHand))).toBe(20);
  });

  it('입고 예정 표 순서와 D-day', () => {
    const rows = sortByArrival(openPos(purchaseOrders)).map((po) => [
      po.id,
      formatMD(po.expectedArrival),
      ddayLabel(diffDays(po.expectedArrival, settings.baseDate)),
    ]);
    expect(rows).toEqual([
      ['PO-001', '10/7', 'D-2'],
      ['PO-003', '10/8', 'D-3'],
      ['PO-002', '10/9', 'D-4'],
    ]);
  });

  it('지연 위험 배지는 PO-001에만 (§9.5)', () => {
    const risky = openPos(purchaseOrders)
      .filter((po) => gradeOf(supplierOf(po.supplierName)!.onTimeRate) === '위험')
      .map((po) => po.id);
    expect(risky).toEqual(['PO-001']);
  });

  it('부품 카드의 다음 입고', () => {
    expect(nextArrivalOf('P007', purchaseOrders)?.qty).toBe(400);
    expect(nextArrivalOf('P004', purchaseOrders)?.qty).toBe(1400);
    expect(nextArrivalOf('P024', purchaseOrders)).toBeNull();
  });

  it('생산 예측: 10/7부터 매일 20대, 정지일 0', () => {
    const { normal, wait } = baseScenarios(state);
    const cum = wait.sim.cumulative;
    expect(cum[0].date).toBe(D('10/5'));
    expect(cum[cum.length - 1].date).toBe(D('10/27'));
    expect(cumAt(cum, D('10/6'))).toBe(0);
    expect(cumAt(cum, D('10/7'))).toBe(20);
    expect(cumAt(cum, D('10/12'))).toBe(120);
    expect(cumAt(cum, D('10/17'))).toBe(220);
    expect(cumAt(cum, D('10/19'))).toBe(260);
    expect(cumAt(cum, D('10/27'))).toBe(420);
    expect(wait.lineStopDays).toBe(0);
    expect(wait.loss).toBe(0);
    expect(normal.sim.totalInput).toBe(420);
    expect(wait.sim.days.every((d) => d.input === 20 && d.kind === '정상')).toBe(true);
  });

  it('주문 3건 모두 충족 (여유 1일)', () => {
    const { wait } = baseScenarios(state);
    expect(doneDates(wait)).toEqual({ 'CO-001': D('10/9'), 'CO-002': D('10/13'), 'CO-003': D('10/17') });
    expect(lateDays(wait)).toEqual({ 'CO-001': -1, 'CO-002': -1, 'CO-003': -1 });
    expect(wait.lateOrders).toHaveLength(0);
  });

  it('정상 계획의 남는 재고', () => {
    const { normal } = baseScenarios(state);
    expect(normal.sim.endStock.P004).toBe(80);
    expect(normal.sim.endStock.P007).toBe(40);
    expect(normal.sim.endStock.P010).toBe(20);
  });
});

describe('F1-2 부품 발주', () => {
  it('배터리 100개를 대성메탈에 발주하면 10/10 도착, 입고 예정 포함 440대', () => {
    const state = demoState();
    const po = buildPurchaseOrder({
      existing: state.purchaseOrders,
      partCode: 'P013',
      supplier: supplierOf('대성메탈')!,
      qty: 100,
      baseDate: state.settings.baseDate,
      kind: '일반',
      createdBy: '테스트',
    });
    expect(po.id).toBe('PO-004');
    expect(po.orderDate).toBe(D('10/5'));
    expect(po.expectedArrival).toBe(D('10/10'));
    expect(po.plannedArrival).toBe(po.expectedArrival);
    expect(ddayLabel(diffDays(po.expectedArrival, state.settings.baseDate))).toBe('D-5');
    expect(po.originalQty).toBe(100);
    expect(po.status).toBe('입고대기');

    const pos = [...state.purchaseOrders, po];
    expect(buildable(state.lineParts, stockWithIncoming(state.lineParts, pos))).toBe(440);
  });

  it('ID는 기존 최대 번호 + 1', () => {
    expect(nextId('PO-', ['PO-001', 'PO-003'])).toBe('PO-004');
    expect(nextId('D-', [])).toBe('D-001');
  });

  it('발주 모달 업체 목록: 그 부품의 주요자재를 공급하는 정상 업체', () => {
    const names = suppliersFor(partOf('P007').materialName, reference.suppliers).map((s) => s.name);
    expect(names).toContain('한빛오토텍');
    expect(names).toHaveLength(15); // 대체 후보 14곳 + 기본 업체
  });
});

describe('§9.2 차질 사례', () => {
  it('사례 버튼 프리셋 (§5 F2-1)', () => {
    const c1 = registerCase('사례1');
    const c2 = registerCase('사례2');
    const c3 = registerCase('사례3');
    expect([c1.part.code, c1.disruption.supplierName, c1.disruption.materialName, c1.disruption.delayDays]).toEqual([
      'P004', '태성모터스', '철강 소재', 7,
    ]);
    expect([c2.part.code, c2.disruption.supplierName, c2.disruption.materialName, c2.disruption.delayDays]).toEqual([
      'P007', '한빛오토텍', '알루미늄 소재', 5,
    ]);
    expect([c3.part.code, c3.disruption.supplierName, c3.disruption.materialName, c3.disruption.delayDays]).toEqual([
      'P010', '세진정밀', '합금강 소재', 6,
    ]);
    expect(c2.disruption.id).toBe('D-001');
    expect(c2.disruption.status).toBe('발생');
    expect(c2.disruption.detectedDate).toBe(D('10/5'));
  });

  it('입고 예정 발주가 없는 부품은 차질을 등록할 수 없다', () => {
    const state = demoState();
    expect(() =>
      buildDisruption({
        state,
        part: partOf('P024'),
        supplierName: '태성모터스',
        reason: '납품 지연',
        delayDays: 3,
        createdBy: null,
      }),
    ).toThrow(NO_OPEN_PO_MESSAGE);
  });

  describe('사례1: 태성모터스 · 철강 · 7일 → 서스펜션', () => {
    const c = registerCase('사례1');
    const { wait } = baseScenarios(c.state);

    it('영향 발주 PO-002 10/9 → 10/16', () => {
      const po = c.state.purchaseOrders.find((p) => p.id === 'PO-002')!;
      expect(po.plannedArrival).toBe(D('10/9'));
      expect(po.expectedArrival).toBe(D('10/16'));
      expect(po.status).toBe('지연');
      expect(po.disruptionId).toBe('D-001');
      // 다른 발주는 그대로
      expect(c.state.purchaseOrders.filter((p) => p.status === '지연')).toHaveLength(1);
    });

    it('기다리기: 10/9 감산(10대) + 10/10~10/15 정지 6일, 손실 130대', () => {
      expect(wait.reducedDates).toEqual([D('10/9')]);
      expect(wait.sim.days.find((d) => d.date === D('10/9'))?.input).toBe(10);
      expect(wait.stopDates).toEqual([D('10/10'), D('10/11'), D('10/12'), D('10/13'), D('10/14'), D('10/15')]);
      expect(wait.sim.days.filter((d) => d.kind !== '정상').every((d) => d.bottleneck === 'P004')).toBe(true);
      expect(wait.sim.totalInput).toBe(290);
      expect(wait.loss).toBe(130);
      expect(stopSummary(wait)).toBe('7일(정지 10/10~10/15 · 감산 10/9)');
      expect(stopBreakdown(wait)).toBe('정지 6일 + 감산 1일');
    });

    it('기다리기: CO-001 충족, CO-002 10/20(6일), CO-003 10/24(6일)', () => {
      expect(doneDates(wait)).toEqual({ 'CO-001': D('10/9'), 'CO-002': D('10/20'), 'CO-003': D('10/24') });
      expect(lateDays(wait)).toEqual({ 'CO-001': -1, 'CO-002': 6, 'CO-003': 6 });
    });

    it('추천 수량: 유지·감량 560, 취소 1,400', () => {
      const delayed = delayedQtyOf(c.state.purchaseOrders, c.disruption.id);
      const cover = coverQty(c.disruption.delayDays, c.state.settings.dailyCapacity, c.linePart.qtyPerCar, delayed);
      expect(cover).toBe(560);
      expect(recommendedQty('유지', cover, delayed)).toBe(560);
      expect(recommendedQty('감량', cover, delayed)).toBe(560);
      expect(recommendedQty('취소', cover, delayed)).toBe(1400);
    });

    it('대체 후보 22곳 (위험 3), 1·2·3순위', () => {
      const rec = recommendFor(c, 560);
      expect(rec.total).toBe(22);
      expect(rec.total).toBe(c.preset.compareCount);
      expect(rec.riskCount).toBe(3);
      expect(
        rec.ranked.filter((x) => x.grade === '위험').map((x) => [x.name, x.onTimeRate]).sort(),
      ).toEqual([['삼우정밀', 74], ['신성기공', 65], ['에이스메탈', 72]]);
      expect(rec.ranked.slice(0, 3).map((x) => [x.name, x.code, x.altLeadDays, x.onTimeRate])).toEqual([
        ['진우기공', 'S041', 2, 97],
        ['대림정공', 'S013', 2, 94],
        ['광성정밀', 'S021', 2, 91],
      ]);
      expect(rec.ranked[0].requiredKg).toBe(1680);
      expect(rec.ranked[0].monthlyCapacityKg).toBe(5040);
      expect(rec.ranked[0].capacityOk).toBe(true);
      expect(rec.ranked[0].arrival).toBe(D('10/7'));
    });

    it('대체(1순위, 유지): 정지 0 · 손실 0 · 10/17 완료 · 지연 0건', () => {
      const alt = runAlt(c, '진우기공', '유지', 560);
      expect(alt.lineStopDays).toBe(0);
      expect(alt.loss).toBe(0);
      expect(alt.allDoneDate).toBe(D('10/17'));
      expect(alt.lateOrders).toHaveLength(0);
    });

    it('남는 서스펜션: 정상 80 / 기다리기 600 / 유지 640 / 감량 80 / 취소 80', () => {
      const { normal } = baseScenarios(c.state);
      expect(normal.sim.endStock.P004).toBe(80);
      expect(wait.sim.endStock.P004).toBe(600);
      expect(runAlt(c, '진우기공', '유지', 560).sim.endStock.P004).toBe(640);
      expect(runAlt(c, '진우기공', '감량', 560).sim.endStock.P004).toBe(80);
      expect(runAlt(c, '진우기공', '취소', 1400).sim.endStock.P004).toBe(80);
    });

    it('자재 평균 대체 납기 3.7일', () => {
      expect(materialOf('철강 소재')?.altAvgLeadDays).toBe(3.7);
    });
  });

  describe('사례2: 한빛오토텍 · 알루미늄 · 5일 → 엔진', () => {
    const c = registerCase('사례2');
    const { wait } = baseScenarios(c.state);

    it('영향 발주 PO-001 10/7 → 10/12, 엔진 카드 차질', () => {
      const po = c.state.purchaseOrders.find((p) => p.id === 'PO-001')!;
      expect(po.expectedArrival).toBe(D('10/12'));
      expect(po.plannedArrival).toBe(D('10/7'));
      expect(po.status).toBe('지연');
      expect(diffDays(po.expectedArrival, po.plannedArrival)).toBe(5);
      expect(partStatusOf(c.linePart, c.state.disruptions, c.state.settings.dailyCapacity)).toBe('차질');
    });

    it('기다리기: 10/8~10/11 정지 4일, 손실 80대', () => {
      expect(wait.stopDates).toEqual([D('10/8'), D('10/9'), D('10/10'), D('10/11')]);
      expect(wait.reducedDates).toEqual([]);
      expect(wait.sim.totalInput).toBe(340);
      expect(wait.loss).toBe(80);
      expect(stopSummary(wait)).toBe('4일(10/8~10/11)');
      expect(stopBreakdown(wait)).toBeNull();
    });

    it('기다리기: CO-001 충족, CO-002 10/17(3일), CO-003 10/21(3일)', () => {
      expect(doneDates(wait)).toEqual({ 'CO-001': D('10/9'), 'CO-002': D('10/17'), 'CO-003': D('10/21') });
      expect(lateDays(wait)).toEqual({ 'CO-001': -1, 'CO-002': 3, 'CO-003': 3 });
      expect(wait.allDoneDate).toBe(D('10/21'));
    });

    it('추천 수량: 유지·감량 100, 취소 400', () => {
      const delayed = delayedQtyOf(c.state.purchaseOrders, c.disruption.id);
      const cover = coverQty(c.disruption.delayDays, c.state.settings.dailyCapacity, c.linePart.qtyPerCar, delayed);
      expect(cover).toBe(100);
      expect(recommendedQty('취소', cover, delayed)).toBe(400);
    });

    it('대체 후보 14곳 (위험 2), 1순위 진성오토텍 — 에이스메탈은 후순위', () => {
      const rec = recommendFor(c, 100);
      expect(rec.total).toBe(14);
      expect(rec.total).toBe(c.preset.compareCount);
      expect(rec.riskCount).toBe(2);
      expect(rec.ranked.slice(0, 3).map((x) => [x.name, x.code, x.altLeadDays, x.onTimeRate])).toEqual([
        ['진성오토텍', 'S017', 2, 96],
        ['동진오토', 'S009', 2, 88],
        ['세광소재', 'S015', 4, 97],
      ]);
      expect(rec.ranked[0].requiredKg).toBe(150);
      expect(rec.ranked[0].monthlyCapacityKg).toBe(3696);
      expect(rec.ranked[0].arrival).toBe(D('10/7'));
      // 위험 업체는 맨 뒤 2곳
      expect(rec.ranked.slice(-2).map((x) => [x.name, x.onTimeRate])).toEqual([
        ['에이스메탈', 72],
        ['대경오토', 79],
      ]);
    });

    it('대체(1순위, 유지): 정지 0 · 손실 0 · 10/17 완료 · 지연 0건', () => {
      const alt = runAlt(c, '진성오토텍', '유지', 100);
      expect(alt.lineStopDays).toBe(0);
      expect(alt.loss).toBe(0);
      expect(alt.allDoneDate).toBe(D('10/17'));
      expect(alt.lateOrders).toHaveLength(0);
      expect(doneDates(alt)).toEqual({ 'CO-001': D('10/9'), 'CO-002': D('10/13'), 'CO-003': D('10/17') });
    });

    it('남는 엔진: 정상 40 / 기다리기 120 / 유지 140 / 감량 40 / 취소 40', () => {
      const { normal } = baseScenarios(c.state);
      expect(normal.sim.endStock.P007).toBe(40);
      expect(wait.sim.endStock.P007).toBe(120);
      expect(runAlt(c, '진성오토텍', '유지', 100).sim.endStock.P007).toBe(140);
      expect(runAlt(c, '진성오토텍', '감량', 100).sim.endStock.P007).toBe(40);
      expect(runAlt(c, '진성오토텍', '취소', 400).sim.endStock.P007).toBe(40);
    });

    it('자재 평균 대체 납기 4.3일', () => {
      expect(materialOf('알루미늄 소재')?.altAvgLeadDays).toBe(4.3);
    });

    it('문구 T1 ~ T5 (§6.10)', () => {
      const rec = recommendFor(c, 100);
      const alt = runAlt(c, '진성오토텍', '유지', 100);
      expect(disruptionMessage(c.disruption, c.part)).toBe(
        '한빛오토텍에 엔진(P007) 부품 문제가 생겨 5일 지연될 예정입니다.',
      );
      expect(impactMessage(wait)).toBe(
        '이대로 기다리면 라인 정지 4일(10/8~10/11) · 생산 손실 80대 · 납기 지연 주문 2건 (CO-002 3일, CO-003 3일)',
      );
      expect(recommendMessage(c.part, c.disruption.supplierName, rec.ranked[0])).toBe(
        '엔진 납품이 한빛오토텍에서 불가능하니, 진성오토텍에서 동일 사양 엔진을 2일 내(10/7) 공급받을 수 있습니다.',
      );
      expect(resultMessage({ part: c.part, candidate: rec.ranked[0], qty: 100, action: '유지', alt })).toBe(
        '진성오토텍에서 엔진 100개를 10/7까지 받으면, 주문 자동차 220대를 10/17까지 생산할 수 있습니다. (라인 정지 0일, 납기 지연 주문 0건, 원래 발주 유지)',
      );
      const notices = customerNotices(wait, c.part);
      expect(notices.map((n) => n.orderId)).toEqual(['CO-002', 'CO-003']);
      expect(notices[0].text).toBe(
        '[온길모빌리티] 주문 CO-002(80대)의 예상 납품일이 10/14에서 10/17로 3일 늦어질 예정입니다. 사유: 엔진 부품 공급 지연. 불편을 드려 죄송합니다.',
      );
    });
  });

  describe('사례3: 세진정밀 · 합금강 · 6일 → 조향', () => {
    const c = registerCase('사례3');
    const { wait } = baseScenarios(c.state);

    it('영향 발주 PO-003 10/8 → 10/14', () => {
      const po = c.state.purchaseOrders.find((p) => p.id === 'PO-003')!;
      expect(po.expectedArrival).toBe(D('10/14'));
      expect(po.status).toBe('지연');
    });

    it('기다리기: 10/10~10/13 정지 4일, 손실 80대', () => {
      expect(wait.stopDates).toEqual([D('10/10'), D('10/11'), D('10/12'), D('10/13')]);
      expect(wait.reducedDates).toEqual([]);
      expect(wait.sim.totalInput).toBe(340);
      expect(wait.loss).toBe(80);
    });

    it('기다리기: CO-001 충족, CO-002 10/17(3일), CO-003 10/21(3일)', () => {
      expect(doneDates(wait)).toEqual({ 'CO-001': D('10/9'), 'CO-002': D('10/17'), 'CO-003': D('10/21') });
      expect(lateDays(wait)).toEqual({ 'CO-001': -1, 'CO-002': 3, 'CO-003': 3 });
    });

    it('추천 수량: 유지·감량 120, 취소 340', () => {
      const delayed = delayedQtyOf(c.state.purchaseOrders, c.disruption.id);
      const cover = coverQty(c.disruption.delayDays, c.state.settings.dailyCapacity, c.linePart.qtyPerCar, delayed);
      expect(cover).toBe(120);
      expect(recommendedQty('취소', cover, delayed)).toBe(340);
    });

    it('대체 후보 12곳 (위험 2), 1·2·3순위', () => {
      const rec = recommendFor(c, 120);
      expect(rec.total).toBe(12);
      expect(rec.total).toBe(c.preset.compareCount);
      expect(rec.riskCount).toBe(2);
      expect(
        rec.ranked.filter((x) => x.grade === '위험').map((x) => [x.name, x.onTimeRate]).sort(),
      ).toEqual([['대경오토', 79], ['동성오토', 77]]);
      expect(rec.ranked.slice(0, 3).map((x) => [x.name, x.code, x.altLeadDays, x.onTimeRate])).toEqual([
        ['대림정공', 'S013', 2, 94],
        ['광성정밀', 'S021', 2, 91],
        ['대원소재', 'S037', 2, 89],
      ]);
      expect(rec.ranked[0].requiredKg).toBeCloseTo(264);
      expect(rec.ranked[0].monthlyCapacityKg).toBe(4972);
      expect(rec.ranked[0].arrival).toBe(D('10/7'));
    });

    it('대체(1순위, 유지): 정지 0 · 손실 0 · 10/17 완료 · 지연 0건', () => {
      const alt = runAlt(c, '대림정공', '유지', 120);
      expect(alt.lineStopDays).toBe(0);
      expect(alt.loss).toBe(0);
      expect(alt.allDoneDate).toBe(D('10/17'));
      expect(alt.lateOrders).toHaveLength(0);
    });

    it('남는 조향: 정상 20 / 기다리기 100 / 유지 140 / 감량 20 / 취소 20', () => {
      const { normal } = baseScenarios(c.state);
      expect(normal.sim.endStock.P010).toBe(20);
      expect(wait.sim.endStock.P010).toBe(100);
      expect(runAlt(c, '대림정공', '유지', 120).sim.endStock.P010).toBe(140);
      expect(runAlt(c, '대림정공', '감량', 120).sim.endStock.P010).toBe(20);
      expect(runAlt(c, '대림정공', '취소', 340).sim.endStock.P010).toBe(20);
    });

    it('자재 평균 대체 납기 4.5일', () => {
      expect(materialOf('합금강 소재')?.altAvgLeadDays).toBe(4.5);
    });
  });
});

describe('§9.3 느린 업체를 고른 경우 (사례2 · 세광소재 · 유지 · 100)', () => {
  const c = registerCase('사례2');
  const alt = runAlt(c, '세광소재', '유지', 100);

  it('10/8 정지 1일, 손실 20대', () => {
    expect(alt.stopDates).toEqual([D('10/8')]);
    expect(alt.lineStopDays).toBe(1);
    expect(alt.loss).toBe(20);
  });

  it('납기 당일 완료는 지연이 아니다 (여유 0일)', () => {
    expect(doneDates(alt)).toMatchObject({ 'CO-002': D('10/14'), 'CO-003': D('10/18') });
    expect(lateDays(alt)).toMatchObject({ 'CO-002': 0, 'CO-003': 0 });
    expect(alt.lateOrders).toHaveLength(0);
  });

  it('남는 엔진 160개', () => {
    expect(alt.sim.endStock.P007).toBe(160);
  });
});

describe('§9.4 원래 발주 처리 옵션 (사례2 · 진성오토텍)', () => {
  const c = registerCase('사례2');
  const po001 = (state: AppState) => state.purchaseOrders.find((p) => p.id === 'PO-001')!;

  it('유지: PO-001 그대로, 남는 엔진 140', () => {
    const after = applyOriginalPoAction(c.state.purchaseOrders, c.disruption.id, '유지', 100);
    expect(after).toBe(c.state.purchaseOrders);
    const alt = runAlt(c, '진성오토텍', '유지', 100);
    expect([alt.lineStopDays, alt.loss, alt.allDoneDate, alt.sim.endStock.P007]).toEqual([0, 0, D('10/17'), 140]);
  });

  it('감량: PO-001 300개(원래 400), 남는 엔진 40', () => {
    const after = applyOriginalPoAction(c.state.purchaseOrders, c.disruption.id, '감량', 100);
    const po = after.find((p) => p.id === 'PO-001')!;
    expect([po.qty, po.originalQty, po.status, po.expectedArrival]).toEqual([300, 400, '지연', D('10/12')]);
    expect(po001(c.state).qty).toBe(400); // 원본은 바꾸지 않는다
    const alt = runAlt(c, '진성오토텍', '감량', 100);
    expect([alt.lineStopDays, alt.loss, alt.allDoneDate, alt.sim.endStock.P007]).toEqual([0, 0, D('10/17'), 40]);
  });

  it('감량: 대체 수량이 발주 수량 이상이면 취소 상태가 된다', () => {
    const after = applyOriginalPoAction(c.state.purchaseOrders, c.disruption.id, '감량', 400);
    const po = after.find((p) => p.id === 'PO-001')!;
    expect([po.qty, po.status]).toEqual([0, '취소']);
  });

  it('취소: PO-001 취소, 대체 400, 남는 엔진 40', () => {
    const after = applyOriginalPoAction(c.state.purchaseOrders, c.disruption.id, '취소', 400);
    expect(after.find((p) => p.id === 'PO-001')!.status).toBe('취소');
    const alt = runAlt(c, '진성오토텍', '취소', 400);
    expect([alt.lineStopDays, alt.loss, alt.allDoneDate, alt.sim.endStock.P007]).toEqual([0, 0, D('10/17'), 40]);
  });

  it('취소 + 수량 100 (잘못된 선택): 10/13~10/25 정지 13일, 손실 260, CO-003 미완료', () => {
    const alt = runAlt(c, '진성오토텍', '취소', 100);
    expect(alt.stopDates[0]).toBe(D('10/13')); // 경고 문구의 날짜
    expect(alt.stopDates[alt.stopDates.length - 1]).toBe(D('10/25'));
    expect(alt.stopDates).toHaveLength(13);
    expect(alt.loss).toBe(260);
    expect(doneDates(alt)).toMatchObject({ 'CO-002': D('10/13'), 'CO-003': null });
    expect(lateDays(alt)).toMatchObject({ 'CO-002': -1, 'CO-003': null });
    expect(alt.allDoneDate).toBeNull();
    expect(alt.sim.endStock.P007).toBe(0);
    const rec = recommendFor(c, 100);
    expect(resultMessage({ part: c.part, candidate: rec.ranked[0], qty: 100, action: '취소', alt })).toBe(
      '진성오토텍에서 엔진 100개를 10/7까지 받으면, 주문 자동차 220대 중 160대만 10/27까지 생산할 수 있습니다. (라인 정지 13일, 납기 지연 주문 1건, 원래 발주 취소)',
    );
  });

  it('확정 저장 내용 (§5 F2-4): PO-004 대체 · 진성오토텍 · 100 · 10/7', () => {
    const built = buildAlternative({
      state: c.state,
      disruption: c.disruption,
      supplier: supplierOf('진성오토텍')!,
      qty: 100,
      action: '감량',
      createdBy: '테스트',
    });
    expect([built.altPo.id, built.altPo.kind, built.altPo.supplierName, built.altPo.qty]).toEqual([
      'PO-004', '대체', '진성오토텍', 100,
    ]);
    expect(built.altPo.expectedArrival).toBe(D('10/7'));
    expect(built.altPo.disruptionId).toBe('D-001');
    expect(built.changedOriginals.map((p) => [p.id, p.qty, p.status])).toEqual([['PO-001', 300, '지연']]);
    expect(built.disruption).toMatchObject({
      status: '대체발주',
      altSupplierName: '진성오토텍',
      altQty: 100,
      altPoId: 'PO-004',
      originalPoAction: '감량',
    });

    // 확정 후 대시보드: 주문이 모두 충족으로 돌아오고 엔진 카드는 '대응 중'
    const after: AppState = {
      ...c.state,
      purchaseOrders: [
        ...c.state.purchaseOrders.map((p) => built.changedOriginals.find((x) => x.id === p.id) ?? p),
        built.altPo,
      ],
      disruptions: [built.disruption],
    };
    const { wait } = baseScenarios(after);
    expect(doneDates(wait)).toEqual({ 'CO-001': D('10/9'), 'CO-002': D('10/13'), 'CO-003': D('10/17') });
    expect(wait.lateOrders).toHaveLength(0);
    expect(partStatusOf(c.linePart, after.disruptions, after.settings.dailyCapacity)).toBe('대응 중');
  });
});

describe('§9.5 위험 업체 (납기 준수율)', () => {
  it('사례2 · 에이스메탈(72% 위험) · 유지 · 100: 예정대로 오면 1순위와 같다', () => {
    const c = registerCase('사례2');
    const alt = runAlt(c, '에이스메탈', '유지', 100);
    expect([alt.lineStopDays, alt.loss, alt.allDoneDate]).toEqual([0, 0, D('10/17')]);
  });

  it('사례2 · 에이스메탈이 2일 늦게(10/9) 오면: 10/8 정지 1일, 손실 20대, 당일 충족', () => {
    const c = registerCase('사례2');
    const late = runAlt(c, '에이스메탈', '유지', 100, RISK_LATE_DAYS);
    expect(late.stopDates).toEqual([D('10/8')]);
    expect(late.loss).toBe(20);
    expect(doneDates(late)).toMatchObject({ 'CO-002': D('10/14'), 'CO-003': D('10/18') });
    expect(late.lateOrders).toHaveLength(0);
    expect(late.sim.endStock.P007).toBe(160);
    const candidate = recommendFor(c, 100).ranked.find((x) => x.name === '에이스메탈')!;
    expect(candidate.grade).toBe('위험');
    expect(riskLateMessage(candidate, late)).toBe(
      '에이스메탈(준수율 72% 위험)가 2일 늦게 오면: 라인 정지 1일(10/8), 손실 20대, 납기 지연 주문 0건',
    );
  });

  it('사례3 · 대경오토(79%, 대체 6일)가 2일 늦으면(10/13): 정지 3일, 손실 60, 2일 지연', () => {
    const c = registerCase('사례3');
    const supplier = supplierOf('대경오토')!;
    expect(supplier.altLeadDays).toBe(6);
    expect(addDays(c.state.settings.baseDate, supplier.altLeadDays + RISK_LATE_DAYS)).toBe(D('10/13'));
    const late = runAlt(c, '대경오토', '유지', 120, RISK_LATE_DAYS);
    expect(late.stopDates).toEqual([D('10/10'), D('10/11'), D('10/12')]);
    expect(late.loss).toBe(60);
    expect(doneDates(late)).toMatchObject({ 'CO-002': D('10/16'), 'CO-003': D('10/20') });
    expect(lateDays(late)).toMatchObject({ 'CO-002': 2, 'CO-003': 2 });
  });
});
