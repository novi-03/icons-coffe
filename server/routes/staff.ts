import { Router } from 'express';
import { z } from 'zod';
import { withCtx, type Tx } from '../db.js';
import { requireStaff, staffCtx } from '../auth.js';
import { idParam, parse } from '../lib/http.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { getOrder, orderSelect } from '../services/orders.js';

/** Waiter / service dashboard API. Admins may use it too. */
export const staffRouter = Router();
staffRouter.use(requireStaff('waiter', 'admin'));

async function assertCanServe(tx: Tx, orderId: string) {
  const o = (await tx.query(`select o.id, o.table_id, o.serving_waiter_id, o.status, o.order_number, app.waiter_can_serve(o.table_id) as can
    from orders o where o.id = $1`, [orderId])).rows[0];
  if (!o) throw notFound('Order not found');
  if (await isWaiter(tx)) {
    if (o.serving_waiter_id && o.serving_waiter_id !== (await me(tx))) throw conflict(`Order #${o.order_number} is being handled by another waiter`, 'ORDER_TAKEN');
    if (!o.serving_waiter_id && !o.can) throw forbidden(`Table for order #${o.order_number} is assigned to another waiter`);
  }
  return o;
}
const isWaiter = async (tx: Tx) => (await tx.query(`select app.role() = 'waiter' as w`)).rows[0].w as boolean;
const me = async (tx: Tx) => (await tx.query(`select app.uid() as id`)).rows[0].id as string;

staffRouter.get('/me', async (req, res) => {
  const data = await withCtx(staffCtx(req), async (tx) => ({
    profile: (await tx.query(`select u.id, u.full_name as name, u.role, u.email, sp.is_on_duty, sp.avatar_color, sp.last_seen_at
      from users u join staff_profiles sp on sp.user_id = u.id where u.id = app.uid()`)).rows[0],
    tables: (await tx.query(`select t.id, t.number, t.label, t.zone from waiter_assignments wa join restaurant_tables t on t.id = wa.table_id
      where wa.waiter_id = app.uid() and wa.is_active order by t.number`)).rows,
  }));
  res.json(data);
});

staffRouter.post('/me/duty', async (req, res) => {
  const { on_duty } = parse(z.object({ on_duty: z.boolean() }), req.body ?? {});
  await withCtx(staffCtx(req), (tx) => tx.query(
    `update staff_profiles set is_on_duty = $1, current_activity = $2 where user_id = app.uid()`, [on_duty, on_duty ? 'On duty' : 'Offline']));
  res.json({ on_duty });
});

/** Everything the waiter needs in one call: active orders, open requests, unpaid bills. */
staffRouter.get('/board', async (req, res) => {
  const data = await withCtx(staffCtx(req), async (tx) => {
    const orders = (await tx.query(`${orderSelect('staff', 'app.waiter_can_serve(o.table_id) as can_serve')}
      where o.status in ('RECEIVED','ACCEPTED','PREPARING','READY','SERVED') and o.created_at > now() - interval '24 hours'
      order by case o.status when 'READY' then 0 when 'SERVED' then 2 else 1 end, o.ready_at asc nulls last, o.created_at asc`)).rows;
    const requests = (await tx.query(`select r.id, r.type, r.note, r.status, r.created_at, r.acknowledged_at, t.number as table_number, r.table_id,
        app.waiter_can_serve(r.table_id) as can_serve, au.full_name as acknowledged_by_name,
        (select wa.waiter_id from waiter_assignments wa where wa.table_id = r.table_id and wa.is_active) as assigned_waiter_id
      from customer_requests r join restaurant_tables t on t.id = r.table_id left join users au on au.id = r.acknowledged_by
      where r.status in ('OPEN','ACKNOWLEDGED') order by r.created_at`)).rows;
    const payments = (await tx.query(`select p.id, p.method, p.status, p.amount_fils, p.transaction_ref, p.created_at, o.id as order_id,
        o.order_number, o.status as order_status, t.number as table_number, app.waiter_can_serve(o.table_id) as can_serve
      from payments p join orders o on o.id = p.order_id join restaurant_tables t on t.id = o.table_id
      where p.status = 'PENDING' and p.method in ('CASH','COUNTER') and o.status <> 'CANCELLED' order by p.created_at`)).rows;
    const me = (await tx.query(`select app.uid() as id`)).rows[0].id;
    return { orders, requests, payments, me };
  });
  res.json(data);
});

staffRouter.post('/orders/:id/claim', async (req, res) => {
  const id = idParam(req);
  const order = await withCtx(staffCtx(req), async (tx) => {
    const o = await assertCanServe(tx, id);
    if (['COMPLETED', 'CANCELLED'].includes(o.status)) throw conflict('This order is already closed');
    await tx.query(`update orders set serving_waiter_id = app.uid() where id = $1 and serving_waiter_id is null`, [id]);
    return getOrder(tx, 'staff', id);
  });
  res.json({ order });
});

