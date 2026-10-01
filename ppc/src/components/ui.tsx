// 여러 화면이 함께 쓰는 작은 UI 조각. 색 규칙은 DESIGN.md §7.4를 따른다.
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { PartStatus } from '../lib/planning';
import type { DisruptionStatus, PoStatus, RateGrade } from '../lib/types';

export type Tone = 'red' | 'orange' | 'blue' | 'green' | 'gray';

const TONE_CLASS: Record<Tone, string> = {
  red: 'bg-red-100 text-red-700',
  orange: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-emerald-100 text-emerald-800',
  gray: 'bg-slate-100 text-slate-600',
};

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export const PART_STATUS_TONE: Record<PartStatus, Tone> = { 차질: 'red', '대응 중': 'blue', 주의: 'orange', 정상: 'gray' };
export const GRADE_TONE: Record<RateGrade, Tone> = { 우수: 'green', 보통: 'gray', 위험: 'red' };
export const PO_STATUS_TONE: Record<PoStatus, Tone> = { 입고대기: 'gray', 지연: 'red', 입고완료: 'green', 취소: 'gray' };
export const DISRUPTION_STATUS_TONE: Record<DisruptionStatus, Tone> = {
  발생: 'red',
  기다리기: 'red',
  대체발주: 'blue',
  해결: 'green',
};

export function GradeBadge({ rate, grade }: { rate: number; grade: RateGrade }) {
  return (
    <Badge tone={GRADE_TONE[grade]}>
      {rate}% {grade}
    </Badge>
  );
}

export function Card({
  title,
  aside,
  children,
  className = '',
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // min-w-0: 그리드 칸 안에서 넓은 표가 카드를 밀어내지 않고 카드 안에서 가로 스크롤되게 한다
    <section className={`min-w-0 rounded-xl border border-slate-200 bg-white shadow-card ${className}`}>
      {(title || aside) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="text-[15px] font-bold tracking-tight text-slate-900">{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white shadow-sm hover:bg-accent-hover',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
  ghost: 'text-slate-600 hover:bg-slate-100',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-semibold transition-colors disabled:opacity-50 ${
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-[13px]'
      } ${BUTTON_CLASS[variant]} ${className}`}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  tone = 'default',
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  tone?: 'default' | 'danger';
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`pop-in w-full rounded-2xl bg-white shadow-popup ${wide ? 'max-w-2xl' : 'max-w-lg'}`}
      >
        <header
          className={`flex items-center justify-between rounded-t-2xl border-b px-6 py-4 ${
            tone === 'danger' ? 'border-red-100 bg-red-50' : 'border-slate-100'
          }`}
        >
          <h3 className={`text-base font-bold ${tone === 'danger' ? 'text-red-700' : 'text-slate-900'}`}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </header>
        <div className="px-6 py-5">{children}</div>
        <footer className="flex justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50 px-6 py-3">
          {footer}
        </footer>
      </div>
    </div>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string | null; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export const INPUT_CLASS =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50';

/** 숫자 입력칸의 문자열을 정수로. 정수가 아니면 NaN */
export function parseIntStrict(text: string): number {
  return /^-?\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
}
