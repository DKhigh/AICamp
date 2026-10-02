// 생산 가능 대수 · 시뮬레이션 · 주문 예측 · 영향 분석 (DESIGN.md §6.2 ~ §6.7, §6.9-1)
// 전부 순수 함수다. 화면은 DB에서 읽은 상태로 이 함수들을 다시 돌려서 보여 준다.
import { CONTRACT_MARK, LOW_COVERAGE_DAYS, SUPPLIER_LIMIT_DAYS, SUPPLIER_ORDER_LIMIT } from './constants';
import { addDays, diffDays, formatMD } from './date';
import { baseCodeOf, colorCodeOf } from './partcode';
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

/**
 * 발주대기 = 취소할 수 있는 발주: 발주한 당일(발주일 = 기준일)의 일반 발주이고 아직 입고대기인 것.
 * DB에는 '입고대기'로 저장하고 화면에서만 '발주대기'로 보여 준다 (DB 스키마를 바꾸지 않는다).
 * 대체 발주는 차질 결정과 묶여 있어 취소 대상에서 뺀다.
 */
export function isCancellable(po: PurchaseOrder, baseDate: ISODate): boolean {
  return po.status === '입고대기' && po.kind === '일반' && po.orderDate === baseDate;
}

export type PoDisplayStatus = PurchaseOrder['status'] | '발주대기';

export function displayStatusOf(po: PurchaseOrder, baseDate: ISODate): PoDisplayStatus {
  return isCancellable(po, baseDate) ? '발주대기' : po.status;
}

export interface SupplierLimit {
  limit: number;
  /** 최근 SUPPLIER_LIMIT_DAYS일 안에 이 업체에 넣은 일반 발주 수량 */
  used: number;
  remaining: number;
  /** 한도가 일부라도 풀리는 가장 빠른 날 (쓴 것이 없으면 null) */
  releaseDate: ISODate | null;
}

/**
 * 주간 발주 한도와 수량 지연을 적용하지 않는 발주:
 * 대체(긴급) 발주 — 차질 대응 수량은 한도보다 크다 — 와 시연 초기 데이터의 정기 계약 물량(입력자 끝에 '정기 계약').
 * 입력자가 없는 발주(예전 데이터)도 정기 계약으로 본다.
 */
export function isLimitExempt(po: PurchaseOrder): boolean {
  return po.kind === '대체' || po.createdBy === null || po.createdBy.endsWith(CONTRACT_MARK);
}

/**
 * 업체별 발주 한도: 한 업체에 일반 발주로 넣을 수 있는 수량은 일주일(발주일 포함 7일) 동안 50개까지다.
 * 발주일로부터 7일이 지난 발주분은 한도에서 빠진다. 취소한 발주와 isLimitExempt인 발주는 세지 않는다.
 */
export function supplierLimitOf(pos: PurchaseOrder[], supplierName: string, baseDate: ISODate): SupplierLimit {
  const counted = pos.filter(
    (po) =>
      po.supplierName === supplierName &&
      !isLimitExempt(po) &&
      po.status !== '취소' &&
      po.orderDate <= baseDate &&
      diffDays(baseDate, po.orderDate) < SUPPLIER_LIMIT_DAYS,
  );
  const used = counted.reduce((sum, po) => sum + po.originalQty, 0);
  const earliest = counted.map((po) => po.orderDate).sort()[0];
  return {
    limit: SUPPLIER_ORDER_LIMIT,
    used,
    remaining: Math.max(0, SUPPLIER_ORDER_LIMIT - used),
    releaseDate: earliest ? addDays(earliest, SUPPLIER_LIMIT_DAYS) : null,
  };
}

/** 한도를 넘으면 안내 문구, 아니면 null */
export function supplierLimitError(limit: SupplierLimit, supplierName: string, qty: number): string | null {
  if (qty <= limit.remaining) return null;
  const release = limit.releaseDate ? ` ${formatMD(limit.releaseDate)}부터 한도가 풀립니다.` : '';
  return `${supplierName} 발주 한도(일주일 ${limit.limit}개)를 넘습니다. 남은 수량은 ${limit.remaining}개입니다.${release}`;
}

/**
 * 같은 날 같은 부품·업체·수량으로 이미 넣은 발주 (실수로 두 번 누른 것인지 확인하려고 찾는다).
 * 취소한 발주와 대체(긴급) 발주는 보지 않는다.
 */
