// 차질 상세 `/disruptions/:id` (DESIGN.md §5 F2-2 ~ F2-4, §7.3)
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmployeeField } from '../components/EmployeeField';
import { employeeError } from '../lib/employees';
import { OrderStatus } from '../components/OrdersTable';
import { CHART_COLORS, ScenarioChart, type ChartRow, type ChartSeries } from '../components/ScenarioChart';
import { Badge, Button, Card, DISRUPTION_STATUS_TONE, GradeBadge, parseIntStrict } from '../components/ui';
import { altScenario, baseScenarios } from '../lib/actions';
import { qtyError } from '../lib/api';
import { RISK_LATE_DAYS } from '../lib/constants';
import { formatMD } from '../lib/date';
import { num, withParticle } from '../lib/format';
import { customerNotices, disruptionMessage, impactMessage, recommendMessage, resultMessage, riskLateMessage } from '../lib/messages';
import {
  applyOriginalPoAction,
  coverQty,
  delayedPosOf,
  recommendedQty,
  stopBreakdown,
  type ScenarioOutcome,
} from '../lib/planning';
import { RANK_RULE_TEXT, recommendSuppliers, type Candidate } from '../lib/recommend';
import { materialOf, partOf, reference } from '../lib/reference';
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

function CandidateRow({
  c,
  selected,
  selectable,
  onSelect,
}: {
  c: Candidate;
  selected: boolean;
  selectable: boolean;
  onSelect: () => void;
}) {
  const risk = c.grade === '위험';
  return (
    <tr className={`${risk ? 'bg-red-50' : ''} ${selected ? 'outline outline-2 -outline-offset-2 outline-accent' : ''}`}>
      <td className="py-2 pl-5 pr-2">
        <label className="flex items-center gap-2 whitespace-nowrap">
          {selectable && (
            <input type="radio" name="candidate" checked={selected} onChange={onSelect} className="h-4 w-4 accent-blue-700" />
          )}
          <strong className="tabular text-slate-900">{c.rank}</strong>
          {risk && <span className="text-[11px] font-semibold text-red-600">위험 · 빨라도 후순위</span>}
        </label>
      </td>
      <td className="px-2 py-2 font-semibold text-slate-900">
        {c.name} <span className="font-mono text-[11px] font-medium text-slate-400">{c.code}</span>
      </td>
      <td className="tabular px-2 py-2 text-slate-900">{c.altLeadDays}일</td>
      <td className="tabular px-2 py-2 font-semibold text-slate-900">{formatMD(c.arrival)}</td>
      <td className="tabular px-2 py-2 text-right text-slate-700">{num(c.monthlyCapacityKg)}kg</td>
      <td className="tabular px-2 py-2 text-right text-slate-700">{num(Math.round(c.requiredKg * 10) / 10)}kg</td>
      <td className="px-2 py-2 text-center">
        {c.capacityOk ? (
          <span className="font-bold text-emerald-700" title="월 공급가능량 이내">
            ✓ 가능
          </span>
        ) : (
          <span className="font-bold text-red-600" title="월 공급가능량 초과">
            ✗ 초과
          </span>
        )}
      </td>
      <td className="py-2 pl-2 pr-5">
        <GradeBadge rate={c.onTimeRate} grade={c.grade} />
      </td>
    </tr>
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
      title="고객 안내 문구 (기다리기 선택)"
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

/** 결정 입력과 비교 (상태가 '발생' 또는 '기다리기'일 때) */
function DecisionSection({ state, disruption, part }: { state: AppState; disruption: Disruption; part: Part }) {
  const { save, notify } = useAppData();
  const [employeeNo, setEmployeeNo] = useState('');
  const navigate = useNavigate();
  const { settings } = state;
  const linePart = state.lineParts.find((p) => p.partCode === disruption.partCode)!;
  const delayedPos = delayedPosOf(state.purchaseOrders, disruption.id);
  const delayedQty = delayedPos.reduce((sum, po) => sum + po.qty, 0);
  const cover = coverQty(disruption.delayDays, settings.dailyCapacity, linePart.qtyPerCar, delayedQty);

  const [action, setAction] = useState<OriginalPoAction>('유지');
  const [qtyText, setQtyText] = useState(String(recommendedQty('유지', cover, delayedQty)));
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState<'alt' | 'wait' | null>(null);

  const qty = parseIntStrict(qtyText);
  const qtyProblem = qtyError(qty);
  const calcQty = qtyProblem ? 0 : qty;

  const { normal, wait } = useMemo(() => baseScenarios(state), [state]);
  // 대체 수량이 바뀌면 공급 가능 여부가 바뀔 수 있으므로 순위도 다시 계산한다
  const rec = useMemo(
    () =>
      recommendSuppliers({
        part,
        excludeSupplierName: disruption.supplierName,
        suppliers: reference.suppliers,
        baseDate: settings.baseDate,
        qty: calcQty,
      }),
    [part, disruption.supplierName, settings.baseDate, calcQty],
  );
  const candidate = rec.ranked.find((c) => c.name === pickedName) ?? rec.ranked[0] ?? null;
  const visible = showAll ? rec.ranked : rec.ranked.slice(0, 3);
  // 선택한 후보가 상위 3곳 밖이면 접힌 상태에서도 보이게 한다
  const shown = candidate && !visible.includes(candidate) ? [...visible, candidate] : visible;
  const riskCandidates = rec.ranked.filter((c) => c.grade === '위험');

  const alt = useMemo(
    () =>
      candidate && !qtyProblem
        ? altScenario({ state, disruption, altLeadDays: candidate.altLeadDays, qty, action, normalTotalInput: normal.sim.totalInput })
        : null,
    [state, disruption, candidate, qty, qtyProblem, action, normal.sim.totalInput],
  );
  const altLate = useMemo(
    () =>
      candidate && candidate.grade === '위험' && !qtyProblem
        ? altScenario({
            state,
            disruption,
            altLeadDays: candidate.altLeadDays,
            qty,
            action,
            normalTotalInput: normal.sim.totalInput,
            lateDays: RISK_LATE_DAYS,
          })
        : null,
    [state, disruption, candidate, qty, qtyProblem, action, normal.sim.totalInput],
  );

  const afterPos = applyOriginalPoAction(state.purchaseOrders, disruption.id, action, calcQty);
  const poSummary = originalPoSummary(delayedPos, afterPos);
  const orderTotal = state.customerOrders.reduce((sum, o) => sum + o.qty, 0);
  const normalEnd = normal.sim.endStock[part.code] ?? 0;

  // 취소인데 대체 수량이 원래 발주보다 적으면 경고 (날짜는 시뮬레이션의 첫 정지·감산일)
  const shortBy = action === '취소' && !qtyProblem ? delayedQty - qty : 0;
  const firstShortDay = alt?.sim.days.find((d) => d.kind !== '정상' && d.bottleneck === part.code)?.date ?? null;

  function chooseAction(next: OriginalPoAction) {
    setAction(next);
    // 옵션을 바꾸면 대체 수량을 그 옵션의 기본값으로 다시 채운다
    setQtyText(String(recommendedQty(next, cover, delayedQty)));
  }

  const chartRows: ChartRow[] = normal.sim.cumulative.map((row, i) => ({
    date: row.date,
    normal: row.cum,
    wait: wait.sim.cumulative[i].cum,
    ...(alt ? { alt: alt.sim.cumulative[i].cum } : {}),
    ...(altLate ? { altLate: altLate.sim.cumulative[i].cum } : {}),
  }));
  const chartSeries: ChartSeries[] = [
    { key: 'normal', name: '정상 계획', color: CHART_COLORS.gray, dashed: true },
    { key: 'wait', name: '기다리기', color: CHART_COLORS.red },
    ...(alt ? [{ key: 'alt', name: `대체 (${candidate!.name})`, color: CHART_COLORS.blue }] : []),
    ...(altLate ? [{ key: 'altLate', name: `대체 · ${RISK_LATE_DAYS}일 늦을 경우`, color: CHART_COLORS.blue, dashed: true }] : []),
  ];

  async function confirmAlt() {
    if (!candidate || qtyProblem) return;
    const message = [
      `${candidate.name}에 ${part.name} ${num(qty)}개를 대체 발주합니다. (도착 예정 ${formatMD(candidate.arrival)})`,
      `원래 발주: ${poSummary || '해당 없음'}`,
      '',
      '확정할까요?',
    ].join('\n');
    if (!window.confirm(message)) return;
    setSaving('alt');
    const po = await save((api) =>
      api.confirmAlternative({ disruptionId: disruption.id, supplierName: candidate.name, qty, action, employeeNo: employeeNo.trim() }),
    );
    setSaving(null);
    if (po) {
      notify('success', `대체 발주 ${po.id}를 확정했습니다. (${candidate.name} · ${num(qty)}개 · ${formatMD(po.expectedArrival)} 도착 예정)`);
      navigate('/');
    }
  }

  async function chooseWait() {
    setSaving('wait');
    const ok = await save(async (api) => {
      await api.decideWait(disruption.id);
      return true;
    });
    setSaving(null);
    if (ok) notify('success', '기다리기로 결정했습니다. 아래 고객 안내 문구를 확인하세요.');
  }

  return (
    <>
      <Card
        title={`대체 업체 추천: ${part.materialName} 공급 가능 ${rec.total}곳 중`}
        aside={
          <span className="cursor-help text-xs text-slate-500 underline decoration-dotted" title={RANK_RULE_TEXT}>
            순위 기준
          </span>
        }
      >
        {candidate ? (
          <>
            <p className="px-5 pt-4 text-sm font-semibold leading-relaxed text-slate-900">
              {recommendMessage(part, disruption.supplierName, rec.ranked[0])}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[13px]">
                <thead className="border-y border-slate-100 text-[11px] font-semibold text-slate-500">
                  <tr>
                    <th className="py-2 pl-5 pr-2">순위</th>
                    <th className="px-2 py-2">업체</th>
                    <th className="px-2 py-2">대체 납기</th>
                    <th className="px-2 py-2">도착 예정</th>
                    <th className="px-2 py-2 text-right">월 공급가능량</th>
                    <th className="px-2 py-2 text-right">필요량</th>
                    <th className="px-2 py-2 text-center">공급 가능</th>
                    <th className="py-2 pl-2 pr-5">납기 준수율</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((c) => (
                    <CandidateRow key={c.code} c={c} selectable selected={c.name === candidate.name} onSelect={() => setPickedName(c.name)} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <p className="text-xs text-slate-600">
                {riskCandidates.length > 0
                  ? `위험 등급 ${riskCandidates.length}곳은 후순위로 내렸습니다 (${riskCandidates.map((c) => `${c.name} ${c.onTimeRate}%`).join(', ')})`
                  : '위험 등급 업체가 없습니다'}
              </p>
              {rec.total > 3 && (
                <Button size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                  {showAll ? '상위 3곳만 보기 ▲' : `전체 ${rec.total}곳 보기 ▼`}
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            {part.materialName}를 공급할 수 있는 다른 정상 업체가 없습니다. 기다리기만 선택할 수 있습니다.
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
                    <span className="text-xs font-medium text-slate-500">대체 {num(recommendedQty(a, cover, delayedQty))}개</span>
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-slate-600">{ACTION_HELP[a]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <label className="text-[13px] font-semibold text-slate-700">
              대체 수량{' '}
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={qtyText}
                onChange={(e) => setQtyText(e.target.value)}
                aria-invalid={!!qtyProblem}
                className={`tabular mx-1 w-28 rounded-md border px-2.5 py-1.5 text-right text-sm outline-none focus:ring-2 ${
                  qtyProblem ? 'border-red-400 focus:ring-red-100' : 'border-slate-300 focus:border-accent focus:ring-blue-100'
                }`}
              />
              개
            </label>
            <p className="pt-2 text-xs text-slate-500">
              {action === '취소'
                ? `추천: 원래 발주 전량 ${num(delayedQty)}개`
                : `추천: 지연 ${disruption.delayDays}일 × 하루 ${settings.dailyCapacity}대 × 1대당 ${linePart.qtyPerCar}개 = ${num(cover)}개`}
            </p>
            {qtyProblem && <p className="w-full text-xs font-medium text-red-600">{qtyProblem}</p>}
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
              title="기다리기"
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
                  title={`대체 (${candidate.name} · 원래 발주 ${action})`}
                  tone="blue"
                  outcome={alt}
                  orderTotal={orderTotal}
                  partName={part.name}
                  endStock={alt.sim.endStock[part.code] ?? 0}
                  normalEndStock={normalEnd}
                />
                {altLate && (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-900">
                    ⚠ {riskLateMessage(candidate, altLate)}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-4 text-sm text-slate-500">
                {candidate ? '대체 수량을 입력하면 결과를 계산합니다.' : '대체할 수 있는 업체가 없습니다.'}
              </div>
            )}
          </div>

          <ScenarioChart ariaLabel="시나리오별 누적 완성 대수" rows={chartRows} series={chartSeries} height={260} />

          {alt && candidate && (
            <p className="rounded-lg bg-accent-light px-4 py-3 text-sm font-semibold leading-relaxed text-slate-900">
              {resultMessage({ part, candidate, qty, action, alt })}
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
                    <th className="px-3 py-2">기다리기</th>
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

          <div className="flex flex-wrap items-end justify-end gap-2 border-t border-slate-100 pt-4">
            {/* 대체 발주도 발주이므로 사원번호가 필요하다 */}
            <div className="mr-auto w-56">
              <EmployeeField value={employeeNo} onChange={setEmployeeNo} />
            </div>
            <Button onClick={() => void chooseWait()} busy={saving === 'wait'} disabled={saving !== null || disruption.status === '기다리기'}>
              {disruption.status === '기다리기' ? '기다리기로 결정됨' : '기다리기로 결정'}
            </Button>
            <Button variant="primary" onClick={() => void confirmAlt()} busy={saving === 'alt'} disabled={saving !== null || !alt || employeeError(employeeNo) !== null}>
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
  const altPo = state.purchaseOrders.find((po) => po.id === disruption.altPoId);
  const originals = state.purchaseOrders.filter((po) => po.disruptionId === disruption.id && po.kind === '일반');

  return (
    <Card title="결정 내용">
      <div className="space-y-3 px-5 py-4 text-sm text-slate-800">
        {disruption.altPoId ? (
          <p className="font-semibold">
            {disruption.altSupplierName}에 {part.name} {num(disruption.altQty ?? 0)}개를 대체 발주했습니다 ({disruption.altPoId}
            {altPo && ` · ${formatMD(altPo.expectedArrival)} 도착 예정 · ${altPo.status}`}). 원래 발주 처리: {disruption.originalPoAction}
          </p>
        ) : (
          <p className="font-semibold">대체 발주 없이 원래 발주를 기다리기로 했습니다.</p>
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

export function DisruptionPage({ state }: { state: AppState }) {
  const { id } = useParams();
  const { save, notify } = useAppData();
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
  const linked =state.purchaseOrders.filter((po) => po.disruptionId === disruption.id && po.kind === '일반');
  const open = disruption.status === '발생' || disruption.status === '기다리기';

  async function resolve() {
    if (!disruption) return;
    if (!window.confirm(`차질 ${disruption.id}을(를) 해결 완료로 바꿀까요? 대시보드의 배너와 카드 배지가 사라집니다.`)) return;
    setResolving(true);
    const ok = await save(async (api) => {
      await api.resolveDisruption(disruption.id);
      return true;
    });
    setResolving(false);
    if (ok) notify('success', `차질 ${disruption.id}을(를) 해결 완료로 바꿨습니다.`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm font-semibold text-accent hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">차질 {disruption.id}</h1>
        <Badge tone={DISRUPTION_STATUS_TONE[disruption.status]}>상태: {disruption.status}</Badge>
        {disruption.status !== '해결' && (
          <Button size="sm" className="ml-auto" onClick={() => void resolve()} busy={resolving}>
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
                    <strong className="text-red-600">{formatMD(po.expectedArrival)}</strong>
                    {po.status !== '지연' && ` (${po.status})`}
                  </span>
                ))}
          </p>
          {open && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold leading-relaxed text-red-700">
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
        // 차질이 바뀌면 입력값을 처음부터 다시 잡는다
        <DecisionSection key={disruption.id} state={state} disruption={disruption} part={part} />
      ) : (
        <DecidedSection state={state} disruption={disruption} part={part} />
      )}
    </div>
  );
}
