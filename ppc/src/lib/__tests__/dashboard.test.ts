// 대시보드 '완료 확인' 값 (DESIGN.md §5 F1-1 ~ F1-5, §11)
import { describe, expect, it } from 'vitest';
import { buildDisruption, withDisruption } from '../actions';
import { dashboardModel } from '../dashboard';
import { formatMD } from '../date';
import { ddayLabel } from '../format';
import { demoState, partOf } from '../reference';

describe('초기 대시보드', () => {
  const model = dashboardModel(demoState());
  const card = (code: string) => model.parts.find((p) => p.part.code === code)!;

  it('KPI 60 / 430 / 20 / 0', () => {
    expect(model.kpi.buildableNow).toBe(60);
    expect(model.kpi.bottleneckNow?.name).toBe('엔진');
    expect(model.kpi.buildableIncoming).toBe(430);
    expect(model.kpi.bottleneckIncoming?.name).toBe('배터리');
    expect([model.kpi.todayInput, model.kpi.dailyCapacity]).toEqual([20, 20]);
    expect(model.kpi.activeDisruptions).toBe(0);
  });

  it('엔진 카드 = 60개 · ×1 · 60대 · 3.0일 · 주의 · 병목 · D-2 +400', () => {
    const engine = card('P007');
    expect([engine.linePart.onHand, engine.linePart.qtyPerCar, engine.cars, engine.coverage.toFixed(1)]).toEqual([60, 1, 60, '3.0']);
    expect([engine.status, engine.isBottleneck]).toEqual(['주의', true]);
    expect([ddayLabel(engine.nextDday!), engine.nextPo?.qty]).toEqual(['D-2', 400]);
  });

  it('서스펜션 카드 = 360개 · ×4 · 90대 · 4.5일 · 주의 · D-4 +1,400', () => {
    const s = card('P004');
    expect([s.linePart.onHand, s.linePart.qtyPerCar, s.cars, s.coverage.toFixed(1)]).toEqual([360, 4, 90, '4.5']);
    expect([s.status, s.isBottleneck]).toEqual(['주의', false]);
    expect([ddayLabel(s.nextDday!), s.nextPo?.qty]).toEqual(['D-4', 1400]);
  });

  it('조향 카드 = 100개 · 100대 · 5.0일 · 정상', () => {
    const s = card('P010');
    expect([s.linePart.onHand, s.cars, s.coverage.toFixed(1), s.status]).toEqual([100, 100, '5.0', '정상']);
  });

  it('병목 태그는 한 부품에만', () => {
    expect(model.parts.filter((p) => p.isBottleneck).map((p) => p.part.name)).toEqual(['엔진']);
  });

  it('입고 예정 표: PO-001 → PO-003 → PO-002, 지연 위험은 PO-001에만', () => {
    expect(model.poRows.map((r) => [r.po.id, formatMD(r.po.expectedArrival), ddayLabel(r.dday), r.atRisk])).toEqual([
      ['PO-001', '10/7', 'D-2', true],
      ['PO-003', '10/8', 'D-3', false],
      ['PO-002', '10/9', 'D-4', false],
    ]);
    expect(model.poRows[0].onTimeRate).toBe(76);
  });

  it('생산 예측 요약: 2일 뒤(10/7) 20대 · 7일 뒤(10/12) 120대 · 14일 뒤(10/19) 260대', () => {
    expect(model.forecastPoints.map((p) => [p.offset, formatMD(p.date), p.cum])).toEqual([
      [2, '10/7', 20],
      [7, '10/12', 120],
      [14, '10/19', 260],
    ]);
  });
});

describe('사례2 등록 후 대시보드', () => {
  const state = demoState();
  const after = withDisruption(
    state,
    buildDisruption({ state, part: partOf('P007'), supplierName: '한빛오토텍', reason: '납품 지연', delayDays: 5, createdBy: null }),
  );
  const model = dashboardModel(after);

  it('엔진 카드가 차질로 바뀌고 배너에 뜬다', () => {
    const engine = model.parts.find((p) => p.part.code === 'P007')!;
    expect(engine.status).toBe('차질');
    expect(engine.activeDisruption?.id).toBe('D-001');
    expect(model.kpi.activeDisruptions).toBe(1);
    expect(model.activeDisruptions.map((d) => d.id)).toEqual(['D-001']);
  });

  it('PO-001은 지연 +5일로 맨 뒤로 가고, 지연 위험 배지는 사라진다', () => {
    const row = model.poRows[model.poRows.length - 1];
    expect([row.po.id, formatMD(row.po.expectedArrival), row.delayedBy, row.po.status, row.atRisk]).toEqual([
      'PO-001', '10/12', 5, '지연', false,
    ]);
  });

  it('주문 납기 현황에 지연이 반영된다', () => {
    expect(model.scenarios.wait.orders.map((o) => [o.id, o.lateDays])).toEqual([
      ['CO-001', -1],
      ['CO-002', 3],
      ['CO-003', 3],
    ]);
  });
});
