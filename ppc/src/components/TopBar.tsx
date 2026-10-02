// 상단 바 (DESIGN.md §5 C-1)
import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { formatWithWeekday } from '../lib/date';
import { searchSuggestions } from '../lib/search';
import { useAppData } from '../state/AppData';
import { useUi } from '../state/Ui';
import { EmployeeConfirmModal } from './EmployeeField';

const HEADER_BUTTON =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-[13px] font-semibold text-slate-200 transition-colors hover:bg-white/20 hover:text-white disabled:opacity-50';

export function TopBar() {
  const { api, state, save, notify, session, logout, setLoginOpen } = useAppData();
  const { openOrder, openDisruption } = useUi();
  const navigate = useNavigate();
  const [resetOpen, setResetOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 검색 자동완성 후보: 라인 부품 이름, 그 부품을 파는 업체, 소재
  const suggestions = useMemo(() => (state ? searchSuggestions(state) : []), [state?.lineParts]);

  /** 사원번호를 확인한 뒤 초기화한다 */
  async function reset(employeeNo: string): Promise<boolean> {
    const ok = await save(async (a) => {
      await a.resetDemoData(employeeNo);
      return true;
    });
    if (ok) {
      notify('success', '시연 초기 데이터로 되돌렸습니다.');
      navigate('/');
    }
    return !!ok;
  }

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-full px-2 py-1.5 text-[13px] font-semibold transition-colors sm:px-3.5 ${
      isActive ? 'bg-accent text-white shadow' : 'text-slate-300 hover:bg-white/10 hover:text-white'
    }`;

  return (
    <>
    {resetOpen && (
      <EmployeeConfirmModal title="데이터 초기화" confirmLabel="초기화" danger onConfirm={reset} onClose={() => setResetOpen(false)}>
        모든 데이터를 시연 초기 상태로 되돌립니다. 지금까지 입력한 발주·차질·활동 기록이 <strong>모든 사용자 화면에서</strong> 지워집니다. 초기 발주와
        주문은 오늘을 기준으로 지난 며칠 사이에 입력한 기록으로 다시 만들어집니다.
      </EmployeeConfirmModal>
    )}
    {/* 좁은 화면에서는 상단 바가 여러 줄이 되므로 고정하지 않는다 */}
    <header className="top-0 z-40 border-b border-header-border bg-header text-white shadow-md lg:sticky">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <div className="flex select-none items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-sky-400" fill="currentColor" aria-hidden>
              <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3zM19 17H5v-4.66l.12-.34h13.77l.11.34V17z" />
              <circle cx="7.5" cy="14.5" r="1.5" />
              <circle cx="16.5" cy="14.5" r="1.5" />
            </svg>
          </div>
          <div>
            <p className="text-[17px] font-extrabold leading-tight tracking-wide">PPC 생산관리</p>
            <p className="text-[11px] leading-tight text-slate-400">ICBM · Product Problem Clear</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/60 p-1">
          <NavLink to="/" end className={navClass}>
            대시보드
          </NavLink>
          <NavLink to="/shipments" className={navClass}>
            출차 일정
          </NavLink>
          <NavLink to="/repairs" className={navClass}>
            수리 차량
          </NavLink>
          <NavLink to="/history" className={navClass}>
            이력
          </NavLink>
          <NavLink to="/qr" className={navClass}>
            QR 접속
          </NavLink>
        </nav>

        {/* 발주 검색: 어떤 부품을 어느 업체에서 얼마에, 며칠 만에, 준수율 몇 %로 살 수 있는지 */}
        <form
          role="search"
          className="flex min-w-[180px] flex-1 items-center sm:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/search?q=${encodeURIComponent(query.trim())}`);
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // 자동완성 목록에서 고르면 바로 검색한다
              if (suggestions.includes(e.target.value)) navigate(`/search?q=${encodeURIComponent(e.target.value)}`);
            }}
            placeholder="부품·업체 검색 (예: 엔진, 대성메탈)"
            aria-label="발주 가능한 부품·업체 검색"
            list="search-suggestions"
            autoComplete="off"
            className="w-full rounded-l-md border border-white/15 bg-white/10 px-3 py-1.5 text-[13px] text-white outline-none placeholder:text-slate-400 focus:border-sky-400 focus:bg-white/15"
          />
          {/* 자동완성: '대성'을 치면 대성메탈·대성정밀이 뜬다 */}
          <datalist id="search-suggestions">
            {suggestions.map((word) => (
              <option key={word} value={word} />
            ))}
          </datalist>
          <button type="submit" className="whitespace-nowrap rounded-r-md border border-l-0 border-white/15 bg-white/15 px-3 py-1.5 text-[13px] font-semibold text-slate-100 hover:bg-white/25">
            검색
          </button>
        </form>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className={HEADER_BUTTON} onClick={() => openOrder()} disabled={!state}>
            + 발주
          </button>
          <button
            type="button"
            onClick={openDisruption}
            disabled={!state}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-red-600 px-3 py-1.5 text-[13px] font-bold text-white shadow hover:bg-red-500 disabled:opacity-50"
          >
            ⚠ 차질 발생
          </button>
          {session ? (
            <button type="button" className={HEADER_BUTTON} onClick={logout} title={`${session.name} · ${session.dept} — 누르면 로그아웃합니다`}>
              <span className="text-emerald-300">●</span> {session.name} · 로그아웃
            </button>
          ) : (
            <button type="button" className={`${HEADER_BUTTON} border-sky-400/60 text-white`} onClick={() => setLoginOpen(true)}>
              로그인
            </button>
          )}
          <button type="button" className={HEADER_BUTTON} onClick={() => setResetOpen(true)}>
            데이터 초기화
          </button>
        </div>

        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-slate-400">기준일</span>
          <strong className="tabular font-mono text-sky-300">{state ? formatWithWeekday(state.settings.baseDate) : '–'}</strong>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              api.mode === 'supabase' ? 'bg-emerald-400/20 text-emerald-300' : 'bg-amber-400/20 text-amber-300'
            }`}
            title={
              api.mode === 'supabase'
                ? 'Supabase 공유 DB에 저장합니다. 같은 주소를 연 사람은 같은 데이터를 봅니다.'
                : 'Supabase 환경 변수가 없어 이 브라우저(localStorage)에만 저장합니다. 다른 사람과 공유되지 않습니다.'
            }
          >
            {api.mode === 'supabase' ? '공유 DB' : '로컬 데모'}
          </span>
        </div>
      </div>
    </header>
    </>
  );
}
