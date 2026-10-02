// 차질 상세 `/disruptions/:id` (DESIGN.md §5 F2-2 ~ F2-4, §7.3)
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmployeeConfirmModal } from '../components/EmployeeField';
import { OrderStatus } from '../components/OrdersTable';
import { SupplierLink } from '../components/SupplierInfo';
import { CHART_COLORS, ScenarioChart, type ChartRow, type ChartSeries } from '../components/ScenarioChart';
import { Badge, Button, Card, DISRUPTION_STATUS_TONE, disruptionStatusLabel, Field, GradeBadge, INPUT_CLASS, parseIntStrict } from '../components/ui';
import { altScenario, baseScenarios, resolvablePos } from '../lib/actions';
import { qtyError } from '../lib/api';
import { RISK_LATE_DAYS, SUPPLIER_ORDER_LIMIT } from '../lib/constants';
import { formatMD } from '../lib/date';
import { num, timeLabel, withParticle, won } from '../lib/format';
import { supplierCapacityOf, unitPriceOf } from '../lib/ordering';
import {
  customerNotices,
  disruptionMessage,
  impactMessage,
  noAltNeededMessage,
  recommendMessage,
  resultMessage,
  riskLateMessage,
} from '../lib/messages';
import {
  applyOriginalPoAction,
  coverQty,
  delayedPosOf,
  recommendedQty,
  stopBreakdown,
  type ScenarioOutcome,
} from '../lib/planning';
import { CAUTION_STATUS, disruptedSupplierNames, RANK_RULE_TEXT, recommendSuppliers, splitPlan, type Candidate } from '../lib/recommend';
import { materialOf, partOf, reference } from '../lib/reference';
import { productionParts } from '../lib/repairs';
import type { AppState, Disruption, OriginalPoAction, Part, PurchaseOrder } from '../lib/types';
import { useAppData } from '../state/AppData';

const ACTIONS: OriginalPoAction[] = ['유지', '감량', '취소'];

const ACTION_HELP: Record<OriginalPoAction, string> = {
  유지: '원래 발주를 그대로 두고 늦게라도 전량 받는다. 가장 안전하지만 재고가 남는다.',
  감량: '원래 발주에서 대체 수량만큼 뺀다. 재고를 정상 계획 수준으로 맞춘다.',
  취소: '원래 발주를 취소하고 대체 업체에서 전량 받는다. 원래 업체를 더 믿을 수 없을 때.',
};

/** 원래 발주 처리 결과 한 줄: 'PO-001 400개 → 300개로 감량' */
function originalPoSummary(before: PurchaseOrder[], after: PurchaseOrder[]): string {
  const afterById = new Map(after.map((po) => [po.id, po]));
  return before
    .map((po) => {
      const next = afterById.get(po.id)!;
      const result = next.status === '취소' ? '취소' : next.qty !== po.qty ? `${num(next.qty)}개로 감량` : '유지';
      return `${po.id} ${num(po.qty)}개 → ${result}`;
    })
    .join(', ');
}

