// 대시보드 `/` (DESIGN.md §5 F1, §7.1)
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CarPartKey } from '../components/car/Car3DVisualizer';
import { CAR_PART_BY_CODE } from '../components/car/carParts';
import type { CarViewerItem } from '../components/car/CarViewer';
import { ForecastPanel } from '../components/dashboard/ForecastPanel';
import { BodyCard, PartCard } from '../components/dashboard/PartCard';
import { CustomerOrdersCard } from '../components/dashboard/CustomerOrdersCard';
import { PoTable } from '../components/PoTable';
import { Badge, Button, Card, ColorSwatch, GradeBadge, PART_STATUS_TONE } from '../components/ui';
import { cautionOf } from '../lib/cautions';
import { dashboardModel, type DashboardModel, type PartRow } from '../lib/dashboard';
import { ddayLabel, num, won } from '../lib/format';
import { gradeOf } from '../lib/recommend';
import { colorOf, partOf, supplierOf } from '../lib/reference';
import { repairCars } from '../lib/repairs';
import type { AppState, Disruption } from '../lib/types';
import { useUi } from '../state/Ui';

// three.js는 용량이 커서 3D 뷰어만 따로 불러온다 (숫자와 표가 먼저 뜬다)
const CarViewer = lazy(() => import('../components/car/CarViewer').then((m) => ({ default: m.CarViewer })));

