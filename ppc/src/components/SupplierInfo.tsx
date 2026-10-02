// 업체 정보: 업체명을 누르면 연락처, 납품하는 부품과 가격, 납기 준수율, 발주 가능량을 보여 준다
import { Link } from 'react-router-dom';
import { CAPACITY_WINDOW_DAYS } from '../lib/constants';
import { formatMD } from '../lib/date';
import { num, won } from '../lib/format';
import { partOf } from '../lib/reference';
import { supplierProfile } from '../lib/search';
import type { AppState } from '../lib/types';
import { useUi } from '../state/Ui';
import { Badge, Button, GradeBadge, Modal } from './ui';

/** 누르면 업체 정보 창이 열리는 업체명 */
export function SupplierLink({ name }: { name: string }) {
  const { openSupplier } = useUi();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openSupplier(name);
      }}
      title="업체 정보 보기"
      className="font-semibold text-slate-900 underline decoration-slate-300 decoration-dotted underline-offset-2 hover:text-accent hover:decoration-accent"
    >
      {name}
    </button>
  );
}

export function SupplierModal({ state, supplierName, onClose }: { state: AppState; supplierName: string; onClose: () => void }) {
  const { openOrder } = useUi();
  const profile = supplierProfile(state, supplierName);

  if (!profile) {
    return (
      <Modal title={supplierName} onClose={onClose} footer={<Button onClick={onClose}>닫기</Button>}>
        <p className="text-sm text-slate-600">Excel 공급업체 시트에 없는 업체입니다.</p>
      </Modal>
    );
  }
  const { supplier, grade, offers, capacity, limit, activeDisruptions, openOrders } = profile;
  const info: [string, React.ReactNode][] = [
    [
      '담당자 연락처',
      supplier.phone ? (
        <a href={`tel:${supplier.phone}`} className="tabular font-bold text-accent hover:underline">
          {supplier.phone}
        </a>
      ) : (
        '–'
      ),
    ],
    ['납기 준수율', <GradeBadge key="g" rate={supplier.onTimeRate} grade={grade} />],
    ['기본 납기 / 긴급(대체) 납기', `${supplier.leadDays}일 / ${supplier.altLeadDays}일`],
    ['공급 소재', supplier.materials.join(', ')],
    [
      '월 공급 능력',
      `${num(supplier.monthlyCapacityKg)}kg 중 남은 ${num(Math.round(capacity.remainingKg))}kg (최근 ${CAPACITY_WINDOW_DAYS}일 발주 ${num(Math.round(capacity.usedKg))}kg)`,
    ],
    [
      '이번 주 발주 한도',
      `${limit.limit}개 중 남은 ${limit.remaining}개` + (limit.releaseDate && limit.used > 0 ? ` (${formatMD(limit.releaseDate)}부터 풀림)` : ''),
    ],
  ];

  return (
    <Modal
      title={
        <>
          {supplier.name} <span className="font-mono text-xs font-medium text-slate-400">{supplier.code}</span>
          <span className="ml-2 align-middle">
            <Badge tone={activeDisruptions.length > 0 ? 'red' : supplier.status === '주의' ? 'orange' : 'green'}>
              {activeDisruptions.length > 0 ? '차질 진행 중' : `상태 ${supplier.status}`}
            </Badge>
          </span>
        </>
      }
      wide
      onClose={onClose}
      footer={<Button onClick={onClose}>닫기</Button>}
    >
      <div className="space-y-4">
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          {info.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
              <dd className="mt-0.5 text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>

        {activeDisruptions.length > 0 && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700">
            해결되지 않은 차질:{' '}
            {activeDisruptions.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ', '}
                <Link to={`/disruptions/${d.id}`} onClick={onClose} className="font-bold underline">
                  {d.id}
                </Link>{' '}
                {partOf(d.partCode).name} {d.delayDays}일 지연
              </span>
            ))}
          </p>
        )}

        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">납품하는 부품 (자동차 1대에 들어가는 부품 가운데)</p>
          {offers.length === 0 ? (
            <p className="rounded-md bg-slate-50 px-3 py-3 text-center text-[13px] text-slate-500">이 업체의 소재로 만드는 라인 부품이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full whitespace-nowrap text-left text-[13px]">
                <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <tr>
                    <th className="px-3 py-2">부품</th>
                    <th className="px-3 py-2">소재</th>
                    <th className="px-3 py-2 text-right">가격 (개당)</th>
                    <th className="px-3 py-2 text-right">지금 발주 가능</th>
                    <th className="px-3 py-2" aria-label="발주" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {offers.map((o) => {
                    const orderable = Math.min(o.limitRemaining, o.maxQty);
                    return (
                      <tr key={o.part.code}>
                        <td className="px-3 py-2 font-semibold text-slate-900">
                          {o.part.name}
                          {o.isDefault && <span className="ml-1.5 text-[11px] font-semibold text-accent">기본 업체</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{o.part.materialName}</td>
                        <td className="tabular px-3 py-2 text-right font-semibold text-slate-900">{o.unitPrice === null ? '단가 없음' : won(o.unitPrice)}</td>
                        <td className={`tabular px-3 py-2 text-right ${orderable === 0 ? 'font-semibold text-red-600' : 'text-slate-900'}`} title={`주간 한도 남은 ${num(o.limitRemaining)}개 · 남은 공급 능력으로 최대 ${num(o.maxQty)}개`}>
                          {num(orderable)}개
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            auth
                            size="sm"
                            disabled={o.unitPrice === null}
                            onClick={() => {
                              onClose();
                              openOrder(o.orderPartCode, supplier.name);
                            }}
                          >
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
          <p className="mt-1 text-[11px] text-slate-500">
            지금 발주 가능 = 이번 주 한도와 남은 월 공급 능력 가운데 작은 쪽. 긴급(대체) 발주는 주간 한도 없이 남은 공급 능력까지 넣을 수 있습니다.
          </p>
        </div>

        {openOrders.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">이 업체에 넣어 둔 발주 (미입고)</p>
            <ul className="space-y-1 text-[13px] text-slate-700">
              {openOrders.map((po) => (
                <li key={po.id}>
                  <strong className="font-mono text-slate-900">{po.id}</strong> {partOf(po.partCode).name} {num(po.qty)}개 · 도착 예정 {formatMD(po.expectedArrival)} ·{' '}
                  {po.status}
                  {po.kind === '대체' && ' · 대체'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
