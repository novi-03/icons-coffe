import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Banknote, Check, ChefHat, CircleCheckBig, Clock, CreditCard, HandPlatter, Inbox, Star, Store, ThumbsUp, XCircle } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { money, time } from '../lib/format';
import { useData } from '../lib/hooks';
import type { Order, OrderStatus, PaymentMethod } from '../lib/types';
import { Badge, Button, Card, ConfirmDialog, cx, ErrorBanner, METHOD_LABEL, PageLoader, PaymentStatusBadge, Textarea, useToast } from '../components/ui';
import { useCustomer } from './CustomerApp';

type Payment = { id: string; method: PaymentMethod; status: string; amount_fils: number; transaction_ref: string; paid_at: string | null; failure_reason: string | null };

const STEPS: { status: OrderStatus; label: string; icon: React.ElementType; at: keyof Order }[] = [
  { status: 'RECEIVED', label: 'Order received', icon: Inbox, at: 'submitted_at' },
  { status: 'ACCEPTED', label: 'Accepted', icon: ThumbsUp, at: 'accepted_at' },
  { status: 'PREPARING', label: 'Preparing', icon: ChefHat, at: 'preparing_at' },
  { status: 'READY', label: 'Ready', icon: CircleCheckBig, at: 'ready_at' },
  { status: 'SERVED', label: 'Served', icon: HandPlatter, at: 'served_at' },
  { status: 'COMPLETED', label: 'Completed', icon: Check, at: 'completed_at' },
];
const HEADLINE: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Complete payment to send your order to the kitchen',
  RECEIVED: 'We have your order — the kitchen will accept it shortly',
  ACCEPTED: 'The kitchen has accepted your order',
  PREPARING: 'Your order is being prepared',
  READY: 'Your order is ready — a waiter is bringing it now',
  SERVED: 'Enjoy! Your order has been served',
  COMPLETED: 'All done — thank you for visiting',
  CANCELLED: 'This order was cancelled',
};

