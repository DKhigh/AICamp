// 현재 재고 `/stock`: 대시보드의 '현재 재고로 생산 가능'을 누르면 오는 화면. 부품별 재고를 표로 본다
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, ColorSwatch, PART_STATUS_TONE } from '../components/ui';
import { LOW_COVERAGE_DAYS } from '../lib/constants';
import { dashboardModel, type PartRow } from '../lib/dashboard';
import { formatMD } from '../lib/date';
import { dashPartName, ddayLabel, num } from '../lib/format';
import { colorOf } from '../lib/reference';
import type { AppState } from '../lib/types';
import { useUi } from '../state/Ui';

export function StockPage({ state }: { state: AppState }) {
  const { openOrder } = useUi();
  const model = useMemo(() => dashboardModel(state), [state]);
  const { kpi } = model;
  const cap = state.settings.dailyCapacity;
  // 색상별 외판은 합계 줄 아래에 색마다 한 줄씩 편다
  const rows = model.parts.flatMap((row) => [{ row, child: false }, ...(row.variants ?? []).map((v) => ({ row: v, child: true }))]);
  const totalOnHand = model.parts.reduce((sum, r) => sum + r.linePart.onHand, 0);

  const line = ({ row, child }: { row: PartRow; child: boolean }) => {
    const group = !!row.variants;
    const need = LOW_COVERAGE_DAYS * cap * row.linePart.qtyPerCar;
    return (
      <tr key={row.part.code} className={`${row.isBottleneck ? 'bg-slate-50' : ''} ${child ? 'text-[12.5px]' : ''}`}>
        <td className={`py-2.5 pr-2 ${child ? 'pl-10' : 'pl-5'}`}>
          {child ? (
            <span className="inline-flex items-center gap-1.5 text-slate-700">
              <ColorSwatch code={row.part.colorCode} />
              {colorOf(row.part.colorCode)?.name ?? row.part.colorCode}
              <span className="font-mono text-[11px] text-slate-400">{row.part.code}</span>
            </span>
          ) : (
            <span className="font-semibold text-slate-900">
              {dashPartName(row.part.name)}
              {!group && <span className="ml-1.5 font-mono text-[11px] font-medium text-slate-400">{row.part.code}</span>}
              {group && <span className="ml-1.5 text-xs font-medium text-slate-500">색상별 {row.variants!.length}종 합계</span>}
              {row.isBottleneck && <span className="ml-2 rounded bg-slate-900 px-1.5 py-0.5 text-[11px] font-bold text-white">병목</span>}
            </span>
          )}
        </td>
        <td className={`tabular px-2 py-2.5 text-right ${child ? 'text-slate-700' : 'text-base font-extrabold text-slate-900'}`}>{num(row.linePart.onHand)}개</td>
        <td className="tabular px-2 py-2.5 text-right text-slate-600">{row.repairNeed > 0 ? `${num(row.repairNeed)}개` : '–'}</td>
        <td className="tabular px-2 py-2.5 text-right font-semibold text-slate-900">{num(row.available)}개</td>
        <td className="tabular px-2 py-2.5 text-right text-slate-600">{child ? '' : `×${row.linePart.qtyPerCar}`}</td>
        <td className="tabular px-2 py-2.5 text-right font-bold text-slate-900">{num(row.cars)}대</td>
        <td className={`tabular px-2 py-2.5 text-right ${!child && row.available < need ? 'font-bold text-amber-700' : 'text-slate-700'}`}>
          {child ? '' : `${row.coverage.toFixed(1)}일`}
        </td>
        <td className="px-2 py-2.5">{!child && <Badge tone={PART_STATUS_TONE[row.status]}>{row.status}</Badge>}</td>
        <td className="tabular whitespace-nowrap px-2 py-2.5 text-slate-700">
          {row.nextPo && row.nextDday !== null ? `${formatMD(row.nextPo.expectedArrival)} (${ddayLabel(row.nextDday)}) +${num(row.nextPo.qty)}개` : '입고 예정 없음'}
        </td>
        <td className="py-2.5 pl-2 pr-5 text-right">
          {!group && (
            <Button auth size="sm" onClick={() => openOrder(row.part.code)} aria-label={`${dashPartName(row.part.name)} 발주`}>
              발주
            </Button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm font-semibold text-accent hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">현재 재고</h1>
        <p className="text-xs text-slate-500">자동차 1대에 들어가는 부품의 지금 재고입니다. 생산 가능 대수는 수리용으로 잡아 둔 수량을 뺀 재고로 계산합니다.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['현재 재고로 생산 가능', `${num(kpi.buildableNow)}대`, kpi.bottleneckNow ? `병목: ${dashPartName(kpi.bottleneckNow.name)}` : ''],
          ['오늘 투입 가능', `${num(kpi.todayInput)} / ${num(kpi.dailyCapacity)}대`, '일일 투입 기준'],
          ['입고 예정 포함 생산 가능', `${num(kpi.buildableIncoming)}대`, kpi.bottleneckIncoming ? `병목: ${dashPartName(kpi.bottleneckIncoming.name)}` : ''],
          ['부품 재고 합계', `${num(totalOnHand)}개`, `${model.parts.length}종`],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-card">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{value}</p>
            <p className="mt-0.5 h-4 text-xs text-slate-500">{sub}</p>
          </div>
        ))}
      </div>

      <Card title="부품별 재고" aside={<span className="text-xs text-slate-500">가능 대수가 가장 적은 부품이 병목입니다 · 재고 일수 {LOW_COVERAGE_DAYS}일 미만은 주의</span>}>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-[13px]">
            <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
              <tr>
                <th className="py-2 pl-5 pr-2">부품</th>
                <th className="px-2 py-2 text-right">현재 재고</th>
                <th className="px-2 py-2 text-right">수리용</th>
                <th className="px-2 py-2 text-right">생산용</th>
                <th className="px-2 py-2 text-right">1대당</th>
                <th className="px-2 py-2 text-right">가능 대수</th>
                <th className="px-2 py-2 text-right">재고 일수</th>
                <th className="px-2 py-2">상태</th>
                <th className="px-2 py-2">다음 입고</th>
                <th className="py-2 pl-2 pr-5" aria-label="발주" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">{rows.map(line)}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
