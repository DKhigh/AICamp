// F1-3 입고 예정 발주 표
import { useState } from 'react';
import type { PoRow } from '../lib/dashboard';
import { formatMD } from '../lib/date';
import { ddayLabel, num, won } from '../lib/format';
import { useAppData } from '../state/AppData';
import { EmployeeConfirmModal } from './EmployeeField';
import { Badge, Button, PO_STATUS_TONE } from './ui';

export function PoTable({ rows }: { rows: PoRow[] }) {
  const { save, notify } = useAppData();
  const [target, setTarget] = useState<PoRow | null>(null);

  async function receive(employeeNo: string): Promise<boolean> {
    if (!target) return true;
    const { po, part } = target;
    const ok = await save(async (api) => {
      await api.receivePurchaseOrder({ poId: po.id, employeeNo });
      return true;
    });
    if (ok) notify('success', `${po.id} 입고 완료: ${part.name} +${num(po.qty)}개`);
    return !!ok;
  }

  if (rows.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-slate-500">입고 예정 발주가 없습니다</p>;
  }

  return (
    <div className="overflow-x-auto">
      {target && (
        <EmployeeConfirmModal title={`입고 처리: ${target.po.id}`} confirmLabel="입고 처리" onConfirm={receive} onClose={() => setTarget(null)}>
          {target.part.name} {num(target.po.qty)}개({target.po.supplierName})를 입고 처리합니다. 현재 재고에 더해지고 발주는 입고완료가 됩니다.
          {target.dday > 0 && (
            <strong className="mt-1.5 block text-amber-700">
              도착 예정일({formatMD(target.po.expectedArrival)})보다 {target.dday}일 이릅니다. 실제로 들어온 것이 맞는지 확인하세요.
            </strong>
          )}
        </EmployeeConfirmModal>
      )}
      <table className="w-full whitespace-nowrap text-left text-[13px]">
        <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
          <tr>
            <th className="py-2 pl-5 pr-2">발주번호</th>
            <th className="px-2 py-2">부품</th>
            <th className="px-2 py-2">업체</th>
            <th className="px-2 py-2 text-right">수량</th>
            <th className="px-2 py-2 text-right">금액</th>
            <th className="px-2 py-2">도착 예정일</th>
            <th className="px-2 py-2">D-day</th>
            <th className="px-2 py-2">상태</th>
            <th className="px-2 py-2">구분</th>
            <th className="py-2 pl-2 pr-5" aria-label="입고 처리" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const { po, part } = row;
            const reduced = po.qty !== po.originalQty;
            return (
              <tr key={po.id} className={po.status === '지연' ? 'bg-red-50/40' : ''}>
                <td className="py-2.5 pl-5 pr-2 font-mono font-semibold text-slate-900">{po.id}</td>
                <td className="px-2 py-2.5 font-semibold text-slate-900">{part.name}</td>
                <td className="px-2 py-2.5 text-slate-700">{po.supplierName}</td>
                <td className="tabular whitespace-nowrap px-2 py-2.5 text-right text-slate-900">
                  {num(po.qty)}
                  {reduced && <span className="text-[11px] text-slate-500"> (원래 {num(po.originalQty)})</span>}
                </td>
                <td className="tabular whitespace-nowrap px-2 py-2.5 text-right text-slate-700">{won(row.amount)}</td>
                <td className="tabular whitespace-nowrap px-2 py-2.5 text-slate-900">
                  {row.delayedBy !== 0 && <s className="mr-1 text-slate-400">{formatMD(po.plannedArrival)}</s>}
                  {formatMD(po.expectedArrival)}
                </td>
                <td className={`tabular whitespace-nowrap px-2 py-2.5 font-semibold ${row.dday < 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                  {ddayLabel(row.dday)}
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    {po.status === '지연' ? (
                      <Badge tone="red">지연 +{row.delayedBy}일</Badge>
                    ) : row.displayStatus === '발주대기' ? (
                      // 이력 화면과 같은 이름을 쓴다: 발주한 당일의 일반 발주
                      <Badge tone="orange" title="발주한 당일까지 이력에서 취소할 수 있습니다">
                        발주대기
                      </Badge>
                    ) : (
                      <Badge tone={PO_STATUS_TONE[po.status]}>{po.status}</Badge>
                    )}
                    {po.status !== '지연' && row.delayedBy !== 0 && (
                      <Badge tone="gray" title="차질을 해결하면서 확정한 도착일입니다">
                        일정 확정 {row.delayedBy > 0 ? '+' : ''}
                        {row.delayedBy}일
                      </Badge>
                    )}
                    {row.atRisk && <Badge tone="orange">지연 위험 (준수율 {row.onTimeRate}%)</Badge>}
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <Badge tone={po.kind === '대체' ? 'blue' : 'gray'}>{po.kind}</Badge>
                </td>
                <td className="py-2.5 pl-2 pr-5 text-right">
                  <Button size="sm" onClick={() => setTarget(row)}>
                    입고 처리
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
