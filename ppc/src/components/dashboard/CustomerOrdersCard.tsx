// 주문 납기 현황 카드: 표 + [납기 추가] + 행마다 [납기 취소]. 추가·취소는 사원번호가 있어야 한다.
import { useMemo, useState } from 'react';
import { previewNewOrder } from '../../lib/actions';
import { qtyError } from '../../lib/api';
import { addDays, formatMD } from '../../lib/date';
import { employeeError } from '../../lib/employees';
import { num } from '../../lib/format';
import type { OrderForecast } from '../../lib/planning';
import { reference } from '../../lib/reference';
import type { AppState } from '../../lib/types';
import { useAppData } from '../../state/AppData';
import { EmployeeConfirmModal, EmployeeField } from '../EmployeeField';
import { OrdersTable } from '../OrdersTable';
import { Button, Card, Field, INPUT_CLASS, Modal, parseIntStrict } from '../ui';

function AddOrderModal({ state, onClose }: { state: AppState; onClose: () => void }) {
  const { save, notify } = useAppData();
  const baseDate = state.settings.baseDate;
  const [customer, setCustomer] = useState('');
  const [qtyText, setQtyText] = useState('');
  const [dueDate, setDueDate] = useState(addDays(baseDate, 14));
  const [employeeNo, setEmployeeNo] = useState('');
  const [saving, setSaving] = useState(false);
  // 납품할 차량 색상 (Excel '차량색상'). 그 색 차체로 만든다
  const [colorCode, setColorCode] = useState(reference.colors[0]?.code ?? '');
  const bodyStock = state.lineParts.find((p) => p.partCode.endsWith(`-${colorCode}`))?.onHand ?? null;

  const qty = parseIntStrict(qtyText);
  const qtyProblem = qtyText === '' ? null : qtyError(qty);
  const dueProblem = dueDate === '' ? '납기 날짜를 선택하세요.' : dueDate < baseDate ? '납기는 기준일보다 빠를 수 없습니다.' : null;
  const canSave = customer.trim() !== '' && qtyText !== '' && !qtyProblem && !dueProblem && employeeError(employeeNo) === null;

  // 저장하기 전에 이 주문이 납기를 맞출 수 있는지, 다른 주문을 밀어내는지 계산해 경고한다
  const preview = useMemo(
    () => (qtyText !== '' && !qtyProblem && !dueProblem ? previewNewOrder(state, { qty, dueDate, colorCode: colorCode || null }) : null),
    [state, qty, qtyText, qtyProblem, dueProblem, dueDate, colorCode],
  );
  const warnings: string[] = [];
  if (preview) {
    const { mine } = preview;
    if (dueDate < preview.earliestDone) {
      warnings.push(
        `오늘 투입해도 리드타임 ${state.settings.leadTimeDays}일 뒤인 ${formatMD(preview.earliestDone)}에야 완성됩니다. 납기 ${formatMD(dueDate)}는 맞출 수 없습니다.`,
      );
    }
    if (mine.lateDays === null) {
      warnings.push(
        `예측 기간(${formatMD(preview.periodEnd)}까지) 안에 완료되지 않습니다. 그때까지 만들 수 있는 차는 모두 ${num(preview.periodTotal)}대이고, 이 주문까지 필요한 양은 ${num(mine.cumNeed)}대입니다.` +
          (bodyStock !== null && qty > bodyStock ? ` 이 색 차체는 ${num(bodyStock)}개뿐이라 차체 발주가 필요합니다.` : ''),
      );
    } else if (mine.lateDays > 0) {
      warnings.push(`예상 완료일은 ${formatMD(mine.doneDate!)}입니다. 납기 ${formatMD(dueDate)}보다 ${mine.lateDays}일 늦습니다.`);
    }
    if (preview.newlyLate.length > 0) {
      warnings.push(
        `이 주문을 넣으면 ${preview.newlyLate.map((o) => `${o.id}(${o.customer})`).join(', ')}의 납기를 맞추지 못하게 됩니다 (납기가 빠른 주문부터 차를 배정합니다).`,
      );
    }
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    const order = await save((api) => api.addCustomerOrder({ customer, qty, dueDate, colorCode: colorCode || null, employeeNo: employeeNo.trim() }));
    setSaving(false);
    if (order) {
      notify('success', `${order.id} 납기를 추가했습니다. (${order.customer} ${num(order.qty)}대 · 납기 ${formatMD(order.dueDate)})`);
      onClose();
    }
  }

  return (
    <Modal
      title="납기 추가"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSave} busy={saving}>
            납기 추가
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <EmployeeField value={employeeNo} onChange={setEmployeeNo} />
        <Field label="고객">
          <input className={INPUT_CLASS} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="예: 한울모빌리티" maxLength={30} />
        </Field>
        <Field
          label="차량 색상"
          hint={bodyStock === null ? undefined : `이 색 차체 재고 ${num(bodyStock)}개 · 주문한 색의 차체로 만들고, 출차 일정에도 이 색으로 나옵니다`}
        >
          <select className={INPUT_CLASS} value={colorCode} onChange={(e) => setColorCode(e.target.value)}>
            {reference.colors.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code}) · {c.description}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="수량 (대)" error={qtyProblem}>
            <input
              className={INPUT_CLASS}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              placeholder="예: 40"
            />
          </Field>
          <Field label="납기" error={dueProblem} hint={`기준일 ${formatMD(baseDate)} 이후`}>
            <input className={INPUT_CLASS} type="date" min={baseDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        {warnings.length > 0 ? (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            <p className="font-bold">⚠ 납기를 맞추기 어렵습니다. 그래도 추가할 수는 있습니다.</p>
            <ul className="mt-1 list-disc pl-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : preview && preview.mine.doneDate ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-800">
            ✅ 예상 완료일 {formatMD(preview.mine.doneDate)} · 납기 충족 (여유 {-(preview.mine.lateDays ?? 0)}일)
          </p>
        ) : (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            수량과 납기를 넣으면 납기를 맞출 수 있는지 미리 계산해 보여 줍니다. 납기가 빠른 주문부터 차례로 완성 차량을 배정합니다.
          </p>
        )}
      </div>
    </Modal>
  );
}

