// (P1) 이력 `/history` (DESIGN.md §5 C-2): 차질 목록과 전체 상태의 발주 목록
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmployeeConfirmModal } from '../components/EmployeeField';
import { SupplierLink } from '../components/SupplierInfo';
import { Badge, Button, Card, DISRUPTION_STATUS_TONE, disruptionStatusLabel, PO_STATUS_TONE } from '../components/ui';
import { formatMD } from '../lib/date';
import { num, timeLabel, won } from '../lib/format';
import { poAmount, poOriginalAmount, totalSpent } from '../lib/ordering';
import { isCancellable } from '../lib/planning';
import { partOf } from '../lib/reference';
import type { ActivityLog, AppState, Disruption, PurchaseOrder } from '../lib/types';
import { useAppData } from '../state/AppData';

function decisionText(d: Disruption): string {
  if (d.altPoId) {
    return `대체 발주 ${d.altSupplierName} ${num(d.altQty ?? 0)}개 (${d.altPoId}) · 원래 발주 ${d.originalPoAction}`;
  }
  if (d.status === '기다리기') return '대응하지 않음 (원래 발주를 기다림)';
  if (d.status === '해결') return '대체 발주 없이 해결';
  return '결정 전';
}

const ORDER_ACTIONS = ['납기 추가', '납기 취소'];

