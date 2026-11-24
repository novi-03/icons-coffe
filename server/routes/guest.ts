import { Router } from 'express';
import { z } from 'zod';
import { rawQuery, withCtx } from '../db.js';
import { config, stripeConfigured } from '../config.js';
import { GUEST_COOKIE, guestCtx, issueGuestCookie, requireGuest, systemCtx, verifyGuestToken } from '../auth.js';
import { clientIp, idParam, parse, rateLimiter, uuid } from '../lib/http.js';
import { HttpError, badRequest, conflict, notFound } from '../lib/errors.js';
import { computeTotals } from '../lib/pricing.js';
import { loadMenu, loadRestaurant, publicRestaurant } from '../services/restaurant.js';
import { getOrder, orderSelect } from '../services/orders.js';
import { abandonOnlinePayment, startOnlinePayment, verifyOnlinePayment } from '../services/payments.js';

export const guestRouter = Router();
const sessionLimit = rateLimiter(30, 60_000);
const orderLimit = rateLimiter(12, 60_000);
const requestLimit = rateLimiter(20, 60_000);

/** QR entry: identifies restaurant + table from the token printed on the table. */
guestRouter.post('/session', async (req, res) => {
  const { qr_token } = parse(z.object({ qr_token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'invalid QR code') }), req.body ?? {});
  sessionLimit(clientIp(req));
  const t = (await rawQuery('select * from app.resolve_qr($1)', [qr_token])).rows[0];
  if (!t) throw new HttpError(404, 'UNKNOWN_QR', 'This QR code is not recognised. Please ask a member of staff for help.');
  if (!t.is_active) throw new HttpError(409, 'TABLE_DISABLED', `Table ${t.number} is not taking orders right now. Please ask a member of staff.`);

  // Reuse the current session if it is still valid for the same table.
  const current = await verifyGuestToken(req.cookies?.[GUEST_COOKIE]);
  let sessionId = current && current.tableId === t.table_id ? current.guestSessionId : null;
  if (!sessionId) {
    const g = await withCtx(systemCtx(t.restaurant_id), async (tx) => (await tx.query(
      `insert into guest_sessions (restaurant_id, table_id, user_agent) values ($1,$2,$3) returning id, restaurant_id, table_id`,
      [t.restaurant_id, t.table_id, String(req.headers['user-agent'] ?? '').slice(0, 300)])).rows[0]);
    issueGuestCookie(res, g);
    sessionId = g.id;
  }
  const ctx = { role: 'guest' as const, restaurantId: t.restaurant_id, guestSessionId: sessionId };
  const data = await withCtx(ctx, async (tx) => ({
    restaurant: publicRestaurant(await loadRestaurant(tx)),
    table: (await tx.query(`select id, number, label, zone, seats from restaurant_tables where id = $1`, [t.table_id])).rows[0],
  }));
  res.json({ ...data, demo_mode: config.demoMode, online_payment_available: stripeConfigured() });
});

guestRouter.use(requireGuest);

guestRouter.get('/context', async (req, res) => {
  const data = await withCtx(guestCtx(req), async (tx) => {
    await tx.query(`update guest_sessions set last_seen_at = now() where id = app.guest()`);
    return {
      restaurant: publicRestaurant(await loadRestaurant(tx)),
      table: (await tx.query(`select id, number, label, zone, seats from restaurant_tables where id = $1`, [req.guest!.tableId])).rows[0],
    };
  });
  res.json({ ...data, demo_mode: config.demoMode, online_payment_available: stripeConfigured() });
});

guestRouter.get('/menu', async (req, res) => {
  res.json(await withCtx(guestCtx(req), (tx) => loadMenu(tx)));
});

const orderSchema = z.object({
  idempotency_key: z.string().min(8).max(80),
  payment_method: z.enum(['ONLINE', 'CASH', 'COUNTER']),
  notes: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    menu_item_id: uuid,
    quantity: z.number().int().min(1).max(20),
    variant_ids: z.array(uuid).max(20).default([]),
    special_instructions: z.string().trim().max(300).optional(),
  })).min(1, 'your cart is empty').max(30),
});

