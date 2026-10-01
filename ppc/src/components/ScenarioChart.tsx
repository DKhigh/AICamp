// 누적 완성 대수 선 그래프 (DESIGN.md §5 F1-5, F2-4). 색 규칙은 §7.4.
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMD } from '../lib/date';
import { num } from '../lib/format';
import type { ISODate } from '../lib/types';

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  dashed?: boolean;
  /** 계단선 (주문 필요량) */
  step?: boolean;
}

export type ChartRow = { date: ISODate } & Record<string, number | string>;

// car-manager 토큰. 파랑·빨강 조합은 dataviz 검증기를 통과했다 (CVD ΔE 28)
export const CHART_COLORS = {
  blue: '#1d4ed8',
  red: '#dc2626',
  gray: '#94a3b8',
};

function ChartTooltip({
  active,
  payload,
  label,
  series,
  unit,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number | string }[];
  label?: string;
  series: ChartSeries[];
  unit: string;
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-bold text-slate-900">{formatMD(label)}</p>
      {series.map((s) => {
        const item = payload.find((p) => p.dataKey === s.key);
        if (!item || typeof item.value !== 'number') return null;
        return (
          <p key={s.key} className="flex items-center gap-2 text-slate-600">
            <LineKey series={s} />
            <span>{s.name}</span>
            <strong className="tabular ml-auto pl-3 text-slate-900">
              {num(item.value)}
              {unit}
            </strong>
          </p>
        );
      })}
    </div>
  );
}

function LineKey({ series }: { series: ChartSeries }) {
  return (
    <svg width="18" height="8" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="4"
        x2="17"
        y2="4"
        stroke={series.color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={series.dashed ? '4 3' : undefined}
      />
    </svg>
  );
}

export function ScenarioChart({
  rows,
  series,
  height = 240,
  unit = '대',
  ariaLabel,
}: {
  rows: ChartRow[];
  series: ChartSeries[];
  height?: number;
  unit?: string;
  ariaLabel: string;
}) {
  return (
    <figure aria-label={ariaLabel}>
      {series.length > 1 && (
        <figcaption className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <LineKey series={s} />
              {s.name}
            </span>
          ))}
        </figcaption>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 8, right: 22, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatMD}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickLine={false}
            axisLine={{ stroke: '#cbd5e1' }}
            interval={1}
            tickMargin={6}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(value: number) => num(value)}
            tickLine={false}
            axisLine={false}
            width={38}
            allowDecimals={false}
          />
          <Tooltip
            content={<ChartTooltip series={series} unit={unit} />}
            cursor={{ stroke: '#94a3b8', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {/* 점선(기준선)을 나중에 그린다: 실선과 겹쳐도 실선 위에 점선이 보인다 */}
          {[...series.filter((s) => !s.dashed), ...series.filter((s) => s.dashed)].map((s) => (
            <Line
              key={s.key}
              type={s.step ? 'stepAfter' : 'linear'}
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}
