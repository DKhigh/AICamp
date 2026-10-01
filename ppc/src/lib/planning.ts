// 생산 가능 대수 · 시뮬레이션 · 주문 예측 · 영향 분석 (DESIGN.md §6.2 ~ §6.7, §6.9-1)
// 전부 순수 함수다. 화면은 DB에서 읽은 상태로 이 함수들을 다시 돌려서 보여 준다.
import { LOW_COVERAGE_DAYS } from './constants';
import { addDays, diffDays, formatMD } from './date';
import type {
  CustomerOrder,
  Disruption,
  ISODate,
  LinePart,
  OriginalPoAction,
  PurchaseOrder,
  Settings,
} from './types';

export type Stock = Record<string, number>;

const round1 = (n: number) => Math.round(n * 10) / 10;
const bySortOrder = (a: LinePart, b: LinePart) => a.sortOrder - b.sortOrder;

// ── §6.2 생산 가능 대수와 병목 ─────────────────────────────────────────────

/** 미입고(입고대기·지연) 발주만 남긴다 */
export function openPos(pos: PurchaseOrder[]): PurchaseOrder[] {
  return pos.filter((po) => po.status === '입고대기' || po.status === '지연');
}

export function stockOnHand(lineParts: LinePart[]): Stock {
  return Object.fromEntries(lineParts.map((p) => [p.partCode, p.onHand]));
}

/** 현재 재고 + 미입고 발주 수량 전체 */
export function stockWithIncoming(lineParts: LinePart[], pos: PurchaseOrder[]): Stock {
  const stock = stockOnHand(lineParts);
  for (const po of openPos(pos)) {
    if (po.partCode in stock) stock[po.partCode] += po.qty;
  }
  return stock;
}

export function carsFromPart(p: LinePart, stock: Stock): number {
  return Math.floor((stock[p.partCode] ?? 0) / p.qtyPerCar);
}

export function buildable(lineParts: LinePart[], stock: Stock): number {
  if (lineParts.length === 0) return 0;
  return Math.min(...lineParts.map((p) => carsFromPart(p, stock)));
}

/** 가능 대수가 가장 작은 부품. 동점이면 sortOrder가 빠른 것 */
export function bottleneckOf(lineParts: LinePart[], stock: Stock): LinePart | null {
  let best: LinePart | null = null;
  let bestCars = Infinity;
  for (const p of [...lineParts].sort(bySortOrder)) {
    const cars = carsFromPart(p, stock);
    if (cars < bestCars) {
      best = p;
      bestCars = cars;
    }
  }
  return best;
}

export function coverageDays(p: LinePart, dailyCapacity: number): number {
  return round1(p.onHand / (p.qtyPerCar * dailyCapacity));
}

// ── §5 F1-1 부품 카드 상태 ────────────────────────────────────────────────

export type PartStatus = '차질' | '대응 중' | '주의' | '정상';

export function partStatusOf(p: LinePart, disruptions: Disruption[], dailyCapacity: number): PartStatus {
  const mine = disruptions.filter((d) => d.partCode === p.partCode);
  if (mine.some((d) => d.status === '발생' || d.status === '기다리기')) return '차질';
  if (mine.some((d) => d.status === '대체발주')) return '대응 중';
  if (coverageDays(p, dailyCapacity) < LOW_COVERAGE_DAYS) return '주의';
  return '정상';
}

/** 이 부품의 미입고 발주 중 가장 먼저 오는 것 */
export function nextArrivalOf(partCode: string, pos: PurchaseOrder[]): PurchaseOrder | null {
  const mine = sortByArrival(openPos(pos).filter((po) => po.partCode === partCode));
  return mine[0] ?? null;
}

export function sortByArrival(pos: PurchaseOrder[]): PurchaseOrder[] {
  return [...pos].sort((a, b) =>
    a.expectedArrival === b.expectedArrival
      ? a.id.localeCompare(b.id)
      : a.expectedArrival < b.expectedArrival
        ? -1
        : 1,
  );
}

// ── §6.4 생산 시뮬레이션 ──────────────────────────────────────────────────

export interface Arrival {
  partCode: string;
  qty: number;
  date: ISODate;
}
export type DayKind = '정상' | '감산' | '정지';
export interface DayRow {
  date: ISODate;
  input: number;
  completeDate: ISODate;
  /** 그날 투입을 제한한 부품 코드 (정상이면 null) */
  bottleneck: string | null;
  kind: DayKind;
}
export interface CumRow {
  date: ISODate;
  completed: number;
  cum: number;
}
export interface SimResult {
  days: DayRow[];
  cumulative: CumRow[];
  totalInput: number;
  /** 기간 종료 시 남는 부품 재고 */
  endStock: Stock;
}

export type ArrivalBasis = 'planned' | 'expected';

