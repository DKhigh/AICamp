// F2-1 차질 발생 모달
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { affectedPos, NO_OPEN_PO_MESSAGE } from '../lib/actions';
import { delayDaysError } from '../lib/api';
import { DISRUPTION_REASONS, MAX_DELAY_DAYS, MIN_DELAY_DAYS } from '../lib/constants';
import { openPos } from '../lib/planning';
import { partOf, reference } from '../lib/reference';
import type { AppState, DelayPreset } from '../lib/types';
import { useAppData } from '../state/AppData';
import { Button, Field, INPUT_CLASS, Modal, parseIntStrict } from './ui';

export function DisruptionModal({ state, onClose }: { state: AppState; onClose: () => void }) {
  const { save, createdBy } = useAppData();
  const navigate = useNavigate();

  /** 그 부품의 미입고 발주 업체 목록 (중복 없이) */
  const suppliersWithOpenPo = (code: string) => [
    ...new Set(
      openPos(state.purchaseOrders)
        .filter((po) => po.partCode === code)
        .map((po) => po.supplierName),
    ),
  ];

  const [partCode, setPartCode] = useState(state.lineParts[0]?.partCode ?? '');
  const [supplierName, setSupplierName] = useState(() => suppliersWithOpenPo(partCode)[0] ?? '');
  const [reason, setReason] = useState<string>(DISRUPTION_REASONS[0]);
  const [delayText, setDelayText] = useState('');
  const [presetId, setPresetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const part = partOf(partCode);
  const supplierOptions = suppliersWithOpenPo(partCode);
  const targets = supplierName ? affectedPos(state.purchaseOrders, partCode, supplierName) : [];
  const delayDays = parseIntStrict(delayText);
  const delayProblem = delayText === '' ? null : delayDaysError(delayDays);
  const canSave = targets.length > 0 && delayText !== '' && !delayProblem;

  function applyPreset(preset: DelayPreset) {
    // 영향 부품 = 라인 부품 중 기본 공급업체와 주요자재가 사례와 같은 부품
    const linePart = state.lineParts.find((lp) => {
      const p = partOf(lp.partCode);
      return p.defaultSupplier === preset.supplierName && p.materialName === preset.materialName;
    });
    if (!linePart) return;
    setPresetId(preset.id);
    setPartCode(linePart.partCode);
    setSupplierName(preset.supplierName);
    setReason(preset.reason);
    setDelayText(String(preset.delayDays));
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    const disruption = await save((api) => api.registerDisruption({ partCode, supplierName, reason, delayDays, createdBy }));
    setSaving(false);
    if (disruption) {
      onClose();
      navigate(`/disruptions/${disruption.id}`);
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
            차질 등록
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-600">Excel 사례로 발생</p>
          <div className="flex flex-wrap gap-2">
            {reference.delayPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                aria-pressed={presetId === preset.id}
                className={`rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  presetId === preset.id
                    ? 'border-red-400 bg-red-50 text-red-700'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-red-300 hover:bg-red-50'
                }`}
              >
                {preset.id} {preset.supplierName}·{preset.materialName.replace(' 소재', '')} {preset.delayDays}일
              </button>
            ))}
          </div>
        </div>

        <hr className="border-slate-200" />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="부품">
            <select
              className={INPUT_CLASS}
              value={partCode}
              onChange={(e) => {
                setPresetId(null);
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
                setPresetId(null);
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

          <Field label={`지연일수 (${MIN_DELAY_DAYS}~${MAX_DELAY_DAYS}일)`} error={delayProblem}>
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
