import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from '../lib/format';

// Single-hue brand charts (one series each): violet marks, recessive silver axes/grid.
const VIOLET = '#8b5cf6';
const AXIS = { stroke: '#525769', fontSize: 11, tickLine: false, axisLine: false } as const;
const tipStyle = { background: '#121834', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, fontSize: 12, color: '#e5e7eb' };
const aedShort = (fils: number) => { const v = fils / 100; return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v.toFixed(0); };

export function RevenueArea({ data, x, y = 'revenue', height = 260, money: isMoney = true, label = 'Revenue' }:
  { data: any[]; x: string; y?: string; height?: number; money?: boolean; label?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={VIOLET} stopOpacity={0.45} /><stop offset="1" stopColor={VIOLET} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
        <XAxis dataKey={x} {...AXIS} minTickGap={24} tickFormatter={(v) => (typeof v === 'string' && v.length === 10 ? v.slice(5) : v)} />
        <YAxis {...AXIS} width={44} tickFormatter={(v) => (isMoney ? aedShort(v) : String(v))} />
        <Tooltip contentStyle={tipStyle} cursor={{ stroke: '#a78bfa', strokeDasharray: 3 }} formatter={(v: any) => [isMoney ? money(v) : v, label]} />
        <Area type="monotone" dataKey={y} stroke={VIOLET} strokeWidth={2} fill="url(#rev)" activeDot={{ r: 5, stroke: '#121834', strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function VBars({ data, x, y, height = 240, money: isMoney = false, label, xFormat }:
  { data: any[]; x: string; y: string; height?: number; money?: boolean; label: string; xFormat?: (v: any) => string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
        <XAxis dataKey={x} {...AXIS} tickFormatter={xFormat} minTickGap={8} />
        <YAxis {...AXIS} width={44} tickFormatter={(v) => (isMoney ? aedShort(v) : String(v))} allowDecimals={false} />
        <Tooltip contentStyle={tipStyle} cursor={{ fill: 'rgba(139,92,246,.08)' }} labelFormatter={xFormat} formatter={(v: any) => [isMoney ? money(v) : v, label]} />
        <Bar dataKey={y} fill={VIOLET} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Ranked horizontal bars with direct labels (name + value) — readable without color. */
export function RankBars({ rows, value, label, format }: { rows: any[]; value: string; label: string; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[value])));
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r[label] + i} title={`${r[label]}: ${format(Number(r[value]))}`}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-silver-200">{r[label]}</span>
            <span className="shrink-0 tabular-nums text-silver-300">{format(Number(r[value]))}</span>
          </div>
          <div className="h-2 rounded-full bg-white/5"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(2, (Number(r[value]) / max) * 100)}%` }} /></div>
        </li>
      ))}
      {!rows.length && <li className="py-6 text-center text-sm text-silver-500">No data for this period</li>}
    </ul>
  );
}