function LogTable({ logs }: { logs: ActivityLog[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-[13px]">
        <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
          <tr>
            <th className="py-2 pl-5 pr-2">시각</th>
            <th className="px-2 py-2">작업</th>
            <th className="px-2 py-2">대상</th>
            <th className="px-2 py-2">내용</th>
            <th className="py-2 pl-2 pr-5">사원</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="tabular whitespace-nowrap py-2.5 pl-5 pr-2 text-slate-600">{timeLabel(l.at)}</td>
              <td className="whitespace-nowrap px-2 py-2.5">
                <Badge tone={l.action.includes('취소') || l.action === '데이터 초기화' ? 'red' : l.action.includes('차질') || l.action.includes('지연') ? 'orange' : 'gray'}>
                  {l.action}
                </Badge>
              </td>
              <td className="whitespace-nowrap px-2 py-2.5 font-mono font-semibold text-slate-900">
                {l.target.startsWith('D-') ? (
                  <Link to={`/disruptions/${l.target}`} className="text-accent hover:underline">
                    {l.target}
                  </Link>
                ) : (
                  l.target || '–'
                )}
              </td>
              <td className="px-2 py-2.5 text-slate-700">{l.detail}</td>
              <td className="whitespace-nowrap py-2.5 pl-2 pr-5 text-slate-700">{l.actor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HistoryPage({ state }: { state: AppState }) {
  const orderLogs = state.logs.filter((l) => ORDER_ACTIONS.includes(l.action));
  const disruptions = [...state.disruptions].sort((a, b) => b.id.localeCompare(a.id));
  const pos = [...state.purchaseOrders].sort((a, b) => b.id.localeCompare(a.id));
  const baseDate = state.settings.baseDate;
  const { save, notify } = useAppData();
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);

  async function cancel(employeeNo: string): Promise<boolean> {
    if (!cancelTarget) return true;
    const poId = cancelTarget.id;
    const ok = await save(async (api) => {
      await api.cancelPurchaseOrder({ poId, employeeNo });
      return true;
    });
    if (ok) notify('success', `${poId} 발주를 취소했습니다.`);
    return !!ok;
  }

  return (
    <div className="space-y-4">
      {cancelTarget && (
        <EmployeeConfirmModal
          title={`발주 취소: ${cancelTarget.id}`}
          confirmLabel="발주 취소"
          danger
          onConfirm={cancel}
          onClose={() => setCancelTarget(null)}
        >
          {partOf(cancelTarget.partCode).name} {num(cancelTarget.qty)}개 · {cancelTarget.supplierName} · {formatMD(cancelTarget.expectedArrival)} 도착
          예정 발주를 취소합니다. 취소하면 입고 예정과 생산 예측에서 빠집니다. 발주 취소는 발주한 당일({formatMD(cancelTarget.orderDate)})까지만 할 수
          있습니다.
        </EmployeeConfirmModal>
      )}
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm font-semibold text-accent hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">이력</h1>
      </div>

      <Card title="차질 목록" aside={<span className="text-xs text-slate-500">{disruptions.length}건</span>}>
        {disruptions.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">등록된 차질이 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[13px]">
              <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="py-2 pl-5 pr-2">번호</th>
                  <th className="px-2 py-2">등록일</th>
                  <th className="px-2 py-2">부품</th>
                  <th className="px-2 py-2">업체</th>
                  <th className="px-2 py-2">사유</th>
                  <th className="px-2 py-2 text-right">지연일수</th>
                  <th className="px-2 py-2">상태</th>
                  <th className="px-2 py-2">결정 내용</th>
                  <th className="py-2 pl-2 pr-5">입력자</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {disruptions.map((d) => {
                  const part = partOf(d.partCode);
                  return (
                    <tr key={d.id}>
                      <td className="py-2.5 pl-5 pr-2">
                        <Link to={`/disruptions/${d.id}`} className="font-mono font-semibold text-accent hover:underline">
                          {d.id}
                        </Link>
                      </td>
                      <td className="tabular px-2 py-2.5 text-slate-700">{formatMD(d.detectedDate)}</td>
                      <td className="px-2 py-2.5 font-semibold text-slate-900">
                        {part.name} <span className="font-mono text-[11px] font-medium text-slate-400">{part.code}</span>
                      </td>
                      <td className="px-2 py-2.5 text-slate-700">
                        <SupplierLink name={d.supplierName} />
                      </td>
                      <td className="px-2 py-2.5 text-slate-700">{d.reason}</td>
                      <td className="tabular px-2 py-2.5 text-right text-slate-900">{d.delayDays}일</td>
                      <td className="px-2 py-2.5">
                        <Badge tone={DISRUPTION_STATUS_TONE[d.status]}>{disruptionStatusLabel(d.status)}</Badge>
                      </td>
                      <td className="px-2 py-2.5 text-slate-700">{decisionText(d)}</td>
                      <td className="py-2.5 pl-2 pr-5 text-slate-700">{d.createdBy ?? '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="발주 목록 (전체 상태)" aside={
          <span className="text-xs text-slate-500">
            {pos.length}건 · 발주에 쓴 금액 합계 <strong className="tabular text-sm text-slate-900">{won(totalSpent(pos))}</strong> (취소 제외)
          </span>
        }
      >
        {pos.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">등록된 발주가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-[13px]">
              <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="py-2 pl-5 pr-2">발주번호</th>
                  <th className="px-2 py-2">부품</th>
                  <th className="px-2 py-2">업체</th>
                  <th className="px-2 py-2 text-right">수량</th>
                  <th className="px-2 py-2 text-right">금액</th>
                  <th className="px-2 py-2">발주일</th>
                  <th className="px-2 py-2">도착 예정일</th>
                  <th className="px-2 py-2">상태</th>
                  <th className="px-2 py-2">구분</th>
                  <th className="px-2 py-2">관련 차질</th>
                  <th className="py-2 pl-2 pr-5">입력자</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pos.map((po) => {
                  const part = partOf(po.partCode);
                  const moved = po.expectedArrival !== po.plannedArrival;
                  return (
                    <tr key={po.id} className={po.status === '취소' ? 'text-slate-400' : ''}>
                      <td className="py-2.5 pl-5 pr-2 font-mono font-semibold text-slate-900">{po.id}</td>
                      <td className="px-2 py-2.5 font-semibold text-slate-900">{part.name}</td>
                      <td className="px-2 py-2.5 text-slate-700">
                        <SupplierLink name={po.supplierName} />
                      </td>
                      <td className="tabular whitespace-nowrap px-2 py-2.5 text-right text-slate-900">
                        {num(po.qty)}
                        {po.qty !== po.originalQty && <span className="text-[11px] text-slate-500"> (원래 {num(po.originalQty)})</span>}
                      </td>
                      <td className="tabular whitespace-nowrap px-2 py-2.5 text-right text-slate-900">
                        {po.status === '취소' ? (
                          <span className="text-slate-400" title="취소한 발주는 쓴 돈에 넣지 않습니다">
                            <s>{won(poOriginalAmount(po))}</s> 0원
                          </span>
                        ) : (
                          won(poAmount(po))
                        )}
                      </td>
                      <td className="tabular px-2 py-2.5 text-slate-700">{formatMD(po.orderDate)}</td>
                      <td className="tabular whitespace-nowrap px-2 py-2.5 text-slate-900">
                        {moved && <s className="mr-1 text-slate-400">{formatMD(po.plannedArrival)}</s>}
                        {formatMD(po.expectedArrival)}
                      </td>
                      <td className="px-2 py-2.5">
                        {isCancellable(po, baseDate) ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone="orange" title="발주한 당일까지 취소할 수 있습니다">
                              발주대기
                            </Badge>
                            <Button auth size="sm" onClick={() => setCancelTarget(po)}>
                              발주 취소
                            </Button>
                          </span>
                        ) : (
                          <Badge tone={PO_STATUS_TONE[po.status]}>{po.status}</Badge>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        <Badge tone={po.kind === '대체' ? 'blue' : 'gray'}>{po.kind}</Badge>
                      </td>
                      <td className="px-2 py-2.5">
                        {po.disruptionId ? (
                          <Link to={`/disruptions/${po.disruptionId}`} className="font-mono font-semibold text-accent hover:underline">
                            {po.disruptionId}
                          </Link>
                        ) : (
                          <span className="text-slate-400">–</span>
                        )}
                      </td>
                      <td className="py-2.5 pl-2 pr-5 text-slate-700">{po.createdBy ?? '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!state.logReady && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <strong>활동 기록 테이블(activity_log)이 DB에 없어 기록이 저장되지 않습니다.</strong> Supabase의 SQL Editor에서
          <code className="mx-1 rounded bg-white px-1">supabase/migration_activity_log.sql</code>을 한 번 실행한 뒤 [데이터 초기화]를 누르세요. 그 전까지는
          납기 추가·취소, 차질 해결 같은 작업이 되기는 하지만 누가 언제 했는지 남지 않습니다.
        </p>
      )}

      <Card
        title="납기 변경 기록 (추가 · 취소)"
        aside={<span className="text-xs text-slate-500">{orderLogs.length}건 · 취소한 주문은 납기 현황에서 지워지고 여기에만 남습니다</span>}
      >
        {orderLogs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">납기를 추가하거나 취소한 기록이 없습니다</p>
        ) : (
          <LogTable logs={orderLogs} />
        )}
      </Card>

      <Card title="활동 기록 (전체)" aside={<span className="text-xs text-slate-500">{state.logs.length}건 · 최신 순 · 누가 언제 무엇을 했는지</span>}>
        {state.logs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">기록이 없습니다</p>
        ) : (
          <LogTable logs={state.logs} />
        )}
      </Card>
    </div>
  );
}
