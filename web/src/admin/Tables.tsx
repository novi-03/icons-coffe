import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Plus, Printer, QrCode, RefreshCw, Trash2, Users } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { money } from '../lib/format';
import { useData } from '../lib/hooks';
import { Badge, Button, Card, ConfirmDialog, cx, ErrorBanner, Field, Input, Logo, Modal, OrderStatusBadge, PageLoader, Select, Toggle, useToast } from '../components/ui';
import { useLive } from './AdminApp';
import { OrderDetail } from './Orders';

type T = {
  id: string; number: number; label: string | null; seats: number; zone: string | null; is_active: boolean; is_demo: boolean; qr_url: string; qr_token: string;
  assigned_waiter_id: string | null; assigned_waiter_name: string | null; active_orders: number; current_bill_fils: number; active_total_fils: number;
  orders: { id: string; order_number: string; status: any; payment_status: string; total_fils: number }[] | null; open_requests: number; occupancy: 'AVAILABLE' | 'OCCUPIED' | 'DISABLED';
};

export default function Tables() {
  const { data, error, reload, softReload } = useData(() => api<{ tables: T[] }>('/admin/tables'), []);
  const staff = useData(() => api<{ staff: { id: string; full_name: string; role: string; is_active: boolean }[] }>('/admin/staff'), []);
  useLive(['order.changed', 'table.changed', 'payment.changed', 'request.changed'], softReload);
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [printing, setPrinting] = useState(false);
  if (!data) return error ? <ErrorBanner message={error} onRetry={reload} /> : <PageLoader />;
  const t = data.tables.find((x) => x.id === sel) ?? null;
  const waiters = (staff.data?.staff ?? []).filter((s) => s.role === 'waiter' && s.is_active);
  const count = (o: T['occupancy']) => data.tables.filter((x) => x.occupancy === o).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone="green" className="px-3 py-1">{count('AVAILABLE')} available</Badge>
          <Badge tone="violet" className="px-3 py-1">{count('OCCUPIED')} occupied</Badge>
          <Badge tone="neutral" className="px-3 py-1">{count('DISABLED')} disabled</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setPrinting(true)}><Printer className="h-4 w-4" />Print all QR codes</Button>
          <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Add table</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {data.tables.map((x) => (
          <button key={x.id} onClick={() => setSel(x.id)} className="text-left">
            <Card className={cx('h-full p-4 transition hover:ring-brand-500/40',
              x.occupancy === 'OCCUPIED' && 'ring-brand-500/40', x.occupancy === 'DISABLED' && 'opacity-50')}>
              <div className="flex items-start justify-between">
                <div className="font-display text-2xl font-extrabold text-white">T{String(x.number).padStart(2, '0')}</div>
                <Badge tone={x.occupancy === 'OCCUPIED' ? 'violet' : x.occupancy === 'AVAILABLE' ? 'green' : 'neutral'}>{x.occupancy.toLowerCase()}</Badge>
              </div>
              <div className="mt-1 text-xs text-silver-500">{x.zone ?? '—'} · {x.seats} seats</div>
              <div className="mt-3 space-y-1 text-xs">
                <div className="flex items-center gap-1.5 text-silver-300"><Users className="h-3.5 w-3.5" />{x.assigned_waiter_name ?? <span className="text-silver-500">No waiter</span>}</div>
                {x.orders?.length ? <div className="text-silver-300">{x.orders.map((o) => `#${o.order_number}`).join(', ')}</div> : null}
                {x.current_bill_fils > 0 && <div className="font-semibold text-amber-200">Bill due {money(x.current_bill_fils)}</div>}
                {x.open_requests > 0 && <Badge tone="amber">{x.open_requests} request{x.open_requests > 1 ? 's' : ''}</Badge>}
              </div>
            </Card>
          </button>
        ))}
      </div>
      <TableDrawer t={t} waiters={waiters} onClose={() => setSel(null)} reload={reload} />
      <TableCreate open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} nextNumber={Math.max(0, ...data.tables.map((x) => x.number)) + 1} />
      {printing && <PrintSheet tables={data.tables.filter((x) => x.is_active)} onClose={() => setPrinting(false)} />}
    </div>
  );
}

