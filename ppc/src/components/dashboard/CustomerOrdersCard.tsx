// 주문 납기 현황 카드: 표 + [납기 추가] + 행마다 [납기 취소]. 추가·취소는 사원번호가 있어야 한다.
import { useState } from 'react';
import { addDays, formatMD } from '../../lib/date';
import { employeeError } from '../../lib/employees';
import { num } from '../../lib/format';
import type { OrderForecast } from '../../lib/planning';
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

  const qty = parseIntStrict(qtyText);
  const qtyProblem = qtyText === '' ? null : Number.isInteger(qty) && qty >= 1 ? null : '수량은 1 이상의 정수여야 합니다.';
  const dueProblem = dueDate === '' ? '납기 날짜를 선택하세요.' : dueDate < baseDate ? '납기는 기준일보다 빠를 수 없습니다.' : null;
  const canSave = customer.trim() !== '' && qtyText !== '' && !qtyProblem && !dueProblem && employeeError(employeeNo) === null;

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    const order = await save((api) => api.addCustomerOrder({ customer, qty, dueDate, employeeNo: employeeNo.trim() }));
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
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          추가하면 납기가 빠른 주문부터 차례로 완성 차량을 배정해 예상 완료일을 다시 계산합니다.
        </p>
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
          {removeTarget.customer} {num(removeTarget.qty)}대 · 납기 {formatMD(removeTarget.dueDate)} 주문을 목록에서 지웁니다. 지우면 되돌릴 수 없고, 남은
          주문의 예상 완료일이 다시 계산됩니다.
        </EmployeeConfirmModal>
      )}
    </Card>
  );
}
