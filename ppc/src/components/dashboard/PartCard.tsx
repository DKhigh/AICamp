// F1-1 부품 재고 카드
import type { PartRow } from '../../lib/dashboard';
import { ddayLabel, num } from '../../lib/format';
import { Badge, Button, PART_STATUS_TONE } from '../ui';

export function PartCard({
  row,
  selected,
  onSelect,
  onOrder,
}: {
  row: PartRow;
  selected: boolean;
  onSelect: () => void;
  onOrder: () => void;
}) {
  const { linePart, part, nextPo } = row;
  return (
    <article
      onClick={onSelect}
      className={`cursor-pointer rounded-lg bg-white p-3 transition-shadow hover:shadow-md ${
        row.isBottleneck ? 'border-2 border-slate-900' : 'border border-slate-200'
      } ${selected ? 'ring-2 ring-accent ring-offset-1' : ''}`}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold leading-tight text-slate-900">
          {part.name} <span className="font-mono text-[11px] font-medium text-slate-400">{part.code}</span>
        </h3>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {row.isBottleneck && (
            <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] font-bold text-white">병목</span>
          )}
          <Badge tone={PART_STATUS_TONE[row.status]}>{row.status}</Badge>
        </div>
      </header>

      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 whitespace-nowrap">
        <span className="text-xl font-extrabold tracking-tight text-slate-900">{num(linePart.onHand)}</span>
        <span className="text-xs text-slate-500">개 · ×{linePart.qtyPerCar}</span>
        <span className="ml-auto text-sm font-bold text-slate-900">→ {num(row.cars)}대</span>
      </p>

      <p className="mt-1 flex flex-wrap items-center justify-between gap-x-2 whitespace-nowrap text-xs text-slate-500">
        <span>
          재고{' '}
          <strong className={row.status === '주의' ? 'text-amber-700' : 'text-slate-700'}>{row.coverage.toFixed(1)}일</strong>
        </span>
        <span className="tabular">
          {nextPo && row.nextDday !== null ? (
            <>
              입고 <strong className={nextPo.status === '지연' ? 'text-red-600' : 'text-slate-700'}>{ddayLabel(row.nextDday)}</strong> · +
              {num(nextPo.qty)}개
            </>
          ) : (
            '입고 예정 없음'
          )}
        </span>
      </p>

      <Button
        size="sm"
        className="mt-2.5 w-full"
        onClick={(e) => {
          e.stopPropagation();
          onOrder();
        }}
      >
        발주
      </Button>
    </article>
  );
}
