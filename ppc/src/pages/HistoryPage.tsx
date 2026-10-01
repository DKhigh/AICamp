// (P1) 이력 `/history` (DESIGN.md §5 C-2): 차질 목록과 전체 상태의 발주 목록
import { Link } from 'react-router-dom';
import { Badge, Card, DISRUPTION_STATUS_TONE, PO_STATUS_TONE } from '../components/ui';
import { formatMD } from '../lib/date';
import { num } from '../lib/format';
import { partOf } from '../lib/reference';
import type { AppState, Disruption } from '../lib/types';

function decisionText(d: Disruption): string {
  if (d.altPoId) {
    return `대체 발주 ${d.altSupplierName} ${num(d.altQty ?? 0)}개 (${d.altPoId}) · 원래 발주 ${d.originalPoAction}`;
  }
  if (d.status === '기다리기') return '기다리기';
  if (d.status === '해결') return '대체 발주 없이 해결';
  return '결정 전';
}

export function HistoryPage({ state }: { state: AppState }) {
  const disruptions = [...state.disruptions].sort((a, b) => b.id.localeCompare(a.id));
  const pos = [...state.purchaseOrders].sort((a, b) => b.id.localeCompare(a.id));

  return (
    <div className="space-y-4">
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
                      <td className="px-2 py-2.5 text-slate-700">{d.supplierName}</td>
                      <td className="px-2 py-2.5 text-slate-700">{d.reason}</td>
                      <td className="tabular px-2 py-2.5 text-right text-slate-900">{d.delayDays}일</td>
                      <td className="px-2 py-2.5">
                        <Badge tone={DISRUPTION_STATUS_TONE[d.status]}>{d.status}</Badge>
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

      <Card title="발주 목록 (전체 상태)" aside={<span className="text-xs text-slate-500">{pos.length}건</span>}>
        {pos.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">등록된 발주가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="py-2 pl-5 pr-2">발주번호</th>
                  <th className="px-2 py-2">부품</th>
                  <th className="px-2 py-2">업체</th>
                  <th className="px-2 py-2 text-right">수량</th>
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
                      <td className="px-2 py-2.5 text-slate-700">{po.supplierName}</td>
                      <td className="tabular whitespace-nowrap px-2 py-2.5 text-right text-slate-900">
                        {num(po.qty)}
                        {po.qty !== po.originalQty && <span className="text-[11px] text-slate-500"> (원래 {num(po.originalQty)})</span>}
                      </td>
                      <td className="tabular px-2 py-2.5 text-slate-700">{formatMD(po.orderDate)}</td>
                      <td className="tabular whitespace-nowrap px-2 py-2.5 text-slate-900">
                        {moved && <s className="mr-1 text-slate-400">{formatMD(po.plannedArrival)}</s>}
                        {formatMD(po.expectedArrival)}
                      </td>
                      <td className="px-2 py-2.5">
                        <Badge tone={PO_STATUS_TONE[po.status]}>{po.status}</Badge>
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
    </div>
  );
}
