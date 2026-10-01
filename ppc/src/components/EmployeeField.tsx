// 사원번호 입력칸과, 사원번호를 받고 나서 실행하는 확인 창.
// 발주·발주 취소·데이터 초기화는 사원 명단(Excel)에 있는 번호를 입력해야 할 수 있다.
import { useState, type ReactNode } from 'react';
import { employeeError, findEmployee } from '../lib/employees';
import { Button, Field, INPUT_CLASS, Modal } from './ui';

export function EmployeeField({ value, onChange, autoFocus = false }: { value: string; onChange: (no: string) => void; autoFocus?: boolean }) {
  const employee = findEmployee(value);
  // 아직 아무것도 안 적었을 때는 빨간 글씨 대신 안내만 한다
  const error = value.trim() === '' ? null : employeeError(value);
  return (
    <Field
      label="사원번호 (필수)"
      error={error}
      hint={employee ? `✓ ${employee.name} · ${employee.dept}` : '사원 명단에 있는 사원번호만 진행할 수 있습니다.'}
    >
      <input
        className={INPUT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="사원번호"
        inputMode="numeric"
        autoComplete="off"
        maxLength={12}
        autoFocus={autoFocus}
        aria-required="true"
      />
    </Field>
  );
}

/** 사원번호를 입력받은 뒤 action을 실행한다. action이 true를 돌려주면 닫는다 */
export function EmployeeConfirmModal({
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (employeeNo: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [employeeNo, setEmployeeNo] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed = employeeError(employeeNo) === null;

  async function submit() {
    if (!allowed) return;
    setBusy(true);
    const done = await onConfirm(employeeNo.trim());
    setBusy(false);
    if (done) onClose();
  }

  return (
    <Modal
      title={title}
      tone={danger ? 'danger' : 'default'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => void submit()} disabled={!allowed} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-[13px] leading-relaxed text-slate-700">{children}</div>
        <EmployeeField value={employeeNo} onChange={setEmployeeNo} autoFocus />
      </div>
    </Modal>
  );
}