function OutcomeCard({
  title,
  tone,
  outcome,
  orderTotal,
  partName,
  endStock,
  normalEndStock,
}: {
  title: string;
  tone: 'red' | 'blue';
  outcome: ScenarioOutcome;
  orderTotal: number;
  partName: string;
  endStock: number;
  normalEndStock: number;
}) {
  const breakdown = stopBreakdown(outcome);
  const stockDiff = endStock - normalEndStock;
  const rows: [string, string, boolean][] = [
    ['라인 정지', `${outcome.lineStopDays}일${breakdown ? ` (${breakdown})` : ''}`, outcome.lineStopDays > 0],
    ['생산 손실', `${num(outcome.loss)}대`, outcome.loss > 0],
    [`주문 ${num(orderTotal)}대 완료`, outcome.allDoneDate ? formatMD(outcome.allDoneDate) : '기간 내 미완료', outcome.allDoneDate === null],
    ['납기 지연 주문', `${outcome.lateOrders.length}건`, outcome.lateOrders.length > 0],
    [
      `기간 종료 시 남는 ${partName}`,
      `${num(endStock)}개${stockDiff === 0 ? ' · 정상 계획과 같음' : ` · 정상 계획보다 ${stockDiff > 0 ? '+' : ''}${num(stockDiff)}`}`,
      false,
    ],
  ];
  return (
    <div className={`rounded-xl border-2 p-4 ${tone === 'red' ? 'border-red-200 bg-red-50/40' : 'border-blue-200 bg-blue-50/40'}`}>
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <span className={`h-2.5 w-2.5 rounded-full ${tone === 'red' ? 'bg-red-600' : 'bg-accent'}`} />
        {title}
      </h3>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        {rows.map(([label, value, bad]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-slate-600">{label}</dt>
            <dd className={`tabular text-right font-bold ${bad ? 'text-red-600' : 'text-slate-900'}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CustomerNoticePanel({ wait, part }: { wait: ScenarioOutcome; part: Part }) {
  const { notify } = useAppData();
  const notices = customerNotices(wait, part);
  const unfinished = wait.orders.filter((o) => o.doneDate === null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify('success', '안내 문구를 복사했습니다.');
    } catch {
      notify('error', '복사하지 못했습니다. 문구를 직접 선택해서 복사하세요.');
    }
  }

  return (
    <Card
      title="고객 안내 문구 (대응하지 않음 선택)"
      aside={
        notices.length > 1 && (
          <Button size="sm" onClick={() => void copy(notices.map((n) => n.text).join('\n'))}>
            전체 복사
          </Button>
        )
      }
    >
      <div className="space-y-2 px-5 py-4">
        {notices.length === 0 && unfinished.length === 0 && (
          <p className="text-sm text-slate-600">납기가 늦어지는 주문이 없어 안내할 고객이 없습니다.</p>
        )}
        {notices.map((n) => (
          <div key={n.orderId} className="flex items-start gap-3 rounded-lg bg-slate-50 px-4 py-3">
            <p className="flex-1 text-[13px] leading-relaxed text-slate-800">{n.text}</p>
            <Button size="sm" onClick={() => void copy(n.text)}>
              복사
            </Button>
          </div>
        ))}
        {unfinished.map((o) => (
          <p key={o.id} className="rounded-lg bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">
            {o.id}({o.customer})는 예측 기간 안에 완료되지 않아 예상 납품일을 안내할 수 없습니다. 대체 발주를 검토하세요.
          </p>
        ))}
      </div>
    </Card>
  );
}

function CandidateRow({
  c,
  part,
  checked,
  qtyText,
  problem,
  onToggle,
  onQty,
}: {
  c: Candidate;
  part: Part;
  /** 이 업체에 대체 발주를 넣을지 */
  checked: boolean;
  qtyText: string;
  problem: string | null;
  onToggle: () => void;
  onQty: (text: string) => void;
}) {
  const risk = c.grade === '위험';
  const selectable = c.maxQty > 0;
  // 공급 능력은 kg이 아니라 이 부품 개수로 보여 준다
  const monthlyQty = Math.floor(c.monthlyCapacityKg / part.kgPerUnit + 1e-9);
  return (
    <tr className={`${risk ? 'bg-red-50' : ''} ${checked ? 'bg-accent-light' : ''}`}>
      <td className="py-2 pl-5 pr-2">
        <label className="flex items-center gap-2 whitespace-nowrap">
          <input
            type="checkbox"
            checked={checked}
            disabled={!selectable}
            onChange={onToggle}
            aria-label={`${c.name}에 대체 발주`}
            className="h-4 w-4 accent-blue-700 disabled:opacity-40"
          />
          <strong className="tabular text-slate-900">{c.rank}</strong>
          {risk && <span className="text-[11px] font-semibold text-red-600">위험 · 빨라도 후순위</span>}
          {c.status === CAUTION_STATUS && <span className="text-[11px] font-semibold text-amber-700">상태 주의 · 후순위</span>}
        </label>
      </td>
      <td className="px-2 py-2 font-semibold text-slate-900">
        <SupplierLink name={c.name} /> <span className="font-mono text-[11px] font-medium text-slate-400">{c.code}</span>
      </td>
      <td className="tabular px-2 py-2 text-slate-900">{c.altLeadDays}일</td>
      <td className="tabular px-2 py-2 font-semibold text-slate-900">{formatMD(c.arrival)}</td>
      <td
        className={`tabular px-2 py-2 text-right ${selectable ? 'text-slate-900' : 'font-semibold text-red-600'}`}
        title={`월 공급가능량 ${num(c.monthlyCapacityKg)}kg ÷ ${part.name} 1개당 ${part.kgPerUnit}kg = 월 ${num(monthlyQty)}개 · 최근 한 달 발주 ${num(Math.round(c.usedKg))}kg을 빼고 남은 양`}
      >
        <strong>{num(c.maxQty)}개</strong>
        <span className="text-[11px] text-slate-400"> / 월 {num(monthlyQty)}개</span>
      </td>
      <td className="px-2 py-2 text-right">
        {checked ? (
          <span className="inline-flex flex-col items-end">
            <span className="whitespace-nowrap">
              <input
                type="number"
                min={1}
                max={c.maxQty}
                step={1}
                inputMode="numeric"
                value={qtyText}
                onChange={(e) => onQty(e.target.value)}
                aria-label={`${c.name} 발주 수량`}
                aria-invalid={!!problem}
                className={`tabular w-20 rounded-md border px-2 py-1 text-right text-sm font-bold text-accent outline-none focus:ring-2 ${
                  problem ? 'border-red-400 focus:ring-red-100' : 'border-slate-300 focus:border-accent focus:ring-blue-100'
                }`}
              />{' '}
              개
            </span>
            {problem && <span className="mt-0.5 text-[11px] font-medium text-red-600">{problem}</span>}
          </span>
        ) : (
          <span className="text-slate-300">–</span>
        )}
      </td>
      <td className="py-2 pl-2 pr-5">
        <GradeBadge rate={c.onTimeRate} grade={c.grade} />
      </td>
    </tr>
  );
}

/** 결정 입력과 비교 (상태가 '발생' 또는 '기다리기'일 때) */
function DecisionSection({ state, disruption, part }: { state: AppState; disruption: Disruption; part: Part }) {
  const { save, notify, session } = useAppData();
  const navigate = useNavigate();
  const { settings } = state;
  const delayedPos = delayedPosOf(state.purchaseOrders, disruption.id);
  const delayedQty = delayedPos.reduce((sum, po) => sum + po.qty, 0);
  // 추천 수량 = 지연 때문에 모자라는 양. 현재 재고(수리용 제외)와 다른 입고 예정분으로 버틸 수 있으면 0
  const cover = useMemo(
    () => coverQty(settings, productionParts(state.lineParts), state.purchaseOrders, disruption.id),
    [settings, state.lineParts, state.purchaseOrders, disruption.id],
  );
  const noAltNeeded = cover === 0;
  const { normal, wait } = useMemo(() => baseScenarios(state), [state]);

  // 업체별로 최근 한 달 동안 이미 발주한 양(kg): 남은 공급 능력을 계산한다
  const usedKg = useMemo(
    () =>
      Object.fromEntries(
        reference.suppliers.map((s) => [s.name, supplierCapacityOf(state.purchaseOrders, s, settings.baseDate).usedKg]),
      ),
    [state.purchaseOrders, settings.baseDate],
  );
  // 지연된 원래 발주 가운데 가장 먼저 오는 날: 이보다 늦게 오는 업체는 후보에서 뺀다
  const originalArrival = delayedPos.length > 0 ? delayedPos.map((po) => po.expectedArrival).sort()[0] : null;
  const rec = useMemo(
    () =>
      recommendSuppliers({
        part,
        excludeSupplierName: disruption.supplierName,
        suppliers: reference.suppliers,
        baseDate: settings.baseDate,
        qty: 1,
        usedKg,
        disruptedSuppliers: disruptedSupplierNames(state.disruptions),
        originalArrival,
      }),
    [part, disruption.supplierName, settings.baseDate, usedKg, state.disruptions, originalArrival],
  );

  /** 추천 설정: 목표 수량을 순위대로, 한 업체에 기본 50개씩 나눈다 → 업체별 수량 */
  const recommendPicks = (target: number): Record<string, string> =>
    Object.fromEntries(splitPlan(rec.ranked, target, null, SUPPLIER_ORDER_LIMIT).allocations.map((a) => [a.supplier.name, String(a.qty)]));

  const [action, setAction] = useState<OriginalPoAction>('유지');
  // 목표 수량: [추천 설정]이 이 수량을 업체에 나눠 채운다
  const [targetText, setTargetText] = useState(cover > 0 ? String(cover) : '');
  // 체크한 업체 → 그 업체에 넣을 수량(입력칸의 글자). 처음에는 추천대로 채워 둔다
  const [picks, setPicks] = useState<Record<string, string>>(() => recommendPicks(cover));
  const [showAll, setShowAll] = useState(false);
  const [confirming, setConfirming] = useState<'alt' | 'wait' | null>(null);

  const target = parseIntStrict(targetText);
  const targetProblem = targetText === '' ? null : qtyError(target);

  const rowProblem = (c: Candidate): string | null => {
    const text = picks[c.name];
    if (text === undefined) return null;
    const n = parseIntStrict(text);
    if (!Number.isInteger(n) || n < 1) return '1 이상의 정수';
    return n > c.maxQty ? `최대 ${num(c.maxQty)}개` : null;
  };
  const checkedRows = rec.ranked.filter((c) => c.name in picks);
  const rowsValid = checkedRows.every((c) => rowProblem(c) === null);
  // 발주 계획: 체크한 업체와 그 수량
  const plan = { allocations: rowsValid ? checkedRows.map((c) => ({ supplier: c, qty: parseIntStrict(picks[c.name]) })) : [] };
  const qty = plan.allocations.reduce((sum, a) => sum + a.qty, 0);
  const hasQty = qty > 0;
  const calcQty = qty;
  const planOk = plan.allocations.length > 0;
  const split = plan.allocations.length > 1;
  const candidate = plan.allocations[0]?.supplier ?? rec.ranked.find((c) => c.maxQty > 0) ?? null;
  const planAmount = plan.allocations.reduce((sum, a) => sum + (unitPriceOf(part, a.supplier.name) ?? 0) * a.qty, 0);
  const lastArrival = plan.allocations.map((a) => a.supplier.arrival).sort().pop() ?? null;
  const maxTotal = rec.ranked.reduce((sum, c) => sum + c.maxQty, 0);

  const visible = showAll ? rec.ranked : rec.ranked.slice(0, 3);
  // 체크한 업체가 상위 3곳 밖이면 접힌 상태에서도 보이게 한다
  const shown = [...visible, ...rec.ranked.filter((c) => !visible.includes(c) && c.name in picks)];
  const riskCandidates = rec.ranked.filter((c) => c.grade === '위험');
  const riskInPlan = plan.allocations.find((a) => a.supplier.grade === '위험')?.supplier ?? null;

  function toggle(c: Candidate) {
    setPicks((prev) => {
      const next = { ...prev };
      if (c.name in next) delete next[c.name];
      // 새로 체크하면 기본 50개 (남은 공급 능력이 그보다 적으면 그만큼)
      else next[c.name] = String(Math.min(SUPPLIER_ORDER_LIMIT, c.maxQty));
      return next;
    });
  }

  const scenarioAllocations = plan.allocations.map((a) => ({ altLeadDays: a.supplier.altLeadDays, qty: a.qty }));
  const alt = useMemo(
    () =>
      candidate && planOk
        ? altScenario({ state, disruption, altLeadDays: candidate.altLeadDays, qty, action, normalTotalInput: normal.sim.totalInput, allocations: scenarioAllocations })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, disruption, candidate, planOk, qty, action, normal.sim.totalInput, JSON.stringify(scenarioAllocations)],
  );
  const altLate = useMemo(
    () =>
      candidate && planOk && riskInPlan
        ? altScenario({
            state,
            disruption,
            altLeadDays: candidate.altLeadDays,
            qty,
            action,
            normalTotalInput: normal.sim.totalInput,
            lateDays: RISK_LATE_DAYS,
            allocations: scenarioAllocations,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, disruption, candidate, planOk, riskInPlan, qty, action, normal.sim.totalInput, JSON.stringify(scenarioAllocations)],
  );

  const afterPos = applyOriginalPoAction(state.purchaseOrders, disruption.id, action, calcQty);
  const poSummary = originalPoSummary(delayedPos, afterPos);
  const orderTotal = state.customerOrders.reduce((sum, o) => sum + o.qty, 0);
  const normalEnd = normal.sim.endStock[part.code] ?? 0;

  // 취소인데 대체 수량이 원래 발주보다 적으면 경고 (날짜는 시뮬레이션의 첫 정지·감산일)
  const shortBy = action === '취소' && hasQty ? delayedQty - qty : 0;
  const firstShortDay = alt?.sim.days.find((d) => d.kind !== '정상' && d.bottleneck === part.code)?.date ?? null;

  function chooseAction(next: OriginalPoAction) {
    setAction(next);
    // 옵션을 바꾸면 목표 수량과 업체별 수량을 그 옵션의 추천값으로 다시 채운다
    const recommended = recommendedQty(next, cover, delayedQty);
    setTargetText(recommended > 0 ? String(recommended) : '');
    setPicks(recommendPicks(recommended));
  }

  /** 원래 발주 처리 옵션마다 실제로 어떻게 되는지: 유지와 감량은 대체 수량이 같아도 받는 총량이 다르다 */
  function actionResult(a: OriginalPoAction): string {
    const altQty = a === action ? qty : recommendedQty(a, cover, delayedQty);
    const after = applyOriginalPoAction(state.purchaseOrders, disruption.id, a, altQty);
    const kept = delayedPosOf(after, disruption.id).reduce((sum, po) => sum + po.qty, 0);
    const original = a === '유지' ? `원래 발주 ${num(delayedQty)}개 그대로 받음` : a === '감량' ? `원래 발주 ${num(delayedQty)}개 → ${num(kept)}개로 줄임` : `원래 발주 ${num(delayedQty)}개 취소`;
    return `${original} + 대체 ${num(altQty)}개 = 모두 ${num(kept + altQty)}개 받음`;
  }

  const planName = split ? `${plan.allocations.length}곳 분할` : (candidate?.name ?? '');
  const chartRows: ChartRow[] = normal.sim.cumulative.map((row, i) => ({
    date: row.date,
    normal: row.cum,
    wait: wait.sim.cumulative[i].cum,
    ...(alt ? { alt: alt.sim.cumulative[i].cum } : {}),
    ...(altLate ? { altLate: altLate.sim.cumulative[i].cum } : {}),
  }));
  const chartSeries: ChartSeries[] = [
    { key: 'normal', name: '정상 계획', color: CHART_COLORS.gray, dashed: true },
    { key: 'wait', name: '대응하지 않음', color: CHART_COLORS.red },
    ...(alt ? [{ key: 'alt', name: `대체 (${planName})`, color: CHART_COLORS.blue }] : []),
    ...(altLate ? [{ key: 'altLate', name: `대체 · ${RISK_LATE_DAYS}일 늦을 경우`, color: CHART_COLORS.blue, dashed: true }] : []),
  ];

  async function confirmAlt(employeeNo: string): Promise<boolean> {
    if (!candidate || !planOk) return false;
    const pos = await save((api) =>
      api.confirmAlternative({
        disruptionId: disruption.id,
        supplierName: candidate.name,
        qty,
        action,
        employeeNo,
        allocations: plan.allocations.map((a) => ({ supplierName: a.supplier.name, qty: a.qty })),
      }),
    );
    if (pos) {
      notify('success', `대체 발주를 확정했습니다. (${plan.allocations.map((a) => `${a.supplier.name} ${num(a.qty)}개`).join(' + ')})`);
      navigate('/');
    }
    return !!pos;
  }

  async function chooseWait(employeeNo: string): Promise<boolean> {
    const ok = await save(async (api) => {
      await api.decideWait({ disruptionId: disruption.id, employeeNo });
      return true;
    });
    if (ok) notify('success', "'대응하지 않음'으로 결정했습니다. 아래 고객 안내 문구를 확인하세요.");
    return !!ok;
  }

  return (
    <>
      {confirming === 'alt' && candidate && planOk && (
        <EmployeeConfirmModal title="대체 발주 확정" confirmLabel="대체 발주 확정" wide onConfirm={confirmAlt} onClose={() => setConfirming(null)}>
          <p className="font-semibold text-slate-900">
            {part.name} {num(qty)}개를 {split ? `${plan.allocations.length}개 업체에 나눠 ` : ''}대체 발주합니다.
          </p>
          <ul className="mt-1.5 list-disc pl-5">
            {plan.allocations.map((a) => (
              <li key={a.supplier.name}>
                {a.supplier.name} {num(a.qty)}개 · 도착 예정 {formatMD(a.supplier.arrival)} · {won((unitPriceOf(part, a.supplier.name) ?? 0) * a.qty)}
              </li>
            ))}
          </ul>
          <p className="mt-1.5">
            합계 {won(planAmount)} · 원래 발주: {poSummary || '해당 없음'}
          </p>
        </EmployeeConfirmModal>
      )}
      {confirming === 'wait' && (
        <EmployeeConfirmModal title="대응하지 않음" confirmLabel="대응하지 않음" onConfirm={chooseWait} onClose={() => setConfirming(null)}>
          이 차질에 대응하지 않습니다. 대체 발주 없이 원래 발주({delayedPos.map((po) => `${po.id} ${formatMD(po.expectedArrival)} 도착 예정`).join(', ') || '지연 중인 발주 없음'})를
          기다립니다. 예상: 라인 정지 {wait.lineStopDays}일 · 생산 손실 {num(wait.loss)}대 · 납기 지연 주문 {wait.lateOrders.length}건. 결정한 사람은
          이력에 남습니다.
        </EmployeeConfirmModal>
      )}

      <Card
        title={`대체 업체 추천: ${part.materialName} 공급 업체 ${rec.total}곳 중`}
        aside={
          <span className="cursor-help text-xs text-slate-500 underline decoration-dotted" title={RANK_RULE_TEXT}>
            순위 기준
          </span>
        }
      >
        {noAltNeeded && (
          <p className="mx-5 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold leading-relaxed text-emerald-800">
            ✅ {noAltNeededMessage(disruption, part)} 그래도 대체 발주를 하려면 아래에서 수량을 직접 넣으세요.
          </p>
        )}
        {candidate ? (
          <>
            {!noAltNeeded && (
              <p className="px-5 pt-4 text-sm font-semibold leading-relaxed text-slate-900">{recommendMessage(disruption, part, rec.ranked[0])}</p>
            )}
            <div className="mx-5 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-blue-200 bg-accent-light px-4 py-3 text-[13px] text-slate-800">
              <label className="font-semibold">
                목표 수량{' '}
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={targetText}
                  onChange={(e) => setTargetText(e.target.value)}
                  aria-label="대체 목표 수량"
                  placeholder={noAltNeeded ? '불필요' : ''}
                  className="tabular mx-1 w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
                />
                개
              </label>
              <Button size="sm" variant="primary" onClick={() => setPicks(recommendPicks(target))} disabled={targetText === '' || !!targetProblem}>
                추천 설정
              </Button>
              <span className="text-xs text-slate-600">
                목표 수량을 순위대로 한 업체에 {SUPPLIER_ORDER_LIMIT}개씩 나눠 체크합니다. 체크와 수량은 아래 표에서 직접 바꿀 수 있습니다.
              </span>
              {targetProblem && <span className="w-full text-xs font-medium text-red-600">{targetProblem}</span>}
              {!targetProblem && targetText !== '' && target > maxTotal && (
                <span className="w-full text-xs font-medium text-red-600">
                  후보 업체의 남은 공급 능력을 모두 합쳐도 {num(maxTotal)}개입니다. 목표 {num(target)}개를 다 채울 수 없습니다.
                </span>
              )}
            </div>
            <p className="tabular px-5 pt-3 text-[13px] text-slate-800">
              {planOk ? (
                <>
                  발주 계획: <strong>{plan.allocations.map((a) => `${a.supplier.name} ${num(a.qty)}개`).join(' + ')}</strong> = 합계{' '}
                  <strong className="text-accent">{num(qty)}개</strong>
                  {lastArrival && ` · 마지막 도착 ${formatMD(lastArrival)}`}
                  {!targetProblem && targetText !== '' && qty !== target && (
                    <span className={qty < target ? 'font-semibold text-red-600' : 'text-slate-500'}>
                      {' '}
                      · 목표 {num(target)}개보다 {num(Math.abs(target - qty))}개 {qty < target ? '적음' : '많음'}
                    </span>
                  )}
                </>
              ) : rowsValid ? (
                <span className="text-slate-500">대체 발주를 넣을 업체를 체크하세요. [추천 설정]을 누르면 추천 업체가 자동으로 체크됩니다.</span>
              ) : (
                <span className="font-semibold text-red-600">수량이 잘못된 업체가 있습니다. 표의 빨간 안내를 확인하세요.</span>
              )}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[13px]">
                <thead className="border-y border-slate-100 text-[11px] font-semibold text-slate-500">
                  <tr>
                    <th className="py-2 pl-5 pr-2">선택 · 순위</th>
                    <th className="px-2 py-2">업체</th>
                    <th className="px-2 py-2">대체 납기</th>
                    <th className="px-2 py-2">도착 예정</th>
                    <th className="px-2 py-2 text-right">남은 {part.name} 공급 능력</th>
                    <th className="px-2 py-2 text-right">발주 수량</th>
                    <th className="py-2 pl-2 pr-5">납기 준수율</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((c) => (
                    <CandidateRow
                      key={c.code}
                      c={c}
                      part={part}
                      checked={c.name in picks}
                      qtyText={picks[c.name] ?? ''}
                      problem={rowProblem(c)}
                      onToggle={() => toggle(c)}
                      onQty={(text) => setPicks((prev) => ({ ...prev, [c.name]: text }))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <p className="text-xs text-slate-600">
                {riskCandidates.length > 0
                  ? `위험 등급 ${riskCandidates.length}곳은 후순위로 내렸습니다 (${riskCandidates.map((c) => `${c.name} ${c.onTimeRate}%`).join(', ')})`
                  : '위험 등급 업체가 없습니다'}
                {rec.excludedDisrupted.length > 0 && ` · 차질 진행 중이라 제외: ${rec.excludedDisrupted.map((s) => s.name).join(', ')}`}
                {rec.excludedTooLate.length > 0 &&
                  ` · 원래 발주(${originalArrival ? formatMD(originalArrival) : ''})보다 늦게 와서 제외: ${rec.excludedTooLate.map((s) => s.name).join(', ')}`}
              </p>
              {rec.total > 3 && (
                <Button size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                  {showAll ? '상위 3곳만 보기 ▲' : `전체 ${rec.total}곳 보기 ▼`}
                </Button>
              )}
            </div>
            <p className="px-5 pb-3 text-[11px] text-slate-500">
              후보는 같은 소재({part.materialName})를 공급하는 업체입니다. 남은 공급 능력 = (월 공급가능량 − 최근 한 달 동안 그 업체에 이미 발주한 양) ÷ {part.name} 1개당
              소재 {part.kgPerUnit}kg. 한 업체에 넣는 수량은 기본 {SUPPLIER_ORDER_LIMIT}개이고, 남은 공급 능력까지 바꿀 수 있습니다.
            </p>
          </>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            {part.materialName}를 공급할 수 있는 다른 업체가 없습니다
            {rec.excludedDisrupted.length + rec.excludedTooLate.length > 0 &&
              ` (차질 진행 중 ${rec.excludedDisrupted.length}곳, 원래 발주보다 늦는 ${rec.excludedTooLate.length}곳 제외)`}
            . '대응하지 않음'만 선택할 수 있습니다.
          </p>
        )}
      </Card>

      <Card title="예상 결과 비교">
        <div className="space-y-4 px-5 py-4">
          <fieldset>
            <legend className="text-[13px] font-semibold text-slate-700">
              원래 발주(
              {delayedPos.length > 0
                ? delayedPos.map((po) => `${po.id} ${num(po.qty)}개 · ${formatMD(po.expectedArrival)} 도착 예정`).join(', ')
                : '지연 중인 발주 없음'}
              ) 처리
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {ACTIONS.map((a) => (
                <label
                  key={a}
                  className={`cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                    action === a ? 'border-accent bg-accent-light' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <input type="radio" name="original-po-action" checked={action === a} onChange={() => chooseAction(a)} className="h-4 w-4 accent-blue-700" />
                    {a}
                    <span className="text-xs font-medium text-slate-500">추천 대체 {num(recommendedQty(a, cover, delayedQty))}개</span>
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-slate-600">{ACTION_HELP[a]}</span>
                  <span className="tabular mt-1.5 block rounded bg-white/70 px-2 py-1 text-xs font-semibold leading-snug text-slate-900">{actionResult(a)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <p className="text-[13px] font-semibold text-slate-700">
              대체 수량 합계 <strong className="tabular text-base text-slate-900">{num(qty)}개</strong>
              <span className="ml-2 text-xs font-medium text-slate-500">
                {action === '취소'
                  ? `추천: 원래 발주 전량 ${num(delayedQty)}개`
                  : noAltNeeded
                    ? '추천: 0개 (재고와 다른 입고 예정분으로 지연 기간을 버틸 수 있음)'
                    : `추천: ${num(cover)}개 = 지연된 발주가 올 때까지 모자라는 양 (현재 재고와 다른 입고 예정분을 뺀 값)`}
                {' · 수량은 위 추천 표에서 바꿉니다'}
              </span>
            </p>
            {planOk && (
              <p className="tabular w-full text-[13px] text-slate-700">
                대체 발주 금액 <strong className="text-slate-900">{won(planAmount)}</strong>
                <span className="text-xs text-slate-500">
                  {' '}
                  ({plan.allocations.map((a) => `${a.supplier.name} 개당 ${won(unitPriceOf(part, a.supplier.name) ?? 0)} × ${num(a.qty)}개`).join(' + ')}
                  {unitPriceOf(part, disruption.supplierName) !== null &&
                    ` · 원래 업체 ${disruption.supplierName}는 개당 ${won(unitPriceOf(part, disruption.supplierName)!)}`}
                  )
                </span>
              </p>
            )}
          </div>

          {shortBy > 0 && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-700">
              {firstShortDay
                ? `원래 발주보다 ${num(shortBy)}개 적어 ${formatMD(firstShortDay)}부터 ${withParticle(part.name, '이', '가')} 부족합니다.`
                : `원래 발주보다 ${num(shortBy)}개 적어 ${part.name} 재고가 정상 계획보다 줄어듭니다.`}
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <OutcomeCard
              title="대응하지 않음 (원래 발주를 기다림)"
              tone="red"
              outcome={wait}
              orderTotal={orderTotal}
              partName={part.name}
              endStock={wait.sim.endStock[part.code] ?? 0}
              normalEndStock={normalEnd}
            />
            {alt && candidate ? (
              <div>
                <OutcomeCard
                  title={`대체 (${planName} · 원래 발주 ${action})`}
                  tone="blue"
                  outcome={alt}
                  orderTotal={orderTotal}
                  partName={part.name}
                  endStock={alt.sim.endStock[part.code] ?? 0}
                  normalEndStock={normalEnd}
                />
                {altLate && riskInPlan && (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-900">
                    ⚠ {riskLateMessage(riskInPlan, altLate)}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
                {!candidate
                  ? '대체할 수 있는 업체가 없습니다.'
                  : noAltNeeded && !hasQty
                    ? "대체 발주가 필요하지 않습니다. '대응하지 않음'을 권합니다."
                    : '추천 표에서 업체를 체크하고 수량을 넣으면 결과를 계산합니다.'}
              </div>
            )}
          </div>

          <ScenarioChart ariaLabel="시나리오별 누적 완성 대수" rows={chartRows} series={chartSeries} height={260} />

          {alt && candidate && (
            <p className="rounded-lg bg-accent-light px-4 py-3 text-sm font-semibold leading-relaxed text-slate-900">
              {resultMessage({ part, candidate, qty, action, alt, allocations: plan.allocations })}
            </p>
          )}

          <details className="text-[13px]">
            <summary className="cursor-pointer font-semibold text-slate-600">주문별 예상 완료일 비교</summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[520px] text-left">
                <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <tr>
                    <th className="px-3 py-2">주문</th>
                    <th className="px-3 py-2">납기</th>
                    <th className="px-3 py-2">대응하지 않음</th>
                    <th className="px-3 py-2">대체</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {wait.orders.map((o, i) => (
                    <tr key={o.id}>
                      <td className="px-3 py-2 font-semibold text-slate-900">
                        {o.id} {o.customer} {num(o.qty)}대
                      </td>
                      <td className="tabular px-3 py-2 text-slate-700">{formatMD(o.dueDate)}</td>
                      <td className="px-3 py-2">
                        <span className="tabular mr-2 text-slate-900">{o.doneDate ? formatMD(o.doneDate) : '–'}</span>
                        <OrderStatus order={o} />
                      </td>
                      <td className="px-3 py-2">
                        {alt ? (
                          <>
                            <span className="tabular mr-2 text-slate-900">
                              {alt.orders[i].doneDate ? formatMD(alt.orders[i].doneDate!) : '–'}
                            </span>
                            <OrderStatus order={alt.orders[i]} />
                          </>
                        ) : (
                          '–'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <p className="mr-auto text-xs text-slate-500">
              {session ? '결정은 로그인한 사원 이름으로 이력에 남습니다.' : '로그인하면 여기서 대응을 결정할 수 있습니다. 지금은 예상 결과만 볼 수 있습니다.'}
            </p>
            <Button auth onClick={() => setConfirming('wait')} disabled={disruption.status === '기다리기'}>
              {disruption.status === '기다리기' ? '대응하지 않음으로 결정됨' : '대응하지 않음'}
            </Button>
            <Button auth variant="primary" onClick={() => setConfirming('alt')} disabled={!alt}>
              대체 발주 확정
            </Button>
          </div>
        </div>
      </Card>

      {disruption.status === '기다리기' && <CustomerNoticePanel wait={wait} part={part} />}
    </>
  );
}

/** 결정이 끝난 뒤 (상태가 '대체발주' 또는 '해결') */
function DecidedSection({ state, disruption, part }: { state: AppState; disruption: Disruption; part: Part }) {
  const { wait } = useMemo(() => baseScenarios(state), [state]);
  const altPos = state.purchaseOrders.filter((po) => po.disruptionId === disruption.id && po.kind === '대체');
  const originals = state.purchaseOrders.filter((po) => po.disruptionId === disruption.id && po.kind === '일반');

  return (
    <Card title="결정 내용">
      <div className="space-y-3 px-5 py-4 text-sm text-slate-800">
        {disruption.altPoId ? (
          <>
            <p className="font-semibold">
              {part.name} {num(disruption.altQty ?? 0)}개를 대체 발주했습니다. 원래 발주 처리: {disruption.originalPoAction}
            </p>
            <ul className="space-y-1 text-[13px] text-slate-700">
              {altPos.map((po) => (
                <li key={po.id}>
                  대체 발주 {po.id}: {po.supplierName} {num(po.qty)}개 · {formatMD(po.expectedArrival)} 도착 예정 · {po.status}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="font-semibold">대응하지 않음: 대체 발주 없이 원래 발주를 기다리기로 했습니다.</p>
        )}
        {originals.length > 0 && (
          <ul className="space-y-1 text-[13px] text-slate-600">
            {originals.map((po) => (
              <li key={po.id}>
                원래 발주 {po.id}: {num(po.qty)}개
                {po.qty !== po.originalQty && ` (원래 ${num(po.originalQty)})`} · {formatMD(po.expectedArrival)} · {po.status}
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-lg bg-slate-50 px-4 py-3 text-[13px]">
          <p className="font-semibold text-slate-900">
            현재 예측: 라인 정지 {wait.lineStopDays}일 · 납기 지연 주문 {wait.lateOrders.length}건
          </p>
          <ul className="mt-1.5 space-y-1">
            {wait.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2">
                <span className="text-slate-700">
                  {o.id} {o.customer} · 납기 {formatMD(o.dueDate)} · 예상 {o.doneDate ? formatMD(o.doneDate) : '–'}
                </span>
                <OrderStatus order={o} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

/** [해결 완료] 창: 지연 중이던 발주가 실제로 언제 들어왔는지 받는다 */
function ResolveModal({ state, disruption, onClose }: { state: AppState; disruption: Disruption; onClose: () => void }) {
  const { save, notify } = useAppData();
  const baseDate = state.settings.baseDate;
  const targets = resolvablePos(state.purchaseOrders, disruption.id);
  // 기본값은 오늘: '방금 들어왔다'가 가장 흔하다
  const [arrivals, setArrivals] = useState<Record<string, string>>(() => Object.fromEntries(targets.map((po) => [po.id, baseDate])));
  const problems = Object.fromEntries(
    targets.map((po) => {
      const date = arrivals[po.id] ?? '';
      return [po.id, date === '' ? '날짜를 선택하세요.' : date < po.orderDate ? `발주일(${formatMD(po.orderDate)})보다 빠를 수 없습니다.` : null];
    }),
  );

  async function resolve(employeeNo: string): Promise<boolean> {
    const ok = await save(async (api) => {
      await api.resolveDisruption({ disruptionId: disruption.id, employeeNo, arrivals });
      return true;
    });
    if (ok) notify('success', `차질 ${disruption.id}을(를) 해결 완료로 바꾸고 예측을 다시 계산했습니다.`);
    return !!ok;
  }

  return (
    <EmployeeConfirmModal
      title={`차질 해결: ${disruption.id}`}
      confirmLabel="해결 완료"
      canConfirm={Object.values(problems).every((p) => p === null)}
      onConfirm={resolve}
      onClose={onClose}
    >
      {targets.length === 0 ? (
        <p>지연 중인 발주가 없습니다. 해결 완료로 바꾸면 대시보드의 배너와 카드 배지가 사라집니다.</p>
      ) : (
        <div className="space-y-3">
          <p>
            지연되던 발주가 <strong>실제로 들어온 날짜</strong>를 넣으세요. 생산 예측을 이 날짜로 다시 계산합니다.
          </p>
          {targets.map((po) => {
            const date = arrivals[po.id] ?? '';
            return (
              <Field
                key={po.id}
                label={`${po.id} · ${partOf(po.partCode).name} ${num(po.qty)}개 · ${po.supplierName} — 실제 도착일`}
                error={problems[po.id]}
                hint={
                  <>
                    원래 예정 {formatMD(po.plannedArrival)} · 지연 예상 {formatMD(po.expectedArrival)} ·{' '}
                    {date !== '' && date <= baseDate ? (
                      <strong className="text-emerald-700">오늘 이전 → 입고 처리합니다 (재고 +{num(po.qty)}개)</strong>
                    ) : (
                      <strong className="text-slate-700">내일 이후 → 그날 들어오는 것으로 확정합니다</strong>
                    )}
                  </>
                }
              >
                <input
                  className={INPUT_CLASS}
                  type="date"
                  min={po.orderDate}
                  value={date}
                  onChange={(e) => setArrivals((prev) => ({ ...prev, [po.id]: e.target.value }))}
                  aria-label={`${po.id} 실제 도착일`}
                />
              </Field>
            );
          })}
        </div>
      )}
    </EmployeeConfirmModal>
  );
}

export function DisruptionPage({ state }: { state: AppState }) {
  const { id } = useParams();
  const [resolving, setResolving] = useState(false);
  const disruption = state.disruptions.find((d) => d.id === id);

  // 영향 분석은 차질이 해결되기 전의 '정상 계획 vs 기다리기'로 본다
  const scenarios = useMemo(() => baseScenarios(state), [state]);

  if (!disruption) {
    return (
      <Card>
        <div className="px-5 py-12 text-center">
          <p className="text-sm text-slate-600">차질 {id}을(를) 찾을 수 없습니다. 데이터가 초기화되었을 수 있습니다.</p>
          <Link to="/" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">
            ← 대시보드로
          </Link>
        </div>
      </Card>
    );
  }

  const part = partOf(disruption.partCode);
  const material = materialOf(part.materialName);
  const linked = state.purchaseOrders.filter((po) => po.disruptionId === disruption.id && po.kind === '일반');
  const open = disruption.status === '발생' || disruption.status === '기다리기';
  // 이 차질에 한 일들 (등록, 지연 연장, 결정, 해결) — 오래된 것부터
  const history = state.logs.filter((l) => l.target === disruption.id).reverse();

  return (
    <div className="space-y-4">
      {resolving && <ResolveModal state={state} disruption={disruption} onClose={() => setResolving(false)} />}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm font-semibold text-accent hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">차질 {disruption.id}</h1>
        <Badge tone={DISRUPTION_STATUS_TONE[disruption.status]}>상태: {disruptionStatusLabel(disruption.status)}</Badge>
        {disruption.status !== '해결' && (
          <Button auth size="sm" className="ml-auto" onClick={() => setResolving(true)}>
            해결 완료
          </Button>
        )}
      </div>

      <Card title="차질 정보">
        <div className="space-y-2 px-5 py-4">
          <p className="text-base font-bold text-slate-900">{disruptionMessage(disruption, part)}</p>
          <p className="text-[13px] text-slate-600">
            사유 {disruption.reason} · 등록 {formatMD(disruption.detectedDate)} · 입력자 {disruption.createdBy ?? '(이름 없음)'}
          </p>
          <p className="text-[13px] text-slate-700">
            영향 발주{' '}
            {linked.length === 0
              ? '없음'
              : linked.map((po, i) => (
                  <span key={po.id}>
                    {i > 0 && ', '}
                    <strong className="font-mono text-slate-900">{po.id}</strong> {num(po.qty)}개
                    {po.qty !== po.originalQty && ` (원래 ${num(po.originalQty)})`}: <s className="text-slate-400">{formatMD(po.plannedArrival)}</s> →{' '}
                    <strong className={po.status === '지연' ? 'text-red-600' : 'text-slate-900'}>{formatMD(po.expectedArrival)}</strong>
                    {po.status !== '지연' && ` (${po.status})`}
                  </span>
                ))}
          </p>
          {open && (
            <p
              className={`rounded-lg border px-4 py-3 text-sm font-semibold leading-relaxed ${
                scenarios.wait.lineStopDays === 0 && scenarios.wait.lateOrders.length === 0
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {impactMessage(scenarios.wait)}
            </p>
          )}
          {material && (
            <p className="text-xs text-slate-500">
              참고: {part.materialName} 대체업체 평균 납기 {material.altAvgLeadDays}일 (Excel 자재 시트)
            </p>
          )}
        </div>
      </Card>

      {open ? (
        // 차질이 바뀌거나 지연이 연장되면 입력값을 처음부터 다시 잡는다
        <DecisionSection key={`${disruption.id}-${disruption.delayDays}`} state={state} disruption={disruption} part={part} />
      ) : (
        <DecidedSection state={state} disruption={disruption} part={part} />
      )}

      <Card title="처리 이력" aside={<span className="text-xs text-slate-500">등록 · 지연 연장 · 결정 · 해결</span>}>
        {history.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-slate-500">
            {state.logReady ? '기록이 없습니다' : '활동 기록 테이블이 없어 기록이 저장되지 않습니다 (이력 페이지의 안내 참고)'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 text-[13px]">
            {history.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5">
                <span className="tabular w-24 shrink-0 text-slate-500">{timeLabel(l.at)}</span>
                <strong className="w-28 shrink-0 text-slate-900">{l.action}</strong>
                <span className="min-w-0 flex-1 text-slate-700">{l.detail}</span>
                <span className="text-slate-500">{l.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