export function duplicateOrderOf(
  pos: PurchaseOrder[],
  draft: { partCode: string; supplierName: string; qty: number },
  baseDate: ISODate,
): PurchaseOrder | null {
  return (
    pos.find(
      (po) =>
        !isLimitExempt(po) &&
        po.status !== '취소' &&
        po.orderDate === baseDate &&
        po.partCode === draft.partCode &&
        po.supplierName === draft.supplierName &&
        po.originalQty === draft.qty,
    ) ?? null
  );
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

/**
 * 차 한 대에 필요한 '요구 단위'. 보통은 부품 하나지만, 색상별 차체처럼 같은 기본코드의 변형들은
 * 한 묶음이다: 차 한 대에 그중 하나만 들어가므로 가능 대수는 변형들의 합이다.
 */
export interface PartGroup {
  /** 기본 부품 코드 ('P012') */
  code: string;
  parts: LinePart[];
}

export function partGroups(lineParts: LinePart[]): PartGroup[] {
  const groups: PartGroup[] = [];
  for (const p of [...lineParts].sort(bySortOrder)) {
    const code = baseCodeOf(p.partCode);
    const group = groups.find((g) => g.code === code);
    if (group) group.parts.push(p);
    else groups.push({ code, parts: [p] });
  }
  return groups;
}

export function carsFromGroup(group: PartGroup, stock: Stock): number {
  return group.parts.reduce((sum, p) => sum + carsFromPart(p, stock), 0);
}

export function buildable(lineParts: LinePart[], stock: Stock): number {
  if (lineParts.length === 0) return 0;
  return Math.min(...partGroups(lineParts).map((g) => carsFromGroup(g, stock)));
}

/** 가능 대수가 가장 작은 부품(묶음이면 기본 코드). 동점이면 sortOrder가 빠른 것 */
export function bottleneckOf(lineParts: LinePart[], stock: Stock): { partCode: string } | null {
  let best: string | null = null;
  let bestCars = Infinity;
  for (const g of partGroups(lineParts)) {
    const cars = carsFromGroup(g, stock);
    if (cars < bestCars) {
      best = g.code;
      bestCars = cars;
    }
  }
  return best === null ? null : { partCode: best };
}

export function coverageDays(p: LinePart, dailyCapacity: number): number {
  return round1(p.onHand / (p.qtyPerCar * dailyCapacity));
}

// ── §5 F1-1 부품 카드 상태 ────────────────────────────────────────────────

export type PartStatus = '차질' | '대응 중' | '주의' | '정상';

/** coverage: 재고 일수를 따로 줄 때 (색상별 차체는 다섯 색을 합친 재고 일수로 본다) */
export function partStatusOf(p: LinePart, disruptions: Disruption[], dailyCapacity: number, coverage?: number): PartStatus {
  const mine = disruptions.filter((d) => d.partCode === p.partCode);
  if (mine.some((d) => d.status === '발생' || d.status === '기다리기')) return '차질';
  if (mine.some((d) => d.status === '대체발주')) return '대응 중';
  if ((coverage ?? coverageDays(p, dailyCapacity)) < LOW_COVERAGE_DAYS) return '주의';
  return '정상';
}

/** 묶음(색상별 차체)의 재고 일수: 변형들의 재고를 합쳐서 본다 */
export function groupCoverageDays(group: PartGroup, dailyCapacity: number): number {
  return round1(group.parts.reduce((sum, p) => sum + p.onHand / p.qtyPerCar, 0) / dailyCapacity);
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
  /** 그날 투입한 차의 색상별 대수 (색상 코드 순). 색상별 차체가 없으면 빈 배열 */
  colors: ColorCount[];
  /** 그날 투입한 차 한 대씩: 어떤 색 차체를 썼고 어느 주문의 차인지 */
  cars: SimCar[];
}
export interface SimCar {
  colorCode: string | null;
  /** 이 차가 채우는 자동차 주문. 주문에 배정되지 않은 차(재고용)는 null */
  orderId: string | null;
}
/** 만들어야 하는 차: 주문 한 건. 납기가 빠른 순으로 넘긴다 */
export interface Demand {
  id: string;
  qty: number;
  /** 주문한 차량 색상. 그 색 차체가 있어야 만들 수 있다. null이면 색을 가리지 않는다 */
  colorCode: string | null;
}
export interface ColorCount {
  colorCode: string;
  count: number;
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
  /** 주문번호 → 그 주문의 마지막 차가 완성되는 날. 기간 안에 다 만들지 못하면 null */
  orderDone: Record<string, ISODate | null>;
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

/**
 * 하루씩 투입을 계산한다. demand(주문, 납기 빠른 순)를 주면 차 한 대마다 주문을 배정하고,
 * 색상별 차체는 그 주문이 요구하는 색을 쓴다:
 * - 그 색 차체가 없으면 그 주문의 차는 만들 수 없다 → 색이 있는 다음 주문의 차를 먼저 만든다
 * - 주문이 색을 가리지 않거나 주문 수량을 다 채운 뒤(재고용)에는 재고가 가장 많은 색을 쓴다
 */
export function simulate(s: Settings, lineParts: LinePart[], arrivals: Arrival[], demand: Demand[] = []): SimResult {
  const stock = stockOnHand(lineParts);
  const groups = partGroups(lineParts);
  // 색상별 차체처럼 한 대에 그중 하나만 쓰는 묶음과, 나머지 부품
  const colorGroup = groups.find((g) => g.parts.some((p) => colorCodeOf(p.partCode) !== null)) ?? null;
  const plain = lineParts.filter((p) => !colorGroup || !colorGroup.parts.includes(p));
  const remaining = demand.map((d) => d.qty);
  const orderDone: Record<string, ISODate | null> = Object.fromEntries(demand.map((d) => [d.id, d.qty === 0 ? s.baseDate : null]));
  const completions = new Map<ISODate, number>();
  const days: DayRow[] = [];
  let totalInput = 0;

  /** 재고가 가장 많은 색의 차체 (없으면 null) */
  const mostStocked = (): LinePart | null => {
    let pick: LinePart | null = null;
    for (const p of colorGroup?.parts ?? []) {
      if (carsFromPart(p, stock) > 0 && (!pick || carsFromPart(p, stock) > carsFromPart(pick, stock))) pick = p;
    }
    return pick;
  };

  for (let i = 0; i < s.horizonDays; i++) {
    const d = addDays(s.baseDate, i);
    const done = addDays(d, s.leadTimeDays);
    // 1) 그날 도착분 입고. 예정일이 기준일보다 지났는데 미입고면 기준일에 들어온 것으로 본다
    for (const a of arrivals) {
      const arriveOn = a.date < s.baseDate ? s.baseDate : a.date;
      if (arriveOn === d && a.partCode in stock) stock[a.partCode] += a.qty;
    }
    // 2) 차체를 뺀 부품으로 만들 수 있는 대수
    const limit = Math.min(s.dailyCapacity, plain.length > 0 ? buildable(plain, stock) : s.dailyCapacity);
    // 3) 차 한 대씩: 주문을 정하고 그 색 차체를 쓴다
    const cars: SimCar[] = [];
    for (let k = 0; k < limit; k++) {
      let body: LinePart | null = null;
      let orderIndex = -1;
      if (colorGroup) {
        for (let j = 0; j < demand.length && !body; j++) {
          if (remaining[j] <= 0) continue;
          const wanted = demand[j].colorCode;
          const candidate = wanted === null ? mostStocked() : (colorGroup.parts.find((p) => colorCodeOf(p.partCode) === wanted) ?? null);
          if (candidate && carsFromPart(candidate, stock) > 0) {
            body = candidate;
            orderIndex = j;
          }
        }
        // 지금 만들 수 있는 주문이 없으면 재고용으로 만든다
        if (!body) body = mostStocked();
        if (!body) break; // 차체가 하나도 없다
        stock[body.partCode] -= body.qtyPerCar;
      } else {
        orderIndex = remaining.findIndex((r) => r > 0);
      }
      if (orderIndex >= 0) {
        remaining[orderIndex] -= 1;
        if (remaining[orderIndex] === 0) orderDone[demand[orderIndex].id] = done;
      }
      cars.push({ colorCode: body ? colorCodeOf(body.partCode) : null, orderId: orderIndex >= 0 ? demand[orderIndex].id : null });
    }
    const input = cars.length;
    const bottleneck =
      input >= s.dailyCapacity ? null : input < limit && colorGroup ? colorGroup.code : (bottleneckOf(plain, stock)?.partCode ?? colorGroup?.code ?? null);
    // 4) 나머지 부품 소모
    for (const p of plain) stock[p.partCode] -= input * p.qtyPerCar;

    const colorCount = new Map<string, number>();
    for (const car of cars) if (car.colorCode) colorCount.set(car.colorCode, (colorCount.get(car.colorCode) ?? 0) + 1);
    const colors = [...colorCount.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([colorCode, count]) => ({ colorCode, count }));
    // 5) 완성 예약
    completions.set(done, (completions.get(done) ?? 0) + input);
    totalInput += input;
    days.push({
      date: d,
      input,
      completeDate: done,
      bottleneck,
      kind: input === s.dailyCapacity ? '정상' : input === 0 ? '정지' : '감산',
      colors,
      cars,
    });
  }

  // 6) 누적 완성: baseDate ~ baseDate + horizonDays - 1 + leadTimeDays
  const cumulative: CumRow[] = [];
  let cum = 0;
  for (let i = 0; i < s.horizonDays + s.leadTimeDays; i++) {
    const d = addDays(s.baseDate, i);
    const completed = completions.get(d) ?? 0;
    cum += completed;
    cumulative.push({ date: d, completed, cum });
  }

  return { days, cumulative, totalInput, endStock: stock, orderDone };
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

/** 납기가 빠른 순 (같으면 주문번호 순). 이 순서로 차를 배정한다 */
export function sortOrdersByDue<T extends CustomerOrder>(orders: T[]): T[] {
  return [...orders].sort((a, b) => (a.dueDate === b.dueDate ? a.id.localeCompare(b.id) : a.dueDate < b.dueDate ? -1 : 1));
}

/** 시뮬레이션이 주문마다 계산한 완료일로 납기 충족 여부를 만든다 */
export function forecastOrders(orders: CustomerOrder[], orderDone: Record<string, ISODate | null>): OrderForecast[] {
  let need = 0;
  return sortOrdersByDue(orders).map((o) => {
    need += o.qty;
    const doneDate = orderDone[o.id] ?? null;
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
  const demand = sortOrdersByDue(orders).map((o): Demand => ({ id: o.id, qty: o.qty, colorCode: o.colorCode ?? null }));
  const sim = simulate(s, lineParts, arrivals, demand);
  const forecast = forecastOrders(orders, sim.orderDone);
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

/**
 * 지연 때문에 추가로 모자라는 수량 = 대체 발주 추천 수량.
 * 지연된 발주가 다 들어올 때까지 매일 일일 투입만큼 만든다고 할 때,
 * (지연된 일정에서 모자라는 양) − (원래 일정이었어도 모자랐을 양)이다. 현재 재고와 다른 입고 예정분을 먼저 쓴다.
 * 0이면 재고로 지연 기간을 버틸 수 있다 → 대체 발주가 필요 없다.
 * lineParts에는 생산에 쓸 수 있는 재고(수리용 제외)를 준다. 색상별 차체는 다섯 색을 합쳐서 본다.
 */
export function coverQty(s: Settings, lineParts: LinePart[], pos: PurchaseOrder[], disruptionId: string): number {
  const delayed = delayedPosOf(pos, disruptionId);
  if (delayed.length === 0) return 0;
  const partCode = delayed[0].partCode;
  const group = partGroups(lineParts).find((g) => g.code === baseCodeOf(partCode));
  const linePart = lineParts.find((p) => p.partCode === partCode);
  if (!group || !linePart) return 0;

  const lastArrival = delayed.map((po) => po.expectedArrival).sort().pop()!;
  const days = diffDays(lastArrival, s.baseDate);
  const perCar = new Map(group.parts.map((p) => [p.partCode, p.qtyPerCar]));
  const incoming = openPos(pos).filter((po) => perCar.has(po.partCode));

  /** 그 일정대로 들어온다면 지연 발주가 다 올 때까지 모자라는 차 대수 */
  const shortCars = (basis: ArrivalBasis): number => {
    let cars = group.parts.reduce((sum, p) => sum + Math.floor(p.onHand / p.qtyPerCar), 0);
    let short = 0;
    for (let i = 0; i < days; i++) {
      const d = addDays(s.baseDate, i);
      for (const po of incoming) {
        const date = basis === 'planned' ? po.plannedArrival : po.expectedArrival;
        if ((date < s.baseDate ? s.baseDate : date) === d) cars += Math.floor(po.qty / perCar.get(po.partCode)!);
      }
      const input = Math.min(cars, s.dailyCapacity);
      short += s.dailyCapacity - input;
      cars -= input;
    }
    return short;
  };

  const extraCars = Math.max(0, shortCars('expected') - shortCars('planned'));
  return Math.min(extraCars * linePart.qtyPerCar, delayedQtyOf(pos, disruptionId));
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
