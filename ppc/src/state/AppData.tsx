// DB에서 읽은 상태를 화면 전체에 나눠 주는 컨텍스트 (DESIGN.md §5 C-1, §8)
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getApi, type Api } from '../lib/api';
import { AUTO_REFRESH_MS } from '../lib/constants';
import { findEmployee, type Employee } from '../lib/employees';
import type { AppState } from '../lib/types';

const SESSION_KEY = 'ppc.session.employeeNo';

/** 이 탭에서 로그인해 둔 사원 (탭을 닫으면 풀린다) */
function readSession(): Employee | null {
  try {
    return findEmployee(window.sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export interface Toast {
  id: number;
  kind: 'error' | 'success';
  text: string;
}

interface AppDataValue {
  api: Api;
  /** null: 아직 못 읽었거나 DB가 비어 있다 */
  state: AppState | null;
  /** loading: 첫 읽기 중 / empty: DB가 비어 있음 / error: 첫 읽기 실패 */
  phase: 'loading' | 'ready' | 'empty' | 'error';
  loadError: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /**
   * 저장을 실행하고 성공하면 DB를 다시 읽는다. 실패하면 빨간 토스트를 띄우고 undefined를 돌려준다.
   * 저장이 끝나기 전에 또 부르면(버튼을 연달아 누른 경우) 두 번째 호출은 아무것도 하지 않고 undefined를 돌려준다.
   */
  save: <T>(action: (api: Api) => Promise<T>) => Promise<T | undefined>;
  /** 로그인한 사원. 저장하는 작업은 로그인해야 할 수 있고, 로그인한 뒤에는 사원번호를 다시 묻지 않는다 */
  session: Employee | null;
  /** 명단에 있는 사원번호면 로그인하고 true */
  login: (employeeNo: string) => boolean;
  logout: () => void;
  loginOpen: boolean;
  setLoginOpen: (open: boolean) => void;
  toasts: Toast[];
  notify: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const api = useMemo(() => getApi(), []);
  const [state, setState] = useState<AppState | null>(null);
  const [phase, setPhase] = useState<AppDataValue['phase']>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const loadSeq = useRef(0);
  const seeding = useRef<Promise<void> | null>(null);
  const saving = useRef(false);
  const [session, setSession] = useState<Employee | null>(readSession);
  const [loginOpen, setLoginOpen] = useState(false);

  const login = useCallback((employeeNo: string) => {
    const employee = findEmployee(employeeNo);
    if (!employee) return false;
    setSession(employee);
    try {
      window.sessionStorage.setItem(SESSION_KEY, employee.no);
    } catch {
      // 저장하지 못해도 이 화면을 닫기 전까지는 로그인 상태다
    }
    return true;
  }, []);
  const logout = useCallback(() => {
    setSession(null);
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // 무시
    }
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (kind: Toast['kind'], text: string) => {
      const id = ++toastSeq.current;
      setToasts((list) => [...list, { id, kind, text }]);
      window.setTimeout(() => dismissToast(id), kind === 'error' ? 7000 : 3000);
    },
    [dismissToast],
  );

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    let next = await api.fetchState();
    // 로컬 데모 모드는 처음 열 때 시연 데이터를 자동으로 넣는다
    if (!next && api.mode === 'local') {
      seeding.current ??= api.seedLocalDemo();
      await seeding.current;
      next = await api.fetchState();
    }
    // 늦게 도착한 예전 응답이 최신 화면을 덮어쓰지 않게 한다
    if (seq !== loadSeq.current) return;
    setState(next);
    setPhase(next ? 'ready' : 'empty');
    setLoadError(null);
  }, [api]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLoadError(message);
      // 이미 화면에 데이터가 있으면 그대로 두고 알리기만 한다
      setPhase((p) => (p === 'ready' ? 'ready' : 'error'));
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // 처음 읽기 + 창에 포커스가 돌아올 때 + (P1) 10초마다
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, AUTO_REFRESH_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const save = useCallback(
    async <T,>(action: (a: Api) => Promise<T>): Promise<T | undefined> => {
      // 화면의 버튼이 비활성으로 바뀌기 전에 들어온 두 번째 클릭을 여기서 막는다 (중복 저장 방지)
      if (saving.current) return undefined;
      saving.current = true;
      try {
        const result = await action(api);
        await refresh();
        return result;
      } catch (e) {
        notify('error', `저장에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
      } finally {
        saving.current = false;
      }
    },
    [api, notify, refresh],
  );

  const value: AppDataValue = {
    api,
    state,
    phase,
    loadError,
    refreshing,
    refresh,
    save,
    session,
    login,
    logout,
    loginOpen,
    setLoginOpen,
    toasts,
    notify,
    dismissToast,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error('AppDataProvider 안에서만 쓸 수 있습니다');
  return value;
}
