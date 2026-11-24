import { useState } from 'react';
import { AlertTriangle, History, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { dateTime, titleCase } from '../lib/format';
import { useData } from '../lib/hooks';
import { Badge, Button, Card, ConfirmDialog, cx, ErrorBanner, Field, Input, Modal, PageLoader, Select, useToast } from '../components/ui';
import { useLive } from './AdminApp';

type Item = { id: string; name: string; unit: string; quantity: number; low_stock_threshold: number; is_low: boolean; is_demo: boolean; products: { name: string; quantity_per_unit: number }[]; last_movement_at: string | null };
const fmt = (n: number) => Number(n).toLocaleString('en', { maximumFractionDigits: 3 });

export default function Inventory() {
  const toast = useToast();
  const { data, error, reload, softReload } = useData(() => api<{ items: Item[] }>('/admin/inventory'), []);
  useLive(['inventory.changed'], softReload);
  const [adjust, setAdjust] = useState<Item | null>(null);
  const [history, setHistory] = useState<Item | null>(null);
  const [create, setCreate] = useState(false);
  const [del, setDel] = useState<Item | null>(null);
  if (!data) return error ? <ErrorBanner message={error} onRetry={reload} /> : <PageLoader />;
  const low = data.items.filter((i) => i.is_low);
  return (
    <div className="space-y-4">
      {low.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl bg-red-500/10 p-4 text-sm text-red-100 ring-1 ring-red-500/25">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div><div className="font-semibold">Low stock: {low.map((i) => i.name).join(', ')}</div><div className="text-red-200/80">Restock soon — these are at or below their alert level.</div></div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-silver-400">Stock is deducted automatically when the kitchen accepts an order (for products with ingredients configured) and returned if an accepted order is cancelled.</p>
        <Button onClick={() => setCreate(true)}><Plus className="h-4 w-4" />Add ingredient</Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-white/5 text-left text-xs uppercase tracking-wider text-silver-500"><tr><th className="px-4 py-3">Ingredient</th><th className="text-right">In stock</th><th className="text-right">Alert at</th><th className="pl-6">Used in</th><th>Last movement</th><th className="pr-4" /></tr></thead>
          <tbody className="divide-y divide-white/5">
            {data.items.map((i) => (
              <tr key={i.id} className="text-silver-200">
                <td className="px-4 py-3 font-semibold text-white">{i.name}{i.is_demo && <Badge tone="amber" className="ml-2">DEMO</Badge>}</td>
                <td className={cx('text-right font-semibold tabular-nums', i.is_low ? 'text-red-300' : 'text-white')}>{fmt(i.quantity)} {i.unit}{i.is_low && <AlertTriangle className="ml-1 inline h-3.5 w-3.5" />}</td>
                <td className="text-right tabular-nums text-silver-400">{fmt(i.low_stock_threshold)} {i.unit}</td>
                <td className="max-w-[260px] truncate pl-6 text-xs text-silver-400">{i.products.map((p) => p.name).join(', ') || '—'}</td>
                <td className="text-xs text-silver-500">{dateTime(i.last_movement_at)}</td>
                <td className="pr-4 text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="xs" variant="secondary" onClick={() => setAdjust(i)}><SlidersHorizontal className="h-3.5 w-3.5" />Adjust</Button>
                    <Button size="xs" variant="ghost" onClick={() => setHistory(i)} aria-label="History"><History className="h-3.5 w-3.5" /></Button>
                    <Button size="xs" variant="ghost" className="text-red-300" onClick={() => setDel(i)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.items.length && <div className="p-10 text-center text-sm text-silver-500">No inventory items yet</div>}
      </Card>
      <AdjustModal item={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); reload(); toast({ tone: 'success', title: 'Stock updated' }); }} />
      <HistoryModal item={history} onClose={() => setHistory(null)} />
      <CreateModal open={create} onClose={() => setCreate(false)} onSaved={() => { setCreate(false); reload(); }} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name}?`} tone="danger" confirmLabel="Delete" body="Its stock history and product links will be removed."
        onConfirm={async () => { await api(`/admin/inventory/${del!.id}`, { method: 'DELETE' }); reload(); }} />
    </div>
  );
}

function AdjustModal({ item, onClose, onSaved }: { item: Item | null; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState<'RESTOCK' | 'ADJUSTMENT' | 'WASTE'>('RESTOCK');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  if (item && last !== item.id) { setLast(item.id); setAmount(''); setNote(''); setReason('RESTOCK'); setThreshold(String(item.low_stock_threshold)); setError(null); }
  if (!item) return null;
  const n = Number(amount);
  const delta = reason === 'RESTOCK' ? Math.abs(n) : reason === 'WASTE' ? -Math.abs(n) : n;
  return (
    <Modal open onClose={onClose} title={`Adjust ${item.name}`} size="sm"
      footer={<Button className="w-full" loading={busy} disabled={!amount || !n} onClick={async () => {
        setBusy(true); setError(null);
        try {
          await api(`/admin/inventory/${item.id}/adjust`, { body: { delta, reason, note: note || undefined } });
          if (Number(threshold) !== item.low_stock_threshold) await api(`/admin/inventory/${item.id}`, { method: 'PATCH', body: { low_stock_threshold: Number(threshold) } });
          onSaved();
        } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
      }}>Save</Button>}>
      <div className="space-y-4 p-5">
        <div className="text-sm text-silver-300">Current stock: <span className="font-semibold text-white">{fmt(item.quantity)} {item.unit}</span></div>
        <Field label="Type"><Select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}><option value="RESTOCK">Restock (add)</option><option value="WASTE">Waste (remove)</option><option value="ADJUSTMENT">Correction (+/−)</option></Select></Field>
        <Field label={`Amount (${item.unit})`} hint={reason === 'ADJUSTMENT' ? 'Use a negative number to reduce stock.' : undefined}><Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {!!n && <div className="text-xs text-silver-400">New stock will be {fmt(item.quantity + delta)} {item.unit}</div>}
        <Field label="Note (optional)"><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Supplier invoice, reason…" /></Field>
        <Field label={`Low-stock alert at (${item.unit})`}><Input type="number" min={0} step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field>
        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}

function HistoryModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const { data } = useData(() => (item ? api<{ transactions: any[] }>(`/admin/inventory/${item.id}/transactions`) : Promise.resolve(null)), [item?.id]);
  if (!item) return null;
  return (
    <Modal open onClose={onClose} title={`${item.name} · stock history`} size="lg">
      {!data ? <PageLoader /> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-silver-500"><tr><th className="px-5 py-2">When</th><th>Type</th><th className="text-right">Change</th><th className="text-right">After</th><th className="pl-4 pr-5">By / note</th></tr></thead>
          <tbody className="divide-y divide-white/5">
            {data.transactions.map((t) => (
              <tr key={t.id} className="text-silver-200">
                <td className="px-5 py-2 text-xs text-silver-400">{dateTime(t.created_at)}</td><td>{titleCase(t.reason)}</td>
                <td className={cx('text-right tabular-nums', t.delta < 0 ? 'text-red-300' : 'text-emerald-300')}>{t.delta > 0 ? '+' : ''}{fmt(t.delta)}</td>
                <td className="text-right tabular-nums">{fmt(t.quantity_after)}</td>
                <td className="pl-4 pr-5 text-xs text-silver-400">{t.order_number ? `Order #${t.order_number}` : t.created_by_name ?? ''}{t.note ? ` · ${t.note}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function CreateModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', unit: 'g', quantity: '', low: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="Add ingredient" size="sm" footer={<Button className="w-full" loading={busy} onClick={async () => {
      setBusy(true); setError(null);
      try { await api('/admin/inventory', { body: { name: f.name, unit: f.unit, quantity: Number(f.quantity) || 0, low_stock_threshold: Number(f.low) || 0 } }); setF({ name: '', unit: 'g', quantity: '', low: '' }); onSaved(); }
      catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
    }}>Create</Button>}>
      <div className="space-y-4 p-5">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Unit"><Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{['g', 'kg', 'ml', 'L', 'pcs'].map((u) => <option key={u}>{u}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Opening stock"><Input type="number" min={0} step="any" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="Alert at"><Input type="number" min={0} step="any" value={f.low} onChange={(e) => setF({ ...f, low: e.target.value })} /></Field>
        </div>
        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}
