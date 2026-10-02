// 대시보드가 보여 줄 값을 DB 상태에서 계산한다 (DESIGN.md §5 F1-1 ~ F1-5). 순수 함수.
import { baseScenarios, type BaseScenarios } from './actions';
import { addDays, diffDays } from './date';
import {
  bottleneckOf,
  buildable,
  carsFromGroup,
  carsFromPart,
  coverageDays,
  cumAt,
  displayStatusOf,
  groupCoverageDays,
  nextArrivalOf,
  openPos,
  partGroups,
  partStatusOf,
  sortByArrival,
  stockOnHand,
  stockWithIncoming,
  type PartStatus,
  type PoDisplayStatus,
} from './planning';
import { poAmount } from './ordering';
import { gradeOf } from './recommend';
import { demoState, partOf, supplierOf } from './reference';
import { productionParts, repairNeedByPart } from './repairs';
import type { AppState, Disruption, ISODate, LinePart, Part, PurchaseOrder, RateGrade } from './types';

export interface PartRow {
  /** DB의 재고 그대로 (수리용 포함) */
  linePart: LinePart;
  part: Part;
  /** 수리 중인 차량에 써야 하는 수량 */
  repairNeed: number;
  /** 생산에 쓸 수 있는 재고 = 현재 재고 − 수리용. 가능 대수·재고 일수는 이 값으로 계산한다 */
  available: number;
  /** 이 부품으로 만들 수 있는 대수 */
  cars: number;
  coverage: number;
  status: PartStatus;
  isBottleneck: boolean;
  nextPo: PurchaseOrder | null;
  nextDday: number | null;
  /** 이 부품의 해결되지 않은 차질 (가장 최근 것) */
  activeDisruption: Disruption | null;
  /** 색상별 차체처럼 묶음일 때: 색상별 행. 이 행 자체는 묶음 합계다 */
  variants?: PartRow[];
}

export interface PoRow {
  po: PurchaseOrder;
  part: Part;
  /** 화면에 보여 줄 상태. 발주한 당일의 일반 발주는 어느 화면에서나 '발주대기'다 */
  displayStatus: PoDisplayStatus;
  dday: number;
  /** expectedArrival - plannedArrival */
  delayedBy: number;
  onTimeRate: number | null;
  grade: RateGrade | null;
  /** 아직 지연되지 않았지만 업체 등급이 '위험' */
  atRisk: boolean;
  /** 이 발주에 쓴 돈(원) */
  amount: number;
}

export interface ForecastPoint {
  offset: number;
  date: ISODate;
  cum: number;
}

export interface DashboardModel {
  parts: PartRow[];
  kpi: {
    buildableNow: number;
    bottleneckNow: Part | null;
    buildableIncoming: number;
    bottleneckIncoming: Part | null;
    todayInput: number;
    dailyCapacity: number;
    activeDisruptions: number;
    /** 진행 중 차질을 대응 상태로 나눈 건수 */
    disruptionCounts: {
      /** 아직 결정하지 않은 차질 (상태 '발생') */
      pending: number;
      /** 대체 발주로 대응 중 (상태 '대체발주') */
      responding: number;
      /** 대응하지 않기로 한 차질 (상태 '기다리기') */
      waiting: number;
    };
  };
  poRows: PoRow[];
  scenarios: BaseScenarios;
  forecastPoints: ForecastPoint[];
  activeDisruptions: Disruption[];
}

export function poRowOf(po: PurchaseOrder, baseDate: ISODate): PoRow {
  const supplier = supplierOf(po.supplierName);
  const grade = supplier ? gradeOf(supplier.onTimeRate) : null;
  return {
    po,
    part: partOf(po.partCode),
    displayStatus: displayStatusOf(po, baseDate),
    dday: diffDays(po.expectedArrival, baseDate),
    delayedBy: diffDays(po.expectedArrival, po.plannedArrival),
    onTimeRate: supplier?.onTimeRate ?? null,
    grade,
    atRisk: po.status === '입고대기' && grade === '위험',
    amount: poAmount(po),
  };
}

