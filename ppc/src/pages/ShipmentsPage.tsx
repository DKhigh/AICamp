// 출차 일정 `/shipments`: 일자별로 출차(완성)된 차량(실적)과 출차될 차량(예정)
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, ColorSwatch } from '../components/ui';
import { dashboardModel } from '../lib/dashboard';
import { formatMD, formatWithWeekday } from '../lib/date';

/** '2026-10-04' → '일' */
const weekdayOf = (date: string) => formatWithWeekday(date).slice(-2, -1);
import { num } from '../lib/format';
import type { ColorCount } from '../lib/planning';
import { colorOf } from '../lib/reference';
import { shipmentSchedule, type ShipDay } from '../lib/shipments';
import type { AppState } from '../lib/types';

function ColorSummary({ label, colors, note }: { label: string; colors: ColorCount[]; note?: string }) {
  if (colors.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] shadow-card sm:px-5">
      {/* 제목, 색상별 대수, 설명을 각각 한 줄로 둔다: 색상별 대수가 중간에서 끊기지 않고 한 줄에 나란히 보인다 */}
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 sm:flex-nowrap sm:gap-x-6">
        {colors.map((c) => (
          <span key={c.colorCode} className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-700" title={colorOf(c.colorCode)?.description}>
            <ColorSwatch code={c.colorCode} />
            {colorOf(c.colorCode)?.name ?? c.colorCode}
            <span className="hidden font-mono text-[11px] text-slate-400 md:inline">{c.colorCode}</span>
            <strong className="tabular text-slate-900">{num(c.count)}대</strong>
          </span>
        ))}
      </div>
      {note && <p className="mt-1.5 text-xs leading-snug text-slate-500">{note}</p>}
    </div>
  );
}