function DisruptionBanner({ disruption }: { disruption: Disruption }) {
  const part = partOf(disruption.partCode);
  const responding = disruption.status === '대체발주';
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-3 ${
        responding ? 'border-blue-200 bg-blue-50' : 'border-red-200 bg-red-50'
      }`}
    >
      <p className={`text-sm font-semibold ${responding ? 'text-blue-800' : 'text-red-700'}`}>
        {responding ? (
          <>
            대응 중: {part.name}({part.code}) · {disruption.supplierName} {disruption.delayDays}일 지연 → {disruption.altSupplierName}에
            대체 발주 {num(disruption.altQty ?? 0)}개 ({disruption.altPoId}) · 원래 발주 {disruption.originalPoAction}
          </>
        ) : (
          <>
            ⚠ 진행 중 차질: {part.name}({part.code}) · {disruption.supplierName} · {disruption.delayDays}일 지연
            {disruption.status === '기다리기' && ' (기다리기로 결정)'}
          </>
        )}
      </p>
      <Link
        to={`/disruptions/${disruption.id}`}
        className={`whitespace-nowrap rounded-md px-3.5 py-1.5 text-[13px] font-bold text-white shadow-sm ${
          responding ? 'bg-accent hover:bg-accent-hover' : 'bg-red-600 hover:bg-red-700'
        }`}
      >
        {responding ? '상세 보기 →' : '대응하기 →'}
      </Link>
    </div>
  );
}

function KpiCard({
  label,
  value,
  unit,
  sub,
  tone = 'default',
  to,
  linkLabel,
}: {
  label: string;
  value: string;
  unit: string;
  sub?: string;
  tone?: 'default' | 'danger';
  /** 주면 카드 전체가 그 페이지로 가는 버튼이 된다 */
  to?: string;
  linkLabel?: string;
}) {
  const body = (
    <>
      <p className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
        {label}
        {to && <span className="whitespace-nowrap text-accent">{linkLabel} →</span>}
      </p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={`text-3xl font-extrabold tracking-tight ${tone === 'danger' ? 'text-red-600' : 'text-slate-900'}`}>{value}</span>
        <span className="text-sm font-semibold text-slate-500">{unit}</span>
      </p>
      <p className="mt-0.5 h-4 text-xs text-slate-500">{sub}</p>
    </>
  );
  const box = 'block rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-card';
  return to ? (
    <Link to={to} className={`${box} transition-shadow hover:border-accent hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

function KpiRow({ kpi }: { kpi: DashboardModel['kpi'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        label="현재 재고로 생산 가능"
        value={num(kpi.buildableNow)}
        unit="대"
        sub={kpi.bottleneckNow ? `병목: ${kpi.bottleneckNow.name} · 수리용 재고 제외` : undefined}
      />
      <KpiCard
        label="입고 예정 포함 생산 가능"
        value={num(kpi.buildableIncoming)}
        unit="대"
        sub={kpi.bottleneckIncoming ? `병목: ${kpi.bottleneckIncoming.name}` : undefined}
        to="/shipments"
        linkLabel="출차 일정"
      />
      <KpiCard
        label="입고된 차량 (수리 중)"
        value={num(repairCars.length)}
        unit="대"
        sub={`오늘 투입 가능 ${num(kpi.todayInput)} / ${num(kpi.dailyCapacity)}대`}
        to="/repairs"
        linkLabel="수리 차량"
      />
      <KpiCard
        label="진행 중 차질"
        value={num(kpi.activeDisruptions)}
        unit="건"
        tone={kpi.activeDisruptions > 0 ? 'danger' : 'default'}
        sub={kpi.activeDisruptions > 0 ? '해결되지 않은 차질' : '차질 없음'}
      />
    </div>
  );
}

/** 3D 뷰어에서 부품을 골랐을 때 아래에 뜨는 상세 카드 */
function PartDetail({ row, onOrder }: { row: PartRow; onOrder: () => void }) {
  const { part, linePart, nextPo, activeDisruption } = row;
  const supplier = supplierOf(part.defaultSupplier);
  const caution = cautionOf(part.name);
  const [showCaution, setShowCaution] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold tracking-tight text-slate-900">
            {part.name} <span className="font-mono text-xs font-medium text-slate-400">{part.code}</span>
          </h3>
          {caution && (
            <button
              type="button"
              onClick={() => setShowCaution((v) => !v)}
              aria-expanded={showCaution}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-colors ${
                showCaution ? 'border-amber-500 bg-amber-500 text-white' : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              ⚠ 주의사항
            </button>
          )}
          <Badge tone={PART_STATUS_TONE[row.status]}>{row.status}</Badge>
          {row.isBottleneck && <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] font-bold text-white">병목</span>}
        </div>
        {caution && showCaution && (
          <p role="note" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">
            <strong>{part.name} 주의사항</strong> — {caution}
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>{part.category}</span>·<span>{part.materialName}</span>·<span>기본 업체 {part.defaultSupplier}</span>
          {supplier && <GradeBadge rate={supplier.onTimeRate} grade={gradeOf(supplier.onTimeRate)} />}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px] text-slate-600">
          {[
            ['현재 재고', `${num(linePart.onHand)}개`],
            ...(row.repairNeed > 0
              ? [
                  ['수리용', `${num(row.repairNeed)}개`],
                  ['생산용', `${num(row.available)}개`],
                ]
              : []),
            ['1대당', `${linePart.qtyPerCar}개`],
            ['가능 대수', `${num(row.cars)}대`],
            ['재고 일수', `${row.coverage.toFixed(1)}일`],
            ['다음 입고', nextPo && row.nextDday !== null ? `${ddayLabel(row.nextDday)} · +${num(nextPo.qty)}개` : '없음'],
          ].map(([label, value]) => (
            <span key={label} className="rounded bg-slate-100 px-2 py-0.5">
              {label} <strong className="text-slate-900">{value}</strong>
            </span>
          ))}
        </div>
        {row.variants && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11.5px] text-slate-600">
            {row.variants.map((v) => (
              <span key={v.part.code} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5">
                <ColorSwatch code={v.part.colorCode} size={10} />
                {colorOf(v.part.colorCode)?.name} <strong className="text-slate-900">{num(v.linePart.onHand)}개</strong>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="primary" onClick={onOrder}>
          발주
        </Button>
        {activeDisruption && (
          <Link
            to={`/disruptions/${activeDisruption.id}`}
            className="inline-flex items-center rounded-md border border-red-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-50"
          >
            {activeDisruption.status === '대체발주' ? '차질 상세 →' : '대응하기 →'}
          </Link>
        )}
      </div>
    </div>
  );
}

export function Dashboard({ state }: { state: AppState }) {
  const { openOrder } = useUi();
  const model = useMemo(() => dashboardModel(state), [state]);
  const [focusCode, setFocusCode] = useState<string | null>(null);

  const focusRow = model.parts.find((p) => p.part.code === focusCode) ?? null;
  const focusKey = focusRow ? (CAR_PART_BY_CODE[focusRow.part.code] ?? null) : null;
  const viewerItems: CarViewerItem[] = model.parts.flatMap((row) => {
    const key = CAR_PART_BY_CODE[row.part.code];
    return key ? [{ key, name: row.part.name, status: row.status, isBottleneck: row.isBottleneck }] : [];
  });
  const codeOfKey = (key: CarPartKey | null) =>
    key ? (model.parts.find((p) => CAR_PART_BY_CODE[p.part.code] === key)?.part.code ?? null) : null;

  return (
    <div className="space-y-4">
      {model.activeDisruptions.map((d) => (
        <DisruptionBanner key={d.id} disruption={d} />
      ))}

      <KpiRow kpi={model.kpi} />

      <Card
        title="부품 재고 (자동차 1대 기준)"
        aside={<p className="text-xs text-slate-500">차량의 부품을 선택하면 위치를 확대하고 재고·입고 현황을 보여 줍니다.</p>}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="relative h-[380px] sm:h-[440px] lg:h-auto lg:min-h-[520px]">
            <Suspense fallback={<div className="absolute inset-0 animate-pulse rounded-lg bg-studio" aria-label="3D 뷰어를 불러오는 중" />}>
              <CarViewer
                items={viewerItems}
                focus={focusKey}
                onFocus={(key) => setFocusCode(codeOfKey(key))}
                detail={
                  focusRow && (
                    <PartDetail
                      key={focusRow.part.code}
                      row={focusRow}
                      onOrder={() => openOrder(focusRow.variants?.[0]?.part.code ?? focusRow.part.code)}
                    />
                  )
                }
              />
            </Suspense>
          </div>
          <div className="grid grid-cols-2 content-start gap-3">
            {model.parts.map((row) => {
              const common = {
                row,
                selected: focusCode === row.part.code,
                onSelect: () => setFocusCode((code) => (code === row.part.code ? null : row.part.code)),
              };
              // 색상별 차체는 한 카드 안에서 색마다 따로 발주한다
              return row.variants ? (
                <BodyCard key={row.part.code} {...common} onOrder={openOrder} />
              ) : (
                <PartCard key={row.part.code} {...common} onOrder={() => openOrder(row.part.code)} />
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="입고 예정 발주" aside={
            <span className="text-xs text-slate-500">
              도착 예정일 순 · {model.poRows.length}건 · 발주 금액{' '}
              <strong className="tabular text-slate-800">{won(model.poRows.reduce((sum, r) => sum + r.amount, 0))}</strong>
            </span>
          }>
          <PoTable rows={model.poRows} />
        </Card>
        <ForecastPanel state={state} model={model} />
      </div>

      <CustomerOrdersCard state={state} orders={model.scenarios.wait.orders} lateCount={model.scenarios.wait.lateOrders.length} />
    </div>
  );
}
