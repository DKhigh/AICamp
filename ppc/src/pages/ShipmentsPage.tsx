// 출차 일정 `/shipments`: 일자별로 출차(완성)되는 차량과 대수
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card } from '../components/ui';
import { dashboardModel } from '../lib/dashboard';
import { formatMD, formatWithWeekday } from '../lib/date';
import { num } from '../lib/format';
import { shipmentSchedule } from '../lib/shipments';
import type { AppState } from '../lib/types';

export function ShipmentsPage({ state }: { state: AppState }) {
  const schedule = useMemo(() => shipmentSchedule(state), [state]);
  const kpi = useMemo(() => dashboardModel(state).kpi, [state]);
  const firstShipDay = schedule.days.find((d) => d.count > 0)?.date ?? schedule.days[0]?.date ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  // 고른 날짜가 (설정 변경 등으로) 사라지면 첫 출차일로 돌아간다
  const selected = schedule.days.find((d) => d.date === picked) ?? schedule.days.find((d) => d.date === firstShipDay) ?? null;
  const maxCount = Math.max(1, ...schedule.days.map((d) => d.count));
  const lastDate = schedule.days[schedule.days.length - 1]?.date;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm font-semibold text-accent hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">출차 일정</h1>
        <p className="text-xs text-slate-500">
          현재 재고와 입고 예정 발주로 계산한 일자별 완성 차량입니다. 발주·차질이 바뀌면 다시 계산됩니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['입고 예정 포함 생산 가능', `${num(kpi.buildableIncoming)}대`, kpi.bottleneckIncoming ? `병목: ${kpi.bottleneckIncoming.name}` : ''],
          ['예측 기간 출차 합계', `${num(schedule.total)}대`, lastDate ? `${formatMD(state.settings.baseDate)} ~ ${formatMD(lastDate)}` : ''],
          ['첫 출차일', firstShipDay && schedule.total > 0 ? formatMD(firstShipDay) : '–', `투입 후 ${state.settings.leadTimeDays}일 뒤 완성`],
          ['하루 최대 출차', `${num(maxCount === 1 && schedule.total === 0 ? 0 : maxCount)}대`, `일일 투입 ${state.settings.dailyCapacity}대`],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-card">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{value}</p>
            <p className="mt-0.5 h-4 text-xs text-slate-500">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <Card title="일자별 출차 대수" aside={<span className="text-xs text-slate-500">날짜를 누르면 차량 목록을 봅니다</span>}>
          <div className="max-h-[640px] overflow-auto">
            <table className="tabular w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-white text-[11px] font-semibold text-slate-500 shadow-[0_1px_0_#f1f5f9]">
                <tr>
                  <th className="py-2 pl-5 pr-2">출차일</th>
                  <th className="px-2 py-2 text-right">출차</th>
                  <th className="w-2/5 px-2 py-2" aria-label="막대" />
                  <th className="py-2 pl-2 pr-5 text-right">누적</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schedule.days.map((d) => {
                  const active = selected?.date === d.date;
                  return (
                    <tr
                      key={d.date}
                      onClick={() => setPicked(d.date)}
                      className={`cursor-pointer ${active ? 'bg-accent-light' : 'hover:bg-slate-50'}`}
                    >
                      <td className="py-2 pl-5 pr-2">
                        <button
                          type="button"
                          aria-pressed={active}
                          className={`font-semibold ${active ? 'text-accent' : 'text-slate-900'} hover:underline`}
                        >
                          {formatMD(d.date)}
                        </button>
                      </td>
                      <td className={`px-2 py-2 text-right font-bold ${d.count === 0 ? 'text-slate-400' : 'text-slate-900'}`}>
                        {num(d.count)}대
                      </td>
                      <td className="px-2 py-2">
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full bg-accent" style={{ width: `${(d.count / maxCount) * 100}%` }} />
                        </div>
                      </td>
                      <td className="py-2 pl-2 pr-5 text-right text-slate-600">{num(d.cum)}대</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title={selected ? `${formatWithWeekday(selected.date)} 출차 차량` : '출차 차량'}
          aside={selected && <span className="text-xs font-semibold text-slate-600">{num(selected.count)}대</span>}
        >
          {!selected || selected.count === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">
              이 날짜에 출차되는 차량이 없습니다
              {selected && selected.date < (firstShipDay ?? '') ? ' (투입한 차가 아직 완성되기 전입니다)' : ''}
            </p>
          ) : (
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-white text-[11px] font-semibold text-slate-500 shadow-[0_1px_0_#f1f5f9]">
                  <tr>
                    <th className="py-2 pl-5 pr-2">순번</th>
                    <th className="px-2 py-2">고유번호</th>
                    <th className="py-2 pl-2 pr-5">배정 주문</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selected.cars.map((car) => (
                    <tr key={car.serial}>
                      <td className="tabular py-2 pl-5 pr-2 text-slate-500">{num(car.seq)}</td>
                      <td className="px-2 py-2 font-mono text-sm font-semibold tracking-wider text-slate-900">{car.serial}</td>
                      <td className="py-2 pl-2 pr-5">
                        {car.orderId ? (
                          <span className="text-slate-700">
                            <Badge tone="blue">{car.orderId}</Badge> {car.customer}
                          </span>
                        ) : (
                          <span className="text-slate-400">주문 미배정 (재고)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
