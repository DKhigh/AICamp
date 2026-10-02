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
import { Badge, Button, Card, ColorSwatch, GradeBadge, PART_STATUS_TONE, DisruptionLink } from '../components/ui';
import { cautionOf } from '../lib/cautions';
import { LOW_COVERAGE_DAYS } from '../lib/constants';
import { dashboardModel, type DashboardModel, type PartRow } from '../lib/dashboard';
import { dashPartName, ddayLabel, num, won } from '../lib/format';
import { gradeOf } from '../lib/recommend';
import { colorOf, partOf, reference, supplierOf } from '../lib/reference';
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
        responding ? 'border-blue-200 bg-blue-50' : 'border-red-400 bg-red-200'
      }`}
    >
      <p className={`text-sm font-semibold ${responding ? 'text-blue-800' : 'text-red-900'}`}>
        {responding ? (
          <>
            대응 중: {dashPartName(part.name)}({part.code}) · {disruption.supplierName} {disruption.delayDays}일 지연 → {disruption.altSupplierName}에
            대체 발주 {num(disruption.altQty ?? 0)}개 ({disruption.altPoId}) · 원래 발주 {disruption.originalPoAction}
          </>
        ) : (
          <>
            ⚠ 진행 중 차질: {dashPartName(part.name)}({part.code}) · {disruption.supplierName} · {disruption.delayDays}일 지연
            {disruption.status === '기다리기' && ' (대응하지 않음으로 결정)'}
          </>
        )}
      </p>
      <DisruptionLink
        hideWhenLoggedOut
        id={disruption.id}
        className={`whitespace-nowrap rounded-md px-3.5 py-1.5 text-[13px] font-bold text-white shadow-sm ${
          responding ? 'bg-accent hover:bg-accent-hover' : 'bg-red-600 hover:bg-red-700'
        }`}
      >
        {responding ? '상세 보기 →' : '대응하기 →'}
      </DisruptionLink>
    </div>
  );
}

/**
 * 재고 부족 경고 (노란색, 차질 배너 아래). 필요 재고는 차를 LOW_COVERAGE_DAYS(5)일 동안 차질 없이 만들 수 있는 양이고,
 * 생산에 쓸 수 있는 재고(수리용 제외)가 그보다 적은 부품을 모아서 보여 준다. 색상별 차체는 다섯 색을 합쳐서 본다.
 */
function LowStockBanner({ rows, dailyCapacity, onOrder }: { rows: PartRow[]; dailyCapacity: number; onOrder: (partCode: string) => void }) {
  const low = rows
    .map((row) => ({ row, need: LOW_COVERAGE_DAYS * dailyCapacity * row.linePart.qtyPerCar }))
    .filter(({ row, need }) => row.available < need);
  if (low.length === 0) return null;
  return (
    <div role="alert" className="rounded-xl border border-amber-300 bg-amber-100 px-5 py-3 text-sm text-amber-900">
      <p className="font-bold">
        ⚠ 재고 부족 주의: {low.length}개 부품의 재고가 {LOW_COVERAGE_DAYS}일 생산분보다 적습니다 (하루 {num(dailyCapacity)}대 기준)
      </p>
      <ul className="mt-1.5 space-y-1.5 text-[13px]">
        {low.map(({ row, need }) => (
          <li key={row.part.code} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1">
              <strong>{dashPartName(row.part.name)}</strong> 생산용 {num(row.available)}개 ({row.coverage.toFixed(1)}일분) · 필요 {num(need)}개 ·{' '}
              <strong>{num(need - row.available)}개 부족</strong>
              {row.nextPo && row.nextDday !== null ? ` · 다음 입고 ${ddayLabel(row.nextDday)} +${num(row.nextPo.qty)}개` : ' · 입고 예정 없음'}
            </span>
            {/* 색상별 차체는 재고가 가장 적은 색의 발주 창을 연다 (창 안에서 다른 색으로 바꿀 수 있다) */}
            <Button
              auth
              size="sm"
              variant="primary"
              onClick={() => onOrder(row.variants ? [...row.variants].sort((a, b) => a.available - b.available)[0].part.code : row.part.code)}
              aria-label={`${dashPartName(row.part.name)} 재고 부족 발주`}
            >
              {dashPartName(row.part.name)} 발주
            </Button>
          </li>
        ))}
      </ul>
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
      <p className="flex items-start justify-between gap-2 text-xs font-semibold leading-snug text-slate-500">
        {label}
        {/* 넓은 화면에서는 제목 옆에, 좁은 화면에서는 카드 아래에 둔다 */}
        {to && <span className="hidden whitespace-nowrap text-accent sm:inline">{linkLabel} →</span>}
      </p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={`text-2xl font-extrabold tracking-tight sm:text-3xl ${tone === 'danger' ? 'text-red-600' : 'text-slate-900'}`}>{value}</span>
        <span className="text-sm font-semibold text-slate-500">{unit}</span>
      </p>
      <p className="mt-0.5 min-h-4 text-xs leading-snug text-slate-500">{sub}</p>
      {to && <p className="mt-1.5 whitespace-nowrap text-right text-xs font-semibold text-accent sm:hidden">{linkLabel} →</p>}
    </>
  );
  const box = 'block rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-card sm:px-5 sm:py-4';
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
        sub={kpi.bottleneckNow ? `병목: ${dashPartName(kpi.bottleneckNow.name)} · 수리용 재고 제외` : undefined}
        to="/stock"
        linkLabel="현재 재고"
      />
      <KpiCard
        label="입고 예정 포함 생산 가능"
        value={num(kpi.buildableIncoming)}
        unit="대"
        sub={kpi.bottleneckIncoming ? `병목: ${dashPartName(kpi.bottleneckIncoming.name)}` : undefined}
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
        // 미대응이 있을 때만 빨갛게: 전부 대응 중이면 급한 일이 아니다
        tone={kpi.disruptionCounts.pending > 0 ? 'danger' : 'default'}
        sub={
          kpi.activeDisruptions > 0
            ? [
                `미대응 ${kpi.disruptionCounts.pending}건`,
                `대응 중 ${kpi.disruptionCounts.responding}건`,
                ...(kpi.disruptionCounts.waiting > 0 ? [`대응 안 함 ${kpi.disruptionCounts.waiting}건`] : []),
              ].join(' · ')
            : '차질 없음'
        }
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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {/* 좁은 화면에서는 내용이 한 줄을 다 쓰고 버튼(발주·차질 상세)은 그 아래로 내려간다.
          버튼이 옆에 붙으면 내용 칸이 좁아져 항목이 한 줄에 하나씩 세로로 늘어선다 */}
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold tracking-tight text-slate-900">
            {dashPartName(part.name)}
            {/* 색상별로 나뉜 외판은 묶음이라 부품 코드를 붙이지 않는다 */}
            {!row.variants && <span className="font-mono text-xs font-medium text-slate-400"> {part.code}</span>}
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
            <strong>{dashPartName(part.name)} 주의사항</strong> — {caution}
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
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button auth variant="primary" onClick={onOrder}>
          발주
        </Button>
        {activeDisruption && (
          <DisruptionLink
            hideWhenLoggedOut
            id={activeDisruption.id}
            className="inline-flex items-center rounded-md border border-red-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-50"
          >
            {activeDisruption.status === '대체발주' ? '차질 상세 →' : '대응하기 →'}
          </DisruptionLink>
        )}
      </div>
    </div>
  );
}

export function Dashboard({ state }: { state: AppState }) {
  const { openOrder } = useUi();
  const model = useMemo(() => dashboardModel(state), [state]);
  const [focusCode, setFocusCode] = useState<string | null>(null);
  // 3D 모델에 칠해 볼 차량 색상 (Excel '차량색상'). 보기만 바뀌고 데이터에는 영향이 없다
  const [paintCode, setPaintCode] = useState(reference.colors[0]?.code ?? null);

  const focusRow = model.parts.find((p) => p.part.code === focusCode) ?? null;
  const focusKey = focusRow ? (CAR_PART_BY_CODE[focusRow.part.code] ?? null) : null;
  const viewerItems: CarViewerItem[] = model.parts.flatMap((row) => {
    const key = CAR_PART_BY_CODE[row.part.code];
    return key ? [{ key, name: dashPartName(row.part.name), status: row.status, isBottleneck: row.isBottleneck }] : [];
  });
  const codeOfKey = (key: CarPartKey | null) =>
    key ? (model.parts.find((p) => CAR_PART_BY_CODE[p.part.code] === key)?.part.code ?? null) : null;

  return (
    <div className="space-y-4">
      {model.activeDisruptions.map((d) => (
        <DisruptionBanner key={d.id} disruption={d} />
      ))}

      <LowStockBanner rows={model.parts} dailyCapacity={state.settings.dailyCapacity} onOrder={openOrder} />

      <KpiRow kpi={model.kpi} />

      <Card
        title="부품 재고 (자동차 1대 기준)"
        aside={<p className="text-xs text-slate-500">차량의 부품을 선택하면 위치를 확대하고 재고·입고 현황을 보여 줍니다.</p>}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="relative h-[340px] sm:h-[440px] lg:h-auto lg:min-h-[520px]">
            <Suspense fallback={<div className="absolute inset-0 animate-pulse rounded-lg bg-studio" aria-label="3D 뷰어를 불러오는 중" />}>
              <CarViewer
                items={viewerItems}
                focus={focusKey}
                onFocus={(key) => setFocusCode(codeOfKey(key))}
                colorCode={paintCode}
                onColorChange={setPaintCode}
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
          <div className="grid grid-cols-2 content-start gap-2 sm:gap-3">
            {/* 한 칸짜리 부품 카드를 먼저 놓고, 두 칸을 쓰는 색상별 차체 카드는 맨 아래에 둔다 */}
            {[...model.parts.filter((row) => !row.variants), ...model.parts.filter((row) => row.variants)].map((row) => {
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

      {/* 입고 예정 표는 칸이 많아(금액·상태·입고 처리) 한 줄을 다 쓴다: 옆으로 끌지 않아도 [입고 처리]까지 보인다 */}
      <Card title="입고 예정 발주" aside={
          <span className="text-xs text-slate-500">
            도착 예정일 순 · {model.poRows.length}건 · 발주 금액{' '}
            <strong className="tabular text-slate-800">{won(model.poRows.reduce((sum, r) => sum + r.amount, 0))}</strong>
          </span>
        }>
        <PoTable rows={model.poRows} />
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
        <ForecastPanel state={state} model={model} />
        <CustomerOrdersCard state={state} orders={model.scenarios.wait.orders} lateCount={model.scenarios.wait.lateOrders.length} />
      </div>
    </div>
  );
}
