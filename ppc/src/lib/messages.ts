// 안내 문구 템플릿 (DESIGN.md §6.10)
import { RISK_LATE_DAYS } from './constants';
import { formatMD } from './date';
import { num, withParticle } from './format';
import { stopSummary, type OrderForecast, type ScenarioOutcome } from './planning';
import type { Candidate } from './recommend';
import type { Disruption, OriginalPoAction, Part } from './types';

/** T1 차질 */
export function disruptionMessage(d: Disruption, part: Part): string {
  return `${d.supplierName}에 ${part.name}(${part.code}) 부품 문제가 생겨 ${d.delayDays}일 지연될 예정입니다.`;
}

function lateOrderText(o: OrderForecast): string {
  return o.lateDays === null ? `${o.id} 기간 내 미완료` : `${o.id} ${o.lateDays}일`;
}

/** T2 영향 */
export function impactMessage(wait: ScenarioOutcome): string {
  const late = wait.lateOrders;
  const lateText =
    late.length === 0 ? '납기 지연 주문 없음' : `납기 지연 주문 ${late.length}건 (${late.map(lateOrderText).join(', ')})`;
  return `이대로 기다리면 라인 정지 ${stopSummary(wait)} · 생산 손실 ${num(wait.loss)}대 · ${lateText}`;
}

/**
 * T3 추천. 후보는 '같은 소재를 공급하는 업체'로 고른 것이라 부품 사양까지 같다고 단정하지 않는다.
 */
export function recommendMessage(d: Disruption, part: Part, c: Candidate): string {
  return `${part.name} 납품이 ${d.supplierName}에서 ${d.delayDays}일 늦어집니다. 같은 소재(${part.materialName})를 공급하는 ${c.name}에서 ${withParticle(part.name, '을', '를')} ${c.altLeadDays}일 내(${formatMD(c.arrival)}) 받을 수 있습니다. 부품 사양은 발주 전에 확인하세요.`;
}

/** T3-불필요: 재고로 지연 기간을 버틸 수 있을 때 */
export function noAltNeededMessage(d: Disruption, part: Part): string {
  return `${part.name} 납품이 ${d.supplierName}에서 ${d.delayDays}일 늦어지지만, 현재 재고와 다른 입고 예정분으로 그동안 생산할 수 있습니다. 대체 발주는 필요하지 않습니다.`;
}

/** T4 결과 */
export function resultMessage(params: {
  part: Part;
  candidate: Candidate;
  qty: number;
  action: OriginalPoAction;
  alt: ScenarioOutcome;
  /** 여러 업체에 나눠 발주할 때: 업체별 수량과 도착일 */
  allocations?: { supplier: Candidate; qty: number }[];
}): string {
  const { part, candidate, qty, action, alt, allocations } = params;
  const orderTotal = alt.orders.reduce((sum, o) => sum + o.qty, 0);
  const head =
    allocations && allocations.length > 1
      ? `${part.name} ${num(qty)}개를 ${allocations.map((a) => `${a.supplier.name} ${num(a.qty)}개(${formatMD(a.supplier.arrival)})`).join(' + ')}로 나눠 받으면, `
      : `${candidate.name}에서 ${part.name} ${num(qty)}개를 ${formatMD(candidate.arrival)}까지 받으면, `;
  const tail = ` (라인 정지 ${alt.lineStopDays}일, 납기 지연 주문 ${alt.lateOrders.length}건, 원래 발주 ${action})`;
  if (alt.allDoneDate) {
    return `${head}주문 자동차 ${num(orderTotal)}대를 ${formatMD(alt.allDoneDate)}까지 생산할 수 있습니다.${tail}`;
  }
  const lastRow = alt.sim.cumulative[alt.sim.cumulative.length - 1];
  const made = Math.min(lastRow?.cum ?? 0, orderTotal);
  const end = lastRow ? formatMD(lastRow.date) : '';
  return `${head}주문 자동차 ${num(orderTotal)}대 중 ${num(made)}대만 ${end}까지 생산할 수 있습니다.${tail}`;
}

/** T4-위험 */
export function riskLateMessage(candidate: Candidate, late: ScenarioOutcome): string {
  return `${candidate.name}(준수율 ${candidate.onTimeRate}% 위험)가 ${RISK_LATE_DAYS}일 늦게 오면: 라인 정지 ${stopSummary(late)}, 손실 ${num(late.loss)}대, 납기 지연 주문 ${late.lateOrders.length}건`;
}

/** T5 고객 안내 (lateDays > 0인 주문만) */
export function customerNotices(wait: ScenarioOutcome, part: Part): { orderId: string; text: string }[] {
  return wait.orders
    .filter((o) => o.doneDate !== null && o.lateDays !== null && o.lateDays > 0)
    .map((o) => ({
      orderId: o.id,
      text: `[${o.customer}] 주문 ${o.id}(${num(o.qty)}대)의 예상 납품일이 ${formatMD(o.dueDate)}에서 ${formatMD(o.doneDate!)}로 ${o.lateDays}일 늦어질 예정입니다. 사유: ${part.name} 부품 공급 지연. 불편을 드려 죄송합니다.`,
    }));
}