guestRouter.post('/orders', async (req, res) => {
  const body = parse(orderSchema, req.body ?? {});
  const ctx = guestCtx(req);
  const existing = await withCtx(ctx, async (tx) => {
    const r = await tx.query(`select id from orders where guest_session_id = app.guest() and idempotency_key = $1`, [body.idempotency_key]);
    return r.rows[0] ? getOrder(tx, 'guest', r.rows[0].id) : null;
  });
  if (existing) return res.json({ order: existing, duplicate: true });
  orderLimit(req.guest!.guestSessionId);
  if (body.payment_method === 'ONLINE' && !stripeConfigured()) {
    throw new HttpError(503, 'PAYMENT_NOT_CONFIGURED', 'Online payment is not available right now. Please choose cash at table or pay at counter.');
  }

  let order: any;
  try {
    order = await withCtx(ctx, async (tx) => {
      const restaurant = publicRestaurant(await loadRestaurant(tx));
      if (!restaurant.status.isOpen) throw new HttpError(409, 'RESTAURANT_CLOSED', `Sorry, we are not taking orders right now (${restaurant.status.label}).`);
      const ids = [...new Set(body.items.map((i) => i.menu_item_id))];
      const rows = (await tx.query(
        `select i.id, i.name, i.price_fils, i.prep_minutes, i.is_available, i.is_archived, c.is_active as category_active
         from menu_items i join menu_categories c on c.id = i.category_id where i.id = any($1::uuid[])`, [ids])).rows;
      const variants = (await tx.query(`select * from product_variants where menu_item_id = any($1::uuid[])`, [ids])).rows;
      const lines = body.items.map((line) => {
        const item = rows.find((r) => r.id === line.menu_item_id);
        if (!item || item.is_archived || !item.category_active) throw badRequest('One of the items in your cart is no longer on the menu. Please review your cart.');
        if (!item.is_available) throw conflict(`Sorry, ${item.name} is currently unavailable. Please remove it from your cart.`, 'ITEM_UNAVAILABLE');
        const own = variants.filter((v) => v.menu_item_id === item.id);
        if (new Set(line.variant_ids).size !== line.variant_ids.length) throw badRequest(`Duplicate options selected for ${item.name}`);
        const chosen = line.variant_ids.map((id) => {
          const v = own.find((x) => x.id === id);
          if (!v) throw badRequest(`An option selected for ${item.name} is not valid`);
          if (!v.is_available) throw conflict(`The option "${v.name}" for ${item.name} is currently unavailable`, 'OPTION_UNAVAILABLE');
          return v;
        });
        // Exactly one choice per size/variation group; extras are optional and multiple.
        const groups = new Set(own.filter((v) => v.kind !== 'EXTRA').map((v) => `${v.kind}:${v.group_name}`));
        for (const g of groups) {
          const n = chosen.filter((v) => `${v.kind}:${v.group_name}` === g).length;
          if (n !== 1) throw badRequest(`Please choose one ${g.split(':')[1]} for ${item.name}`);
        }
        const unit = item.price_fils + chosen.reduce((s, v) => s + v.price_delta_fils, 0);
        if (unit < 0) throw badRequest(`Invalid price for ${item.name}`);
        return { item, line, chosen, unit };
      });
      const subtotal = lines.reduce((s, l) => s + l.unit * l.line.quantity, 0);
      const totals = computeTotals(subtotal, restaurant);
      if (totals.total <= 0) throw badRequest('Order total must be greater than zero');
      const status = body.payment_method === 'ONLINE' ? 'AWAITING_PAYMENT' : 'RECEIVED';
      const o = (await tx.query(
        `insert into orders (restaurant_id, table_id, guest_session_id, idempotency_key, status, payment_method, subtotal_fils,
           service_charge_fils, tax_fils, total_fils, vat_rate_bps, service_charge_bps, prices_include_tax, est_prep_minutes, notes)
         values (app.rid(), $1, app.guest(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
        [req.guest!.tableId, body.idempotency_key, status, body.payment_method, totals.subtotal, totals.service, totals.tax, totals.total,
          restaurant.vat_rate_bps, restaurant.service_charge_bps, restaurant.prices_include_tax,
          Math.max(...lines.map((l) => l.item.prep_minutes)), body.notes || null])).rows[0];
      for (const [position, l] of lines.entries()) {
        await tx.query(
          `insert into order_items (order_id, restaurant_id, menu_item_id, item_name, unit_price_fils, quantity, options, special_instructions, line_total_fils, prep_minutes, position)
           values ($1, app.rid(), $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [o.id, l.item.id, l.item.name, l.unit, l.line.quantity,
            JSON.stringify(l.chosen.map((v) => ({ id: v.id, kind: v.kind, group: v.group_name, name: v.name, price_delta_fils: v.price_delta_fils }))),
            l.line.special_instructions || null, l.unit * l.line.quantity, l.item.prep_minutes, position]);
      }
      if (body.payment_method !== 'ONLINE') {
        await tx.query(`insert into payments (restaurant_id, order_id, method, status, amount_fils) values (app.rid(), $1, $2, 'PENDING', $3)`,
          [o.id, body.payment_method, totals.total]);
      }
      return { id: o.id };
    });
  } catch (e: any) {
    if (e?.code === '23505' && e?.constraint === 'orders_idempotency_uq') {
      // A concurrent duplicate submission won the race — return that order.
      const dup = await withCtx(ctx, async (tx) => {
        const r = await tx.query(`select id from orders where guest_session_id = app.guest() and idempotency_key = $1`, [body.idempotency_key]);
        return r.rows[0] ? getOrder(tx, 'guest', r.rows[0].id) : null;
      });
      if (dup) return res.json({ order: dup, duplicate: true });
    }
    throw e;
  }

  let checkout: { checkoutUrl: string | null; error?: string } | null = null;
  if (body.payment_method === 'ONLINE') {
    try {
      const r = await startOnlinePayment(req.guest!.restaurantId, order.id, `/order/${order.id}`);
      checkout = { checkoutUrl: r.checkoutUrl };
    } catch (e: any) {
      checkout = { checkoutUrl: null, error: e?.message ?? 'Could not start online payment' };
    }
  }
  const full = await withCtx(ctx, (tx) => getOrder(tx, 'guest', order.id));
  res.status(201).json({ order: full, checkout });
});

guestRouter.get('/orders', async (req, res) => {
  const rows = await withCtx(guestCtx(req), async (tx) =>
    (await tx.query(`${orderSelect('guest')} where o.guest_session_id = app.guest() order by o.created_at desc limit 20`)).rows);
  res.json({ orders: rows });
});

guestRouter.get('/orders/:id', async (req, res) => {
  const id = idParam(req);
  const data = await withCtx(guestCtx(req), async (tx) => {
    const order = await getOrder(tx, 'guest', id);
    if (!order) return null;
    const payments = (await tx.query(
      `select id, method, status, amount_fils, transaction_ref, paid_at, failure_reason, created_at from payments where order_id = $1 order by created_at desc`, [id])).rows;
    return { order, payments };
  });
  if (!data) throw notFound('Order not found');
  res.json(data);
});

/** Retry online payment or switch an unpaid online order to cash / counter. */
guestRouter.post('/orders/:id/payment', async (req, res) => {
  const id = idParam(req);
  const { method } = parse(z.object({ method: z.enum(['ONLINE', 'CASH', 'COUNTER']) }), req.body ?? {});
  const order = await withCtx(guestCtx(req), (tx) => getOrder(tx, 'guest', id));
  if (!order) throw notFound('Order not found');
  const rid = req.guest!.restaurantId;
  if (order.status !== 'AWAITING_PAYMENT') {
    throw conflict(order.payment_status === 'PAID' ? 'This order is already paid' : 'Payment method can only be changed before the order is sent to the kitchen');
  }
  if (method === 'ONLINE') {
    const r = await startOnlinePayment(rid, id, `/order/${id}`);
    return res.json({ checkout: { checkoutUrl: r.checkoutUrl }, status: r.status });
  }
  const paid = await abandonOnlinePayment(rid, id);
  if (!paid) {
    await withCtx(systemCtx(rid), async (tx) => {
      const cur = (await tx.query(`select status, total_fils from orders where id = $1 for update`, [id])).rows[0];
      if (cur.status !== 'AWAITING_PAYMENT') return;
      await tx.query(`update orders set payment_method = $2, status = 'RECEIVED' where id = $1`, [id, method]);
      await tx.query(`insert into payments (restaurant_id, order_id, method, status, amount_fils) values (app.rid(), $1, $2, 'PENDING', $3)`,
        [id, method, cur.total_fils]);
    });
  }
  const updated = await withCtx(guestCtx(req), (tx) => getOrder(tx, 'guest', id));
  res.json({ order: updated, already_paid: paid });
});

/** Called when the customer returns from Stripe Checkout — verifies with Stripe, never trusts the redirect. */
guestRouter.post('/orders/:id/verify-payment', async (req, res) => {
  const id = idParam(req);
  const payment = await withCtx(guestCtx(req), async (tx) =>
    (await tx.query(`select id from payments where order_id = $1 and method = 'ONLINE' order by created_at desc limit 1`, [id])).rows[0]);
  if (!payment) throw notFound('No online payment found for this order');
  const status = stripeConfigured() ? await verifyOnlinePayment(req.guest!.restaurantId, payment.id) : 'PENDING';
  const order = await withCtx(guestCtx(req), (tx) => getOrder(tx, 'guest', id));
  res.json({ status, order });
});

guestRouter.post('/orders/:id/cancel', async (req, res) => {
  const id = idParam(req);
  const order = await withCtx(guestCtx(req), (tx) => getOrder(tx, 'guest', id));
  if (!order) throw notFound('Order not found');
  if (order.status !== 'AWAITING_PAYMENT') throw conflict('This order has already been sent to the kitchen. Please ask a member of staff to help.');
  const rid = req.guest!.restaurantId;
  const paid = await abandonOnlinePayment(rid, id);
  if (paid) throw conflict('Your payment has already been received, so the order was sent to the kitchen.');
  await withCtx(systemCtx(rid), (tx) => tx.query(
    `update orders set status = 'CANCELLED', cancel_reason = 'Cancelled by customer before payment' where id = $1 and status = 'AWAITING_PAYMENT'`, [id]));
  res.json({ order: await withCtx(guestCtx(req), (tx) => getOrder(tx, 'guest', id)) });
});

guestRouter.post('/orders/:id/review', async (req, res) => {
  const id = idParam(req);
  const body = parse(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }), req.body ?? {});
  const review = await withCtx(guestCtx(req), async (tx) => {
    const o = await getOrder(tx, 'guest', id);
    if (!o) throw notFound('Order not found');
    return (await tx.query(
      `insert into reviews (restaurant_id, order_id, guest_session_id, rating, comment) values (app.rid(), $1, app.guest(), $2, $3)
       returning rating, comment, created_at`, [id, body.rating, body.comment || null])).rows[0];
  });
  res.status(201).json({ review });
});