export default function OrderPage() {
  const { orderId } = useParams();
  const [params, setParams] = useSearchParams();
  const { subscribe, reloadOrders } = useCustomer();
  const toast = useToast();
  const { data, error, reload, softReload, loading } = useData(() => api<{ order: Order; payments: Payment[] }>(`/guest/orders/${orderId}`), [orderId]);
  const [verifying, setVerifying] = useState(false);
  const [payBusy, setPayBusy] = useState<PaymentMethod | null>(null);
  const [payError, setPayError] = useState<string | null>(params.get('payment_error') ? 'We could not start online payment. Try again or choose another method.' : null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const verifiedOnce = useRef(false);

  useEffect(() => subscribe((e) => { if (e.t === 'resync' || e.o === orderId) softReload(); }), [subscribe, orderId, softReload]);

  // Returning from Stripe Checkout: verify with the server (which asks Stripe). Never trust the redirect alone.
  useEffect(() => {
    const sessionReturn = params.get('session_id');
    if (!sessionReturn || verifiedOnce.current) return;
    verifiedOnce.current = true;
    setVerifying(true);
    let tries = 0;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ status: string; order: Order }>(`/guest/orders/${orderId}/verify-payment`, { method: 'POST' });
        if (r.status === 'PAID' || r.status === 'FAILED' || ++tries >= 10) {
          setVerifying(false);
          reload();
          reloadOrders();
          if (r.status === 'PAID') toast({ tone: 'success', title: 'Payment confirmed', body: 'Your order has been sent to the kitchen.' });
          setParams({}, { replace: true });
          return;
        }
      } catch (e) {
        if (++tries >= 10) { setVerifying(false); setPayError(errMsg(e)); return; }
      }
      if (!stop) window.setTimeout(tick, 2500);
    };
    tick();
    return () => { stop = true; };
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <PageLoader label="Loading your order…" />;
  if (error && !data) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return null;
  const { order, payments } = data;
  const currentIdx = STEPS.findIndex((s) => s.status === order.status);
  const activePayment = payments.find((p) => ['PENDING', 'PROCESSING', 'PAID'].includes(p.status));
  const eta = order.accepted_at ? new Date(new Date(order.accepted_at).getTime() + order.est_prep_minutes * 60000).toISOString() : null;

  const pay = async (method: PaymentMethod) => {
    setPayBusy(method); setPayError(null);
    try {
      const r = await api<{ checkout?: { checkoutUrl: string | null } }>(`/guest/orders/${order.id}/payment`, { body: { method } });
      if (method === 'ONLINE' && r.checkout?.checkoutUrl) { window.location.assign(r.checkout.checkoutUrl); return; }
      reload(); reloadOrders();
    } catch (e) { setPayError(errMsg(e)); } finally { setPayBusy(null); }
  };

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Order #{order.order_number} · Table {String(order.table_number).padStart(2, '0')}</div>
            <h1 className="mt-2 font-display text-xl font-bold leading-snug text-white" aria-live="polite">{HEADLINE[order.status]}</h1>
          </div>
          {order.status === 'CANCELLED' ? <XCircle className="h-8 w-8 shrink-0 text-red-400" /> : order.status === 'READY' ? <CircleCheckBig className="h-8 w-8 shrink-0 animate-pulse text-emerald-400" /> : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-silver-300">
          <Badge tone="silver"><Clock className="h-3 w-3" /> Placed {time(order.created_at)}</Badge>
          {['RECEIVED', 'ACCEPTED', 'PREPARING'].includes(order.status) && (
            <Badge tone="violet">{eta ? `Estimated ready ~${time(eta)}` : `Estimated prep ~${order.est_prep_minutes} min`}</Badge>
          )}
          {order.payment_status && <PaymentStatusBadge status={order.payment_status} />}
        </div>
        {order.status === 'CANCELLED' && order.cancel_reason && <p className="mt-3 text-sm text-red-200">{order.cancel_reason}</p>}
      </Card>

      {verifying && <Card className="flex items-center gap-3 p-4 text-sm text-silver-200"><span className="h-3 w-3 animate-ping rounded-full bg-brand-400" />Confirming your payment with the payment provider…</Card>}
      {params.get('cancelled') && order.status === 'AWAITING_PAYMENT' && <ErrorBanner message="Payment was not completed. You can try again or choose to pay with cash or at the counter." />}

      {order.status === 'AWAITING_PAYMENT' && !verifying && (
        <Card className="space-y-3 p-4">
          <div className="font-semibold text-white">Payment required · {money(order.total_fils)}</div>
          <p className="text-sm text-silver-400">Your order is saved but has not been sent to the kitchen yet.</p>
          <ErrorBanner message={payError} />
          <Button className="w-full" size="lg" loading={payBusy === 'ONLINE'} disabled={!!payBusy} onClick={() => pay('ONLINE')}><CreditCard className="h-5 w-5" />Pay online now</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" loading={payBusy === 'CASH'} disabled={!!payBusy} onClick={() => pay('CASH')}><Banknote className="h-4 w-4" />Cash at table</Button>
            <Button variant="secondary" loading={payBusy === 'COUNTER'} disabled={!!payBusy} onClick={() => pay('COUNTER')}><Store className="h-4 w-4" />Pay at counter</Button>
          </div>
          <button className="w-full pt-1 text-center text-xs font-semibold text-silver-500 hover:text-red-300" onClick={() => setCancelOpen(true)}>Cancel this order</button>
        </Card>
      )}

      {order.status !== 'CANCELLED' && order.status !== 'AWAITING_PAYMENT' && (
        <Card className="p-5">
          <ol className="relative space-y-0" aria-label="Order progress">
            {STEPS.map((s, i) => {
              const done = i <= currentIdx;
              const current = i === currentIdx;
              const at = order[s.at] as string | null;
              return (
                <li key={s.status} className="relative flex gap-4 pb-6 last:pb-0">
                  {i < STEPS.length - 1 && <span className={cx('absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-0.5', i < currentIdx ? 'bg-brand-500' : 'bg-white/10')} />}
                  <span className={cx('relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-2 transition',
                    done ? 'bg-brand-500 text-white ring-brand-300/40' : 'bg-ink-900 text-silver-600 ring-white/10', current && 'shadow-glow')}>
                    <s.icon className="h-5 w-5" />
                  </span>
                  <div className="pt-2">
                    <div className={cx('font-semibold', done ? 'text-white' : 'text-silver-500')}>{s.label}{current && <span className="ml-2 text-xs font-medium text-brand-300">● now</span>}</div>
                    {at && <div className="text-xs text-silver-400">{time(at)}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <Card className="divide-y divide-white/5">
        {order.items.map((it) => (
          <div key={it.id} className="flex justify-between gap-3 p-4 text-sm">
            <div>
              <div className="font-semibold text-white">{it.quantity} × {it.item_name}</div>
              {it.options.length > 0 && <div className="text-xs text-silver-400">{it.options.map((o) => o.name).join(' · ')}</div>}
              {it.special_instructions && <div className="text-xs italic text-amber-200/90">“{it.special_instructions}”</div>}
            </div>
            <div className="text-silver-200">{money(it.line_total_fils)}</div>
          </div>
        ))}
        <div className="space-y-1.5 p-4 text-sm">
          <div className="flex justify-between text-silver-300"><span>Subtotal</span><span>{money(order.subtotal_fils)}</span></div>
          {!!order.service_charge_fils && <div className="flex justify-between text-silver-300"><span>Service charge</span><span>{money(order.service_charge_fils)}</span></div>}
          <div className="flex justify-between text-silver-500"><span>{order.prices_include_tax ? 'Includes VAT' : 'VAT'}</span><span>{money(order.tax_fils)}</span></div>
          <div className="flex justify-between pt-1 font-display text-base font-bold text-white"><span>Total</span><span>{money(order.total_fils)}</span></div>
          <div className="flex items-center justify-between pt-2 text-xs text-silver-400">
            <span>{order.payment_method && METHOD_LABEL[order.payment_method]}{activePayment ? ` · Ref ${activePayment.transaction_ref}` : ''}</span>
            {order.payment_status && <PaymentStatusBadge status={order.payment_status} />}
          </div>
          {order.payment_status === 'PENDING' && order.payment_method !== 'ONLINE' && order.status !== 'CANCELLED' && (
            <p className="pt-1 text-xs text-amber-200/80">{order.payment_method === 'CASH' ? 'Please pay your waiter in cash — they will confirm it in the system.' : 'Please pay at the counter before you leave.'}</p>
          )}
        </div>
      </Card>

      {(order.status === 'SERVED' || order.status === 'COMPLETED') && <ReviewBox order={order} onDone={reload} />}

      <div className="flex gap-2 pb-4">
        <Link to="/menu" className="flex-1"><Button variant="secondary" className="w-full">Order more</Button></Link>
        <Link to="/service" className="flex-1"><Button variant="outline" className="w-full">Call waiter / bill</Button></Link>
      </div>

      <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this order?" tone="danger" confirmLabel="Cancel order"
        body="Your order has not been sent to the kitchen. Any unfinished online checkout will be closed."
        onConfirm={async () => { await api(`/guest/orders/${order.id}/cancel`, { method: 'POST' }); reload(); reloadOrders(); }} />
    </div>
  );
}

function ReviewBox({ order, onDone }: { order: Order; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (order.review) {
    return (
      <Card className="p-4">
        <div className="text-sm font-semibold text-white">Thanks for your review!</div>
        <div className="mt-1 text-amber-400">{'★'.repeat(order.review.rating)}<span className="text-silver-600">{'★'.repeat(5 - order.review.rating)}</span></div>
        {order.review.comment && <p className="mt-1 text-sm text-silver-300">“{order.review.comment}”</p>}
      </Card>
    );
  }
  return (
    <Card className="space-y-3 p-4">
      <div className="font-display text-lg font-semibold text-white">How was everything?</div>
      <div className="flex gap-1" role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} role="radio" aria-checked={rating === i} aria-label={`${i} star${i > 1 ? 's' : ''}`} onClick={() => setRating(i)}
            className={cx('rounded-lg p-1 transition active:scale-90', i <= rating ? 'text-amber-400' : 'text-silver-600 hover:text-silver-400')}>
            <Star className="h-9 w-9" fill={i <= rating ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
      <Textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Tell us about your food and service (optional)" />
      <ErrorBanner message={error} />
      <Button className="w-full" disabled={!rating} loading={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await api(`/guest/orders/${order.id}/review`, { body: { rating, comment: comment.trim() || undefined } }); onDone(); }
        catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
      }}>Submit review</Button>
    </Card>
  );
}
