// F2-1 차질 발생 모달. 같은 부품·업체에 진행 중인 차질이 있으면 새로 만들지 않고 그 차질의 지연을 연장한다.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { activeDisruptionFor, affectedPos, NO_OPEN_PO_MESSAGE } from '../lib/actions';
import { delayDaysError } from '../lib/api';
import { DISRUPTION_REASONS, MAX_DELAY_DAYS, MIN_DELAY_DAYS } from '../lib/constants';
import { employeeError } from '../lib/employees';
import { openPos } from '../lib/planning';
import { disruptionExamples, partOf } from '../lib/reference';
import type { AppState, DisruptionExample } from '../lib/types';
import { useAppData } from '../state/AppData';
import { EmployeeField } from './EmployeeField';
import { Button, Field, INPUT_CLASS, Modal, parseIntStrict } from './ui';

export function DisruptionModal({ state, onClose }: { state: AppState; onClose: () => void }) {
  const { save, notify } = useAppData();
  const navigate = useNavigate();

  /** 그 부품의 미입고 발주 업체 목록 (중복 없이) */
  const suppliersWithOpenPo = (code: string) => [
    ...new Set(
      openPos(state.purchaseOrders)
        .filter((po) => po.partCode === code)
        .map((po) => po.supplierName),
    ),
  ];

  const [employeeNo, setEmployeeNo] = useState('');
  const [partCode, setPartCode] = useState(state.lineParts[0]?.partCode ?? '');
  const [supplierName, setSupplierName] = useState(() => suppliersWithOpenPo(partCode)[0] ?? '');
  const [reason, setReason] = useState<string>(DISRUPTION_REASONS[0]);
  const [delayText, setDelayText] = useState('');
  const [exampleId, setExampleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const part = partOf(partCode);
  const supplierOptions = suppliersWithOpenPo(partCode);
  const targets = supplierName ? affectedPos(state.purchaseOrders, partCode, supplierName) : [];
  // 이미 진행 중인 차질이 있으면 '지연 연장'이 된다
  const existing = supplierName ? activeDisruptionFor(state.disruptions, partCode, supplierName) : null;
  const delayDays = parseIntStrict(delayText);
  const totalDays = existing && Number.isInteger(delayDays) ? existing.delayDays + delayDays : null;
  const delayProblem =
    delayText === ''
      ? null
      : (delayDaysError(delayDays) ??
        (totalDays !== null && totalDays > MAX_DELAY_DAYS
          ? `지연일수 합계는 ${MAX_DELAY_DAYS}일을 넘을 수 없습니다 (현재 ${existing!.delayDays}일 + ${delayDays}일)`
          : null));
  const canSave = targets.length > 0 && delayText !== '' && !delayProblem && employeeError(employeeNo) === null;

  function applyExample(example: DisruptionExample) {
    if (!state.lineParts.some((lp) => lp.partCode === example.partCode)) return;
    setExampleId(example.id);
    setPartCode(example.partCode);
    setSupplierName(example.supplierName);
    setReason(example.reason);
    setDelayText(String(example.delayDays));
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    const result = await save((api) => api.registerDisruption({ partCode, supplierName, reason, delayDays, employeeNo: employeeNo.trim() }));
    setSaving(false);
    if (result) {
      if (result.extended) {
        notify('success', `${result.disruption.id}의 지연을 ${delayDays}일 연장했습니다. (합계 ${result.disruption.delayDays}일)`);
      }
      onClose();
      navigate(`/disruptions/${result.disruption.id}`);
    }
  }

  return (
    <Modal
      title="⚠ 차질 발생"
      tone="danger"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="danger" onClick={() => void submit()} disabled={!canSave} busy={saving}>
            {existing ? '지연 연장' : '차질 등록'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-600">시연 예시로 채우기</p>
          <div className="flex flex-wrap gap-2">
            {disruptionExamples.map((example) => (
              <button
                key={example.id}
                type="button"
                onClick={() => applyExample(example)}
                aria-pressed={exampleId === example.id}
                className={`rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  exampleId === example.id
                    ? 'border-red-400 bg-red-50 text-red-700'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-red-300 hover:bg-red-50'
                }`}
              >
                {example.id} {example.supplierName}·{partOf(example.partCode).name} {example.delayDays}일
              </button>
            ))}
          </div>
        </div>

        <hr className="border-slate-200" />

        <EmployeeField value={employeeNo} onChange={setEmployeeNo} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="부품">
            <select
              className={INPUT_CLASS}
              value={partCode}
              onChange={(e) => {
                setExampleId(null);
                setPartCode(e.target.value);
                setSupplierName(suppliersWithOpenPo(e.target.value)[0] ?? '');
              }}
            >
              {state.lineParts.map((lp) => {
                const p = partOf(lp.partCode);
                return (
                  <option key={p.code} value={p.code}>
                    {p.name} ({p.code})
                  </option>
                );
              })}
            </select>
          </Field>

          <Field label="업체 (이 부품의 입고 예정 발주)">
            <select
              className={INPUT_CLASS}
              value={supplierOptions.includes(supplierName) ? supplierName : ''}
              disabled={supplierOptions.length === 0}
              onChange={(e) => {
                setExampleId(null);
                setSupplierName(e.target.value);
              }}
            >
              {supplierOptions.length === 0 && <option value="">입고 예정 발주 없음</option>}
              {supplierOptions.map((name) => (
                <option key={name} value={name}>
                  {name} (
                  {affectedPos(state.purchaseOrders, partCode, name)
                    .map((po) => po.id)
                    .join(', ')}
                  )
                </option>
              ))}
            </select>
          </Field>

          <Field label="사유">
            <select className={INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)}>
              {DISRUPTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>

          <Field label={existing ? `추가 지연일수 (${MIN_DELAY_DAYS}~${MAX_DELAY_DAYS}일)` : `지연일수 (${MIN_DELAY_DAYS}~${MAX_DELAY_DAYS}일)`} error={delayProblem}>
            <input
              className={INPUT_CLASS}
              type="number"
              min={MIN_DELAY_DAYS}
              max={MAX_DELAY_DAYS}
              step={1}
              inputMode="numeric"
              value={delayText}
              onChange={(e) => setDelayText(e.target.value)}
              placeholder="예: 5"
            />
          </Field>
        </div>

        {targets.length === 0 ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700">
            {NO_OPEN_PO_MESSAGE}
          </p>
        ) : existing ? (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            <strong>
              이미 진행 중인 차질 {existing.id}({existing.delayDays}일 지연 · {existing.status})이 있습니다.
            </strong>{' '}
            새 차질을 만들지 않고 {existing.id}의 지연을 연장합니다
            {totalDays !== null && !delayProblem && ` (${existing.delayDays}일 → ${totalDays}일)`}. 발주{' '}
            <strong>{targets.map((po) => po.id).join(', ')}</strong>의 도착 예정일이 입력한 일수만큼 더 밀리고, 연장한 내용은 이력에 남습니다.
            {existing.status === '기다리기' && ' 기다리기로 결정했던 차질은 다시 결정해야 합니다.'}
          </p>
        ) : (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            등록하면 {part.name}({part.code}) · {supplierName}의 입고 예정 발주{' '}
            <strong className="text-slate-900">{targets.map((po) => po.id).join(', ')}</strong>의 도착 예정일이 지연일수만큼 뒤로
            밀립니다.
          </p>
        )}
      </div>
    </Modal>
  );
}