function TableDrawer({ t, waiters, onClose, reload }: { t: T | null; waiters: { id: string; full_name: string }[]; onClose: () => void; reload: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ label: '', seats: '4', zone: '', number: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'regen' | 'delete' | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [qrBust, setQrBust] = useState(0);
  useEffect(() => { if (t) setF({ label: t.label ?? '', seats: String(t.seats), zone: t.zone ?? '', number: String(t.number) }); }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return null;
  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(k);
    try { await fn(); toast({ tone: 'success', title: ok }); reload(); } catch (e) { toast({ tone: 'error', title: 'Failed', body: errMsg(e) }); } finally { setBusy(null); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={<span>Table {String(t.number).padStart(2, '0')} {t.is_demo && <Badge tone="amber" className="ml-2">DEMO</Badge>}</span>}>
      <div className="grid gap-6 p-5 md:grid-cols-[1fr_240px]">
        <div className="space-y-5">
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-silver-400">Active orders</h4>
            {t.orders?.length ? t.orders.map((o) => (
              <button key={o.id} onClick={() => setOrderId(o.id)} className="mb-2 flex w-full items-center justify-between rounded-xl bg-ink-900 px-3 py-2 text-sm ring-1 ring-white/5 hover:ring-brand-500/40">
                <span className="font-semibold text-white">#{o.order_number}</span><span className="flex items-center gap-2"><span className="tabular-nums text-silver-300">{money(o.total_fils)}</span><OrderStatusBadge status={o.status} /></span>
              </button>
            )) : <div className="text-sm text-silver-500">No active orders.</div>}
            <div className="mt-2 text-sm text-silver-300">Current bill (unpaid): <span className="font-semibold text-white">{money(t.current_bill_fils)}</span></div>
          </section>
          <section>
            <Field label="Assigned waiter">
              <Select value={t.assigned_waiter_id ?? ''} disabled={busy === 'waiter'} onChange={(e) => run('waiter', () => api(`/admin/tables/${t.id}/waiter`, { method: 'PUT', body: { waiter_id: e.target.value || null } }), 'Waiter assignment updated')}>
                <option value="">— Unassigned (all on-duty waiters notified) —</option>
                {waiters.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
              </Select>
            </Field>
          </section>
          <section className="grid grid-cols-2 gap-3">
            <Field label="Number"><Input type="number" min={1} max={999} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
            <Field label="Seats"><Input type="number" min={1} max={50} value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} /></Field>
            <Field label="Label"><Input value={f.label} maxLength={40} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
            <Field label="Zone"><Input value={f.zone} maxLength={40} onChange={(e) => setF({ ...f, zone: e.target.value })} /></Field>
          </section>
          <div className="flex flex-wrap items-center gap-3">
            <Button loading={busy === 'save'} onClick={() => run('save', () => api(`/admin/tables/${t.id}`, { method: 'PATCH', body: { number: Number(f.number), seats: Number(f.seats), label: f.label || null, zone: f.zone || null } }), 'Table saved')}>Save changes</Button>
            <label className="flex items-center gap-2 text-sm text-silver-300">
              <Toggle checked={t.is_active} label="Table enabled" onChange={(v) => run('active', () => api(`/admin/tables/${t.id}`, { method: 'PATCH', body: { is_active: v } }), v ? 'Table enabled' : 'Table disabled — its QR code stops accepting orders')} />
              {t.is_active ? 'Enabled' : 'Disabled'}
            </label>
            <Button variant="ghost" className="ml-auto text-red-300" onClick={() => setConfirm('delete')}><Trash2 className="h-4 w-4" />Delete</Button>
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl bg-white p-3"><img src={`/api/admin/tables/${t.id}/qr.png?v=${t.qr_token}${qrBust}`} alt={`QR code for table ${t.number}`} className="w-full" /></div>
          <div className="break-all rounded-xl bg-ink-900 px-3 py-2 font-mono text-[11px] text-silver-400 ring-1 ring-white/5">{t.qr_url}</div>
          <div className="grid grid-cols-2 gap-2">
            <a href={`/api/admin/tables/${t.id}/qr.png?download=1`}><Button size="sm" variant="secondary" className="w-full"><Download className="h-4 w-4" />PNG</Button></a>
            <a href={`/api/admin/tables/${t.id}/qr.svg?download=1`}><Button size="sm" variant="secondary" className="w-full"><Download className="h-4 w-4" />SVG</Button></a>
          </div>
          <Button size="sm" variant="outline" className="w-full" onClick={() => setConfirm('regen')}><RefreshCw className="h-4 w-4" />Regenerate QR code</Button>
          <a href={t.qr_url} target="_blank" rel="noreferrer" className="block text-center text-xs font-semibold text-brand-300 hover:underline"><QrCode className="mr-1 inline h-3.5 w-3.5" />Open as customer</a>
        </div>
      </div>
      <ConfirmDialog open={confirm === 'regen'} onClose={() => setConfirm(null)} title="Regenerate QR code?" tone="warning" confirmLabel="Regenerate"
        body="The old printed QR code for this table will stop working immediately. Print the new one." onConfirm={async () => { await api(`/admin/tables/${t.id}/regenerate-qr`, { method: 'POST' }); setQrBust((n) => n + 1); reload(); }} />
      <ConfirmDialog open={confirm === 'delete'} onClose={() => setConfirm(null)} title={`Delete table ${t.number}?`} tone="danger" confirmLabel="Delete"
        body="Tables with order history cannot be deleted — disable them instead." onConfirm={async () => { await api(`/admin/tables/${t.id}`, { method: 'DELETE' }); onClose(); reload(); }} />
      <OrderDetail id={orderId} onClose={() => setOrderId(null)} onChanged={reload} />
    </Modal>
  );
}

function TableCreate({ open, onClose, onSaved, nextNumber }: { open: boolean; onClose: () => void; onSaved: () => void; nextNumber: number }) {
  const [f, setF] = useState({ number: '', seats: '4', zone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setF({ number: String(nextNumber), seats: '4', zone: '' }); setError(null); } }, [open, nextNumber]);
  return (
    <Modal open={open} onClose={onClose} title="Add table" size="sm" footer={<Button className="w-full" loading={busy} onClick={async () => {
      setBusy(true); setError(null);
      try { await api('/admin/tables', { body: { number: Number(f.number), seats: Number(f.seats), zone: f.zone || null } }); onSaved(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
    }}>Create table & QR code</Button>}>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Table number"><Input type="number" min={1} max={999} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
          <Field label="Seats"><Input type="number" min={1} max={50} value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} /></Field>
        </div>
        <Field label="Zone (optional)"><Input value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} placeholder="Indoor, Terrace…" /></Field>
        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}

function PrintSheet({ tables, onClose }: { tables: T[]; onClose: () => void }) {
  useEffect(() => {
    document.body.classList.add('printing');
    return () => document.body.classList.remove('printing');
  }, []);
  return createPortal(
    <div className="print-sheet fixed inset-0 z-[80] overflow-auto bg-white text-black">
      <div className="no-print sticky top-0 flex items-center justify-between gap-3 border-b bg-white p-4">
        <span className="font-semibold">{tables.length} table QR codes · print or save as PDF</span>
        <div className="flex gap-2"><Button onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
      <div className="grid grid-cols-2 gap-6 p-6 sm:grid-cols-3 print:grid-cols-3">
        {tables.map((t) => (
          <div key={t.id} className="flex break-inside-avoid flex-col items-center rounded-2xl border-2 border-neutral-200 p-4 text-center">
            <div className="rounded-lg bg-[#0d1126] px-3 py-1"><Logo size="sm" /></div>
            <div className="mt-3 text-sm font-semibold uppercase tracking-widest text-neutral-500">Scan to order</div>
            <img src={`/api/admin/tables/${t.id}/qr.png?v=${t.qr_token}`} alt="" className="my-2 w-44" />
            <div className="text-3xl font-extrabold tracking-wide">TABLE {String(t.number).padStart(2, '0')}</div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
