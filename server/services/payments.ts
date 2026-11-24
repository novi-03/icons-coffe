/**
 * Payments. Online payments use Stripe Checkout and are marked PAID only after
 * the payment is verified with Stripe (by retrieving the Checkout Session from
 * the Stripe API, or via a signature-verified webhook). Nothing here simulates a
 * successful card payment.
 */
import Stripe from 'stripe';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { config, stripeConfigured } from '../config.js';
import { withCtx } from '../db.js';
import { systemCtx } from '../auth.js';
import { HttpError, conflict, notFound } from '../lib/errors.js';

let stripeClient: Stripe | null = null;

export function stripe(): Stripe {
  if (!stripeConfigured()) {
    throw new HttpError(503, 'PAYMENT_NOT_CONFIGURED',
      'Online payment is not available yet (STRIPE_SECRET_KEY is not configured). Please choose cash at table or pay at counter.');
  }
  if (!stripeClient) {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    stripeClient = new Stripe(config.stripe.secretKey, {
      httpAgent: proxy ? new HttpsProxyAgent(proxy) : undefined,
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: 'ICONS Coffee RMS' },
    });
  }
  return stripeClient;
}

const CHECKOUT_TTL_MIN = 30;

/**
 * Starts (or resumes) Stripe Checkout for an AWAITING_PAYMENT online order.
 * Idempotent: an open session for the order is reused instead of creating a second payment.
 */
export async function startOnlinePayment(restaurantId: string, orderId: string, returnPath: string) {
  const sys = systemCtx(restaurantId);
  const { order, existing } = await withCtx(sys, async (tx) => {
    const o = (await tx.query(`select o.*, t.number as table_number from orders o join restaurant_tables t on t.id = o.table_id where o.id = $1`, [orderId])).rows[0];
    if (!o) throw notFound('Order not found');
    const p = (await tx.query(`select * from payments where order_id = $1 and status in ('PENDING','PROCESSING','PAID')`, [orderId])).rows[0];
    return { order: o, existing: p };
  });
  if (order.payment_method !== 'ONLINE') throw conflict('This order is not set up for online payment');
  if (existing?.status === 'PAID') return { status: 'PAID' as const, checkoutUrl: null, paymentId: existing.id };
  if (order.status !== 'AWAITING_PAYMENT') throw conflict('This order no longer accepts online payment');

  if (existing?.status === 'PROCESSING' && existing.provider_session_id) {
    const s = await stripe().checkout.sessions.retrieve(existing.provider_session_id);
    if (s.status === 'open' && s.url) return { status: 'PROCESSING' as const, checkoutUrl: s.url, paymentId: existing.id };
    const verified = await verifyOnlinePayment(restaurantId, existing.id);
    if (verified === 'PAID') return { status: 'PAID' as const, checkoutUrl: null, paymentId: existing.id };
  }

  // Create the payment record first so we have a stable id + transaction reference.
  const payment = await withCtx(sys, async (tx) => {
    const again = (await tx.query(`select * from payments where order_id = $1 and status in ('PENDING','PROCESSING','PAID')`, [orderId])).rows[0];
    if (again) return again;
    return (await tx.query(
      `insert into payments (restaurant_id, order_id, method, status, amount_fils, provider) values ($1,$2,'ONLINE','PENDING',$3,'stripe') returning *`,
      [restaurantId, orderId, order.total_fils])).rows[0];
  });
  if (payment.status !== 'PENDING') {
    if (payment.checkout_url) return { status: payment.status, checkoutUrl: payment.checkout_url, paymentId: payment.id };
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.create({
      mode: 'payment',
      currency: 'aed',
      // Charge exactly the AED order total (no automatic currency conversion), so verification can match amounts 1:1.
      adaptive_pricing: { enabled: false },
      client_reference_id: payment.id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'aed',
          unit_amount: payment.amount_fils,
          product_data: { name: `ICONS Coffee · Order #${order.order_number} · Table ${String(order.table_number).padStart(2, '0')}` },
        },
      }],
      metadata: { payment_id: payment.id, order_id: orderId, restaurant_id: restaurantId, transaction_ref: payment.transaction_ref },
      payment_intent_data: { metadata: { payment_id: payment.id, order_id: orderId, transaction_ref: payment.transaction_ref } },
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_MIN * 60,
      success_url: `${config.publicUrl}${returnPath}?payment=${payment.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.publicUrl}${returnPath}?payment=${payment.id}&cancelled=1`,
    }, { idempotencyKey: `icons-checkout-${payment.id}` });
  } catch (e: any) {
    await withCtx(sys, (tx) => tx.query(`update payments set status = 'FAILED', failure_reason = $2 where id = $1 and status = 'PENDING'`,
      [payment.id, `Could not start checkout: ${e?.message ?? 'payment provider error'}`.slice(0, 300)]));
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'The payment provider could not start checkout. Please try again or choose another payment method.');
  }
  await withCtx(sys, (tx) => tx.query(
    `update payments set status = 'PROCESSING', provider_session_id = $2, checkout_url = $3 where id = $1 and status = 'PENDING'`,
    [payment.id, session.id, session.url]));
  return { status: 'PROCESSING' as const, checkoutUrl: session.url, paymentId: payment.id };
}