/** §6.6: 정상 계획은 plannedArrival, 현재/기다리기는 expectedArrival 기준 */
export function arrivalsFromPos(pos: PurchaseOrder[], basis: ArrivalBasis): Arrival[] {
  return openPos(pos).map((po) => ({
    partCode: po.partCode,
    qty: po.qty,
    date: basis === 'planned' ? po.plannedArrival : po.expectedArrival,
  }));
}

export function simulate(s: Settings, lineParts: LinePart[], arrivals: Arrival[]): SimResult {
  const stock = stockOnHand(lineParts);
  const completions = new Map<ISODate, number>();
  const days: DayRow[] = [];
  let totalInput = 0;

  for (let i = 0; i < s.horizonDays; i++) {
    const d = addDays(s.baseDate, i);
    // 1) 그날 도착분 입고. 예정일이 기준일보다 지났는데 미입고면 기준일에 들어온 것으로 본다
    for (const a of arrivals) {
      const arriveOn = a.date < s.baseDate ? s.baseDate : a.date;
      if (arriveOn === d && a.partCode in stock) stock[a.partCode] += a.qty;
    }
    // 2) 투입 대수
    const input = Math.min(s.dailyCapacity, buildable(lineParts, stock));
    const bottleneck = input < s.dailyCapacity ? (bottleneckOf(lineParts, stock)?.partCode ?? null) : null;
    // 3) 부품 소모
    for (const p of lineParts) stock[p.partCode] -= input * p.qtyPerCar;
    // 4) 완성 예약
    const done = addDays(d, s.leadTimeDays);
    completions.set(done, (completions.get(done) ?? 0) + input);
    totalInput += input;
    days.push({
      date: d,
      input,
      completeDate: done,
      bottleneck,
      kind: input === s.dailyCapacity ? '정상' : input === 0 ? '정지' : '감산',
    });
  }

  // 5) 누적 완성: baseDate ~ baseDate + horizonDays - 1 + leadTimeDays
  const cumulative: CumRow[] = [];
  let cum = 0;
  for (let i = 0; i < s.horizonDays + s.leadTimeDays; i++) {
    const d = addDays(s.baseDate, i);
    const completed = completions.get(d) ?? 0;
    cum += completed;
    cumulative.push({ date: d, completed, cum });
  }

  return { days, cumulative, totalInput, endStock: stock };
}

/** 그 날짜까지의 누적 완성 대수. 기간 밖이면 가장 가까운 끝 값 */
export function cumAt(cumulative: CumRow[], date: ISODate): number {
  let value = 0;
  for (const row of cumulative) {
    if (row.date > date) break;
    value = row.cum;
  }
  return value;
}

// ── §6.5 주문 완료 예정일 ────────────────────────────────────────────────

export interface OrderForecast extends CustomerOrder {
  /** 누적 필요량 (납기 오름차순) */
  cumNeed: number;
  /** null이면 '기간 내 미완료' */
  doneDate: ISODate | null;
  /** doneDate - dueDate. 0 이하이면 충족, 여유 = -lateDays */
  lateDays: number | null;
}

export function forecastOrders(orders: CustomerOrder[], cumulative: CumRow[]): OrderForecast[] {
  const sorted = [...orders].sort((a, b) =>
    a.dueDate === b.dueDate ? a.id.localeCompare(b.id) : a.dueDate < b.dueDate ? -1 : 1,
  );
  let need = 0;
  return sorted.map((o) => {
    need += o.qty;
    const doneDate = cumulative.find((row) => row.cum >= need)?.date ?? null;
    return { ...o, cumNeed: need, doneDate, lateDays: doneDate ? diffDays(doneDate, o.dueDate) : null };
  });
}

export function isLate(o: OrderForecast): boolean {
  return o.lateDays === null || o.lateDays > 0;
}

// ── §6.6 시나리오 결과 ───────────────────────────────────────────────────

export interface DateRange {
  from: ISODate;
  to: ISODate;
  days: number;
}

/** 연속된 날짜를 구간으로 묶는다 (§6.7) */
export function groupRanges(dates: ISODate[]): DateRange[] {
  const ranges: DateRange[] = [];
  for (const d of [...dates].sort()) {
    const last = ranges[ranges.length - 1];
    if (last && diffDays(d, last.to) === 1) {
      last.to = d;
      last.days += 1;
    } else {
      ranges.push({ from: d, to: d, days: 1 });
    }
  }
  return ranges;
}

export function formatRanges(ranges: DateRange[]): string {
  return ranges.map((r) => (r.from === r.to ? formatMD(r.from) : `${formatMD(r.from)}~${formatMD(r.to)}`)).join(', ');
}

export interface ScenarioOutcome {
  sim: SimResult;
  orders: OrderForecast[];
  stopDates: ISODate[];
  reducedDates: ISODate[];
  /** 정지 + 감산 일수 */
  lineStopDays: number;
  /** 정상 계획 totalInput - 이 시나리오 totalInput */
  loss: number;
  /** 납기를 넘기거나 기간 내에 못 끝내는 주문 */
  lateOrders: OrderForecast[];
  /** 마지막 주문의 완료일. 기간 내에 못 끝내면 null */
  allDoneDate: ISODate | null;
}

