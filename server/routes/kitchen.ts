import { Router } from 'express';
import { z } from 'zod';
import { withCtx } from '../db.js';
import { requireStaff, staffCtx } from '../auth.js';
import { idParam, parse } from '../lib/http.js';
import { conflict, notFound } from '../lib/errors.js';
import { getOrder, orderSelect } from '../services/orders.js';

export const kitchenRouter = Router();
kitchenRouter.use(requireStaff('kitchen', 'admin'));

kitchenRouter.get('/orders', async (req, res) => {
  const data = await withCtx(staffCtx(req), async (tx) => {
    const active = (await tx.query(`${orderSelect('kitchen')}
      where o.status in ('RECEIVED','ACCEPTED','PREPARING','READY')
      order by (o.priority = 'RUSH') desc, o.submitted_at asc nulls last limit 200`)).rows;
    const done = (await tx.query(`${orderSelect('kitchen')}
      where o.status in ('SERVED','COMPLETED','CANCELLED') and o.updated_at > now() - interval '8 hours'
        and o.submitted_at is not null
      order by coalesce(o.served_at, o.cancelled_at, o.updated_at) desc limit 40`)).rows;
    const r = (await tx.query(`select timezone, delay_grace_minutes from restaurants where id = app.rid()`)).rows[0];
    return { active, completed: done, timezone: r.timezone, delay_grace_minutes: r.delay_grace_minutes, server_time: new Date().toISOString() };
  });
  res.json(data);
});

kitchenRouter.post('/orders/:id/status', async (req, res) => {
  const id = idParam(req);
  const { status } = parse(z.object({ status: z.enum(['ACCEPTED', 'PREPARING', 'READY']) }), req.body ?? {});
  const expectedFrom = { ACCEPTED: 'RECEIVED', PREPARING: 'ACCEPTED', READY: 'PREPARING' }[status];
  const order = await withCtx(staffCtx(req), async (tx) => {
    const cur = (await tx.query(`select status, order_number from orders where id = $1 for update`, [id])).rows[0];
    if (!cur) throw notFound('Order not found');
    if (cur.status === status) return getOrder(tx, 'kitchen', id); // idempotent (double tap)
    if (cur.status !== expectedFrom) throw conflict(`Order #${cur.order_number} is ${cur.status.toLowerCase()} and cannot be marked ${status.toLowerCase()}`, 'INVALID_TRANSITION');
    await tx.query(`update orders set status = $2 where id = $1`, [id, status]);
    return getOrder(tx, 'kitchen', id);
  });
  res.json({ order });
});

kitchenRouter.post('/orders/:id/reject', async (req, res) => {
  const id = idParam(req);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body ?? {});
  const order = await withCtx(staffCtx(req), async (tx) => {
    const cur = (await tx.query(`select status from orders where id = $1 for update`, [id])).rows[0];
    if (!cur) throw notFound('Order not found');
    if (cur.status !== 'RECEIVED') throw conflict('Only new orders can be rejected by the kitchen. Ask a manager to cancel orders in progress.', 'INVALID_TRANSITION');
    await tx.query(`update orders set status = 'CANCELLED', cancel_reason = $2 where id = $1`, [id, `Kitchen: ${reason}`]);
    return getOrder(tx, 'kitchen', id);
  });
  res.json({ order });
});

kitchenRouter.post('/orders/:id/priority', async (req, res) => {
  const id = idParam(req);
  const { priority } = parse(z.object({ priority: z.enum(['NORMAL', 'RUSH']) }), req.body ?? {});
  const order = await withCtx(staffCtx(req), async (tx) => {
    const r = await tx.query(`update orders set priority = $2 where id = $1 and status in ('RECEIVED','ACCEPTED','PREPARING') returning id`, [id, priority]);
    if (!r.rowCount) throw conflict('Priority can only be changed while the order is being prepared');
    return getOrder(tx, 'kitchen', id);
  });
  res.json({ order });
});
