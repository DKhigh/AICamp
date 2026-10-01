import { useCallback, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { DisruptionModal } from './components/DisruptionModal';
import { OrderModal } from './components/OrderModal';
import { TopBar } from './components/TopBar';
import { Button, Card, Spinner } from './components/ui';
import { EMPTY_DB_MESSAGE } from './lib/api';
import { Dashboard } from './pages/Dashboard';
import { DisruptionPage } from './pages/DisruptionPage';
import { HistoryPage } from './pages/HistoryPage';
import { AppDataProvider, useAppData } from './state/AppData';
import { UiContext, type UiValue } from './state/Ui';

function Toasts() {
  const { toasts, dismissToast } = useAppData();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismissToast(t.id)}
          className={`pop-in pointer-events-auto max-w-xl rounded-lg px-4 py-2.5 text-left text-sm font-semibold text-white shadow-popup ${
            t.kind === 'error' ? 'bg-red-600' : 'bg-slate-900'
          }`}
        >
          {t.kind === 'error' ? '⚠ ' : '✓ '}
          {t.text}
        </button>
      ))}
    </div>
  );
}

/** 아직 화면에 보여 줄 데이터가 없을 때 (첫 읽기 중 / 실패 / 빈 DB) */
function NoData() {
  const { phase, loadError, refresh, save, notify, api } = useAppData();
  const [busy, setBusy] = useState(false);

  async function seed() {
    setBusy(true);
    const ok = await save(async (a) => {
      await a.resetDemoData();
      return true;
    });
    setBusy(false);
    if (ok) notify('success', '시연 데이터를 넣었습니다.');
  }

  return (
    <Card>
      <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
        {phase === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Spinner /> 데이터를 읽는 중입니다…
          </p>
        )}
        {phase === 'error' && (
          <>
            <p className="text-sm font-semibold text-red-600">데이터를 읽지 못했습니다: {loadError}</p>
            {api.mode === 'supabase' && (
              <p className="max-w-md text-xs text-slate-500">
                Supabase에 테이블이 있는지(supabase/schema.sql 실행), .env.local의 URL과 publishable key가 맞는지 확인하세요.
              </p>
            )}
            <Button onClick={() => void refresh()}>다시 시도</Button>
          </>
        )}
        {phase === 'empty' && (
          <>
            <p className="text-sm text-slate-700">{EMPTY_DB_MESSAGE}</p>
            <Button variant="primary" onClick={() => void seed()} busy={busy}>
              시연 데이터 넣기
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function Shell() {
  const { state, loadError, phase } = useAppData();
  const [orderModal, setOrderModal] = useState<{ partCode?: string } | null>(null);
  const [disruptionModal, setDisruptionModal] = useState(false);

  const openOrder = useCallback((partCode?: string) => setOrderModal({ partCode }), []);
  const openDisruption = useCallback(() => setDisruptionModal(true), []);
  const ui = useMemo<UiValue>(() => ({ openOrder, openDisruption }), [openOrder, openDisruption]);

  return (
    <UiContext.Provider value={ui}>
      <TopBar />
      <Toasts />
      <main className="mx-auto max-w-[1320px] px-4 py-4 sm:px-6">
        {state && phase === 'ready' && loadError && (
          <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] font-medium text-amber-900">
            최신 데이터를 읽지 못해 마지막으로 읽은 내용을 보여 주고 있습니다: {loadError}
          </p>
        )}
        {state ? (
          <Routes>
            <Route path="/" element={<Dashboard state={state} />} />
            <Route path="/disruptions/:id" element={<DisruptionPage state={state} />} />
            <Route path="/history" element={<HistoryPage state={state} />} />
            <Route path="*" element={<Dashboard state={state} />} />
          </Routes>
        ) : (
          <NoData />
        )}
      </main>
      {state && orderModal && <OrderModal state={state} initialPartCode={orderModal.partCode} onClose={() => setOrderModal(null)} />}
      {state && disruptionModal && <DisruptionModal state={state} onClose={() => setDisruptionModal(false)} />}
    </UiContext.Provider>
  );
}

export default function App() {
  return (
    <AppDataProvider>
      <Shell />
    </AppDataProvider>
  );
}
