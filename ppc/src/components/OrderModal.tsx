// F1-2 부품 발주 모달
import { useMemo, useState } from 'react';
import { qtyError } from '../lib/api';
import { addDays, diffDays, formatMD } from '../lib/date';
import { employeeError } from '../lib/employees';
import { ddayLabel, num, won } from '../lib/format';
import { capacityError, pricePerKgOf, qtyDelayOf, supplierCapacityOf, unitPriceOf } from '../lib/ordering';
import { duplicateOrderOf, supplierLimitError, supplierLimitOf } from '../lib/planning';
import { disruptedSupplierNames, gradeOf, suppliersFor } from '../lib/recommend';
import { partOf, reference } from '../lib/reference';
import type { AppState } from '../lib/types';
import { useAppData } from '../state/AppData';
import { EmployeeField } from './EmployeeField';
import { Button, Field, INPUT_CLASS, Modal, parseIntStrict } from './ui';

export function OrderModal({
  state,
  initialPartCode,
  initialSupplierName,
  onClose,
}: {
  state: AppState;
  initialPartCode?: string;
  /** 발주 검색에서 업체를 골라 들어온 경우 */
  initialSupplierName?: string;
  onClose: () => void;
}) {
  const { save, notify } = useAppData();
  const [employeeNo, setEmployeeNo] = useState('');
  // 색상별 차체는 색마다 따로 발주한다. 목록에 없는 코드(차체 묶음 'P012')가 오면 첫 부품으로 연다
  const codes = state.lineParts.map((lp) => lp.partCode);
  const [partCode, setPartCode] = useState(initialPartCode && codes.includes(initialPartCode) ? initialPartCode : (codes[0] ?? ''));
  const part = partOf(partCode);

  // 그 부품의 주요자재를 공급할 수 있고 상태가 '정상'인 업체만
  const suppliers = useMemo(() => suppliersFor(part.materialName, reference.suppliers), [part.materialName]);
  const defaultSupplier = (code: string) => {
    const p = partOf(code);
    const list = suppliersFor(p.materialName, reference.suppliers);
    return (list.find((s) => s.name === p.defaultSupplier) ?? list[0])?.name ?? '';
  };
  const [supplierName, setSupplierName] = useState(() =>
    initialSupplierName && suppliers.some((s) => s.name === initialSupplierName) ? initialSupplierName : defaultSupplier(partCode),
  );
  const [qtyText, setQtyText] = useState('');
  const [saving, setSaving] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);

  const supplier = suppliers.find((s) => s.name === supplierName);
  const qty = parseIntStrict(qtyText);
  const qtyProblem = qtyText === '' ? null : qtyError(qty);
  const validQty = qtyText !== '' && !qtyProblem;
  const baseDate = state.settings.baseDate;
  const grade = supplier ? gradeOf(supplier.onTimeRate) : null;

  // 업체별 한도: 일주일 동안 한 업체에 50개까지
  const limit = supplier ? supplierLimitOf(state.purchaseOrders, supplier.name, baseDate) : null;
  const limitProblem = supplier && limit && validQty ? supplierLimitError(limit, supplier.name, qty) : null;
  // 공급 능력: 월 공급가능량에서 최근 한 달 동안 이 업체에 이미 발주한 양을 뺀 만큼만 받을 수 있다
  const capacityProblem =
    supplier && validQty ? capacityError(supplierCapacityOf(state.purchaseOrders, supplier, baseDate), supplier.name, part, qty) : null;
  // 같은 날 같은 내용의 발주가 이미 있으면 한 번 더 확인한다 (실수로 두 번 넣는 것을 막는다)
  const duplicate = supplier && validQty ? duplicateOrderOf(state.purchaseOrders, { partCode, supplierName: supplier.name, qty }, baseDate) : null;
  const supplierDisrupted = !!supplier && disruptedSupplierNames(state.disruptions).includes(supplier.name);

  // 금액: 업체의 자재 단가(원/kg) × 부품 1개당 소재 필요량(kg) × 수량
  const perKg = supplier ? pricePerKgOf(part, supplier.name) : null;
  const unitPrice = supplier ? unitPriceOf(part, supplier.name) : null;
  const amount = unitPrice !== null && validQty ? unitPrice * qty : null;

  // 도착 예정일 = 기준일 + 업체 기본 납기 + 수량에 따른 지연 (같은 업체에 많이 시킬수록 늦다)
  const delay = supplier ? qtyDelayOf(state.purchaseOrders, part, supplier.name, validQty ? qty : 1, baseDate) : null;
  const totalDays = supplier && delay ? supplier.leadDays + delay.days : null;
  const arrival = totalDays !== null ? addDays(baseDate, totalDays) : null;

  const canSave =
    !!supplier && validQty && !limitProblem && !capacityProblem && unitPrice !== null && employeeError(employeeNo) === null && (!duplicate || allowDuplicate);

  async function submit() {
    if (!supplier || !canSave) return;
    setSaving(true);
    const po = await save((api) => api.createPurchaseOrder({ partCode, supplierName: supplier.name, qty, employeeNo: employeeNo.trim(), allowDuplicate }));
    setSaving(false);
    if (po) {
      notify(
        'success',
        `${po.id} 발주를 등록했습니다. (${part.name} ${num(qty)}개 · ${won(unitPrice! * qty)} · ${formatMD(po.expectedArrival)} 도착 예정)`,
      );
      onClose();
    }
  }

  return (
    <Modal
      title="부품 발주"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSave} busy={saving}>
            발주 등록
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <EmployeeField value={employeeNo} onChange={setEmployeeNo} />
        <Field label="부품" hint={part.colorCode ? '차체는 색상마다 따로 발주합니다. 그 색 차체가 있어야 그 색 차를 만들 수 있습니다.' : undefined}>
          <select
            className={INPUT_CLASS}
            value={partCode}
            onChange={(e) => {
              setPartCode(e.target.value);
              setSupplierName(defaultSupplier(e.target.value));
            }}
          >
            {state.lineParts.map((lp) => {
              const p = partOf(lp.partCode);
              return (
                <option key={p.code} value={p.code}>
                  {p.name} ({p.code}) · {p.materialName}
                </option>
              );
            })}
          </select>
        </Field>

        <Field label="업체" hint={`${part.materialName}를 공급할 수 있는 정상 업체 ${suppliers.length}곳 · 단가는 업체마다 다릅니다`}>
          <select className={INPUT_CLASS} value={supplierName} onChange={(e) => setSupplierName(e.target.value)}>
            {suppliers.map((s) => {
              const price = unitPriceOf(part, s.name);
              return (
                <option key={s.code} value={s.name}>
                  {s.name} (개당 {price === null ? '단가 없음' : won(price)} · 기본 납기 {s.leadDays}일 · 준수율 {s.onTimeRate}% {gradeOf(s.onTimeRate)})
                  {s.name === part.defaultSupplier ? ' · 기본 업체' : ''}
                </option>
              );
            })}
          </select>
        </Field>

        {supplier && grade === '위험' && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700">
            이 업체는 납기 준수율이 {supplier.onTimeRate}%(위험)라 예정일보다 늦을 수 있습니다.
          </p>
        )}

        {supplierDisrupted && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700">
            이 업체에는 해결되지 않은 차질이 있습니다. 예정대로 받지 못할 수 있으니 다른 업체도 확인하세요.
          </p>
        )}

        <Field
          label="수량 (개)"
          error={qtyProblem ?? limitProblem ?? capacityProblem}
          hint={
            limit &&
            `이 업체 발주 한도: 일주일 ${limit.limit}개 중 ${limit.used}개 사용 · 남은 ${limit.remaining}개` +
              (limit.releaseDate ? ` · ${formatMD(limit.releaseDate)}부터 풀림` : '')
          }
        >
          <input
            className={INPUT_CLASS}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={qtyText}
            onChange={(e) => {
              setQtyText(e.target.value);
              setAllowDuplicate(false);
            }}
            placeholder="예: 50"
            max={limit?.remaining}
            autoFocus
          />
        </Field>

        {duplicate && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            <p className="font-semibold">
              같은 내용의 발주({duplicate.id} · {part.name} {num(duplicate.originalQty)}개 · {duplicate.supplierName})가 오늘 이미 있습니다.
            </p>
            <label className="mt-1.5 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} className="h-4 w-4 accent-amber-600" />
              실수가 아닙니다. 같은 발주를 한 번 더 넣습니다
            </label>
          </div>
        )}

        <div className="rounded-lg border border-blue-100 bg-accent-light px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold text-slate-600">발주 금액</span>
            <strong className="tabular text-xl font-extrabold tracking-tight text-slate-900">{amount === null ? '–' : won(amount)}</strong>
          </div>
          <p className="tabular mt-1 text-right text-xs text-slate-600">
            {unitPrice === null || perKg === null
              ? '이 업체의 단가가 없어 발주할 수 없습니다.'
              : `개당 ${won(unitPrice)} (${part.materialName} ${won(perKg)}/kg × ${part.kgPerUnit}kg)` + (validQty ? ` × ${num(qty)}개` : '')}
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 px-4 py-3 text-center">
          <div>
            <dt className="text-[11px] font-semibold text-slate-500">발주일 (기준일)</dt>
            <dd className="tabular mt-0.5 text-sm font-bold text-slate-900">{formatMD(baseDate)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold text-slate-500">도착 예정일</dt>
            <dd className="tabular mt-0.5 text-sm font-bold text-slate-900">{arrival ? `${formatMD(arrival)} (+${totalDays}일)` : '–'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold text-slate-500">D-day</dt>
            <dd className="tabular mt-0.5 text-sm font-bold text-slate-900">{arrival ? ddayLabel(diffDays(arrival, baseDate)) : '–'}</dd>
          </div>
          {supplier && delay && (
            <p className="col-span-3 text-xs text-slate-600">
              기본 납기 {supplier.leadDays}일 + 납품량 지연 <strong className="text-slate-900">{delay.days}일</strong> ({delay.label} ·{' '}
              {delay.tierMinQty}개 이상 단계)
              {delay.already > 0 && ` · 이 업체에 최근 일주일 ${num(delay.already)}개 발주해 합계 ${num(delay.cumulative)}개 기준`}
            </p>
          )}
        </dl>
      </div>
    </Modal>
  );
}
