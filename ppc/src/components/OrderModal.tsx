// F1-2 부품 발주 모달
import { useMemo, useState } from 'react';
import { qtyError } from '../lib/api';
import { addDays, diffDays, formatMD } from '../lib/date';
import { ddayLabel, num } from '../lib/format';
import { gradeOf, suppliersFor } from '../lib/recommend';
import { partOf, reference } from '../lib/reference';
import type { AppState } from '../lib/types';
import { useAppData } from '../state/AppData';
import { Button, Field, INPUT_CLASS, Modal, parseIntStrict } from './ui';

export function OrderModal({ state, initialPartCode, onClose }: { state: AppState; initialPartCode?: string; onClose: () => void }) {
  const { save, createdBy, notify } = useAppData();
  const [partCode, setPartCode] = useState(initialPartCode ?? state.lineParts[0]?.partCode ?? '');
  const part = partOf(partCode);

  // 그 부품의 주요자재를 공급할 수 있고 상태가 '정상'인 업체만
  const suppliers = useMemo(() => suppliersFor(part.materialName, reference.suppliers), [part.materialName]);
  const defaultSupplier = (code: string) => {
    const p = partOf(code);
    const list = suppliersFor(p.materialName, reference.suppliers);
    return (list.find((s) => s.name === p.defaultSupplier) ?? list[0])?.name ?? '';
  };
  const [supplierName, setSupplierName] = useState(() => defaultSupplier(partCode));
  const [qtyText, setQtyText] = useState('');
  const [saving, setSaving] = useState(false);

  const supplier = suppliers.find((s) => s.name === supplierName);
  const qty = parseIntStrict(qtyText);
  const qtyProblem = qtyText === '' ? null : qtyError(qty);
  const baseDate = state.settings.baseDate;
  const arrival = supplier ? addDays(baseDate, supplier.leadDays) : null;
  const grade = supplier ? gradeOf(supplier.onTimeRate) : null;
  const canSave = !!supplier && qtyText !== '' && !qtyProblem;

  async function submit() {
    if (!supplier || !canSave) return;
    setSaving(true);
    const po = await save((api) => api.createPurchaseOrder({ partCode, supplierName: supplier.name, qty, createdBy }));
    setSaving(false);
    if (po) {
      notify('success', `${po.id} 발주를 등록했습니다. (${part.name} ${num(qty)}개 · ${formatMD(po.expectedArrival)} 도착 예정)`);
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
        <Field label="부품">
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

        <Field label="업체" hint={`${part.materialName}를 공급할 수 있는 정상 업체 ${suppliers.length}곳`}>
          <select className={INPUT_CLASS} value={supplierName} onChange={(e) => setSupplierName(e.target.value)}>
            {suppliers.map((s) => (
              <option key={s.code} value={s.name}>
                {s.name} (기본 납기 {s.leadDays}일 · 준수율 {s.onTimeRate}% {gradeOf(s.onTimeRate)})
                {s.name === part.defaultSupplier ? ' · 기본 업체' : ''}
              </option>
            ))}
          </select>
        </Field>

        {supplier && grade === '위험' && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700">
            이 업체는 납기 준수율이 {supplier.onTimeRate}%(위험)라 예정일보다 늦을 수 있습니다.
          </p>
        )}

        <Field label="수량 (개)" error={qtyProblem}>
          <input
            className={INPUT_CLASS}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            placeholder="예: 100"
            autoFocus
          />
        </Field>

        <dl className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 px-4 py-3 text-center">
          <div>
            <dt className="text-[11px] font-semibold text-slate-500">발주일 (기준일)</dt>
            <dd className="tabular mt-0.5 text-sm font-bold text-slate-900">{formatMD(baseDate)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold text-slate-500">도착 예정일</dt>
            <dd className="tabular mt-0.5 text-sm font-bold text-slate-900">
              {arrival ? `${formatMD(arrival)} (+${supplier!.leadDays}일)` : '–'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold text-slate-500">D-day</dt>
            <dd className="tabular mt-0.5 text-sm font-bold text-slate-900">{arrival ? ddayLabel(diffDays(arrival, baseDate)) : '–'}</dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
