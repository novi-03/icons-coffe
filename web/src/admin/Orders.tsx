import { useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { dateTime, localDate, money, time, titleCase } from '../lib/format';
import { useData } from '../lib/hooks';
import type { Order, OrderStatus } from '../lib/types';
import { Badge, Button, Card, ConfirmDialog, cx, ErrorBanner, Input, METHOD_LABEL, Modal, ORDER_STATUS_LABEL, OrderStatusBadge, PageLoader, PaymentStatusBadge, Select, Stars, useToast } from '../components/ui';
import { useLive } from './AdminApp';

const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { RECEIVED: 'ACCEPTED', ACCEPTED: 'PREPARING', PREPARING: 'READY', READY: 'SERVED', SERVED: 'COMPLETED' };

export default function Orders() {
  const [f, setF] = useState({ search: '', status: '', group: '', payment_status: '', payment_method: '', from: localDate(-6), to: localDate(), page: 1 });
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, reload, softReload } = useData(() => api<{ orders: Order[]; total: number; page: number; page_size: number }>('/admin/orders', { query: { ...f, page_size: 25 } }), [JSON.stringify(f)]);
  useLive(['order.changed', 'payment.changed'], softReload);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, page: 1, ...p }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="space-y-4">
      <Card className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-7">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-500" />
          <Input className="pl-9" placeholder="Order #, table no. or TXN ref" value={f.search} onChange={(e) => set({ search: e.target.value })} aria-label="Search orders" />
        </div>
        <Select value={f.group || f.status} onChange={(e) => { const v = e.target.value; set(v === 'active' || v === 'closed' ? { group: v, status: '' } : { status: v, group: '' }); }} aria-label="Order status">
          <option value="">All statuses</option><option value="active">Active (in progress)</option><option value="closed">Closed</option>
          {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={f.payment_status} onChange={(e) => set({ payment_status: e.target.value })} aria-label="Payment status">
          <option value="">Any payment status</option>{['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </Select>
        <Select value={f.payment_method} onChange={(e) => set({ payment_method: e.target.value })} aria-label="Payment method">
          <option value="">Any method</option><option value="ONLINE">Online</option><option value="CASH">Cash</option><option value="COUNTER">Counter</option>
        </Select>
        <Input type="date" aria-label="From date" value={f.from} max={f.to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        <Input type="date" aria-label="To date" value={f.to} min={f.from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
      </Card>
      <ErrorBanner message={error} onRetry={reload} />
      <Card className="overflow-hidden">
        {!data ? <PageLoader /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-white/5 text-left text-xs uppercase tracking-wider text-silver-500">
                <tr><th className="px-4 py-3">Order ID</th><th>Table</th><th>Order time</th><th>Items</th><th className="text-right">Total</th><th className="pl-6">Payment method</th><th>Payment</th><th className="pr-4">Order status</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.orders.map((o) => (
                  <tr key={o.id} onClick={() => setOpenId(o.id)} className="cursor-pointer text-silver-200 transition hover:bg-white/[.03]">
                    <td className="px-4 py-3 font-semibold text-white">#{o.order_number}{o.is_demo && <Badge tone="amber" className="ml-2">DEMO</Badge>}</td>
                    <td>T{String(o.table_number).padStart(2, '0')}</td>
                    <td className="whitespace-nowrap text-silver-400">{dateTime(o.created_at)}</td>
                    <td className="max-w-[260px] truncate text-silver-300">{o.items.map((i) => `${i.quantity}× ${i.item_name}`).join(', ')}</td>
                    <td className="text-right tabular-nums text-white">{money(o.total_fils)}</td>
                    <td className="pl-6">{o.payment_method && METHOD_LABEL[o.payment_method]}</td>
                    <td>{o.payment_status && <PaymentStatusBadge status={o.payment_status} />}</td>
                    <td className="pr-4"><OrderStatusBadge status={o.status} />{!!o.open_issues && <Badge tone="red" className="ml-1">issue</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.orders.length && <div className="p-10 text-center text-sm text-silver-500">No orders match these filters</div>}
          </div>
        )}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between border-t border-white/5 px-4 py-3 text-sm text-silver-400">
            <span>{data.total.toLocaleString()} orders · page {data.page} of {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={f.page <= 1} onClick={() => setF((x) => ({ ...x, page: x.page - 1 }))}><ChevronLeft className="h-4 w-4" />Prev</Button>
              <Button size="sm" variant="secondary" disabled={f.page >= pages} onClick={() => setF((x) => ({ ...x, page: x.page + 1 }))}>Next<ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </Card>
      <OrderDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}

export function OrderDetail({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data, error, reload, softReload } = useData(() => (id ? api(`/admin/orders/${id}`) : Promise.resolve(null)), [id]);
  useLive(['order.changed', 'payment.changed'], softReload);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast({ tone: 'success', title: ok }); reload(); onChanged(); } catch (e) { toast({ tone: 'error', title: 'Action failed', body: errMsg(e) }); } finally { setBusy(null); }
  };
  const o: Order | undefined = data?.order;
  const next = o ? NEXT[o.status] : undefined;
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={o ? <span>Order #{o.order_number} <span className="ml-2 align-middle"><OrderStatusBadge status={o.status} /></span></span> : 'Order'}>
      {!data ? (error ? <div className="p-5"><ErrorBanner message={error} /></div> : <PageLoader />) : o && (
        <div className="space-y-5 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Info label="Table" value={`T${String(o.table_number).padStart(2, '0')}`} />
            <Info label="Placed" value={dateTime(o.created_at)} />
            <Info label="Waiter" value={o.serving_waiter_name ?? o.assigned_waiter_name ?? '—'} />
            <Info label="Priority" value={o.priority === 'RUSH' ? 'Rush' : 'Normal'} />
          </div>
          {o.cancel_reason && <ErrorBanner message={`Cancelled: ${o.cancel_reason}`} />}
          <div className="rounded-xl ring-1 ring-white/5">
            {o.items.map((it) => (
              <div key={it.id} className="flex justify-between gap-3 border-b border-white/5 px-4 py-2.5 last:border-0">
                <div><span className="font-semibold text-white">{it.quantity}× {it.item_name}</span>
                  {it.options.length > 0 && <div className="text-xs text-silver-400">{it.options.map((x) => x.name).join(' · ')}</div>}
                  {it.special_instructions && <div className="text-xs italic text-amber-200">“{it.special_instructions}”</div>}</div>
                <span className="tabular-nums">{money(it.line_total_fils)}</span>
              </div>
            ))}
            <div className="space-y-1 bg-ink-900/60 px-4 py-3">
              <Line l="Subtotal" v={money(o.subtotal_fils)} />{!!o.service_charge_fils && <Line l="Service charge" v={money(o.service_charge_fils)} />}
              <Line l={o.prices_include_tax ? 'VAT (included)' : 'VAT'} v={money(o.tax_fils)} />
              <div className="flex justify-between font-display font-bold text-white"><span>Total</span><span>{money(o.total_fils)}</span></div>
            </div>
          </div>
          {o.notes && <div className="rounded-xl bg-amber-500/10 px-4 py-2 text-amber-100">Note: {o.notes}</div>}

          <section>
            <h4 className="mb-2 font-semibold text-white">Payments</h4>
            <div className="space-y-2">
              {data.payments.map((p: any) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ink-900 px-4 py-2.5 ring-1 ring-white/5">
                  <div>
                    <div className="font-semibold text-white">{p.transaction_ref} · {METHOD_LABEL[p.method as keyof typeof METHOD_LABEL]}</div>
                    <div className="text-xs text-silver-400">{money(p.amount_fils)}{p.paid_at ? ` · paid ${dateTime(p.paid_at)}` : ''}{p.confirmed_by_name ? ` · confirmed by ${p.confirmed_by_name}` : ''}{p.provider_payment_id ? ` · ${p.provider_payment_id}` : ''}{p.failure_reason ? ` · ${p.failure_reason}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <PaymentStatusBadge status={p.status} />
                    {p.status === 'PENDING' && p.method !== 'ONLINE' && <Button size="xs" variant="success" loading={busy === 'pay'} onClick={() => run('pay', () => api(`/admin/payments/${p.id}/confirm`, { method: 'POST' }), 'Payment confirmed')}>Confirm paid</Button>}
                    {p.status === 'PAID' && <Button size="xs" variant="outline" loading={busy === 'refund'} onClick={() => run('refund', () => api(`/admin/payments/${p.id}/refund`, { method: 'POST' }), 'Payment refunded')}>Refund</Button>}
                  </div>
                </div>
              ))}
              {!data.payments.length && <div className="text-silver-500">No payment records yet.</div>}
            </div>
          </section>

          {data.issues.length > 0 && (
            <section>
              <h4 className="mb-2 font-semibold text-white">Service issues</h4>
              {data.issues.map((i: any) => (
                <div key={i.id} className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-red-500/10 px-4 py-2.5 ring-1 ring-red-500/20">
                  <div><div className="font-semibold text-red-100">{titleCase(i.type)} · {i.reported_by_name}</div><div className="text-xs text-red-200/80">{i.note} · {time(i.created_at)}</div></div>
                  {i.status === 'OPEN' ? <Button size="xs" variant="secondary" onClick={() => run('issue', () => api(`/admin/issues/${i.id}/resolve`, { method: 'POST' }), 'Issue resolved')}>Resolve</Button> : <Badge tone="green">Resolved</Badge>}
                </div>
              ))}
            </section>
          )}

          {data.review && <section><h4 className="mb-1 font-semibold text-white">Customer review</h4><Stars value={data.review.rating} /> {data.review.comment && <p className="text-silver-300">“{data.review.comment}”</p>}</section>}

          <section>
            <h4 className="mb-2 font-semibold text-white">Order history</h4>
            <ol className="space-y-1.5 border-l border-white/10 pl-4">
              {data.events.map((e: any) => (
                <li key={e.id} className="relative text-xs text-silver-300">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-brand-400" />
                  <span className="text-silver-500">{dateTime(e.created_at)}</span> · {e.event_type === 'STATUS_CHANGED' ? `${titleCase(e.from_status)} → ${titleCase(e.to_status)}` : titleCase(e.event_type)}
                  {' '}<span className="text-silver-500">by {e.actor_name ?? e.actor_role}</span>
                  {e.details?.reason && <span className="text-red-300"> · {e.details.reason}</span>}
                </li>
              ))}
            </ol>
          </section>

          {!['COMPLETED', 'CANCELLED'].includes(o.status) && (
            <div className={cx('flex flex-wrap gap-2 border-t border-white/5 pt-4')}>
              {next && o.status !== 'AWAITING_PAYMENT' && (
                <Button loading={busy === 'next'} disabled={next === 'COMPLETED' && o.payment_status !== 'PAID'} title={next === 'COMPLETED' && o.payment_status !== 'PAID' ? 'Confirm payment first' : ''}
                  onClick={() => run('next', () => api(`/admin/orders/${o.id}/status`, { body: { status: next } }), `Order marked ${ORDER_STATUS_LABEL[next].toLowerCase()}`)}>
                  Mark as {ORDER_STATUS_LABEL[next]}
                </Button>
              )}
              {o.status !== 'SERVED' && <Button variant="danger" onClick={() => setCancel(true)}>Cancel order</Button>}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog open={cancel} onClose={() => setCancel(false)} title={`Cancel order #${o?.order_number}?`} tone="danger" confirmLabel="Cancel order"
        body={o?.payment_status === 'PAID' ? 'This order is already paid — refund the payment after cancelling.' : 'Pending payments for this order will be cancelled.'}
        input={{ label: 'Reason', required: true, minLength: 3, placeholder: 'e.g. Customer left' }}
        onConfirm={async (reason) => { await api(`/admin/orders/${o!.id}/cancel`, { body: { reason } }); toast({ tone: 'success', title: 'Order cancelled' }); reload(); onChanged(); }} />
    </Modal>
  );
}

const Info = ({ label, value }: { label: string; value: string }) => <div className="rounded-xl bg-ink-900 px-3 py-2 ring-1 ring-white/5"><div className="text-[11px] uppercase tracking-wider text-silver-500">{label}</div><div className="font-semibold text-white">{value}</div></div>;
const Line = ({ l, v }: { l: string; v: string }) => <div className="flex justify-between text-silver-400"><span>{l}</span><span>{v}</span></div>;
