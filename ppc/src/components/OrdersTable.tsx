// F1-5 주문 납기 현황 표
import { formatMD } from '../lib/date';
import { num } from '../lib/format';
import type { OrderForecast } from '../lib/planning';

export function OrderStatus({ order }: { order: OrderForecast }) {
  if (order.lateDays === null) {
    return <span className="font-semibold text-red-600">❌ 기간 내 미완료</span>;
  }
  if (order.lateDays > 0) {
    return <span className="font-semibold text-red-600">❌ {order.lateDays}일 지연</span>;
  }
  return <span className="font-semibold text-emerald-700">✅ 충족 (여유 {-order.lateDays}일)</span>;
}

export function OrdersTable({ orders }: { orders: OrderForecast[] }) {
  if (orders.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-slate-500">자동차 주문이 없습니다</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
          <tr>
            <th className="py-2 pl-5 pr-2">주문번호</th>
            <th className="px-2 py-2">고객</th>
            <th className="px-2 py-2 text-right">수량</th>
            <th className="px-2 py-2">납기</th>
            <th className="px-2 py-2">예상 완료일</th>
            <th className="py-2 pl-2 pr-5">상태</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="py-2.5 pl-5 pr-2 font-mono font-semibold text-slate-900">{o.id}</td>
              <td className="px-2 py-2.5 text-slate-900">{o.customer}</td>
              <td className="tabular px-2 py-2.5 text-right text-slate-900">{num(o.qty)}대</td>
              <td className="tabular px-2 py-2.5 text-slate-700">{formatMD(o.dueDate)}</td>
              <td className="tabular px-2 py-2.5 font-semibold text-slate-900">{o.doneDate ? formatMD(o.doneDate) : '–'}</td>
              <td className="py-2.5 pl-2 pr-5">
                <OrderStatus order={o} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
