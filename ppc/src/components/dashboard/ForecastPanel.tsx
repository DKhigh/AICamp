// F1-5 생산 예측: 요약 문장, 누적 완성 그래프, 일별 표, (P1) 설정 수정
import { useState } from 'react';
import type { DashboardModel } from '../../lib/dashboard';
import { dailyCapacityError, leadTimeError } from '../../lib/api';
import { MAX_DAILY_CAPACITY, MAX_LEAD_TIME_DAYS } from '../../lib/constants';
import { formatMD } from '../../lib/date';
import { num } from '../../lib/format';
import { partOf } from '../../lib/reference';
import type { AppState } from '../../lib/types';
import { useAppData } from '../../state/AppData';
import { EmployeeConfirmModal } from '../EmployeeField';
import { CHART_COLORS, ScenarioChart, type ChartRow } from '../ScenarioChart';
import { Badge, Button, Card, parseIntStrict } from '../ui';

function SettingsEditor({ state }: { state: AppState }) {
  const { save, notify } = useAppData();
  const [capacityText, setCapacityText] = useState(String(state.settings.dailyCapacity));
  const [leadText, setLeadText] = useState(String(state.settings.leadTimeDays));
  const [confirming, setConfirming] = useState(false);

  const dailyCapacity = parseIntStrict(capacityText);
  const leadTimeDays = parseIntStrict(leadText);
  const capacityProblem = dailyCapacityError(dailyCapacity) ? `1~${num(MAX_DAILY_CAPACITY)}의 정수` : null;
  const leadProblem = leadTimeError(leadTimeDays) ? `0~${MAX_LEAD_TIME_DAYS}의 정수` : null;
  const changed = dailyCapacity !== state.settings.dailyCapacity || leadTimeDays !== state.settings.leadTimeDays;

  async function submit(employeeNo: string): Promise<boolean> {
    const ok = await save(async (api) => {
      await api.updateSettings({ dailyCapacity, leadTimeDays, employeeNo });
      return true;
    });
    if (ok) notify('success', '설정을 저장하고 예측을 다시 계산했습니다.');
    return !!ok;
  }

  const inputClass =
    'tabular w-16 rounded-md border border-slate-300 px-2 py-1 text-right text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-blue-100';

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-[13px]">
      {confirming && (
        <EmployeeConfirmModal title="생산 설정 변경" confirmLabel="저장" onConfirm={submit} onClose={() => setConfirming(false)}>
          일일 투입 {num(state.settings.dailyCapacity)} → <strong>{num(dailyCapacity)}대</strong>, 리드타임 {state.settings.leadTimeDays} →{' '}
          <strong>{leadTimeDays}일</strong>로 바꿉니다. 저장하면 모든 사람의 화면에서 생산 예측이 다시 계산되고, 바꾼 사람이 이력에 남습니다.
        </EmployeeConfirmModal>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-slate-500">일일 투입 (대)</span>
        <input className={inputClass} type="number" min={1} max={MAX_DAILY_CAPACITY} step={1} value={capacityText} onChange={(e) => setCapacityText(e.target.value)} />
        {capacityProblem && <span className="text-[11px] font-medium text-red-600">{capacityProblem}</span>}
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-slate-500">리드타임 (일)</span>
        <input className={inputClass} type="number" min={0} max={MAX_LEAD_TIME_DAYS} step={1} value={leadText} onChange={(e) => setLeadText(e.target.value)} />
        {leadProblem && <span className="text-[11px] font-medium text-red-600">{leadProblem}</span>}
      </label>
      <Button size="sm" variant="primary" onClick={() => setConfirming(true)} disabled={!changed || !!capacityProblem || !!leadProblem}>
        저장
      </Button>
      <span className="pb-1 text-[11px] text-slate-500">저장할 때 사원번호를 확인합니다. 모든 사람의 화면에서 예측이 다시 계산됩니다.</span>
    </div>
  );
}

export function ForecastPanel({ state, model }: { state: AppState; model: DashboardModel }) {
  const [showTable, setShowTable] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { settings, customerOrders } = state;
  const sim = model.scenarios.wait.sim;

  // (P1) 주문 누적 필요량: 납기일 기준 계단선
  const rows: ChartRow[] = sim.cumulative.map((row) => ({
    date: row.date,
    cum: row.cum,
    need: customerOrders.filter((o) => o.dueDate <= row.date).reduce((sum, o) => sum + o.qty, 0),
  }));
  const dayByDate = new Map(sim.days.map((d) => [d.date, d]));
  const stopCount = model.scenarios.wait.lineStopDays;

  return (
    <Card
      title="생산 예측"
      aside={
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>
            일일 투입 <strong className="text-slate-800">{settings.dailyCapacity}대</strong> · 리드타임{' '}
            <strong className="text-slate-800">{settings.leadTimeDays}일</strong>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
            설정 {showSettings ? '▲' : '▼'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4">
        {showSettings && (
          // 설정이 바뀌면(다른 사람이 바꾼 경우 포함) 입력칸을 새 값으로 다시 채운다
          <SettingsEditor key={`${settings.dailyCapacity}-${settings.leadTimeDays}`} state={state} />
        )}

        <p className="text-sm leading-relaxed text-slate-700">
          {model.forecastPoints.map((p, i) => (
            <span key={p.offset}>
              {i > 0 && ' · '}
              {p.offset}일 뒤({formatMD(p.date)}) <strong className="text-base text-slate-900">{num(p.cum)}대</strong>
            </span>
          ))}{' '}
          완성 예정
          {stopCount > 0 && (
            <span className="ml-2 align-middle">
              <Badge tone="red">라인 정지·감산 {stopCount}일</Badge>
            </span>
          )}
        </p>

        <ScenarioChart
          ariaLabel="누적 완성 대수와 주문 누적 필요량"
          rows={rows}
          series={[
            { key: 'cum', name: '누적 완성', color: CHART_COLORS.blue },
            { key: 'need', name: '주문 누적 필요량 (납기 기준)', color: CHART_COLORS.gray, dashed: true, step: true },
          ]}
        />

        <div>
          <Button size="sm" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
            일별 표 {showTable ? '▲' : '▼'}
          </Button>
          {showTable && (
            <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-200">
              <table className="tabular w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <tr>
                    <th className="px-3 py-2">날짜</th>
                    <th className="px-3 py-2 text-right">투입</th>
                    <th className="px-3 py-2 text-right">완성</th>
                    <th className="px-3 py-2 text-right">누적 완성</th>
                    <th className="px-3 py-2">비고</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sim.cumulative.map((row) => {
                    const day = dayByDate.get(row.date);
                    return (
                      <tr key={row.date} className={day && day.kind !== '정상' ? 'bg-red-50/50' : ''}>
                        <td className="px-3 py-1.5 text-slate-900">{formatMD(row.date)}</td>
                        <td className="px-3 py-1.5 text-right text-slate-900">{day ? num(day.input) : '–'}</td>
                        <td className="px-3 py-1.5 text-right text-slate-900">{num(row.completed)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold text-slate-900">{num(row.cum)}</td>
                        <td className="px-3 py-1.5 text-slate-700">
                          {day && day.kind !== '정상' && (
                            <>
                              <Badge tone={day.kind === '정지' ? 'red' : 'orange'}>{day.kind}</Badge>{' '}
                              {day.bottleneck && `${partOf(day.bottleneck).name} 부족`}
                            </>
                          )}
                          {!day && <span className="text-slate-400">투입 기간 종료</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