export function CustomerOrdersCard({ state, orders, lateCount }: { state: AppState; orders: OrderForecast[]; lateCount: number }) {
  const { save, notify } = useAppData();
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrderForecast | null>(null);

  async function remove(employeeNo: string): Promise<boolean> {
    if (!removeTarget) return true;
    const orderId = removeTarget.id;
    const ok = await save(async (api) => {
      await api.removeCustomerOrder({ orderId, employeeNo });
      return true;
    });
    if (ok) notify('success', `${orderId} 납기를 취소했습니다.`);
    return !!ok;
  }

  return (
    <Card
      title="주문 납기 현황"
      aside={
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            자동차 주문 {num(state.customerOrders.reduce((sum, o) => sum + o.qty, 0))}대 · 납기 지연 {lateCount}건
          </span>
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            + 납기 추가
          </Button>
        </div>
      }
    >
      <OrdersTable orders={orders} onRemove={setRemoveTarget} />
      {adding && <AddOrderModal state={state} onClose={() => setAdding(false)} />}
      {removeTarget && (
        <EmployeeConfirmModal
          title={`납기 취소: ${removeTarget.id}`}
          confirmLabel="납기 취소"
          danger
          onConfirm={remove}
          onClose={() => setRemoveTarget(null)}
        >
          {removeTarget.customer} {num(removeTarget.qty)}대 · 납기 {formatMD(removeTarget.dueDate)} 주문을 취소합니다. 주문은 납기 현황에서 지워지고(되돌릴 수 없음) 남은 주문의 예상 완료일이 다시 계산됩니다. 누가 언제 취소했는지는 이력의 납기 변경 기록에 남습니다.
        </EmployeeConfirmModal>
      )}
    </Card>
  );
}
