import { useState } from 'react';
import { api } from '../lib/api';
import { localDate, money } from '../lib/format';
import { useData } from '../lib/hooks';
import { Button, Card, ErrorBanner, Field, Input, PageLoader, Stat, Tabs } from '../components/ui';
import { useLive } from './AdminApp';
import { RankBars, RevenueArea, VBars } from './charts';

const PRESETS = [{ label: 'Today', days: 1 }, { label: '7 days', days: 7 }, { label: '30 days', days: 30 }, { label: '90 days', days: 90 }];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      {PRESETS.map((p) => (
        <Button key={p.label} size="sm" variant={from === localDate(-(p.days - 1)) && to === localDate() ? 'primary' : 'secondary'} onClick={() => onChange(localDate(-(p.days - 1)), localDate())}>{p.label}</Button>
      ))}
      <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => e.target.value && onChange(e.target.value, to)} className="h-9 w-40" /></Field>
      <Field label="To"><Input type="date" value={to} min={from} max={localDate()} onChange={(e) => e.target.value && onChange(from, e.target.value)} className="h-9 w-40" /></Field>
    </div>
  );
}

export default function Analytics() {
  const [range, setRange] = useState({ from: localDate(-29), to: localDate() });
  const [gran, setGran] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const { data, error, reload, softReload } = useData(() => api('/admin/analytics', { query: range }), [range.from, range.to]);
  useLive(['payment.changed'], softReload);

  return (
    <div className="space-y-6">
      <Card className="p-4"><DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} /></Card>
      <ErrorBanner message={error} onRetry={reload} />
      {!data ? <PageLoader /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Revenue collected" value={money(data.totals.revenue)} />
            <Stat label="Orders" value={data.totals.orders.toLocaleString()} tone="blue" />
            <Stat label="Avg order value" value={money(data.totals.paid_orders ? Math.round(data.totals.revenue / data.totals.paid_orders) : 0)} tone="green" />
            <Stat label="Cancelled" value={data.totals.cancelled} tone="red" sub={<span>{data.totals.orders + data.totals.cancelled ? ((data.totals.cancelled / (data.totals.orders + data.totals.cancelled)) * 100).toFixed(1) : 0}% of orders</span>} />
          </div>
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display font-semibold text-white">Revenue</h3>
              <Tabs value={gran} onChange={setGran} tabs={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} className="w-auto" />
            </div>
            {gran === 'daily' ? <RevenueArea data={data.daily} x="day" height={300} /> : <VBars data={data[gran]} x="period" y="revenue" money label="Revenue" height={300} xFormat={(v) => (gran === 'monthly' ? String(v).slice(0, 7) : `wk ${String(v).slice(5)}`)} />}
            <p className="mt-2 text-xs text-silver-500">Revenue = payments confirmed as paid (by the provider for online, by staff for cash/counter), dated by payment time in {data.timezone}.</p>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5"><h3 className="mb-4 font-display font-semibold text-white">Order volume per day</h3><RevenueArea data={data.daily} x="day" y="orders" money={false} label="Orders" height={220} /></Card>
            <Card className="p-5"><h3 className="mb-4 font-display font-semibold text-white">Orders by hour of day</h3><VBars data={data.hourly} x="hour" y="orders" label="Orders" height={220} xFormat={(h) => `${String(h).padStart(2, '0')}h`} /></Card>
            <Card className="p-5">
              <h3 className="mb-4 font-display font-semibold text-white">Sales by payment method</h3>
              <RankBars rows={data.by_method.map((m: any) => ({ ...m, label: `${m.method === 'ONLINE' ? 'Online' : m.method === 'CASH' ? 'Cash at table' : 'Pay at counter'} · ${m.count} payments` }))} value="revenue" label="label" format={(v) => money(v)} />
            </Card>
            <Card className="p-5"><h3 className="mb-4 font-display font-semibold text-white">Best-performing categories</h3><RankBars rows={data.categories} value="revenue" label="category" format={(v) => money(v)} /></Card>
            <Card className="p-5"><h3 className="mb-4 font-display font-semibold text-white">Best-selling products</h3><RankBars rows={data.products.slice(0, 10)} value="qty" label="name" format={(v) => `${v.toLocaleString()} sold`} /></Card>
            <Card className="p-5"><h3 className="mb-4 font-display font-semibold text-white">Orders by weekday</h3><VBars data={data.weekday} x="dow" y="orders" label="Orders" height={220} xFormat={(d) => DOW[Number(d)]} /></Card>
          </div>
        </>
      )}
    </div>
  );
}
