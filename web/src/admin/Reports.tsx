import { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../lib/api';
import { localDate, money, titleCase } from '../lib/format';
import { useData } from '../lib/hooks';
import { Button, Card, cx, ErrorBanner, PageLoader } from '../components/ui';
import { DateRange } from './Analytics';

const TYPES = [
  { id: 'daily', label: 'Daily sales' }, { id: 'weekly', label: 'Weekly sales' }, { id: 'monthly', label: 'Monthly sales' },
  { id: 'products', label: 'Product performance' }, { id: 'payments', label: 'Payments' }, { id: 'orders', label: 'Orders' }, { id: 'staff', label: 'Staff activity' },
] as const;

export default function Reports() {
  const [type, setType] = useState<(typeof TYPES)[number]['id']>('daily');
  const [range, setRange] = useState({ from: localDate(-29), to: localDate() });
  const { data, error, reload, loading } = useData(() => api('/admin/reports/' + type, { query: range }), [type, range.from, range.to]);
  const csv = `/api/admin/reports/${type}?format=csv&from=${range.from}&to=${range.to}`;
  const cell = (c: string, v: any) => (v === null || v === undefined || v === '' ? '—' : c.endsWith('_fils') ? money(v) : typeof v === 'boolean' ? (v ? 'yes' : '') : String(v));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => <button key={t.id} onClick={() => setType(t.id)} className={cx('rounded-xl px-3 py-2 text-sm font-semibold ring-1', type === t.id ? 'bg-brand-500/20 text-white ring-brand-500/40' : 'text-silver-300 ring-white/10 hover:bg-white/5')}>{t.label}</button>)}
      </div>
      <Card className="flex flex-wrap items-end justify-between gap-3 p-4">
        <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <a href={csv}><Button><Download className="h-4 w-4" />Export CSV</Button></a>
      </Card>
      <ErrorBanner message={error} onRetry={reload} />
      <Card className="overflow-hidden">
        {!data || loading ? <PageLoader /> : (
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-navy-900 text-left text-xs uppercase tracking-wider text-silver-500">
                <tr>{data.columns.map((c: string) => <th key={c} className="whitespace-nowrap px-3 py-3">{titleCase(c.replace(/_fils$/, ''))}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.rows.slice(0, 500).map((r: any, i: number) => (
                  <tr key={i} className="text-silver-200">{data.columns.map((c: string) => <td key={c} className={cx('whitespace-nowrap px-3 py-2', c.endsWith('_fils') && 'text-right tabular-nums')}>{cell(c, r[c])}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && <div className="p-10 text-center text-sm text-silver-500">No data for this period</div>}
            {data.rows.length > 500 && <div className="p-3 text-center text-xs text-silver-500">Showing first 500 of {data.rows.length} rows — export CSV for all.</div>}
          </div>
        )}
      </Card>
      {data && <p className="text-xs text-silver-500">{data.from} to {data.to} · times in {data.timezone} · amounts in AED</p>}
    </div>
  );
}
