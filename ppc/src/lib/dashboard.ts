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
  groupCoverageDays,
  nextArrivalOf,
  openPos,
  partGroups,
  partStatusOf,
  sortByArrival,
  stockOnHand,
  stockWithIncoming,
  type PartStatus,
} from './planning';
import { poAmount } from './ordering';
import { gradeOf } from './recommend';
import { partOf, supplierOf } from './reference';
import type { AppState, Disruption, ISODate, LinePart, Part, PurchaseOrder, RateGrade } from './types';

export interface PartRow {
  linePart: LinePart;
  part: Part;
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
    dday: diffDays(po.expectedArrival, baseDate),
    delayedBy: diffDays(po.expectedArrival, po.plannedArrival),
    onTimeRate: supplier?.onTimeRate ?? null,
    grade,
    atRisk: po.status === '입고대기' && grade === '위험',
    amount: poAmount(po),
  };
}

export function dashboardModel(state: AppState): DashboardModel {
  const { settings, lineParts, purchaseOrders, disruptions } = state;
  const onHand = stockOnHand(lineParts);
  const incoming = stockWithIncoming(lineParts, purchaseOrders);
  const bottleneckNow = bottleneckOf(lineParts, onHand);
  const bottleneckIncoming = bottleneckOf(lineParts, incoming);
  const buildableNow = buildable(lineParts, onHand);
  const activeDisruptions = disruptions.filter((d) => d.status !== '해결');

  const rowOf = (linePart: LinePart, groupCoverage?: number): PartRow => {
    const nextPo = nextArrivalOf(linePart.partCode, purchaseOrders);
    return {
      linePart,
      part: partOf(linePart.partCode),
      cars: carsFromPart(linePart, onHand),
      coverage: coverageDays(linePart, settings.dailyCapacity),
      status: partStatusOf(linePart, disruptions, settings.dailyCapacity, groupCoverage),
      isBottleneck: bottleneckNow?.partCode === linePart.partCode,
      nextPo,
      nextDday: nextPo ? diffDays(nextPo.expectedArrival, settings.baseDate) : null,
      activeDisruption: [...activeDisruptions].reverse().find((d) => d.partCode === linePart.partCode) ?? null,
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
        onHand: group.parts.reduce((sum, p) => sum + p.onHand, 0),
        sortOrder: group.parts[0].sortOrder,
      },
      part: partOf(group.code),
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
    },
    poRows: sortByArrival(openPos(purchaseOrders)).map((po) => poRowOf(po, settings.baseDate)),
    scenarios,
    forecastPoints,
    activeDisruptions,
  };
}
