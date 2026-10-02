// 수리 차량 `/repairs`: 입고되어 수리 중인 차량, 고장 난 곳, 소모 부품. 여기서도 발주할 수 있다.
import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CarPartKey } from '../components/car/Car3DVisualizer';
import { CAR_PART_BY_CODE, CarPartIcon } from '../components/car/carParts';
import type { CarViewerItem } from '../components/car/CarViewer';
import { Badge, Button, Card, ColorSwatch, Modal, type Tone } from '../components/ui';
import { formatMD } from '../lib/date';
import { num } from '../lib/format';
import { baseCodeOf } from '../lib/partcode';
import { nextArrivalOf } from '../lib/planning';
import { colorOf, partOf } from '../lib/reference';
import { cautionOf } from '../lib/cautions';
import { mechanicOf, repairCarsAt, repairCarViews, repairPartNeeds } from '../lib/repairs';
import type { AppState, Mechanic } from '../lib/types';
import { useUi } from '../state/Ui';

// three.js는 용량이 커서 3D 뷰어만 따로 불러온다
const CarViewer = lazy(() => import('../components/car/CarViewer').then((m) => ({ default: m.CarViewer })));

const STATUS_TONE: Record<string, Tone> = { '수리 중': 'blue', '부품 대기': 'orange', '진단 중': 'gray' };

/** 대시보드 3D 모델의 부품 배지와 같은 아이콘 (부품 코드마다 하나) */
function PartIcons({ codes }: { codes: string[] }) {
  const keys = [...new Set(codes.map((code) => CAR_PART_BY_CODE[baseCodeOf(code)]).filter((k): k is CarPartKey => k !== undefined))];
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {keys.map((key) => (
        <span key={key} className="car-hotspot-icon" aria-hidden>
          <CarPartIcon part={key} />
        </span>
      ))}
    </span>
  );
}

/** 누르면 정비사 정보 창이 열리는 이름 */
function MechanicName({ mechanic, onOpen }: { mechanic: Mechanic | undefined; onOpen: (m: Mechanic) => void }) {
  if (!mechanic) return <span className="text-slate-400">미배정</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(mechanic);
      }}
      title="정비사 정보 보기"
      className="font-semibold text-slate-900 underline decoration-slate-300 decoration-dotted underline-offset-2 hover:text-accent hover:decoration-accent"
    >
      {mechanic.name}
    </button>
  );
}

