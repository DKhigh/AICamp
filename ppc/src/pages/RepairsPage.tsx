// 수리 차량 `/repairs`: 입고되어 수리 중인 차량, 고장 난 곳, 소모 부품. 여기서도 발주할 수 있다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, ColorSwatch, type Tone } from '../components/ui';
import { formatMD } from '../lib/date';
import { num } from '../lib/format';
import { nextArrivalOf } from '../lib/planning';
import { colorOf, partOf } from '../lib/reference';
import { repairCarsAt, repairCarViews, repairPartNeeds } from '../lib/repairs';
import type { AppState } from '../lib/types';
import { useUi } from '../state/Ui';

const STATUS_TONE: Record<string, Tone> = { '수리 중': 'blue', '부품 대기': 'orange', '진단 중': 'gray' };

export function RepairsPage({ state }: { state: AppState }) {
  const { openOrder } = useUi();
  const [picked, setPicked] = useState<string | null>(null);
  const repairCars = repairCarViews(repairCarsAt(state.settings.baseDate), state.lineParts);
  const selected = repairCars.find((c) => c.serial === picked) ?? null;
  const needs = repairPartNeeds(repairCars, state.lineParts);
  const needOf = new Map(needs.map((n) => [n.partCode, n]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm font-semibold text-accent hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">수리 차량</h1>
        <p className="text-xs text-slate-500">입고되어 수리 중인 차량 {repairCars.length}대 · 수리에 쓸 부품은 재고에서 따로 잡아 두고 생산에는 쓰지 않습니다</p>
        <Button variant="primary" className="ml-auto" onClick={() => openOrder()}>
          + 발주
        </Button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title="수리 중인 차량" aside={<span className="text-xs text-slate-500">{repairCars.length}대</span>}>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-[13px]">
              <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="py-2 pl-5 pr-2">고유번호</th>
                  <th className="px-2 py-2">색상</th>
                  <th className="px-2 py-2">입고일</th>
                  <th className="px-2 py-2">고장 난 곳</th>
                  <th className="px-2 py-2">상태</th>
                  <th className="py-2 pl-2 pr-5 text-right">소모 부품</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {repairCars.map((car) => {
                  const active = selected?.serial === car.serial;
                  return (
                    <tr
                      key={car.serial}
                      onClick={() => setPicked(active ? null : car.serial)}
                      className={`cursor-pointer ${active ? 'bg-accent-light' : 'hover:bg-slate-50'}`}
                    >
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
                      <td className="px-2 py-2.5 font-semibold text-slate-900">{car.faultArea}</td>
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

        <Card title={selected ? `차량 ${selected.serial}` : '차량 상세'}>
          {!selected ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">왼쪽 목록에서 차량을 선택하세요</p>
          ) : (
            <div className="space-y-4 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold text-slate-500">고장 난 곳</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-base font-bold text-slate-900">
                  {selected.faultArea}
                  <Badge tone={STATUS_TONE[selected.status] ?? 'gray'}>{selected.status}</Badge>
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-700">{selected.symptom}</p>
                <p className="mt-1 text-xs text-slate-500">입고일 {formatMD(selected.receivedDate)}</p>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold text-slate-500">소모 부품</p>
                <ul className="space-y-2">
                  {selected.parts.map((use) => {
                    const part = partOf(use.partCode);
                    const need = needOf.get(use.partCode);
                    const short = selected.missing.find((m) => m.partCode === use.partCode)?.qty ?? 0;
                    const next = nextArrivalOf(use.partCode, state.purchaseOrders);
                    return (
                      <li key={use.partCode} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2.5">
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
                        </div>
                        <Button size="sm" onClick={() => openOrder(use.partCode)}>
                          발주
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </Card>
      </div>

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
                      <Button size="sm" onClick={() => openOrder(n.partCode)}>
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