export function ShipmentsPage({ state }: { state: AppState }) {
  const schedule = useMemo(() => shipmentSchedule(state), [state]);
  const kpi = useMemo(() => dashboardModel(state).kpi, [state]);
  const baseDate = state.settings.baseDate;
  // 지난 실적(오래된 날부터) 다음에 오늘부터의 예정을 잇는다
  const allDays = useMemo(() => [...schedule.past, ...schedule.days], [schedule]);
  const firstShipDay = schedule.days.find((d) => d.count > 0)?.date ?? null;
  const latestPast = schedule.past[schedule.past.length - 1]?.date ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  // 처음에는 가장 최근 실적(어제)을 보여 준다. 고른 날짜가 사라지면 다시 기본값으로 돌아간다
  const selected: ShipDay | null =
    allDays.find((d) => d.date === picked) ?? allDays.find((d) => d.date === (latestPast ?? firstShipDay)) ?? allDays[0] ?? null;
  const maxCount = Math.max(1, ...allDays.map((d) => d.count));
  const lastDate = schedule.days[schedule.days.length - 1]?.date;
  const firstPast = schedule.past[0]?.date;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm font-semibold text-accent hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">출차 일정</h1>
        <p className="text-xs text-slate-500">
          기준일({formatMD(baseDate)}) 이전은 이미 출차한 <strong>실적</strong>, 기준일부터는 현재 재고와 입고 예정 발주로 계산한 <strong>예정</strong>입니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [`출차 실적 (지난 ${schedule.past.length}일)`, `${num(schedule.pastTotal)}대`, firstPast && latestPast ? `${formatMD(firstPast)} ~ ${formatMD(latestPast)}` : ''],
          ['출차 예정 (오늘 이후)', `${num(schedule.total)}대`, lastDate ? `${formatMD(baseDate)} ~ ${formatMD(lastDate)}` : ''],
          ['다음 출차 예정일', firstShipDay ? formatMD(firstShipDay) : '–', `투입 후 ${state.settings.leadTimeDays}일 뒤 완성`],
          ['입고 예정 포함 생산 가능', `${num(kpi.buildableIncoming)}대`, kpi.bottleneckIncoming ? `병목: ${kpi.bottleneckIncoming.name}` : ''],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-card sm:px-5 sm:py-4">
            <p className="text-xs font-semibold leading-snug text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">{value}</p>
            <p className="mt-0.5 min-h-4 text-xs leading-snug text-slate-500">{sub}</p>
          </div>
        ))}
      </div>

      <ColorSummary label="색상별 출차 실적" colors={schedule.pastColors} />
      <ColorSummary
        label="색상별 출차 예정"
        colors={schedule.colors}
        note="차량 색은 투입할 때 쓴 차체의 색입니다 (Excel '차량색상'). 그 색 차체가 없으면 그 색 차는 나오지 않습니다."
      />

      {schedule.past.length > 0 && firstPast && latestPast && (
        <Card
          title="출차 실적 날짜 선택"
          aside={
            <label className="flex items-center gap-2 text-xs text-slate-600">
              달력에서 고르기
              <input
                type="date"
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px] text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-blue-100"
                min={firstPast}
                max={latestPast}
                value={selected?.past ? selected.date : ''}
                onChange={(e) => {
                  // 실적 자료가 있는 날(기준일 이전 7일)만 받는다
                  if (schedule.past.some((d) => d.date === e.target.value)) setPicked(e.target.value);
                }}
                aria-label="출차 실적 날짜"
              />
            </label>
          }
        >
          <div className="grid grid-cols-7 gap-1 p-3 sm:gap-2 sm:p-4">
            {schedule.past.map((d) => {
              const active = selected?.date === d.date;
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setPicked(d.date)}
                  aria-pressed={active}
                  aria-label={`${formatMD(d.date)} 출차 실적 ${d.count}대`}
                  className={`flex flex-col items-center rounded-lg border px-0.5 py-2 transition-colors ${
                    active ? 'border-accent bg-accent text-white' : 'border-slate-200 bg-white text-slate-900 hover:border-accent hover:bg-accent-light'
                  }`}
                >
                  <span className={`text-[11px] font-semibold ${active ? 'text-blue-100' : 'text-slate-500'}`}>{weekdayOf(d.date)}</span>
                  <span className="tabular text-sm font-extrabold sm:text-base">{formatMD(d.date)}</span>
                  <span className={`tabular text-[11px] ${active ? 'text-blue-100' : 'text-slate-500'}`}>{num(d.count)}대</span>
                </button>
              );
            })}
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
            실적은 기준일({formatMD(baseDate)}) 이전 {schedule.past.length}일({formatMD(firstPast)} ~ {formatMD(latestPast)})까지만 볼 수 있습니다.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <Card title="일자별 출차 대수" aside={<span className="text-xs text-slate-500">날짜를 누르면 차량 목록을 봅니다</span>}>
          <div className="max-h-[320px] overflow-auto lg:max-h-[640px]">
            <table className="tabular w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-white text-[11px] font-semibold text-slate-500 shadow-[0_1px_0_#f1f5f9]">
                <tr>
                  <th className="py-2 pl-3 pr-2 sm:pl-5">출차일</th>
                  <th className="px-2 py-2">구분</th>
                  <th className="px-2 py-2 text-right">출차</th>
                  <th className="hidden w-1/3 px-2 py-2 sm:table-cell" aria-label="막대" />
                  <th className="py-2 pl-2 pr-3 text-right sm:pr-5">누적</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allDays.map((d) => {
                  const active = selected?.date === d.date;
                  return (
                    <tr
                      key={d.date}
                      onClick={() => setPicked(d.date)}
                      className={`cursor-pointer ${active ? 'bg-accent-light' : d.past ? 'bg-slate-50/70 hover:bg-slate-100' : 'hover:bg-slate-50'} ${
                        d.date === baseDate ? 'border-t-2 border-slate-400' : ''
                      }`}
                    >
                      <td className="whitespace-nowrap py-2 pl-3 pr-2 sm:pl-5">
                        <button type="button" aria-pressed={active} className={`font-semibold ${active ? 'text-accent' : 'text-slate-900'} hover:underline`}>
                          {formatMD(d.date)}
                        </button>
                        {d.date === baseDate && <span className="ml-1.5 text-[11px] font-semibold text-slate-500">오늘</span>}
                      </td>
                      <td className="px-2 py-2">
                        <Badge tone={d.past ? 'green' : 'gray'}>{d.past ? '실적' : '예정'}</Badge>
                      </td>
                      <td className={`whitespace-nowrap px-2 py-2 text-right font-bold ${d.count === 0 ? 'text-slate-400' : 'text-slate-900'}`}>{num(d.count)}대</td>
                      <td className="hidden px-2 py-2 sm:table-cell">
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className={`h-2 rounded-full ${d.past ? 'bg-emerald-500' : 'bg-accent'}`} style={{ width: `${(d.count / maxCount) * 100}%` }} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap py-2 pl-2 pr-3 text-right text-slate-600 sm:pr-5">{num(d.cum)}대</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title={selected ? `${formatWithWeekday(selected.date)} ${selected.past ? '출차한 차량 (실적)' : '출차 예정 차량'}` : '출차 차량'}
          aside={
            selected && (
              <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-slate-600">
                {selected.colors.map((c) => (
                  <span key={c.colorCode} className="inline-flex items-center gap-1">
                    <ColorSwatch code={c.colorCode} size={10} />
                    {colorOf(c.colorCode)?.name} {num(c.count)}
                  </span>
                ))}
                <strong className="text-slate-900">{num(selected.count)}대</strong>
              </span>
            )
          }
        >
          {!selected || selected.count === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">
              이 날짜에 출차되는 차량이 없습니다
              {selected && !selected.past && firstShipDay && selected.date < firstShipDay ? ' (투입한 차가 아직 완성되기 전입니다)' : ''}
            </p>
          ) : (
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-white text-[11px] font-semibold text-slate-500 shadow-[0_1px_0_#f1f5f9]">
                  <tr>
                    <th className="py-2 pl-3 pr-2 sm:pl-5">순번</th>
                    <th className="px-2 py-2">색상</th>
                    <th className="px-2 py-2">고유번호</th>
                    <th className="py-2 pl-2 pr-3 sm:pr-5">{selected.past ? '납품처' : '배정 주문'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selected.cars.map((car) => (
                    <tr key={car.serial}>
                      <td className="tabular py-2 pl-3 pr-2 text-slate-500 sm:pl-5">{num(car.seq)}</td>
                      <td className="px-2 py-2">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-700">
                          <ColorSwatch code={car.colorCode} />
                          {colorOf(car.colorCode)?.name ?? '–'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-[13px] font-semibold tracking-wide text-slate-900 sm:text-sm sm:tracking-wider">{car.serial}</td>
                      <td className="py-2 pl-2 pr-3 sm:pr-5">
                        {selected.past ? (
                          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-700">
                            <Badge tone="green">출차 완료</Badge>
                            <span>{car.customer}</span>
                          </span>
                        ) : car.orderId ? (
                          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-700">
                            <Badge tone="blue">{car.orderId}</Badge>
                            <span>{car.customer}</span>
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
          {selected && !selected.past && selected.count > 0 && (
            <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
              예정 차량의 고유번호는 주문과 그 주문 안에서의 순번으로 정합니다. 다른 주문이 추가되어도 같은 주문의 같은 순번 차는 번호가 바뀌지 않습니다.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