function MechanicModal({ mechanic, cars, onClose }: { mechanic: Mechanic; cars: { serial: string; faultArea: string; status: string }[]; onClose: () => void }) {
  const info: [string, React.ReactNode][] = [
    [
      '연락처',
      <a key="p" href={`tel:${mechanic.phone}`} className="tabular font-bold text-accent hover:underline">
        {mechanic.phone}
      </a>,
    ],
    ['직급', mechanic.rank],
    ['경력', mechanic.career.replace(/^경력\s*/, '')],
    ['주 담당 부품', mechanic.mainPart],
    ['부 담당 부품', mechanic.subPart],
    ['정비사 ID', <span key="i" className="font-mono">{mechanic.id}</span>],
  ];
  return (
    <Modal title={`정비사 ${mechanic.name}`} onClose={onClose} footer={<Button onClick={onClose}>닫기</Button>}>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
          {info.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
              <dd className="mt-0.5 text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">지금 맡고 있는 수리 차량 {cars.length}대</p>
          {cars.length === 0 ? (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-500">맡고 있는 차량이 없습니다.</p>
          ) : (
            <ul className="space-y-1 text-[13px] text-slate-700">
              {cars.map((c) => (
                <li key={c.serial}>
                  <strong className="font-mono text-slate-900">{c.serial}</strong> · {c.faultArea} · {c.status}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function RepairsPage({ state }: { state: AppState }) {
  const [mechanicOpen, setMechanicOpen] = useState<Mechanic | null>(null);
  const { openOrder } = useUi();
  const [picked, setPicked] = useState<string | null>(null);
  const repairCars = repairCarViews(repairCarsAt(state.settings.baseDate), state.lineParts);
  const selected = repairCars.find((c) => c.serial === picked) ?? null;
  // 3D 모델에서 확대해 볼 부품
  const [focusKey, setFocusKey] = useState<CarPartKey | null>(null);
  // 선택한 차량에서 수리할 부품만 모델 위에 빨간 배지로 띄운다
  const faultItems: CarViewerItem[] = (selected?.parts ?? []).flatMap((use) => {
    const key = CAR_PART_BY_CODE[baseCodeOf(use.partCode)];
    return key ? [{ key, name: `${partOf(use.partCode).name} × ${use.qty}`, status: '차질' as const, isBottleneck: false }] : [];
  });
  const needs = repairPartNeeds(repairCars, state.lineParts);
  const needOf = new Map(needs.map((n) => [n.partCode, n]));

  return (
    <div className="space-y-4">
      {mechanicOpen && (
        <MechanicModal mechanic={mechanicOpen} cars={repairCars.filter((c) => c.mechanicId === mechanicOpen.id)} onClose={() => setMechanicOpen(null)} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm font-semibold text-accent hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">수리 차량</h1>
        <p className="text-xs text-slate-500">입고되어 수리 중인 차량 {repairCars.length}대 · 수리에 쓸 부품은 재고에서 따로 잡아 두고 생산에는 쓰지 않습니다</p>
        <Button auth variant="primary" className="ml-auto" onClick={() => openOrder()}>
          + 발주
        </Button>
      </div>

      <Card title="수리 중인 차량" aside={<span className="text-xs text-slate-500">{repairCars.length}대 · 차량을 누르면 아래에 고장 부위를 3D로 보여 줍니다</span>}>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-[13px]">
            <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
              <tr>
                <th className="py-2 pl-5 pr-2">고유번호</th>
                <th className="px-2 py-2">색상</th>
                <th className="px-2 py-2">입고일</th>
                <th className="px-2 py-2">고장 난 곳</th>
                <th className="px-2 py-2">증상</th>
                <th className="px-2 py-2">담당 정비사</th>
                <th className="px-2 py-2">상태</th>
                <th className="py-2 pl-2 pr-5 text-right">소모 부품</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {repairCars.map((car) => {
                const active = selected?.serial === car.serial;
                return (
                  <tr key={car.serial} onClick={() => {
                    setPicked(active ? null : car.serial);
                    setFocusKey(null);
                  }} className={`cursor-pointer ${active ? 'bg-accent-light' : 'hover:bg-slate-50'}`}>
                    <td className="py-2.5 pl-5 pr-2">
                      <button
                        type="button"
                        aria-pressed={active}
                        className={`font-mono text-sm font-semibold tracking-wider hover:underline ${active ? 'text-accent' : 'text-slate-900'}`}
                      >
                        {car.serial}
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-slate-700">
                        <ColorSwatch code={car.colorCode} />
                        {colorOf(car.colorCode)?.name}
                      </span>
                    </td>
                    <td className="tabular px-2 py-2.5 text-slate-700">{formatMD(car.receivedDate)}</td>
                    <td className="px-2 py-2.5 font-semibold text-slate-900">
                      <span className="inline-flex items-center gap-1.5">
                        <PartIcons codes={car.parts.map((u) => u.partCode)} />
                        {car.faultArea}
                      </span>
                    </td>
                    <td className="max-w-[300px] truncate px-2 py-2.5 text-slate-600" title={car.symptom}>
                      {car.symptom}
                    </td>
                    <td className="px-2 py-2.5">
                      <MechanicName mechanic={mechanicOf(car.mechanicId)} onOpen={setMechanicOpen} />
                    </td>
                    <td className="px-2 py-2.5">
                      <Badge tone={STATUS_TONE[car.status] ?? 'gray'}>{car.status}</Badge>
                    </td>
                    <td className="tabular py-2.5 pl-2 pr-5 text-right text-slate-700">
                      {car.parts.length}종 · {num(car.parts.reduce((sum, u) => sum + u.qty, 0))}개
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={selected ? `차량 ${selected.serial} — 수리가 필요한 곳` : '차량 상세'}
        aside={selected && <Badge tone={STATUS_TONE[selected.status] ?? 'gray'}>{selected.status}</Badge>}
      >
        {!selected ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">위 목록에서 차량을 선택하면 고장 난 곳을 차량 모델에서 보여 줍니다</p>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            {/* 대시보드와 같은 3D 모델. 이 차량에서 수리할 부품만 빨갛게 표시한다 */}
            {/* 넓은 화면에서는 오른쪽 내용(고장 난 곳이 여럿이면 길어진다) 높이만큼 늘려, 모델 아래가 비지 않게 한다 */}
            <div className="relative h-[360px] sm:h-[420px] lg:h-auto lg:min-h-[420px]">
              <Suspense fallback={<div className="absolute inset-0 animate-pulse rounded-lg bg-studio" aria-label="3D 뷰어를 불러오는 중" />}>
                <CarViewer
                  // 차량을 바꾸면 시점과 표시를 처음부터 다시 잡는다
                  key={selected.serial}
                  items={faultItems}
                  focus={focusKey}
                  onFocus={setFocusKey}
                  detail={null}
                  initialMode="cutaway"
                  // 수리 차량의 실제 색으로 칠한다
                  colorCode={selected.colorCode}
                />
              </Suspense>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-semibold text-slate-500">고장 난 곳</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-base font-bold text-slate-900">
                  <PartIcons codes={selected.parts.map((u) => u.partCode)} />
                  {selected.faultArea}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-700">{selected.symptom}</p>
                <p className="mt-1 text-xs text-slate-500">
                  <ColorSwatch code={selected.colorCode} size={10} /> {colorOf(selected.colorCode)?.name} · 입고일 {formatMD(selected.receivedDate)} · 담당 정비사{' '}
                  <MechanicName mechanic={mechanicOf(selected.mechanicId)} onOpen={setMechanicOpen} />
                  {mechanicOf(selected.mechanicId) && ` (${mechanicOf(selected.mechanicId)!.rank})`}
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-slate-500">고객 요청사항</p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-800">“{selected.customerRequest}”</p>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold text-slate-500">수리해야 하는 부품 (누르면 그 부품을 확대합니다)</p>
                <ul className="space-y-2">
                  {selected.parts.map((use) => {
                    const part = partOf(use.partCode);
                    const key = CAR_PART_BY_CODE[baseCodeOf(use.partCode)];
                    const need = needOf.get(use.partCode);
                    const short = selected.missing.find((m) => m.partCode === use.partCode)?.qty ?? 0;
                    const next = nextArrivalOf(use.partCode, state.purchaseOrders);
                    const active = key !== undefined && focusKey === key;
                    return (
                      <li
                        key={use.partCode}
                        onClick={() => key && setFocusKey(active ? null : key)}
                        className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2.5 ${
                          active ? 'border-accent bg-accent-light' : 'border-transparent bg-slate-50 hover:border-slate-200'
                        }`}
                      >
                        <PartIcons codes={[use.partCode]} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-900">
                            {part.name} <span className="font-mono text-[11px] font-medium text-slate-400">{part.code}</span>
                            <span className="ml-2 font-semibold text-slate-700">× {num(use.qty)}개</span>
                          </p>
                          <p className="tabular mt-0.5 text-xs text-slate-600">
                            현재 재고 {num(need?.onHand ?? 0)}개 중 수리용 {num(need?.reserved ?? 0)}개 확보 ·{' '}
                            {short === 0 ? (
                              <span className="font-semibold text-emerald-700">✓ 이 차량 몫 확보</span>
                            ) : (
                              <span className="font-semibold text-red-600">✗ {num(short)}개 부족 · 부품 대기</span>
                            )}
                            {next && ` · 다음 입고 ${formatMD(next.expectedArrival)} +${num(next.qty)}개`}
                          </p>
                          {/* 이 부품을 다룰 때 조심할 점 (Excel '주의사항') */}
                          {cautionOf(partOf(baseCodeOf(use.partCode)).name) && (
                            <p role="note" className="mt-1.5 rounded-md border border-amber-300 bg-amber-100 px-2.5 py-1.5 text-xs leading-relaxed text-amber-900">
                              <strong>⚠ 수리 시 주의</strong> — {cautionOf(partOf(baseCodeOf(use.partCode)).name)}
                            </p>
                          )}
                        </div>
                        <Button
                          auth
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openOrder(use.partCode);
                          }}
                        >
                          발주
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="수리에 필요한 부품 합계" aside={<span className="text-xs text-slate-500">수리 중인 차량 전체 기준</span>}>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-[13px]">
            <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
              <tr>
                <th className="py-2 pl-5 pr-2">부품</th>
                <th className="px-2 py-2 text-right">수리 소요</th>
                <th className="px-2 py-2 text-right">현재 재고</th>
                <th className="px-2 py-2 text-right">수리용 확보</th>
                <th className="px-2 py-2 text-right">생산에 쓸 수 있는 재고</th>
                <th className="px-2 py-2">상태</th>
                <th className="py-2 pl-2 pr-5" aria-label="발주" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {needs.map((n) => {
                const part = partOf(n.partCode);
                return (
                  <tr key={n.partCode}>
                    <td className="py-2.5 pl-5 pr-2 font-semibold text-slate-900">
                      {part.name} <span className="font-mono text-[11px] font-medium text-slate-400">{part.code}</span>
                    </td>
                    <td className="tabular px-2 py-2.5 text-right text-slate-900">{num(n.needed)}개</td>
                    <td className="tabular px-2 py-2.5 text-right text-slate-900">{num(n.onHand)}개</td>
                    <td className="tabular px-2 py-2.5 text-right font-semibold text-slate-900">{num(n.reserved)}개</td>
                    <td className="tabular px-2 py-2.5 text-right text-slate-900">{num(n.available)}개</td>
                    <td className="px-2 py-2.5">
                      {n.enough ? <Badge tone="green">수리용 확보</Badge> : <Badge tone="red">{num(n.needed - n.onHand)}개 부족</Badge>}
                    </td>
                    <td className="py-2.5 pl-2 pr-5 text-right">
                      <Button auth size="sm" onClick={() => openOrder(n.partCode)}>
                        발주
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
          수리에 필요한 부품은 재고에서 먼저 잡아 둡니다. 대시보드의 생산 가능 대수·재고 일수·생산 예측은 이 수량을 뺀 '생산에 쓸 수 있는 재고'로 계산합니다. 재고가 모자라면 늦게 입고된 차량부터 '부품 대기'가 됩니다. (수리 차량 목록은 시연용 고정 데이터입니다.)
        </p>
      </Card>
    </div>
  );
}
