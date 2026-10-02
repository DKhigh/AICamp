// 주문 납기 현황 카드: 표 + [납기 추가] + 행마다 [납기 취소]. 추가·취소는 사원번호가 있어야 한다.
import { useMemo, useState } from 'react';
import { previewNewOrders } from '../../lib/actions';
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
import { Button, Card, ColorSwatch, Field, INPUT_CLASS, Modal, parseIntStrict } from '../ui';

function AddOrderModal({ state, onClose }: { state: AppState; onClose: () => void }) {
  const { save, notify } = useAppData();
  const baseDate = state.settings.baseDate;
  const [customer, setCustomer] = useState('');
  // 색상 코드 → 수량 입력칸의 글자. 한 번에 여러 색을 주문할 수 있고, 수량을 넣은 색마다 주문이 하나씩 생긴다
  const [qtyByColor, setQtyByColor] = useState<Record<string, string>>({});
  const [dueDate, setDueDate] = useState(addDays(baseDate, 14));
  const [employeeNo, setEmployeeNo] = useState('');
  const [saving, setSaving] = useState(false);

  const rows = reference.colors.map((color) => {
    const text = (qtyByColor[color.code] ?? '').trim();
    const qty = parseIntStrict(text);
    return {
      color,
      text,
      qty,
      problem: text === '' ? null : qtyError(qty),
      bodyStock: state.lineParts.find((p) => p.partCode.endsWith(`-${color.code}`))?.onHand ?? null,
    };
  });
  const items = rows.filter((r) => r.text !== '' && !r.problem);
  const hasProblem = rows.some((r) => r.problem);
  const total = items.reduce((sum, r) => sum + r.qty, 0);
  const dueProblem = dueDate === '' ? '납기 날짜를 선택하세요.' : dueDate < baseDate ? '납기는 기준일보다 빠를 수 없습니다.' : null;
  const canSave = customer.trim() !== '' && items.length > 0 && !hasProblem && !dueProblem && employeeError(employeeNo) === null;

  // 저장하기 전에 이 주문들이 납기를 맞출 수 있는지, 다른 주문을 밀어내는지 계산해 경고한다
  const itemsKey = items.map((r) => `${r.color.code}:${r.qty}`).join(',');
  const preview = useMemo(
    () => (items.length > 0 && !hasProblem && !dueProblem ? previewNewOrders(state, items.map((r) => ({ qty: r.qty, dueDate, colorCode: r.color.code }))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, itemsKey, hasProblem, dueProblem, dueDate],
  );
  const warnings: string[] = [];
  if (preview) {
    if (dueDate < preview.earliestDone) {
      warnings.push(
        `오늘 투입해도 리드타임 ${state.settings.leadTimeDays}일 뒤인 ${formatMD(preview.earliestDone)}에야 완성됩니다. 납기 ${formatMD(dueDate)}는 맞출 수 없습니다.`,
      );
    }
    preview.mines.forEach((mine, i) => {
      const { color, qty, bodyStock } = items[i];
      if (mine.lateDays === null) {
        warnings.push(
          `${color.name} ${num(qty)}대: 예측 기간(${formatMD(preview.periodEnd)}까지) 안에 완료되지 않습니다.` +
            (bodyStock !== null && qty > bodyStock
              ? ` 이 색 차체는 ${num(bodyStock)}개뿐이라 차체 발주가 필요합니다.`
              : ` 그때까지 만들 수 있는 차는 모두 ${num(preview.periodTotal)}대입니다.`),
        );
      } else if (mine.lateDays > 0) {
        warnings.push(`${color.name} ${num(qty)}대: 예상 완료일 ${formatMD(mine.doneDate!)} · 납기보다 ${mine.lateDays}일 늦습니다.`);
      }
    });
    if (preview.newlyLate.length > 0) {
      warnings.push(
        `이 주문을 넣으면 ${preview.newlyLate.map((o) => `${o.id}(${o.customer})`).join(', ')}의 납기를 맞추지 못하게 됩니다 (납기가 빠른 주문부터 차를 배정합니다).`,
      );
    }
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    const orders = await save((api) =>
      api.addCustomerOrders({ customer, dueDate, items: items.map((r) => ({ colorCode: r.color.code, qty: r.qty })), employeeNo: employeeNo.trim() }),
    );
    setSaving(false);
    if (orders) {
      notify(
        'success',
        `납기를 추가했습니다: ${orders[0].customer} ${items.map((r) => `${r.color.name} ${num(r.qty)}대`).join(' + ')} · 납기 ${formatMD(dueDate)} (${orders.map((o) => o.id).join(', ')})`,
      );
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="고객">
            <input className={INPUT_CLASS} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="예: 한울모빌리티" maxLength={30} />
          </Field>
          <Field label="납기" error={dueProblem} hint={`기준일 ${formatMD(baseDate)} 이후`}>
            <input className={INPUT_CLASS} type="date" min={baseDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 flex w-full items-baseline justify-between text-xs font-semibold text-slate-600">
            <span>색상별 수량 (대) — 필요한 색에만 넣으세요</span>
            <span className="tabular text-slate-900">합계 {num(total)}대</span>
          </legend>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {rows.map((r) => (
              <li key={r.color.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="flex w-24 items-center gap-1.5 text-sm font-semibold text-slate-900" title={r.color.description}>
                  <ColorSwatch code={r.color.code} />
                  {r.color.name}
                </span>
                <input
                  className={`tabular w-24 rounded-md border px-2.5 py-1.5 text-right text-sm outline-none focus:ring-2 ${
                    r.problem ? 'border-red-400 focus:ring-red-100' : 'border-slate-300 focus:border-accent focus:ring-blue-100'
                  }`}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={qtyByColor[r.color.code] ?? ''}
                  onChange={(e) => setQtyByColor((prev) => ({ ...prev, [r.color.code]: e.target.value }))}
                  placeholder="0"
                  aria-label={`${r.color.name} 수량`}
                  aria-invalid={!!r.problem}
                />
                <span className="text-xs text-slate-500">대</span>
                <span className={`tabular flex-1 text-right text-xs ${r.problem ? 'font-medium text-red-600' : 'text-slate-500'}`}>
                  {r.problem ?? (r.bodyStock === null ? '' : `이 색 차체 재고 ${num(r.bodyStock)}개`)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-500">
            수량을 넣은 색마다 주문이 하나씩 생기고, 납기 현황에는 색상별로 한 줄씩 나옵니다. 주문한 색의 차체로 만듭니다.
          </p>
        </fieldset>

        {warnings.length > 0 ? (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            <p className="font-bold">⚠ 납기를 맞추기 어렵습니다. 그래도 추가할 수는 있습니다.</p>
            <ul className="mt-1 list-disc pl-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : preview ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-800">
            ✅ 납기 충족 ·{' '}
            {preview.mines.map((mine, i) => `${items[i].color.name} ${formatMD(mine.doneDate!)} 완료 (여유 ${-(mine.lateDays ?? 0)}일)`).join(' · ')}
          </p>
        ) : (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            색상별 수량과 납기를 넣으면 납기를 맞출 수 있는지 미리 계산해 보여 줍니다. 납기가 빠른 주문부터 차례로 완성 차량을 배정합니다.
          </p>
        )}
      </div>
    </Modal>
  );
}

export function CustomerOrdersCard({ state, orders, lateCount }: { state: AppState; orders: OrderForecast[]; lateCount: number }) {
  const { save, notify, session } = useAppData();
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
          <Button auth size="sm" variant="primary" onClick={() => setAdding(true)}>
            + 납기 추가
          </Button>
        </div>
      }
    >
      {/* 납기 취소 열은 로그인했을 때만 보인다 */}
      <OrdersTable orders={orders} onRemove={session ? setRemoveTarget : undefined} />
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