guestRouter.get('/requests', async (req, res) => {
  const rows = await withCtx(guestCtx(req), async (tx) => (await tx.query(
    `select id, type, note, status, created_at, acknowledged_at, completed_at from customer_requests
     where guest_session_id = app.guest() order by created_at desc limit 20`)).rows);
  res.json({ requests: rows });
});

guestRouter.post('/requests', async (req, res) => {
  const body = parse(z.object({
    type: z.enum(['CALL_WAITER', 'REQUEST_BILL', 'REQUEST_WIFI', 'ASSISTANCE']),
    note: z.string().trim().max(300).optional(),
  }), req.body ?? {});
  requestLimit(req.guest!.guestSessionId);
  const row = await withCtx(guestCtx(req), async (tx) => (await tx.query(
    `insert into customer_requests (restaurant_id, table_id, guest_session_id, type, note) values (app.rid(), $1, app.guest(), $2, $3)
     returning id, type, note, status, created_at`, [req.guest!.tableId, body.type, body.note || null])).rows[0]);
  res.status(201).json({ request: row });
});

guestRouter.post('/requests/:id/cancel', async (req, res) => {
  const id = idParam(req);
  const r = await withCtx(guestCtx(req), (tx) => tx.query(
    `update customer_requests set status = 'CANCELLED' where id = $1 and guest_session_id = app.guest() and status in ('OPEN','ACKNOWLEDGED') returning id`, [id]));
  if (!r.rowCount) throw notFound('Request not found or already handled');
  res.json({ ok: true });
});
