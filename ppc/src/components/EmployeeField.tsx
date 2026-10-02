// 로그인(사원번호)과, 저장하기 전에 한 번 더 묻는 확인 창.
// 저장하는 작업은 모두 로그인해야 할 수 있다. 로그인은 사원 명단(Excel '발주권한자')에 있는 사원번호만 받는다.
// 로그인한 뒤에는 작업마다 사원번호를 다시 묻지 않고, 로그인한 사원의 번호를 그대로 쓴다.
// 확인 창은 브라우저 기본 confirm() 대신 쓰는 앱 자체 모달이다 (기본 창은 환경에 따라 뜨지 않거나 눈에 띄지 않는다).
import { useEffect, useState, type ReactNode } from 'react';
import { employeeError, findEmployee } from '../lib/employees';
import { useAppData } from '../state/AppData';
import { Button, Field, INPUT_CLASS, Modal } from './ui';

/**
 * 저장하는 창 안에 넣는 로그인 상태 표시. 로그인한 사원의 번호를 onChange로 알려 준다 (로그인 전이면 빈 문자열).
 * 로그인하지 않았으면 로그인 버튼을 보여 준다.
 */
export function EmployeeField({ onChange }: { value?: string; onChange: (no: string) => void; autoFocus?: boolean }) {
  const { session, setLoginOpen } = useAppData();
  const no = session?.no ?? '';
  useEffect(() => {
    onChange(no);
    // onChange는 부모의 setState라 다시 실행할 필요가 없다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [no]);

  if (session) {
    return (
      <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
        ✓ {session.name} · {session.dept}
        {session.rank ? ` ${session.rank}` : ''} (로그인됨) — 이 이름으로 기록됩니다
      </p>
    );
  }
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-900">
      로그인해야 저장할 수 있습니다.
      <Button size="sm" variant="primary" onClick={() => setLoginOpen(true)}>
        로그인
      </Button>
    </div>
  );
}

/** 상단 바의 [로그인]: 사원번호만 받는다 */
export function LoginModal() {
  const { login, setLoginOpen, notify } = useAppData();
  const [value, setValue] = useState('');
  const employee = findEmployee(value);
  // 아직 아무것도 안 적었을 때는 빨간 글씨 대신 안내만 한다
  const error = value.trim() === '' ? null : employeeError(value);
  const close = () => setLoginOpen(false);

  function submit() {
    if (!login(value)) return;
    notify('success', `${employee?.name ?? ''} 님으로 로그인했습니다.`);
    close();
  }

  return (
    <Modal
      title="로그인"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>닫기</Button>
          <Button variant="primary" onClick={submit} disabled={!employee}>
            로그인
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="text-[13px] leading-relaxed text-slate-700">
          발주, 발주 취소, 입고 처리, 차질 등록·대응, 납기 추가·취소, 생산 설정, 데이터 초기화는 로그인해야 할 수 있습니다. 로그인한 뒤에는 사원번호를
          다시 묻지 않습니다.
        </p>
        <Field
          label="사원번호"
          error={error}
          hint={employee ? `✓ ${employee.name} · ${employee.dept}${employee.rank ? ` ${employee.rank}` : ''}` : '발주 권한자 명단에 있는 사원번호 (형식: ICBM-00000)'}
        >
          {/* 발표·공용 화면에서 번호가 보이지 않게 가린다. one-time-code: 브라우저가 비밀번호로 저장하자고 묻지 않게 한다 */}
          <input
            type="password"
            className={INPUT_CLASS}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="사원번호"
            autoComplete="one-time-code"
            maxLength={20}
            autoFocus
            aria-required="true"
          />
        </Field>
      </form>
    </Modal>
  );
}

/** 저장하기 전에 내용을 보여 주고 확인받는 창. action이 true를 돌려주면 닫는다. 로그인한 사원의 번호를 넘긴다 */
export function EmployeeConfirmModal({
  title,
  children,
  confirmLabel,
  danger = false,
  canConfirm = true,
  wide = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** 채워야 할 다른 입력이 있을 때: false면 확인 버튼을 막는다 */
  canConfirm?: boolean;
  wide?: boolean;
  onConfirm: (employeeNo: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [employeeNo, setEmployeeNo] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed = employeeError(employeeNo) === null && canConfirm;

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
      wide={wide}
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
        <EmployeeField onChange={setEmployeeNo} />
      </div>
    </Modal>
  );
}