export function dashboardModel(state: AppState): DashboardModel {
  const { settings, purchaseOrders, disruptions } = state;
  // 생산 가능 대수와 재고 일수는 수리용으로 잡아 둔 수량을 뺀 재고로 계산한다
  const lineParts = productionParts(state.lineParts);
  const rawByCode = new Map(state.lineParts.map((p) => [p.partCode, p]));
  const repairNeed = repairNeedByPart();
  const onHand = stockOnHand(lineParts);
  const incoming = stockWithIncoming(lineParts, purchaseOrders);
  const bottleneckNow = bottleneckOf(lineParts, onHand);
  const bottleneckIncoming = bottleneckOf(lineParts, incoming);
  const buildableNow = buildable(lineParts, onHand);
  const activeDisruptions = disruptions.filter((d) => d.status !== '해결');

  /** prod: 생산용 재고 기준의 부품 행 */
  const rowOf = (prod: LinePart, groupCoverage?: number): PartRow => {
    const nextPo = nextArrivalOf(prod.partCode, purchaseOrders);
    return {
      linePart: rawByCode.get(prod.partCode) ?? prod,
      part: partOf(prod.partCode),
      repairNeed: repairNeed[prod.partCode] ?? 0,
      available: prod.onHand,
      cars: carsFromPart(prod, onHand),
      coverage: coverageDays(prod, settings.dailyCapacity),
      status: partStatusOf(prod, disruptions, settings.dailyCapacity, groupCoverage),
      isBottleneck: bottleneckNow?.partCode === prod.partCode,
      nextPo,
      nextDday: nextPo ? diffDays(nextPo.expectedArrival, settings.baseDate) : null,
      activeDisruption: [...activeDisruptions].reverse().find((d) => d.partCode === prod.partCode) ?? null,
    };
  };

  // 카드는 요구 단위마다 하나. 색상별 차체는 합계 행 하나에 색상별 행을 달아 준다
  const STATUS_RANK: PartStatus[] = ['차질', '대응 중', '주의', '정상'];
  const parts = partGroups(lineParts).map((group): PartRow => {
    if (group.parts.length === 1 && group.parts[0].partCode === group.code) return rowOf(group.parts[0]);
    const coverage = groupCoverageDays(group, settings.dailyCapacity);
    const variants = group.parts.map((p) => rowOf(p, coverage));
    const next = variants
      .filter((v) => v.nextPo)
      .sort((a, b) => (a.nextPo!.expectedArrival < b.nextPo!.expectedArrival ? -1 : 1))[0];
    return {
      linePart: {
        partCode: group.code,
        qtyPerCar: 1,
        onHand: variants.reduce((sum, v) => sum + v.linePart.onHand, 0),
        sortOrder: group.parts[0].sortOrder,
      },
      part: partOf(group.code),
      repairNeed: variants.reduce((sum, v) => sum + v.repairNeed, 0),
      available: variants.reduce((sum, v) => sum + v.available, 0),
      cars: carsFromGroup(group, onHand),
      coverage,
      status: STATUS_RANK.find((s) => variants.some((v) => v.status === s)) ?? '정상',
      isBottleneck: bottleneckNow?.partCode === group.code,
      nextPo: next?.nextPo ?? null,
      nextDday: next?.nextDday ?? null,
      activeDisruption: [...activeDisruptions].reverse().find((d) => group.parts.some((p) => p.partCode === d.partCode)) ?? null,
      variants,
    };
  });

  const scenarios = baseScenarios(state);
  const cumulative = scenarios.wait.sim.cumulative;
  const lastDate = cumulative[cumulative.length - 1]?.date ?? settings.baseDate;
  // 요약 문장: 리드타임 뒤, 7일 뒤, 14일 뒤의 누적 완성 대수
  const forecastPoints = [...new Set([settings.leadTimeDays, 7, 14])]
    .sort((a, b) => a - b)
    .map((offset) => ({ offset, date: addDays(settings.baseDate, offset) }))
    .filter((p) => p.date <= lastDate)
    .map((p) => ({ ...p, cum: cumAt(cumulative, p.date) }));

  return {
    parts,
    kpi: {
      buildableNow,
      bottleneckNow: bottleneckNow ? partOf(bottleneckNow.partCode) : null,
      buildableIncoming: buildable(lineParts, incoming),
      bottleneckIncoming: bottleneckIncoming ? partOf(bottleneckIncoming.partCode) : null,
      todayInput: Math.min(settings.dailyCapacity, buildableNow),
      dailyCapacity: settings.dailyCapacity,
      activeDisruptions: activeDisruptions.length,
      disruptionCounts: {
        pending: activeDisruptions.filter((d) => d.status === '발생').length,
        responding: activeDisruptions.filter((d) => d.status === '대체발주').length,
        waiting: activeDisruptions.filter((d) => d.status === '기다리기').length,
      },
    },
    poRows: sortByArrival(openPos(purchaseOrders)).map((po) => poRowOf(po, settings.baseDate)),
    scenarios,
    forecastPoints,
    activeDisruptions,
  };
}

/**
 * DB의 데이터가 지금 앱과 맞지 않는 이유들 (없으면 빈 배열). 앱을 새로 배포한 뒤 [데이터 초기화]를 하지 않으면 생긴다.
 * - 부품 구성이 다르다: 예전 데이터에는 색상 구분 없는 차체(P012) 한 줄만 있어 차량 색이 나오지 않는다
 * - 기준일(오늘)보다 뒤 날짜로 입력된 기록이 있다: 예전 데이터는 10/5를 기준일로 만든 것이다
 */
export function staleDataReasons(state: AppState): string[] {
  const reasons: string[] = [];
  const expected = demoState(state.settings.baseDate).lineParts.map((p) => p.partCode).sort().join(',');
  const actual = state.lineParts.map((p) => p.partCode).sort().join(',');
  if (expected !== actual) reasons.push('부품 구성이 예전 형식입니다 (차체가 색상별로 나뉘어 있지 않음)');
  const future = state.purchaseOrders.some((po) => po.orderDate > state.settings.baseDate) ||
    state.disruptions.some((d) => d.detectedDate > state.settings.baseDate);
  if (future) reasons.push('기준일(오늘)보다 뒤 날짜로 입력된 발주·차질 기록이 있습니다');
  if (state.customerOrders.some((o) => !o.colorCode)) {
    reasons.push('차량 색상이 없는 자동차 주문이 있습니다 (Supabase에서 supabase/migration_order_color.sql을 실행한 뒤 초기화하세요)');
  }
  return reasons;
}
