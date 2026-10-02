// F1-1 부품 재고 카드
import type { PartRow } from '../../lib/dashboard';
import { dashPartName, ddayLabel, num } from '../../lib/format';
import { colorOf } from '../../lib/reference';
import { Badge, Button, ColorSwatch, PART_STATUS_TONE } from '../ui';

/**
 * 색상별 차체 카드: 차 한 대에 다섯 색 가운데 하나만 들어가므로 가능 대수는 합계로 보고,
 * 재고·입고·발주는 색상마다 따로 관리한다. 그 색 차체가 있어야 그 색 차를 만들 수 있다.
 */
export function BodyCard({
  row,
  selected,
  onSelect,
  onOrder,
}: {
  row: PartRow;
  selected: boolean;
  onSelect: () => void;
  onOrder: (partCode: string) => void;
}) {
  const variants = row.variants ?? [];
  return (
    <article
      onClick={onSelect}
      className={`col-span-2 cursor-pointer rounded-lg bg-white p-3 transition-shadow hover:shadow-md ${
        row.isBottleneck ? 'border-2 border-slate-900' : 'border border-slate-200'
      } ${selected ? 'ring-2 ring-accent ring-offset-1' : ''}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold leading-tight text-slate-900">
          {dashPartName(row.part.name)}
          <span className="ml-2 text-xs font-medium text-slate-500">색상별 {variants.length}종</span>
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="tabular text-xs text-slate-500">
            합계 <strong className="text-sm text-slate-900">{num(row.linePart.onHand)}</strong>개 → <strong className="text-slate-900">{num(row.cars)}대</strong> ·
            재고 <strong className="text-slate-700">{row.coverage.toFixed(1)}일</strong>
          </span>
          {row.isBottleneck && <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] font-bold text-white">병목</span>}
          <Badge tone={PART_STATUS_TONE[row.status]}>{row.status}</Badge>
        </div>
      </header>

      <ul className="mt-2 divide-y divide-slate-100">
        {variants.map((v) => {
          const color = colorOf(v.part.colorCode);
          return (
            <li key={v.part.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
              <span className="flex w-24 items-center gap-1.5 font-semibold text-slate-900" title={color?.description}>
                <ColorSwatch code={v.part.colorCode} />
                {color?.name ?? v.part.colorCode}
                <span className="font-mono text-[10px] font-medium text-slate-400">{v.part.colorCode}</span>
              </span>
              <span className="tabular w-20 text-slate-600">
                <strong className={`text-sm ${v.linePart.onHand === 0 ? 'text-red-600' : 'text-slate-900'}`}>{num(v.linePart.onHand)}</strong>개
              </span>
              <span className="tabular flex-1 whitespace-nowrap text-slate-500">
                {v.nextPo && v.nextDday !== null ? (
                  <>
                    입고 <strong className={v.nextPo.status === '지연' ? 'text-red-600' : 'text-slate-700'}>{ddayLabel(v.nextDday)}</strong> · +
                    {num(v.nextPo.qty)}개
                  </>
                ) : v.linePart.onHand === 0 ? (
                  <span className="font-semibold text-red-600">재고 없음 · 이 색 차를 만들 수 없음</span>
                ) : (
                  '입고 예정 없음'
                )}
              </span>
              {v.status !== '정상' && v.status !== '주의' && <Badge tone={PART_STATUS_TONE[v.status]}>{v.status}</Badge>}
              <Button
                auth
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onOrder(v.part.code);
                }}
                aria-label={`${dashPartName(v.part.name)} 발주`}
              >
                발주
              </Button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

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

      {row.repairNeed > 0 && (
        <p className="tabular mt-0.5 whitespace-nowrap text-[11px] text-slate-500" title="수리 중인 차량에 쓸 부품은 생산에 쓰지 않고 남겨 둡니다">
          수리용 <strong className="text-slate-700">{num(row.repairNeed)}개</strong> 제외 · 생산용 <strong className="text-slate-700">{num(row.available)}개</strong>
        </p>
      )}

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
        auth
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
