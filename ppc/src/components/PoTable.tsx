// F1-3 입고 예정 발주 표
import { useState } from 'react';
import type { PoRow } from '../lib/dashboard';
import { formatMD } from '../lib/date';
import { ddayLabel, num } from '../lib/format';
import { useAppData } from '../state/AppData';
import { Badge, Button, PO_STATUS_TONE } from './ui';

export function PoTable({ rows }: { rows: PoRow[] }) {
  const { save, notify } = useAppData();
  const [receiving, setReceiving] = useState<string | null>(null);

  async function receive(row: PoRow) {
    const { po, part } = row;
    if (!window.confirm(`${po.id} ${part.name} ${num(po.qty)}개를 입고 처리할까요? 현재 재고에 더해집니다.`)) return;
    setReceiving(po.id);
    const ok = await save(async (api) => {
      await api.receivePurchaseOrder(po.id);
      return true;
    });
    setReceiving(null);
    if (ok) notify('success', `${po.id} 입고 완료: ${part.name} +${num(po.qty)}개`);
  }

  if (rows.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-slate-500">입고 예정 발주가 없습니다</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-left text-[13px]">
        <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
          <tr>
            <th className="py-2 pl-5 pr-2">발주번호</th>
            <th className="px-2 py-2">부품</th>
            <th className="px-2 py-2">업체</th>
            <th className="px-2 py-2 text-right">수량</th>
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
                <td className="tabular whitespace-nowrap px-2 py-2.5 text-slate-900">
                  {po.status === '지연' && row.delayedBy !== 0 && (
                    <s className="mr-1 text-slate-400">{formatMD(po.plannedArrival)}</s>
                  )}
                  {formatMD(po.expectedArrival)}
                </td>
                <td className={`tabular whitespace-nowrap px-2 py-2.5 font-semibold ${row.dday < 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                  {ddayLabel(row.dday)}
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    {po.status === '지연' ? (
                      <Badge tone="red">지연 +{row.delayedBy}일</Badge>
                    ) : (
                      <Badge tone={PO_STATUS_TONE[po.status]}>{po.status}</Badge>
                    )}
                    {row.atRisk && <Badge tone="orange">지연 위험 (준수율 {row.onTimeRate}%)</Badge>}
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <Badge tone={po.kind === '대체' ? 'blue' : 'gray'}>{po.kind}</Badge>
                </td>
                <td className="py-2.5 pl-2 pr-5 text-right">
                  <Button size="sm" onClick={() => void receive(row)} busy={receiving === po.id} disabled={receiving !== null}>
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
