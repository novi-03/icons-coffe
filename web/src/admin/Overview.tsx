import { Link } from 'react-router-dom';
import { AlertTriangle, Banknote, ChefHat, ClipboardList, Clock, Coins, Receipt, ShoppingBag, Star, Table2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { money, time } from '../lib/format';
import { useData } from '../lib/hooks';
import type { Order } from '../lib/types';
import { Badge, Card, ErrorBanner, OrderStatusBadge, PageLoader, PaymentStatusBadge, Stat } from '../components/ui';
import { useLive } from './AdminApp';
import { RankBars, VBars } from './charts';

type K = Record<string, number | string | null>;
const trend = (cur: number, prev: number, enough: boolean) => (enough && prev > 0 ? { pct: ((cur - prev) / prev) * 100, label: 'vs same time yesterday' } : null);

export default function Overview() {
  const { data, error, reload, softReload } = useData(() => api<{ kpis: K; pipeline: { status: string; c: number }[]; recent: Order[]; hourly: any[]; top_today: any[] }>('/admin/overview'), []);
  useLive(['order.changed', 'payment.changed', 'table.changed', 'review.created', 'inventory.changed', 'request.changed'], softReload);
  if (!data) return error ? <ErrorBanner message={error} onRetry={reload} /> : <PageLoader />;
  const k = data.kpis;
  const n = (key: string) => Number(k[key] ?? 0);
  const enough = n('history_orders') > 0;
  const aov = n('paid_count_today') ? n('revenue_today') / n('paid_count_today') : 0;
  const aovPrev = n('paid_count_yesterday') ? n('revenue_yesterday_same_time') / n('paid_count_yesterday') : 0;
  const pipe = (s: string) => data.pipeline.find((p) => p.status === s)?.c ?? 0;
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: Number(data.hourly.find((x) => x.hour === h)?.revenue ?? 0) })).filter((x) => x.hour >= 6 || x.revenue > 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today's revenue" value={money(n('revenue_today'))} icon={<Coins className="h-4 w-4" />} trend={trend(n('revenue_today'), n('revenue_yesterday_same_time'), enough)} />
        <Stat label="Total orders" value={n('orders_today')} icon={<ShoppingBag className="h-4 w-4" />} trend={trend(n('orders_today'), n('orders_yesterday_same_time'), enough)} sub={<span>today</span>} tone="blue" />
        <Stat label="Average order value" value={money(Math.round(aov))} icon={<Receipt className="h-4 w-4" />} trend={trend(aov, aovPrev, enough)} tone="green" />
        <Stat label="Active orders" value={n('active_orders')} icon={<ChefHat className="h-4 w-4" />} sub={n('delayed_orders') ? <Badge tone="red"><AlertTriangle className="h-3 w-3" />{n('delayed_orders')} delayed</Badge> : <span>in progress now</span>} tone="amber" />
        <Stat label="Pending payments" value={n('pending_payments')} icon={<Banknote className="h-4 w-4" />} sub={<span>{money(n('pending_payments_fils'))} outstanding{n('awaiting_online_payment') ? ` · ${n('awaiting_online_payment')} awaiting online` : ''}</span>} tone="amber" />
        <Stat label="Occupied tables" value={`${n('occupied_tables')}`} icon={<Table2 className="h-4 w-4" />} sub={<span>of {n('active_tables')} active tables</span>} tone="violet" />
        <Stat label="Available tables" value={Math.max(0, n('active_tables') - n('occupied_tables'))} icon={<Table2 className="h-4 w-4" />} tone="green" />
        <Stat label="Customers" value={n('customers_today')} icon={<Users className="h-4 w-4" />} trend={trend(n('customers_today'), n('customers_yesterday_same_time'), enough)} sub={<span>today · {n('customers_all_time').toLocaleString()} all-time</span>} tone="blue" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between"><h3 className="font-display font-semibold text-white">Revenue by hour · today</h3><Link to="/admin/analytics" className="text-xs font-semibold text-brand-300">Full analytics →</Link></div>
          <VBars data={hours} x="hour" y="revenue" money label="Revenue" xFormat={(h) => `${String(h).padStart(2, '0')}:00`} />
        </Card>
        <Card className="p-5">
          <h3 className="mb-4 font-display font-semibold text-white">Live pipeline</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[['Awaiting payment', 'AWAITING_PAYMENT'], ['New', 'RECEIVED'], ['Accepted', 'ACCEPTED'], ['Preparing', 'PREPARING'], ['Ready', 'READY'], ['Served (unpaid)', 'SERVED']].map(([l, s]) => (
              <div key={s} className="rounded-xl bg-ink-900 p-3 ring-1 ring-white/5"><div className="text-xs text-silver-400">{l}</div><div className="font-display text-xl font-bold text-white">{pipe(s)}</div></div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {n('open_requests') > 0 && <Badge tone="amber">{n('open_requests')} open customer requests</Badge>}
            {n('low_stock') > 0 && <Link to="/admin/inventory"><Badge tone="red">{n('low_stock')} low-stock items</Badge></Link>}
            {n('open_issues') > 0 && <Badge tone="red">{n('open_issues')} open service issues</Badge>}
            {k.rating_30d && <Badge tone="violet"><Star className="h-3 w-3" />{k.rating_30d} avg rating (30d)</Badge>}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between px-5 pt-5"><h3 className="font-display font-semibold text-white">Latest orders</h3><Link to="/admin/orders" className="text-xs font-semibold text-brand-300">All orders →</Link></div>
          <div className="overflow-x-auto">
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-silver-500"><tr><th className="px-5 py-2">Order</th><th>Table</th><th>Time</th><th>Total</th><th>Payment</th><th className="pr-5">Status</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {data.recent.map((o) => (
                  <tr key={o.id} className="text-silver-200">
                    <td className="px-5 py-2.5 font-semibold text-white">#{o.order_number}{o.is_demo && <Badge tone="amber" className="ml-2">DEMO</Badge>}</td>
                    <td>T{String(o.table_number).padStart(2, '0')}</td><td className="text-silver-400"><Clock className="mr-1 inline h-3 w-3" />{time(o.created_at)}</td>
                    <td className="tabular-nums">{money(o.total_fils)}</td><td>{o.payment_status && <PaymentStatusBadge status={o.payment_status} />}</td><td className="pr-5"><OrderStatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.recent.length && <div className="p-8 text-center text-sm text-silver-500"><ClipboardList className="mx-auto mb-2 h-6 w-6" />No orders yet today</div>}
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="mb-4 font-display font-semibold text-white">Best sellers · today</h3>
          <RankBars rows={data.top_today} value="qty" label="name" format={(v) => `${v} sold`} />
        </Card>
      </div>
    </div>
  );
}