staffRouter.post('/orders/:id/collect', async (req, res) => {
  const id = idParam(req);
  const order = await withCtx(staffCtx(req), async (tx) => {
    const o = await assertCanServe(tx, id);
    if (o.status !== 'READY') throw conflict(`Order #${o.order_number} is not ready for collection (it is ${o.status.toLowerCase()})`, 'INVALID_TRANSITION');
    await tx.query(`update orders set serving_waiter_id = coalesce(serving_waiter_id, app.uid()), collected_at = coalesce(collected_at, now()) where id = $1`, [id]);
    await tx.query(`update notifications set acknowledged_at = coalesce(acknowledged_at, now()), read_at = coalesce(read_at, now())
      where order_id = $1 and type = 'ORDER_READY' and recipient_user_id = app.uid()`, [id]);
    await tx.query(`update staff_profiles set current_activity = $1 where user_id = app.uid()`, [`Collecting #${o.order_number}`]);
    return getOrder(tx, 'staff', id);
  });
  res.json({ order });
});

staffRouter.post('/orders/:id/serve', async (req, res) => {
  const id = idParam(req);
  const order = await withCtx(staffCtx(req), async (tx) => {
    const o = await assertCanServe(tx, id);
    if (o.status === 'SERVED' || o.status === 'COMPLETED') return getOrder(tx, 'staff', id); // idempotent
    if (o.status !== 'READY') throw conflict(`Order #${o.order_number} is not ready yet (it is ${o.status.toLowerCase()})`, 'INVALID_TRANSITION');
    await tx.query(`update orders set status = 'SERVED' where id = $1`, [id]);
    await tx.query(`update notifications set acknowledged_at = coalesce(acknowledged_at, now()), read_at = coalesce(read_at, now())
      where order_id = $1 and type = 'ORDER_READY' and recipient_user_id = app.uid()`, [id]);
    await tx.query(`update staff_profiles set current_activity = $1 where user_id = app.uid()`, [`Served #${o.order_number}`]);
    return getOrder(tx, 'staff', id);
  });
  res.json({ order });
});

staffRouter.post('/orders/:id/issues', async (req, res) => {
  const id = idParam(req);
  const body = parse(z.object({ type: z.enum(['MISSING_ITEM', 'SERVICE_ISSUE']), note: z.string().trim().min(3).max(500) }), req.body ?? {});
  const issue = await withCtx(staffCtx(req), async (tx) => {
    const o = (await tx.query(`select id from orders where id = $1`, [id])).rows[0];
    if (!o) throw notFound('Order not found');
    return (await tx.query(`insert into order_issues (restaurant_id, order_id, type, note, reported_by) values (app.rid(), $1, $2, $3, app.uid()) returning *`,
      [id, body.type, body.note])).rows[0];
  });
  res.status(201).json({ issue });
});

staffRouter.post('/payments/:id/confirm', async (req, res) => {
  const id = idParam(req);
  const payment = await withCtx(staffCtx(req), async (tx) => {
    const p = (await tx.query(`select p.*, o.order_number from payments p join orders o on o.id = p.order_id where p.id = $1`, [id])).rows[0];
    if (!p) throw notFound('Payment not found');
    if (p.method === 'ONLINE') throw forbidden('Online payments are confirmed automatically by the payment provider');
    if (p.status === 'PAID') return p; // idempotent
    if (p.status !== 'PENDING') throw conflict(`This payment is ${p.status.toLowerCase()} and cannot be confirmed`);
    const u = await tx.query(`update payments set status = 'PAID' where id = $1 and status = 'PENDING' returning *`, [id]);
    if (!u.rowCount) throw conflict('This payment was updated by someone else — refresh and try again');
    return u.rows[0];
  });
  res.json({ payment });
});

staffRouter.post('/requests/:id/:action', async (req, res) => {
  const id = idParam(req);
  const action = parse(z.enum(['ack', 'complete']), req.params.action);
  const row = await withCtx(staffCtx(req), async (tx) => {
    const r = (await tx.query(`select status, app.waiter_can_serve(table_id) as can from customer_requests where id = $1`, [id])).rows[0];
    if (!r) throw notFound('Request not found');
    if ((await isWaiter(tx)) && !r.can) throw forbidden('This table is assigned to another waiter');
    const target = action === 'ack' ? 'ACKNOWLEDGED' : 'COMPLETED';
    if (r.status === target) return r;
    if (r.status === 'COMPLETED' || r.status === 'CANCELLED') throw conflict(`This request is already ${r.status.toLowerCase()}`);
    if (action === 'ack' && r.status !== 'OPEN') throw conflict('This request was already acknowledged');
    const u = await tx.query(`update customer_requests set status = $2 where id = $1 and status = $3 returning *`, [id, target, r.status]);
    if (!u.rowCount) throw conflict('This request was just updated by someone else');
    return u.rows[0];
  });
  res.json({ request: row });
});
