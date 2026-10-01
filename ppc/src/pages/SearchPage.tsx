// 발주 검색 `/search?q=`: 어떤 부품을 어느 업체에서 얼마에, 며칠 만에, 준수율 몇 %로 발주할 수 있는지
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, GradeBadge } from '../components/ui';
import { num, won } from '../lib/format';
import { searchOffers } from '../lib/search';
import type { AppState } from '../lib/types';
import { useUi } from '../state/Ui';

export function SearchPage({ state }: { state: AppState }) {
  const { openOrder } = useUi();
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const offers = useMemo(() => searchOffers(state, query), [state, query]);
  const partCount = new Set(offers.map((o) => o.part.code)).size;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm font-semibold text-accent hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">발주 검색</h1>
        <p className="text-xs text-slate-500">
          {query.trim() === '' ? '전체' : `"${query.trim()}"`} · 부품 {partCount}종 · 발주할 수 있는 업체 {num(offers.length)}곳 · 싼 순으로 정렬
        </p>
      </div>

      <Card title="부품별 발주 가능 업체" aside={<span className="text-xs text-slate-500">상단 검색창에 부품명·업체명·소재를 넣으세요 (여러 낱말은 띄어쓰기)</span>}>
        {offers.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">
            "{query.trim()}"에 맞는 부품·업체가 없습니다. 부품명(엔진, 차체 …), 업체명, 소재 이름으로 찾아보세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-[13px]">
              <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="py-2 pl-5 pr-2">부품</th>
                  <th className="px-2 py-2">업체</th>
                  <th className="px-2 py-2 text-right">가격 (개당)</th>
                  <th className="px-2 py-2 text-right">기본 납기</th>
                  <th className="px-2 py-2 text-right">긴급(대체) 납기</th>
                  <th className="px-2 py-2">납기 준수율</th>
                  <th className="px-2 py-2 text-right">이번 주 발주 가능</th>
                  <th className="py-2 pl-2 pr-5" aria-label="발주" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {offers.map((o, i) => {
                  const firstOfPart = i === 0 || offers[i - 1].part.code !== o.part.code;
                  const orderable = Math.min(o.limitRemaining, o.maxQty);
                  return (
                    <tr key={`${o.part.code}-${o.supplier.code}`} className={firstOfPart && i > 0 ? 'border-t-2 border-slate-200' : ''}>
                      <td className="py-2.5 pl-5 pr-2">
                        <span className="font-semibold text-slate-900">{o.part.name}</span>{' '}
                        <span className="font-mono text-[11px] text-slate-400">{o.part.code}</span>
                        <span className="ml-2 text-xs text-slate-500">{o.part.materialName}</span>
                      </td>
                      <td className="px-2 py-2.5 text-slate-900">
                        {o.supplier.name} <span className="font-mono text-[11px] text-slate-400">{o.supplier.code}</span>
                        {o.isDefault && <span className="ml-1.5 text-[11px] font-semibold text-accent">기본 업체</span>}
                        {o.disrupted && (
                          <span className="ml-1.5">
                            <Badge tone="red">차질 진행 중</Badge>
                          </span>
                        )}
                      </td>
                      <td className="tabular px-2 py-2.5 text-right font-semibold text-slate-900">{o.unitPrice === null ? '단가 없음' : won(o.unitPrice)}</td>
                      <td className="tabular px-2 py-2.5 text-right text-slate-900">{o.leadDays}일</td>
                      <td className="tabular px-2 py-2.5 text-right text-slate-700">{o.altLeadDays}일</td>
                      <td className="px-2 py-2.5">
                        <GradeBadge rate={o.onTimeRate} grade={o.grade} />
                      </td>
                      <td className={`tabular px-2 py-2.5 text-right ${orderable === 0 ? 'font-semibold text-red-600' : 'text-slate-700'}`}>
                        {num(orderable)}개
                      </td>
                      <td className="py-2.5 pl-2 pr-5 text-right">
                        <Button size="sm" onClick={() => openOrder(o.orderPartCode, o.supplier.name)} disabled={o.unitPrice === null} aria-label={`${o.part.name} ${o.supplier.name} 발주`}>
                          발주
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
          가격 = 업체의 자재 단가(원/kg) × 부품 1개당 소재 필요량(kg). 기본 납기에는 발주 수량에 따른 지연이 더해집니다(발주 창에서 확인). 이번 주
          발주 가능 = 업체당 주간 한도와 남은 월 공급 능력 가운데 작은 쪽.
        </p>
      </Card>
    </div>
  );
}
