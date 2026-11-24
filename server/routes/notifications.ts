import { Router } from 'express';
import { z } from 'zod';
import { withCtx } from '../db.js';
import { requireStaff, staffCtx } from '../auth.js';
import { idParam, parse } from '../lib/http.js';
import { notFound } from '../lib/errors.js';

/** Notifications for the signed-in staff member (RLS limits rows to their user or role). */
export const notificationsRouter = Router();
notificationsRouter.use(requireStaff());

notificationsRouter.get('/', async (req, res) => {
  const q = parse(z.object({ unread: z.enum(['1', '0']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
  const data = await withCtx(staffCtx(req), async (tx) => ({
    notifications: (await tx.query(`select n.*, t.number as table_number from notifications n left join restaurant_tables t on t.id = n.table_id
      ${q.unread === '1' ? 'where n.read_at is null' : ''} order by n.created_at desc limit $1`, [q.limit])).rows,
    unread: (await tx.query(`select count(*)::int as c from notifications where read_at is null`)).rows[0].c,
  }));
  res.json(data);
});

notificationsRouter.post('/read-all', async (req, res) => {
  await withCtx(staffCtx(req), (tx) => tx.query(`update notifications set read_at = now() where read_at is null`));
  res.json({ ok: true });
});

notificationsRouter.post('/:id/:action', async (req, res) => {
  const id = idParam(req);
  const action = parse(z.enum(['read', 'ack']), req.params.action);
  const r = await withCtx(staffCtx(req), (tx) => tx.query(
    action === 'read'
      ? `update notifications set read_at = coalesce(read_at, now()) where id = $1 returning id`
      : `update notifications set read_at = coalesce(read_at, now()), acknowledged_at = coalesce(acknowledged_at, now()) where id = $1 returning id`, [id]));
  if (!r.rowCount) throw notFound('Notification not found');
  res.json({ ok: true });
});