/** Asks Stripe for the truth about a payment and records it. Returns the resulting status. */
export async function verifyOnlinePayment(restaurantId: string, paymentId: string): Promise<string> {
  const sys = systemCtx(restaurantId);
  const p = await withCtx(sys, async (tx) => (await tx.query(`select * from payments where id = $1`, [paymentId])).rows[0]);
  if (!p) throw notFound('Payment not found');
  if (p.method !== 'ONLINE' || !p.provider_session_id) return p.status;
  if (!['PENDING', 'PROCESSING', 'CANCELLED', 'FAILED'].includes(p.status)) return p.status;

  const s = await stripe().checkout.sessions.retrieve(p.provider_session_id);
  const genuine = s.metadata?.payment_id === p.id && s.amount_total === p.amount_fils && (s.currency ?? '').toLowerCase() === 'aed';
  if (s.payment_status === 'paid' && genuine) {
    if (p.status === 'CANCELLED' || p.status === 'FAILED') {
      // Money was captured after we gave up on the session — record it on a fresh payment row so it is never lost.
      await withCtx(sys, async (tx) => {
        const upd = await tx.query(
          `update payments set failure_reason = coalesce(failure_reason, '') || ' — LATE PAYMENT CAPTURED AT PROVIDER'
           where id = $1 and coalesce(failure_reason, '') not like '%LATE PAYMENT%' returning order_id`, [p.id]);
        if (upd.rowCount) {
          await tx.query(`select app.notify(app.rid(), null, 'admin', 'PAYMENT_UPDATE', 'Late online payment needs review',
            $1, $2, null, jsonb_build_object('paymentId', $3::text))`,
            [`Stripe captured ${(p.amount_fils / 100).toFixed(2)} AED for ${p.transaction_ref} after checkout was abandoned. Refund or reconcile in Stripe.`, p.order_id, p.id]);
        }
      });
      console.warn(`[payments] Stripe session ${s.id} paid after payment ${p.id} was ${p.status}; flagged for admin review`);
      return p.status;
    }
    await withCtx(sys, (tx) => tx.query(
      `update payments set status = 'PAID', provider_payment_id = $2 where id = $1 and status in ('PENDING','PROCESSING')`,
      [p.id, typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null]));
    return 'PAID';
  }
  if (s.payment_status === 'paid' && !genuine) {
    console.error(`[payments] Stripe session ${s.id} does not match payment ${p.id} (amount/currency/metadata) — not marking paid`);
    return p.status;
  }
  if (s.status === 'expired' && (p.status === 'PROCESSING' || p.status === 'PENDING')) {
    await withCtx(sys, (tx) => tx.query(
      `update payments set status = 'FAILED', failure_reason = 'Checkout session expired before payment' where id = $1 and status in ('PENDING','PROCESSING')`, [p.id]));
    return 'FAILED';
  }
  return p.status;
}

/** Abandon the open online checkout (if not already paid). Returns true if the order turned out to be paid. */
export async function abandonOnlinePayment(restaurantId: string, orderId: string): Promise<boolean> {
  const sys = systemCtx(restaurantId);
  const p = await withCtx(sys, async (tx) =>
    (await tx.query(`select * from payments where order_id = $1 and method = 'ONLINE' and status in ('PENDING','PROCESSING','PAID')`, [orderId])).rows[0]);
  if (!p) return false;
  if (p.status === 'PAID') return true;
  if (p.provider_session_id && stripeConfigured()) {
    const status = await verifyOnlinePayment(restaurantId, p.id);
    if (status === 'PAID') return true;
    try {
      const s = await stripe().checkout.sessions.retrieve(p.provider_session_id);
      if (s.status === 'open') await stripe().checkout.sessions.expire(p.provider_session_id);
    } catch (e: any) {
      // If the session completed in the meantime, verification below will catch it.
      const again = await verifyOnlinePayment(restaurantId, p.id);
      if (again === 'PAID') return true;
      console.warn('[payments] could not expire session', e?.message);
    }
  }
  await withCtx(sys, (tx) => tx.query(
    `update payments set status = 'CANCELLED', failure_reason = 'Customer changed payment method' where id = $1 and status in ('PENDING','PROCESSING')`, [p.id]));
  return false;
}

export async function refundPayment(restaurantId: string, adminId: string, paymentId: string) {
  const ctx = { role: 'admin' as const, restaurantId, userId: adminId };
  const p = await withCtx(ctx, async (tx) => (await tx.query(`select * from payments where id = $1`, [paymentId])).rows[0]);
  if (!p) throw notFound('Payment not found');
  if (p.status !== 'PAID') throw conflict(`Only paid payments can be refunded (this one is ${p.status})`);
  if (p.method === 'ONLINE' && !p.is_demo) {
    if (!p.provider_payment_id) throw conflict('This online payment has no provider reference to refund');
    await stripe().refunds.create({ payment_intent: p.provider_payment_id, metadata: { payment_id: p.id } },
      { idempotencyKey: `icons-refund-${p.id}` });
  }
  await withCtx(ctx, (tx) => tx.query(`update payments set status = 'REFUNDED' where id = $1 and status = 'PAID'`, [p.id]));
}

export function constructWebhookEvent(raw: Buffer, signature: string | undefined) {
  if (!config.stripe.webhookSecret) throw new HttpError(503, 'WEBHOOK_NOT_CONFIGURED', 'STRIPE_WEBHOOK_SECRET is not configured');
  if (!signature) throw new HttpError(400, 'BAD_SIGNATURE', 'Missing Stripe-Signature header');
  try {
    return stripe().webhooks.constructEvent(raw, signature, config.stripe.webhookSecret);
  } catch {
    throw new HttpError(400, 'BAD_SIGNATURE', 'Invalid webhook signature');
  }
}