export function evaluateScenario(
  s: Settings,
  lineParts: LinePart[],
  orders: CustomerOrder[],
  arrivals: Arrival[],
  normalTotalInput?: number,
): ScenarioOutcome {
  const sim = simulate(s, lineParts, arrivals);
  const forecast = forecastOrders(orders, sim.cumulative);
  const stopDates = sim.days.filter((d) => d.kind === '정지').map((d) => d.date);
  const reducedDates = sim.days.filter((d) => d.kind === '감산').map((d) => d.date);
  const last = forecast[forecast.length - 1];
  return {
    sim,
    orders: forecast,
    stopDates,
    reducedDates,
    lineStopDays: stopDates.length + reducedDates.length,
    loss: (normalTotalInput ?? sim.totalInput) - sim.totalInput,
    lateOrders: forecast.filter(isLate),
    allDoneDate: last ? last.doneDate : null,
  };
}

/** '4일(10/8~10/11)' / '7일(정지 10/10~10/15 · 감산 10/9)' / '0일' */
export function stopSummary(o: Pick<ScenarioOutcome, 'stopDates' | 'reducedDates' | 'lineStopDays'>): string {
  if (o.lineStopDays === 0) return '0일';
  const stops = formatRanges(groupRanges(o.stopDates));
  const reduced = formatRanges(groupRanges(o.reducedDates));
  if (o.reducedDates.length === 0) return `${o.lineStopDays}일(${stops})`;
  if (o.stopDates.length === 0) return `${o.lineStopDays}일(감산 ${reduced})`;
  return `${o.lineStopDays}일(정지 ${stops} · 감산 ${reduced})`;
}

/** '정지 6일 + 감산 1일' (§6.6) */
export function stopBreakdown(o: Pick<ScenarioOutcome, 'stopDates' | 'reducedDates'>): string | null {
  if (o.reducedDates.length === 0) return null;
  return `정지 ${o.stopDates.length}일 + 감산 ${o.reducedDates.length}일`;
}

// ── §6.9, §6.9-1 대체 수량과 원래 발주 처리 ─────────────────────────────────

/** 이 차질로 지연된(아직 미입고인) 발주 */
export function delayedPosOf(pos: PurchaseOrder[], disruptionId: string): PurchaseOrder[] {
  return pos.filter((po) => po.disruptionId === disruptionId && po.status === '지연' && po.kind === '일반');
}

export function delayedQtyOf(pos: PurchaseOrder[], disruptionId: string): number {
  return delayedPosOf(pos, disruptionId).reduce((sum, po) => sum + po.qty, 0);
}

/** 지연되는 기간 동안 라인을 멈추지 않으려면 필요한 양 */
export function coverQty(delayDays: number, dailyCapacity: number, qtyPerCar: number, delayedQty: number): number {
  return Math.min(delayDays * dailyCapacity * qtyPerCar, delayedQty);
}

export function recommendedQty(action: OriginalPoAction, cover: number, delayedQty: number): number {
  return action === '취소' ? delayedQty : cover;
}

/**
 * 원래 발주 처리. 시뮬레이션(미리보기)과 확정 저장이 같은 함수를 쓴다.
 * 바뀐 발주만 새 객체로 바꾼 전체 목록을 돌려준다.
 */
export function applyOriginalPoAction(
  pos: PurchaseOrder[],
  disruptionId: string,
  action: OriginalPoAction,
  altQty: number,
): PurchaseOrder[] {
  if (action === '유지') return pos;
  const targets = delayedPosOf(pos, disruptionId);
  const patched = new Map<string, PurchaseOrder>();

  if (action === '취소') {
    for (const po of targets) patched.set(po.id, { ...po, status: '취소' });
  } else {
    // 감량: 늦게 오는 발주부터 대체 수량만큼 뺀다
    let remaining = altQty;
    for (const po of sortByArrival(targets).reverse()) {
      if (remaining <= 0) break;
      const cut = Math.min(po.qty, remaining);
      remaining -= cut;
      const qty = po.qty - cut;
      patched.set(po.id, { ...po, qty, status: qty === 0 ? '취소' : po.status });
    }
  }
  return pos.map((po) => patched.get(po.id) ?? po);
}

/** applyOriginalPoAction 전후를 비교해 실제로 바뀐 발주만 고른다 (DB 저장용) */
export function changedPos(before: PurchaseOrder[], after: PurchaseOrder[]): PurchaseOrder[] {
  const prev = new Map(before.map((po) => [po.id, po]));
  return after.filter((po) => {
    const old = prev.get(po.id);
    return !old || old.qty !== po.qty || old.status !== po.status;
  });
}
