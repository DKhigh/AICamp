import { useCallback, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { DisruptionModal } from './components/DisruptionModal';
import { EmployeeConfirmModal, LoginModal } from './components/EmployeeField';
import { OrderModal } from './components/OrderModal';
import { SupplierModal } from './components/SupplierInfo';
import { TopBar } from './components/TopBar';
import { Button, Card, Spinner } from './components/ui';
import { EMPTY_DB_MESSAGE } from './lib/api';
import { staleDataReasons } from './lib/dashboard';
import { SearchPage } from './pages/SearchPage';
import { Dashboard } from './pages/Dashboard';
import { DisruptionPage } from './pages/DisruptionPage';
import { HistoryPage } from './pages/HistoryPage';
import { QrPage } from './pages/QrPage';
import { RepairsPage } from './pages/RepairsPage';
import { ShipmentsPage } from './pages/ShipmentsPage';
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
  const { phase, loadError, refresh, save, notify, api, session } = useAppData();
  const [seedOpen, setSeedOpen] = useState(false);

  async function seed(employeeNo: string): Promise<boolean> {
    const ok = await save(async (a) => {
      await a.resetDemoData(employeeNo);
      return true;
    });
    if (ok) notify('success', '시연 데이터를 넣었습니다.');
    return !!ok;
  }

  return (
    <Card>
      {seedOpen && (
        <EmployeeConfirmModal title="시연 데이터 넣기" confirmLabel="시연 데이터 넣기" onConfirm={seed} onClose={() => setSeedOpen(false)}>
          비어 있는 DB에 시연 초기 데이터를 넣습니다.
        </EmployeeConfirmModal>
      )}
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
            {!session && <p className="text-xs text-slate-500">상단의 [로그인] 후에 시연 데이터를 넣을 수 있습니다.</p>}
            <Button auth variant="primary" onClick={() => setSeedOpen(true)}>
              시연 데이터 넣기
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function Shell() {
  const { state, loadError, phase, loginOpen } = useAppData();
  const [orderModal, setOrderModal] = useState<{ partCode?: string; supplierName?: string } | null>(null);
  const [disruptionModal, setDisruptionModal] = useState(false);
  const [supplierModal, setSupplierModal] = useState<string | null>(null);

  const openOrder = useCallback((partCode?: string, supplierName?: string) => setOrderModal({ partCode, supplierName }), []);
  const openDisruption = useCallback(() => setDisruptionModal(true), []);
  const openSupplier = useCallback((supplierName: string) => setSupplierModal(supplierName), []);
  const ui = useMemo<UiValue>(() => ({ openOrder, openDisruption, openSupplier }), [openOrder, openDisruption, openSupplier]);
  const stale = useMemo(() => (state ? staleDataReasons(state) : []), [state]);

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
        {/* 앱을 새로 배포한 뒤 [데이터 초기화]를 하지 않으면 DB에 예전 형식의 데이터가 남아 있다 */}
        {stale.length > 0 && (
          <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
            <p className="font-bold">DB에 예전 형식의 데이터가 남아 있습니다. 상단의 [데이터 초기화]를 한 번 눌러 주세요.</p>
            <ul className="mt-1 list-disc pl-5">
              {stale.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="mt-1">초기화하면 차체가 색상별로 나뉘고, 발주·주문 기록이 오늘을 기준으로 한 지난 날짜로 다시 만들어집니다.</p>
          </div>
        )}
        <Routes>
          {/* QR 페이지는 DB 데이터가 필요 없으므로, 데이터를 못 읽었을 때도 띄울 수 있게 따로 둔다 */}
          <Route path="/qr" element={<QrPage />} />
          <Route
            path="*"
            element={
              state ? (
                <Routes>
                  <Route path="/" element={<Dashboard state={state} />} />
                  <Route path="/disruptions/:id" element={<DisruptionPage state={state} />} />
                  <Route path="/history" element={<HistoryPage state={state} />} />
                  <Route path="/shipments" element={<ShipmentsPage state={state} />} />
                  <Route path="/repairs" element={<RepairsPage state={state} />} />
                  <Route path="/search" element={<SearchPage state={state} />} />
                  <Route path="*" element={<Dashboard state={state} />} />
                </Routes>
              ) : (
                <NoData />
              )
            }
          />
        </Routes>
      </main>
      {state && supplierModal && <SupplierModal state={state} supplierName={supplierModal} onClose={() => setSupplierModal(null)} />}
      {state && orderModal && (
        <OrderModal state={state} initialPartCode={orderModal.partCode} initialSupplierName={orderModal.supplierName} onClose={() => setOrderModal(null)} />
      )}
      {state && disruptionModal && <DisruptionModal state={state} onClose={() => setDisruptionModal(false)} />}
      {/* 다른 창 위에 떠야 하므로 맨 뒤에 둔다 */}
      {loginOpen && <LoginModal />}
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
