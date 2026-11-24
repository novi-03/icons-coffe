import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banknote, CreditCard, Minus, Pencil, Plus, ShoppingBag, Store, Trash2 } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { money, pct } from '../lib/format';
import type { MenuItem, Order, PaymentMethod } from '../lib/types';
import { Button, Card, cx, EmptyState, ErrorBanner, Textarea } from '../components/ui';
import { useCustomer } from './CustomerApp';
import ItemSheet from './ItemSheet';
import { computeTotals, lineProblem, newKey, unitPrice, type CartLine } from './cart';

export default function CartPage() {
  const { ctx, menu, cart, setCart, reloadOrders, reloadMenu } = useCustomer();
  const nav = useNavigate();
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: MenuItem; line: CartLine } | null>(null);

  // One idempotency key per distinct cart: retries (double taps, network errors) can never create a second order.
  const signature = JSON.stringify([cart.map((l) => [l.menu_item_id, l.quantity, l.variant_ids, l.special_instructions]), method, notes.trim()]);
  const [idemKey, setIdemKey] = useState(newKey);
  useEffect(() => { setIdemKey(newKey()); }, [signature]);

  const itemsById = useMemo(() => new Map((menu?.items ?? []).map((i) => [i.id, i])), [menu]);
  const lines = cart.map((l) => {
    const item = itemsById.get(l.menu_item_id);
    const unit = item ? unitPrice(item, l.variant_ids) : 0;
    return { line: l, item, unit, problem: menu ? lineProblem(item, l) : null };
  });
  const subtotal = lines.reduce((s, l) => s + l.unit * l.line.quantity, 0);
  const r = ctx.restaurant;
  const totals = computeTotals(subtotal, r);
  const hasProblems = lines.some((l) => l.problem);

  if (cart.length === 0) {
    return <EmptyState icon={<ShoppingBag className="h-7 w-7" />} title="Your cart is empty" body="Browse the menu and add something delicious."
      action={<Link to="/menu"><Button>Browse menu</Button></Link>} />;
  }

  const updateQty = (key: string, delta: number) =>
    setCart((c) => c.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.min(20, l.quantity + delta)) } : l)));

  const placeOrder = async () => {
    if (!method) return setError('Please choose how you would like to pay.');
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ order: Order; checkout?: { checkoutUrl: string | null; error?: string } | null; duplicate?: boolean }>('/guest/orders', {
        body: {
          idempotency_key: idemKey, payment_method: method, notes: notes.trim() || undefined,
          items: cart.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity, variant_ids: l.variant_ids, special_instructions: l.special_instructions })),
        },
      });
      setCart(() => []);
      reloadOrders();
      if (method === 'ONLINE' && res.checkout?.checkoutUrl) {
        window.location.assign(res.checkout.checkoutUrl);
        return;
      }
      nav(`/order/${res.order.id}${res.checkout?.error ? '?payment_error=1' : ''}`);
    } catch (e) {
      setError(errMsg(e));
      reloadMenu();
    } finally {
      setBusy(false);
    }
  };

  const methods: { id: PaymentMethod; title: string; body: string; icon: React.ReactNode; disabled?: string }[] = [
    { id: 'ONLINE', title: 'Pay online now', body: 'Card, Apple Pay or Google Pay via secure checkout', icon: <CreditCard className="h-5 w-5" />,
      disabled: ctx.online_payment_available ? undefined : 'Online payment is not available right now' },
    { id: 'CASH', title: 'Cash at table', body: 'Pay your waiter when your order is served', icon: <Banknote className="h-5 w-5" /> },
    { id: 'COUNTER', title: 'Pay at counter', body: 'Pay at the counter before you leave', icon: <Store className="h-5 w-5" /> },
  ];

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-bold text-white">Your order</h1>
      <Card className="divide-y divide-white/5">
        {lines.map(({ line, item, unit, problem }) => (
          <div key={line.key} className="flex gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-white">{item?.name ?? 'Unavailable item'}</div>
              {item && line.variant_ids.length > 0 && (
                <div className="mt-0.5 text-xs text-silver-400">{item.variants.filter((v) => line.variant_ids.includes(v.id)).map((v) => v.name).join(' · ')}</div>
              )}
              {line.special_instructions && <div className="mt-1 text-xs italic text-amber-200/90">“{line.special_instructions}”</div>}
              {problem && <div className="mt-1 text-xs font-semibold text-red-300">{problem}</div>}
              <div className="mt-2 flex items-center gap-2">
                <div className="flex items-center rounded-xl bg-ink-900 ring-1 ring-white/10">
                  <button aria-label="Decrease" className="flex h-8 w-8 items-center justify-center disabled:opacity-30" disabled={line.quantity <= 1} onClick={() => updateQty(line.key, -1)}><Minus className="h-3.5 w-3.5" /></button>
                  <span className="w-6 text-center text-sm font-semibold">{line.quantity}</span>
                  <button aria-label="Increase" className="flex h-8 w-8 items-center justify-center disabled:opacity-30" disabled={line.quantity >= 20} onClick={() => updateQty(line.key, 1)}><Plus className="h-3.5 w-3.5" /></button>
                </div>
                {item && item.variants.length > 0 && (
                  <button className="flex h-8 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-silver-300 hover:bg-white/5" onClick={() => setEditing({ item, line })}><Pencil className="h-3.5 w-3.5" />Edit</button>
                )}
                <button className="flex h-8 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-red-300 hover:bg-red-500/10" onClick={() => setCart((c) => c.filter((l) => l.key !== line.key))}><Trash2 className="h-3.5 w-3.5" />Remove</button>
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-white">{money(unit * line.quantity)}</div>
              {line.quantity > 1 && <div className="text-xs text-silver-500">{money(unit)} each</div>}
            </div>
          </div>
        ))}
      </Card>

      <div>
        <label htmlFor="order-notes" className="mb-2 block text-sm font-semibold text-white">Note for the kitchen <span className="font-normal text-silver-500">(optional)</span></label>
        <Textarea id="order-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergies, timing (e.g. bring drinks first)…" />
      </div>

      <Card className="space-y-2 p-4 text-sm">
        <Row label="Subtotal" value={money(totals.subtotal)} />
        {r.service_charge_bps > 0 && <Row label={`Service charge (${pct(r.service_charge_bps)})`} value={money(totals.service)} />}
        <Row label={r.prices_include_tax ? `Includes VAT (${pct(r.vat_rate_bps)})` : `VAT (${pct(r.vat_rate_bps)})`} value={money(totals.tax)} muted={r.prices_include_tax} />
        <div className="flex items-center justify-between border-t border-white/10 pt-3 font-display text-lg font-bold text-white"><span>Total</span><span>{money(totals.total)}</span></div>
      </Card>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-white">How would you like to pay?</h2>
        <div className="space-y-2" role="radiogroup" aria-label="Payment method">
          {methods.map((m) => (
            <button key={m.id} role="radio" aria-checked={method === m.id} disabled={!!m.disabled} onClick={() => setMethod(m.id)}
              className={cx('flex w-full items-center gap-3 rounded-2xl p-4 text-left ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-40',
                method === m.id ? 'bg-brand-500/15 ring-brand-500/60' : 'bg-navy-900/70 ring-white/10 hover:bg-navy-800')}>
              <div className={cx('rounded-xl p-2.5', method === m.id ? 'bg-brand-500 text-white' : 'bg-white/5 text-silver-300')}>{m.icon}</div>
              <div className="flex-1">
                <div className="font-semibold text-white">{m.title}</div>
                <div className="text-xs text-silver-400">{m.disabled ?? m.body}</div>
              </div>
              <span className={cx('h-5 w-5 rounded-full ring-2 ring-inset', method === m.id ? 'bg-brand-500 ring-brand-300' : 'ring-silver-600')} />
            </button>
          ))}
        </div>
      </section>

      {!r.status.isOpen && <ErrorBanner message={`We are not taking orders right now (${r.status.label}).`} />}
      <ErrorBanner message={error} />
      {hasProblems && <ErrorBanner message="Some items in your cart need attention before you can order." />}

      <Button size="xl" className="w-full" loading={busy} disabled={!method || hasProblems || !r.status.isOpen} onClick={placeOrder}>
        {method === 'ONLINE' ? `Continue to payment · ${money(totals.total)}` : `Place order · ${money(totals.total)}`}
      </Button>
      <p className="pb-4 text-center text-xs text-silver-500">Ordering for Table {String(ctx.table.number).padStart(2, '0')}. Your order goes straight to our kitchen.</p>

      <ItemSheet item={editing?.item ?? null} editing={editing?.line} onClose={() => setEditing(null)} />
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return <div className={cx('flex items-center justify-between', muted ? 'text-silver-500' : 'text-silver-300')}><span>{label}</span><span className="tabular-nums">{value}</span></div>;
}
