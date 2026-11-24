import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { z } from 'zod';
import { withCtx, type Tx } from '../db.js';
import { config, stripeConfigured } from '../config.js';
import { requireStaff, staffCtx } from '../auth.js';
import { idParam, parse, uuid } from '../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { loadMenu, loadRestaurant, publicRestaurant } from '../services/restaurant.js';
import { getOrder, orderSelect } from '../services/orders.js';
import { abandonOnlinePayment, refundPayment } from '../services/payments.js';
import { toCsv } from '../lib/csv.js';

export const adminRouter = Router();
adminRouter.use(requireStaff('admin'));

const ctx = (req: Request) => staffCtx(req);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

/** Resolve a local-date range (inclusive) into UTC bounds using the restaurant timezone. */
async function range(tx: Tx, q: unknown, defaultDays = 30, maxDays = 731) {
  const { from, to } = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), q);
  const r = (await tx.query(`
    with tz as (select timezone from restaurants where id = app.rid()),
    d as (select coalesce($2::date, (now() at time zone tz.timezone)::date) as to_d, tz.timezone from tz)
    select coalesce($1::date, d.to_d - ($3::int - 1)) as from_d, d.to_d, d.timezone,
           (coalesce($1::date, d.to_d - ($3::int - 1))::timestamp at time zone d.timezone) as start_at,
           ((d.to_d + 1)::timestamp at time zone d.timezone) as end_at
    from d`, [from ?? null, to ?? null, defaultDays])).rows[0];
  if (r.from_d > r.to_d) throw badRequest('"from" must be on or before "to"');
  if ((r.to_d - r.from_d) / 86400000 > maxDays) throw badRequest(`Date range is limited to ${maxDays} days`);
  return r as { from_d: Date; to_d: Date; timezone: string; start_at: Date; end_at: Date };
}
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// A. Overview
// ---------------------------------------------------------------------------
adminRouter.get('/overview', async (req, res) => {
  const data = await withCtx(ctx(req), async (tx) => {
    const k = (await tx.query(`
      with tz as (select timezone from restaurants where id = app.rid()),
      b as (select (date_trunc('day', now() at time zone tz.timezone) at time zone tz.timezone) as today_start from tz)
      select
        (select coalesce(sum(amount_fils), 0) from payments, b where status = 'PAID' and paid_at >= b.today_start) as revenue_today,
        (select coalesce(sum(amount_fils), 0) from payments, b where status = 'PAID' and paid_at >= b.today_start - interval '1 day'
           and paid_at < now() - interval '1 day') as revenue_yesterday_same_time,
        (select count(*) from payments, b where status = 'PAID' and paid_at >= b.today_start) as paid_count_today,
        (select count(*) from payments, b where status = 'PAID' and paid_at >= b.today_start - interval '1 day'
           and paid_at < now() - interval '1 day') as paid_count_yesterday,
        (select count(*) from orders, b where submitted_at >= b.today_start and status <> 'CANCELLED') as orders_today,
        (select count(*) from orders, b where submitted_at >= b.today_start - interval '1 day' and submitted_at < now() - interval '1 day'
           and status <> 'CANCELLED') as orders_yesterday_same_time,
        (select count(*) from orders where status in ('RECEIVED','ACCEPTED','PREPARING','READY','SERVED')) as active_orders,
        (select count(*) from orders where status = 'AWAITING_PAYMENT') as awaiting_online_payment,
        (select count(*) from payments p join orders o on o.id = p.order_id where p.status in ('PENDING','PROCESSING') and o.status <> 'CANCELLED') as pending_payments,
        (select coalesce(sum(p.amount_fils), 0) from payments p join orders o on o.id = p.order_id where p.status in ('PENDING','PROCESSING') and o.status <> 'CANCELLED') as pending_payments_fils,
        (select count(distinct table_id) from orders where status in ('RECEIVED','ACCEPTED','PREPARING','READY','SERVED')) as occupied_tables,
        (select count(*) from restaurant_tables where is_active) as active_tables,
        (select count(distinct coalesce(guest_session_id::text, id::text)) from orders, b where submitted_at >= b.today_start and status <> 'CANCELLED') as customers_today,
        (select count(distinct coalesce(guest_session_id::text, id::text)) from orders, b where submitted_at >= b.today_start - interval '1 day'
           and submitted_at < now() - interval '1 day' and status <> 'CANCELLED') as customers_yesterday_same_time,
        (select count(distinct coalesce(guest_session_id::text, id::text)) from orders where submitted_at is not null and status <> 'CANCELLED') as customers_all_time,
        (select count(*) from orders where submitted_at < (select today_start from b) - interval '1 day') as history_orders,
        (select count(*) from customer_requests where status in ('OPEN','ACKNOWLEDGED')) as open_requests,
        (select count(*) from inventory_items where quantity <= low_stock_threshold) as low_stock,
        (select count(*) from order_issues where status = 'OPEN') as open_issues,
        (select round(avg(rating)::numeric, 2) from reviews where created_at > now() - interval '30 days') as rating_30d,
        (select count(*) from orders where status in ('ACCEPTED','PREPARING') and accepted_at + make_interval(mins => est_prep_minutes + (select delay_grace_minutes from restaurants where id = app.rid())) < now()) as delayed_orders
    `)).rows[0];
    const pipeline = (await tx.query(`select status, count(*)::int as c from orders where status in ('AWAITING_PAYMENT','RECEIVED','ACCEPTED','PREPARING','READY','SERVED') group by status`)).rows;
    const recent = (await tx.query(`${orderSelect('staff')} where o.submitted_at is not null or o.status = 'AWAITING_PAYMENT' order by o.created_at desc limit 8`)).rows;
    const hourly = (await tx.query(`
      with tz as (select timezone from restaurants where id = app.rid())
      select extract(hour from p.paid_at at time zone tz.timezone)::int as hour, sum(p.amount_fils)::bigint as revenue, count(*)::int as orders
      from payments p, tz where p.status = 'PAID' and p.paid_at >= date_trunc('day', now() at time zone tz.timezone) at time zone tz.timezone
      group by 1 order by 1`)).rows;
    const top = (await tx.query(`
      with tz as (select timezone from restaurants where id = app.rid())
      select oi.item_name as name, sum(oi.quantity)::int as qty, sum(oi.line_total_fils)::bigint as revenue
      from order_items oi join orders o on o.id = oi.order_id, tz
      where o.status <> 'CANCELLED' and o.submitted_at >= date_trunc('day', now() at time zone tz.timezone) at time zone tz.timezone
      group by 1 order by qty desc limit 5`)).rows;
    return { kpis: k, pipeline, recent, hourly, top_today: top };
  });
  res.json(data);
});

// ---------------------------------------------------------------------------
// B. Analytics
// ---------------------------------------------------------------------------
async function analytics(tx: Tx, q: unknown) {
  const rg = await range(tx, q);
  const p = [rg.start_at, rg.end_at, rg.timezone];
  const daily = (await tx.query(`
    with days as (select generate_series((($1::timestamptz) at time zone $3)::date, (($2::timestamptz - interval '1 second') at time zone $3)::date, '1 day')::date as day),
    rev as (select (paid_at at time zone $3)::date as day, sum(amount_fils)::bigint as revenue, count(*)::int as paid_orders
            from payments where status = 'PAID' and paid_at >= $1 and paid_at < $2 group by 1),
    ord as (select (submitted_at at time zone $3)::date as day, count(*) filter (where status <> 'CANCELLED')::int as orders,
                   count(*) filter (where status = 'CANCELLED')::int as cancelled
            from orders where submitted_at >= $1 and submitted_at < $2 group by 1)
    select to_char(days.day, 'YYYY-MM-DD') as day, coalesce(rev.revenue, 0) as revenue, coalesce(rev.paid_orders, 0) as paid_orders,
           coalesce(ord.orders, 0) as orders, coalesce(ord.cancelled, 0) as cancelled
    from days left join rev using (day) left join ord using (day) order by days.day`, p)).rows;
  const bucket = async (unit: 'week' | 'month') => (await tx.query(`
    select to_char(date_trunc('${unit}', paid_at at time zone $3), 'YYYY-MM-DD') as period, sum(amount_fils)::bigint as revenue, count(*)::int as orders
    from payments where status = 'PAID' and paid_at >= $1 and paid_at < $2 group by 1 order by 1`, p)).rows;
  const byMethod = (await tx.query(`
    select method, sum(amount_fils)::bigint as revenue, count(*)::int as count from payments
    where status = 'PAID' and paid_at >= $1 and paid_at < $2 group by 1 order by revenue desc`, p.slice(0, 2))).rows;
  const products = (await tx.query(`
    select oi.item_name as name, coalesce(c.name, 'Archived') as category, sum(oi.quantity)::int as qty, sum(oi.line_total_fils)::bigint as revenue,
           count(distinct o.id)::int as orders
    from order_items oi join orders o on o.id = oi.order_id
    left join menu_items mi on mi.id = oi.menu_item_id left join menu_categories c on c.id = mi.category_id
    where o.status <> 'CANCELLED' and o.submitted_at >= $1 and o.submitted_at < $2
    group by 1, 2 order by revenue desc`, p.slice(0, 2))).rows;
  const categories = (await tx.query(`
    select coalesce(c.name, 'Archived') as category, sum(oi.quantity)::int as qty, sum(oi.line_total_fils)::bigint as revenue
    from order_items oi join orders o on o.id = oi.order_id
    left join menu_items mi on mi.id = oi.menu_item_id left join menu_categories c on c.id = mi.category_id
    where o.status <> 'CANCELLED' and o.submitted_at >= $1 and o.submitted_at < $2
    group by 1 order by revenue desc`, p.slice(0, 2))).rows;
  const hourly = (await tx.query(`
    select extract(hour from submitted_at at time zone $3)::int as hour, count(*)::int as orders
    from orders where submitted_at >= $1 and submitted_at < $2 and status <> 'CANCELLED' group by 1 order by 1`, p)).rows;
  const weekday = (await tx.query(`
    select extract(dow from submitted_at at time zone $3)::int as dow, count(*)::int as orders
    from orders where submitted_at >= $1 and submitted_at < $2 and status <> 'CANCELLED' group by 1 order by 1`, p)).rows;
  const totals = {
    revenue: daily.reduce((s, d) => s + Number(d.revenue), 0),
    orders: daily.reduce((s, d) => s + d.orders, 0),
    paid_orders: daily.reduce((s, d) => s + d.paid_orders, 0),
    cancelled: daily.reduce((s, d) => s + d.cancelled, 0),
  };
  return { from: fmtDate(rg.from_d), to: fmtDate(rg.to_d), timezone: rg.timezone, totals, daily,
    weekly: await bucket('week'), monthly: await bucket('month'), by_method: byMethod, products, categories, hourly, weekday };
}
adminRouter.get('/analytics', async (req, res) => {
  res.json(await withCtx(ctx(req), (tx) => analytics(tx, req.query)));
});

// ---------------------------------------------------------------------------
// C. Orders
// ---------------------------------------------------------------------------
const STATUS = ['AWAITING_PAYMENT', 'RECEIVED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'] as const;
const PAY_STATUS = ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED'] as const;

adminRouter.get('/orders', async (req, res) => {
  const q = parse(z.object({
    search: z.string().trim().max(50).optional(),
    status: z.enum(STATUS).optional(),
    group: z.enum(['active', 'closed']).optional(),
    payment_status: z.enum(PAY_STATUS).optional(),
    payment_method: z.enum(['ONLINE', 'CASH', 'COUNTER']).optional(),
    table: z.coerce.number().int().min(1).max(999).optional(),
    from: dateStr.optional(), to: dateStr.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    page_size: z.coerce.number().int().min(5).max(100).default(25),
  }), req.query);
  const data = await withCtx(ctx(req), async (tx) => {
    const rg = await range(tx, { from: q.from, to: q.to }, 3650, 3660);
    const where: string[] = ['o.created_at >= $1', 'o.created_at < $2'];
    const params: unknown[] = [rg.start_at, rg.end_at];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (q.search) {
      const s = q.search.replace(/^#/, '');
      params.push(`%${s}%`);
      const n = /^\d+$/.test(s) ? Number(s) : null;
      params.push(n);
      where.push(`(o.order_number ilike $${params.length - 1} or t.number = $${params.length}
        or exists (select 1 from payments px where px.order_id = o.id and px.transaction_ref ilike $${params.length - 1}))`);
    }
    if (q.status) add('o.status = ?', q.status);
    if (q.group === 'active') where.push(`o.status in ('AWAITING_PAYMENT','RECEIVED','ACCEPTED','PREPARING','READY','SERVED')`);
    if (q.group === 'closed') where.push(`o.status in ('COMPLETED','CANCELLED')`);
    if (q.payment_status) add('o.payment_status = ?', q.payment_status);
    if (q.payment_method) add('o.payment_method = ?', q.payment_method);
    if (q.table) add('t.number = ?', q.table);
    const w = where.join(' and ');
    const total = (await tx.query(`select count(*)::int as c from orders o join restaurant_tables t on t.id = o.table_id where ${w}`, params)).rows[0].c;
    params.push(q.page_size, (q.page - 1) * q.page_size);
    const rows = (await tx.query(`${orderSelect('staff')} where ${w} order by o.created_at desc limit $${params.length - 1} offset $${params.length}`, params)).rows;
    return { orders: rows, total, page: q.page, page_size: q.page_size };
  });
  res.json(data);
});

adminRouter.get('/orders/:id', async (req, res) => {
  const id = idParam(req);
  const data = await withCtx(ctx(req), async (tx) => {
    const order = await getOrder(tx, 'staff', id);
    if (!order) throw notFound('Order not found');
    const payments = (await tx.query(`select p.*, u.full_name as confirmed_by_name from payments p left join users u on u.id = p.confirmed_by
      where p.order_id = $1 order by p.created_at`, [id])).rows;
    const events = (await tx.query(`select e.id, e.event_type, e.from_status, e.to_status, e.actor_role, e.details, e.created_at, u.full_name as actor_name
      from order_events e left join users u on u.id = e.actor_user_id where e.order_id = $1 order by e.created_at, e.id`, [id])).rows;
    const issues = (await tx.query(`select i.*, u.full_name as reported_by_name from order_issues i left join users u on u.id = i.reported_by
      where i.order_id = $1 order by i.created_at`, [id])).rows;
    const review = (await tx.query(`select rating, comment, created_at from reviews where order_id = $1`, [id])).rows[0] ?? null;
    return { order, payments, events, issues, review };
  });
  res.json(data);
});

adminRouter.post('/orders/:id/status', async (req, res) => {
  const id = idParam(req);
  const { status } = parse(z.object({ status: z.enum(['ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED']) }), req.body ?? {});
  const order = await withCtx(ctx(req), async (tx) => {
    const u = await tx.query(`update orders set status = $2 where id = $1 returning id`, [id, status]);
    if (!u.rowCount) throw notFound('Order not found');
    return getOrder(tx, 'staff', id);
  });
  res.json({ order });
});

adminRouter.post('/orders/:id/cancel', async (req, res) => {
  const id = idParam(req);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body ?? {});
  const cur = await withCtx(ctx(req), (tx) => getOrder(tx, 'staff', id));
  if (!cur) throw notFound('Order not found');
  if (cur.status === 'AWAITING_PAYMENT' && stripeConfigured()) {
    const paid = await abandonOnlinePayment(req.staff!.restaurantId, id);
    if (paid) throw conflict('The customer has just paid online — the order is now with the kitchen. Cancel it again if needed and refund the payment.');
  }
  const order = await withCtx(ctx(req), async (tx) => {
    await tx.query(`update orders set status = 'CANCELLED', cancel_reason = $2 where id = $1`, [id, reason]);
    return getOrder(tx, 'staff', id);
  });
  res.json({ order });
});

adminRouter.post('/payments/:id/confirm', async (req, res) => {
  const id = idParam(req);
  const p = await withCtx(ctx(req), async (tx) => {
    const cur = (await tx.query(`select method, status from payments where id = $1`, [id])).rows[0];
    if (!cur) throw notFound('Payment not found');
    if (cur.method === 'ONLINE') throw forbidden('Online payments are confirmed by the payment provider, not manually');
    if (cur.status === 'PAID') return cur;
    return (await tx.query(`update payments set status = 'PAID' where id = $1 returning *`, [id])).rows[0];
  });
  res.json({ payment: p });
});

adminRouter.post('/payments/:id/refund', async (req, res) => {
  await refundPayment(req.staff!.restaurantId, req.staff!.userId, idParam(req));
  res.json({ ok: true });
});

adminRouter.post('/issues/:id/resolve', async (req, res) => {
  const id = idParam(req);
  const r = await withCtx(ctx(req), (tx) => tx.query(
    `update order_issues set status = 'RESOLVED', resolved_by = app.uid(), resolved_at = now() where id = $1 and status = 'OPEN' returning id`, [id]));
  if (!r.rowCount) throw notFound('Issue not found or already resolved');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// D. Menu management
// ---------------------------------------------------------------------------
adminRouter.get('/menu', async (req, res) => {
  res.json(await withCtx(ctx(req), async (tx) => {
    const menu = await loadMenu(tx, { includeArchived: true });
    const ingredients = (await tx.query(`select mii.menu_item_id, mii.inventory_item_id, mii.quantity_per_unit, ii.name, ii.unit
      from menu_item_ingredients mii join inventory_items ii on ii.id = mii.inventory_item_id`)).rows;
    return { ...menu, ingredients };
  }));
});

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'category';
const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullish(),
  icon: z.string().trim().max(40).nullish(),
  sort_order: z.number().int().min(0).max(1000).optional(),
  is_active: z.boolean().optional(),
});

adminRouter.post('/categories', async (req, res) => {
  const b = parse(categorySchema, req.body ?? {});
  const row = await withCtx(ctx(req), async (tx) => (await tx.query(
    `insert into menu_categories (restaurant_id, name, slug, description, icon, sort_order, is_active)
     values (app.rid(), $1, $2, $3, $4, coalesce($5, (select coalesce(max(sort_order) + 1, 0) from menu_categories)), coalesce($6, true)) returning *`,
    [b.name, slugify(b.name), b.description ?? null, b.icon ?? null, b.sort_order ?? null, b.is_active ?? null])).rows[0]);
  res.status(201).json({ category: row });
});

adminRouter.patch('/categories/:id', async (req, res) => {
  const id = idParam(req);
  const b = parse(categorySchema.partial(), req.body ?? {});
  const row = await withCtx(ctx(req), async (tx) => {
    const r = await tx.query(`update menu_categories set name = coalesce($2, name), slug = coalesce($3, slug), description = case when $7 then $4 else description end,
        icon = coalesce($5, icon), sort_order = coalesce($6, sort_order), is_active = coalesce($8, is_active) where id = $1 returning *`,
      [id, b.name ?? null, b.name ? slugify(b.name) : null, b.description ?? null, b.icon ?? null, b.sort_order ?? null, 'description' in b, b.is_active ?? null]);
    if (!r.rowCount) throw notFound('Category not found');
    return r.rows[0];
  });
  res.json({ category: row });
});

adminRouter.delete('/categories/:id', async (req, res) => {
  const id = idParam(req);
  await withCtx(ctx(req), async (tx) => {
    const n = (await tx.query(`select count(*)::int as c from menu_items where category_id = $1`, [id])).rows[0].c;
    if (n > 0) throw conflict(`This category still has ${n} product(s). Move or delete them first, or hide the category instead.`, 'IN_USE');
    const r = await tx.query(`delete from menu_categories where id = $1`, [id]);
    if (!r.rowCount) throw notFound('Category not found');
  });
  res.json({ ok: true });
});

const variantSchema = z.object({
  id: uuid.optional(),
  kind: z.enum(['SIZE', 'VARIATION', 'EXTRA']),
  group_name: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  price_delta_fils: z.number().int().min(-1000000).max(1000000),
  is_default: z.boolean().default(false),
  is_available: z.boolean().default(true),
});
const itemSchema = z.object({
  category_id: uuid,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullish(),
  price_fils: z.number().int().min(0).max(10000000),
  prep_minutes: z.number().int().min(0).max(240),
  image_media_id: uuid.nullish(),
  is_available: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  is_popular: z.boolean().default(false),
  dietary: z.array(z.enum(['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'contains-nuts', 'spicy', 'halal'])).max(7).default([]),
  calories: z.number().int().min(0).max(5000).nullish(),
  sort_order: z.number().int().min(0).max(10000).optional(),
  variants: z.array(variantSchema).max(40).optional(),
  ingredients: z.array(z.object({ inventory_item_id: uuid, quantity_per_unit: z.number().positive().max(100000) })).max(30).optional(),
});

function validateVariants(vs: z.infer<typeof variantSchema>[]) {
  const groups = new Map<string, z.infer<typeof variantSchema>[]>();
  for (const v of vs) {
    if (v.kind === 'EXTRA') continue;
    const k = `${v.kind}:${v.group_name.toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  for (const [k, g] of groups) {
    if (g.filter((v) => v.is_default).length > 1) throw badRequest(`Only one default option allowed in "${k.split(':')[1]}"`);
  }
  const names = vs.map((v) => `${v.kind}:${v.group_name.toLowerCase()}:${v.name.toLowerCase()}`);
  if (new Set(names).size !== names.length) throw badRequest('Duplicate option names within a group');
}

async function saveVariants(tx: Tx, itemId: string, vs: z.infer<typeof variantSchema>[]) {
  validateVariants(vs);
  const keep = vs.filter((v) => v.id).map((v) => v.id!);
  await tx.query(`delete from product_variants where menu_item_id = $1 and not (id = any($2::uuid[]))`, [itemId, keep]);
  let i = 0;
  for (const v of vs) {
    if (v.id) {
      const r = await tx.query(`update product_variants set kind = $3, group_name = $4, name = $5, price_delta_fils = $6, is_default = $7,
        is_available = $8, sort_order = $9 where id = $1 and menu_item_id = $2`,
        [v.id, itemId, v.kind, v.group_name, v.name, v.price_delta_fils, v.is_default, v.is_available, i++]);
      if (!r.rowCount) throw badRequest('Option does not belong to this product');
    } else {
      await tx.query(`insert into product_variants (restaurant_id, menu_item_id, kind, group_name, name, price_delta_fils, is_default, is_available, sort_order)
        values (app.rid(), $1, $2, $3, $4, $5, $6, $7, $8)`, [itemId, v.kind, v.group_name, v.name, v.price_delta_fils, v.is_default, v.is_available, i++]);
    }
  }
}
async function saveIngredients(tx: Tx, itemId: string, ings: { inventory_item_id: string; quantity_per_unit: number }[]) {
  await tx.query(`delete from menu_item_ingredients where menu_item_id = $1`, [itemId]);
  for (const g of ings) {
    await tx.query(`insert into menu_item_ingredients (menu_item_id, inventory_item_id, restaurant_id, quantity_per_unit) values ($1, $2, app.rid(), $3)
      on conflict (menu_item_id, inventory_item_id) do update set quantity_per_unit = excluded.quantity_per_unit`, [itemId, g.inventory_item_id, g.quantity_per_unit]);
  }
}

adminRouter.post('/items', async (req, res) => {
  const b = parse(itemSchema, req.body ?? {});
  const item = await withCtx(ctx(req), async (tx) => {
    const r = (await tx.query(`insert into menu_items (restaurant_id, category_id, name, description, price_fils, prep_minutes, image_media_id,
        is_available, is_featured, is_popular, dietary, calories, sort_order)
      values (app.rid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, (select coalesce(max(sort_order) + 1, 0) from menu_items where category_id = $1)))
      returning id`, [b.category_id, b.name, b.description ?? null, b.price_fils, b.prep_minutes, b.image_media_id ?? null, b.is_available,
      b.is_featured, b.is_popular, b.dietary, b.calories ?? null, b.sort_order ?? null])).rows[0];
    if (b.variants) await saveVariants(tx, r.id, b.variants);
    if (b.ingredients) await saveIngredients(tx, r.id, b.ingredients);
    return r;
  });
  res.status(201).json({ item });
});

adminRouter.patch('/items/:id', async (req, res) => {
  const id = idParam(req);
  const b = parse(itemSchema.partial().extend({ is_archived: z.boolean().optional() }), req.body ?? {});
  await withCtx(ctx(req), async (tx) => {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const cols = ['category_id', 'name', 'description', 'price_fils', 'prep_minutes', 'image_media_id', 'is_available', 'is_featured',
      'is_popular', 'dietary', 'calories', 'sort_order', 'is_archived'] as const;
    for (const c of cols) {
      if (c in b) { params.push((b as any)[c] ?? null); sets.push(`${c} = $${params.length}`); }
    }
    if (sets.length) {
      const r = await tx.query(`update menu_items set ${sets.join(', ')} where id = $1`, params);
      if (!r.rowCount) throw notFound('Product not found');
    } else if (!(await tx.query(`select 1 from menu_items where id = $1`, [id])).rowCount) {
      throw notFound('Product not found');
    }
    if (b.variants) await saveVariants(tx, id, b.variants);
    if (b.ingredients) await saveIngredients(tx, id, b.ingredients);
  });
  res.json({ ok: true });
});

adminRouter.delete('/items/:id', async (req, res) => {
  const id = idParam(req);
  const result = await withCtx(ctx(req), async (tx) => {
    const used = (await tx.query(`select exists (select 1 from order_items where menu_item_id = $1) as used`, [id])).rows[0].used;
    if (used) {
      // Keep order history intact: archive instead of deleting.
      const r = await tx.query(`update menu_items set is_archived = true, is_available = false where id = $1`, [id]);
      if (!r.rowCount) throw notFound('Product not found');
      return 'archived';
    }
    const r = await tx.query(`delete from menu_items where id = $1`, [id]);
    if (!r.rowCount) throw notFound('Product not found');
    return 'deleted';
  });
  res.json({ result });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });
const MAGIC: [string, (b: Buffer) => boolean][] = [
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/webp', (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
];
adminRouter.post('/media', upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f) throw badRequest('Choose an image file to upload');
  // Trust the file's bytes, not its name or declared type. SVG uploads are refused (script risk).
  const mime = MAGIC.find(([, test]) => test(f.buffer))?.[0];
  if (!mime) throw badRequest('Only PNG, JPEG or WebP images are allowed');
  const row = await withCtx(ctx(req), async (tx) => (await tx.query(
    `insert into media (restaurant_id, mime, bytes, size_bytes, created_by) values (app.rid(), $1, $2, $3, app.uid()) returning id`,
    [mime, f.buffer, f.size])).rows[0]);
  res.status(201).json({ id: row.id, url: `/api/media/${row.id}` });
});

// ---------------------------------------------------------------------------
// E. Tables & QR codes
// ---------------------------------------------------------------------------
const qrUrl = (token: string) => `${config.publicUrl}/t/${token}`;

adminRouter.get('/tables', async (req, res) => {
  const rows = await withCtx(ctx(req), async (tx) => (await tx.query(`
    select t.*, wa.waiter_id as assigned_waiter_id, u.full_name as assigned_waiter_name,
      (select count(*)::int from orders o where o.table_id = t.id and o.status in ('RECEIVED','ACCEPTED','PREPARING','READY','SERVED')) as active_orders,
      (select coalesce(sum(o.total_fils), 0) from orders o where o.table_id = t.id and o.status not in ('COMPLETED','CANCELLED')
         and o.payment_status <> 'PAID') as current_bill_fils,
      (select coalesce(sum(o.total_fils), 0) from orders o where o.table_id = t.id and o.status in ('RECEIVED','ACCEPTED','PREPARING','READY','SERVED')) as active_total_fils,
      (select json_agg(json_build_object('id', o.id, 'order_number', o.order_number, 'status', o.status, 'payment_status', o.payment_status, 'total_fils', o.total_fils) order by o.created_at)
         from orders o where o.table_id = t.id and o.status in ('AWAITING_PAYMENT','RECEIVED','ACCEPTED','PREPARING','READY','SERVED')) as orders,
      (select count(*)::int from customer_requests r where r.table_id = t.id and r.status in ('OPEN','ACKNOWLEDGED')) as open_requests
    from restaurant_tables t
    left join waiter_assignments wa on wa.table_id = t.id and wa.is_active
    left join users u on u.id = wa.waiter_id
    order by t.number`)).rows);
  res.json({ tables: rows.map((t) => ({ ...t, qr_url: qrUrl(t.qr_token), occupancy: !t.is_active ? 'DISABLED' : t.active_orders > 0 ? 'OCCUPIED' : 'AVAILABLE' })) });
});

const tableSchema = z.object({
  number: z.number().int().min(1).max(999),
  label: z.string().trim().max(40).nullish(),
  seats: z.number().int().min(1).max(50).default(4),
  zone: z.string().trim().max(40).nullish(),
  is_active: z.boolean().default(true),
});
const newToken = () => crypto.randomBytes(18).toString('base64url');

adminRouter.post('/tables', async (req, res) => {
  const b = parse(tableSchema, req.body ?? {});
  const row = await withCtx(ctx(req), async (tx) => (await tx.query(
    `insert into restaurant_tables (restaurant_id, number, label, seats, zone, qr_token, is_active) values (app.rid(), $1, $2, $3, $4, $5, $6) returning *`,
    [b.number, b.label || `Table ${String(b.number).padStart(2, '0')}`, b.seats, b.zone ?? null, newToken(), b.is_active])).rows[0]);
  res.status(201).json({ table: { ...row, qr_url: qrUrl(row.qr_token) } });
});

adminRouter.patch('/tables/:id', async (req, res) => {
  const id = idParam(req);
  const b = parse(tableSchema.partial(), req.body ?? {});
  const row = await withCtx(ctx(req), async (tx) => {
    const r = await tx.query(`update restaurant_tables set number = coalesce($2, number), label = case when $7 then $3 else label end,
        seats = coalesce($4, seats), zone = case when $8 then $5 else zone end, is_active = coalesce($6, is_active) where id = $1 returning *`,
      [id, b.number ?? null, b.label ?? null, b.seats ?? null, b.zone ?? null, b.is_active ?? null, 'label' in b, 'zone' in b]);
    if (!r.rowCount) throw notFound('Table not found');
    return r.rows[0];
  });
  res.json({ table: { ...row, qr_url: qrUrl(row.qr_token) } });
});

adminRouter.delete('/tables/:id', async (req, res) => {
  const id = idParam(req);
  await withCtx(ctx(req), async (tx) => {
    const used = (await tx.query(`select exists (select 1 from orders where table_id = $1) as u`, [id])).rows[0].u;
    if (used) throw conflict('This table has order history and cannot be deleted. Disable it instead.', 'IN_USE');
    const r = await tx.query(`delete from restaurant_tables where id = $1`, [id]);
    if (!r.rowCount) throw notFound('Table not found');
  });
  res.json({ ok: true });
});

adminRouter.post('/tables/:id/regenerate-qr', async (req, res) => {
  const id = idParam(req);
  const row = await withCtx(ctx(req), async (tx) => {
    const r = await tx.query(`update restaurant_tables set qr_token = $2 where id = $1 returning *`, [id, newToken()]);
    if (!r.rowCount) throw notFound('Table not found');
    return r.rows[0];
  });
  res.json({ table: { ...row, qr_url: qrUrl(row.qr_token) } });
});

adminRouter.put('/tables/:id/waiter', async (req, res) => {
  const id = idParam(req);
  const { waiter_id } = parse(z.object({ waiter_id: uuid.nullable() }), req.body ?? {});
  await withCtx(ctx(req), async (tx) => {
    if (waiter_id) {
      const w = (await tx.query(`select role, is_active from users where id = $1`, [waiter_id])).rows[0];
      if (!w || w.role !== 'waiter' || !w.is_active) throw badRequest('Choose an active waiter');
    }
    await tx.query(`update waiter_assignments set is_active = false, ended_at = now() where table_id = $1 and is_active`, [id]);
    if (waiter_id) {
      await tx.query(`insert into waiter_assignments (restaurant_id, table_id, waiter_id, assigned_by) values (app.rid(), $1, $2, app.uid())`, [id, waiter_id]);
    }
  });
  res.json({ ok: true });
});

adminRouter.get('/tables/:id/qr.:fmt', async (req, res) => {
  const id = idParam(req);
  const fmt = parse(z.enum(['png', 'svg']), req.params.fmt);
  const t = await withCtx(ctx(req), async (tx) => (await tx.query(`select number, qr_token from restaurant_tables where id = $1`, [id])).rows[0]);
  if (!t) throw notFound('Table not found');
  const url = qrUrl(t.qr_token);
  const name = `icons-table-${String(t.number).padStart(2, '0')}-qr.${fmt}`;
  if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  const opts = { errorCorrectionLevel: 'M' as const, margin: 2, color: { dark: '#0b0b12', light: '#ffffff' } };
  if (fmt === 'png') {
    res.type('png').send(await QRCode.toBuffer(url, { ...opts, width: 720 }));
  } else {
    res.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
  }
});

// ---------------------------------------------------------------------------
// F. Staff
// ---------------------------------------------------------------------------
adminRouter.get('/staff', async (req, res) => {
  const rows = await withCtx(ctx(req), async (tx) => (await tx.query(`
    select u.id, u.email, u.full_name, u.role, u.is_active, u.is_demo, u.last_login_at, u.created_at,
      sp.is_on_duty, sp.last_seen_at, sp.current_activity, sp.avatar_color, sp.phone,
      coalesce((select json_agg(json_build_object('id', t.id, 'number', t.number) order by t.number)
        from waiter_assignments wa join restaurant_tables t on t.id = wa.table_id where wa.waiter_id = u.id and wa.is_active), '[]') as tables,
      (select count(*)::int from order_events e where e.actor_user_id = u.id and e.created_at > date_trunc('day', now() at time zone r.timezone) at time zone r.timezone) as actions_today,
      (select json_build_object('event_type', e.event_type, 'to_status', e.to_status, 'created_at', e.created_at, 'order_number', o.order_number)
        from order_events e join orders o on o.id = e.order_id where e.actor_user_id = u.id order by e.created_at desc limit 1) as last_action
    from users u join staff_profiles sp on sp.user_id = u.id join restaurants r on r.id = u.restaurant_id
    order by case u.role when 'admin' then 0 when 'waiter' then 1 else 2 end, u.full_name`)).rows);
  res.json({ staff: rows });
});

const passwordSchema = z.string().min(10, 'password must be at least 10 characters').max(200);
adminRouter.post('/staff', async (req, res) => {
  const b = parse(z.object({
    email: z.string().trim().email().max(200), full_name: z.string().trim().min(1).max(120),
    role: z.enum(['admin', 'waiter', 'kitchen']), password: passwordSchema, phone: z.string().trim().max(40).nullish(),
  }), req.body ?? {});
  const hash = await bcrypt.hash(b.password, 11);
  const row = await withCtx(ctx(req), async (tx) => {
    const u = (await tx.query(`insert into users (restaurant_id, email, password_hash, full_name, role) values (app.rid(), lower($1), $2, $3, $4)
      returning id, email, full_name, role, is_active`, [b.email, hash, b.full_name, b.role])).rows[0];
    const colors = ['#8b5cf6', '#22c55e', '#f59e0b', '#38bdf8', '#ef4444', '#ec4899', '#14b8a6'];
    await tx.query(`insert into staff_profiles (user_id, restaurant_id, phone, avatar_color) values ($1, app.rid(), $2, $3)`,
      [u.id, b.phone ?? null, colors[Math.floor(Math.random() * colors.length)]]);
    return u;
  });
  res.status(201).json({ user: row });
});

adminRouter.patch('/staff/:id', async (req, res) => {
  const id = idParam(req);
  const b = parse(z.object({
    full_name: z.string().trim().min(1).max(120).optional(), role: z.enum(['admin', 'waiter', 'kitchen']).optional(),
    is_active: z.boolean().optional(), password: passwordSchema.optional(), phone: z.string().trim().max(40).nullish(),
  }), req.body ?? {});
  if (id === req.staff!.userId && (b.is_active === false || (b.role && b.role !== 'admin'))) {
    throw badRequest('You cannot deactivate your own account or remove your own admin role');
  }
  const hash = b.password ? await bcrypt.hash(b.password, 11) : null;
  await withCtx(ctx(req), async (tx) => {
    // The app role may write password hashes but never read them, so the hash is set in its own statement.
    const r = await tx.query(`update users set full_name = coalesce($2, full_name), role = coalesce($3, role), is_active = coalesce($4, is_active),
        token_version = token_version + case when $5 or $4 = false or ($3::text is not null and $3 <> role) then 1 else 0 end
      where id = $1 returning id, role`, [id, b.full_name ?? null, b.role ?? null, b.is_active ?? null, hash !== null]);
    if (!r.rowCount) throw notFound('Staff member not found');
    if (hash) await tx.query(`update users set password_hash = $2 where id = $1`, [id, hash]);
    if ('phone' in b) await tx.query(`update staff_profiles set phone = $2 where user_id = $1`, [id, b.phone ?? null]);
    if (b.is_active === false || (b.role && b.role !== 'waiter')) {
      await tx.query(`update waiter_assignments set is_active = false, ended_at = now() where waiter_id = $1 and is_active`, [id]);
      await tx.query(`update staff_profiles set is_on_duty = false where user_id = $1`, [id]);
    }
  });
  res.json({ ok: true });
});

adminRouter.put('/staff/:id/tables', async (req, res) => {
  const id = idParam(req);
  const { table_ids } = parse(z.object({ table_ids: z.array(uuid).max(200) }), req.body ?? {});
  await withCtx(ctx(req), async (tx) => {
    const w = (await tx.query(`select role, is_active from users where id = $1`, [id])).rows[0];
    if (!w) throw notFound('Staff member not found');
    if (w.role !== 'waiter' || !w.is_active) throw badRequest('Tables can only be assigned to active waiters');
    await tx.query(`update waiter_assignments set is_active = false, ended_at = now() where is_active and (waiter_id = $1 or table_id = any($2::uuid[]))`, [id, table_ids]);
    for (const t of table_ids) {
      await tx.query(`insert into waiter_assignments (restaurant_id, table_id, waiter_id, assigned_by) values (app.rid(), $1, $2, app.uid())`, [t, id]);
    }
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// G. Inventory
// ---------------------------------------------------------------------------
adminRouter.get('/inventory', async (req, res) => {
  const rows = await withCtx(ctx(req), async (tx) => (await tx.query(`
    select ii.*, ii.quantity <= ii.low_stock_threshold as is_low,
      coalesce((select json_agg(json_build_object('menu_item_id', mi.id, 'name', mi.name, 'quantity_per_unit', mii.quantity_per_unit) order by mi.name)
        from menu_item_ingredients mii join menu_items mi on mi.id = mii.menu_item_id where mii.inventory_item_id = ii.id), '[]') as products,
      (select max(created_at) from inventory_transactions t where t.inventory_item_id = ii.id) as last_movement_at
    from inventory_items ii order by (ii.quantity <= ii.low_stock_threshold) desc, ii.name`)).rows);
  res.json({ items: rows });
});

const invSchema = z.object({
  name: z.string().trim().min(1).max(80), unit: z.enum(['g', 'kg', 'ml', 'L', 'pcs']),
  low_stock_threshold: z.number().min(0).max(10000000), quantity: z.number().min(0).max(10000000).optional(),
});
adminRouter.post('/inventory', async (req, res) => {
  const b = parse(invSchema, req.body ?? {});
  const row = await withCtx(ctx(req), async (tx) => {
    const r = (await tx.query(`insert into inventory_items (restaurant_id, name, unit, quantity, low_stock_threshold) values (app.rid(), $1, $2, 0, $3) returning *`,
      [b.name, b.unit, b.low_stock_threshold])).rows[0];
    if (b.quantity && b.quantity > 0) {
      await tx.query(`insert into inventory_transactions (restaurant_id, inventory_item_id, delta, quantity_after, reason, note, created_by)
        values (app.rid(), $1, $2, 0, 'RESTOCK', 'Opening stock', app.uid())`, [r.id, b.quantity]);
    }
    return r;
  });
  res.status(201).json({ item: row });
});

adminRouter.patch('/inventory/:id', async (req, res) => {
  const id = idParam(req);
  const b = parse(invSchema.omit({ quantity: true }).partial(), req.body ?? {});
  await withCtx(ctx(req), async (tx) => {
    const r = await tx.query(`update inventory_items set name = coalesce($2, name), unit = coalesce($3, unit), low_stock_threshold = coalesce($4, low_stock_threshold)
      where id = $1`, [id, b.name ?? null, b.unit ?? null, b.low_stock_threshold ?? null]);
    if (!r.rowCount) throw notFound('Inventory item not found');
  });
  res.json({ ok: true });
});

adminRouter.delete('/inventory/:id', async (req, res) => {
  const id = idParam(req);
  await withCtx(ctx(req), async (tx) => {
    const r = await tx.query(`delete from inventory_items where id = $1`, [id]);
    if (!r.rowCount) throw notFound('Inventory item not found');
  });
  res.json({ ok: true });
});

adminRouter.post('/inventory/:id/adjust', async (req, res) => {
  const id = idParam(req);
  const b = parse(z.object({
    delta: z.number().refine((n) => n !== 0, 'delta cannot be zero').refine((n) => Math.abs(n) <= 10000000, 'delta too large'),
    reason: z.enum(['RESTOCK', 'ADJUSTMENT', 'WASTE']), note: z.string().trim().max(300).optional(),
  }), req.body ?? {});
  if (b.reason === 'RESTOCK' && b.delta < 0) throw badRequest('A restock must add stock');
  if (b.reason === 'WASTE' && b.delta > 0) throw badRequest('Waste must remove stock');
  const tx_ = await withCtx(ctx(req), async (tx) => {
    const cur = (await tx.query(`select quantity from inventory_items where id = $1`, [id])).rows[0];
    if (!cur) throw notFound('Inventory item not found');
    if (cur.quantity + b.delta < 0) throw badRequest(`Stock cannot go below zero (currently ${cur.quantity})`);
    return (await tx.query(`insert into inventory_transactions (restaurant_id, inventory_item_id, delta, quantity_after, reason, note, created_by)
      values (app.rid(), $1, $2, 0, $3, $4, app.uid()) returning *`, [id, b.delta, b.reason, b.note || null])).rows[0];
  });
  res.status(201).json({ transaction: tx_ });
});

adminRouter.get('/inventory/:id/transactions', async (req, res) => {
  const id = idParam(req);
  const rows = await withCtx(ctx(req), async (tx) => (await tx.query(`select t.*, u.full_name as created_by_name, o.order_number
    from inventory_transactions t left join users u on u.id = t.created_by left join orders o on o.id = t.order_id
    where t.inventory_item_id = $1 order by t.created_at desc limit 100`, [id])).rows);
  res.json({ transactions: rows });
});

// ---------------------------------------------------------------------------
// H. Reviews
// ---------------------------------------------------------------------------
adminRouter.get('/reviews', async (req, res) => {
  const q = parse(z.object({
    rating: z.coerce.number().int().min(1).max(5).optional(),
    page: z.coerce.number().int().min(1).default(1), page_size: z.coerce.number().int().min(5).max(100).default(20),
  }), req.query);
  const data = await withCtx(ctx(req), async (tx) => {
    const params: unknown[] = [q.rating ?? null];
    const total = (await tx.query(`select count(*)::int as c from reviews where ($1::int is null or rating = $1)`, params)).rows[0].c;
    const rows = (await tx.query(`select rv.*, o.order_number, o.total_fils, t.number as table_number
      from reviews rv join orders o on o.id = rv.order_id left join restaurant_tables t on t.id = rv.table_id
      where ($1::int is null or rv.rating = $1) order by rv.created_at desc limit $2 offset $3`, [q.rating ?? null, q.page_size, (q.page - 1) * q.page_size])).rows;
    const summary = (await tx.query(`select count(*)::int as count, round(avg(rating)::numeric, 2) as average,
      count(*) filter (where rating = 5)::int as r5, count(*) filter (where rating = 4)::int as r4, count(*) filter (where rating = 3)::int as r3,
      count(*) filter (where rating = 2)::int as r2, count(*) filter (where rating = 1)::int as r1 from reviews`)).rows[0];
    return { reviews: rows, total, summary, page: q.page, page_size: q.page_size };
  });
  res.json(data);
});

// ---------------------------------------------------------------------------
// I. Reports (JSON or CSV)
// ---------------------------------------------------------------------------
const REPORTS = ['daily', 'weekly', 'monthly', 'products', 'payments', 'orders', 'staff'] as const;
adminRouter.get('/reports/:type', async (req, res) => {
  const type = parse(z.enum(REPORTS), req.params.type);
  const format = parse(z.enum(['json', 'csv']).default('json'), req.query.format);
  const report = await withCtx(ctx(req), async (tx) => {
    const rg = await range(tx, req.query, type === 'monthly' ? 365 : type === 'weekly' ? 90 : 30);
    const p = [rg.start_at, rg.end_at, rg.timezone];
    let columns: string[] = [];
    let rows: any[] = [];
    if (type === 'daily' || type === 'weekly' || type === 'monthly') {
      const unit = type === 'daily' ? 'day' : type === 'weekly' ? 'week' : 'month';
      rows = (await tx.query(`
        with o as (select to_char(date_trunc('${unit}', submitted_at at time zone $3), 'YYYY-MM-DD') as period,
                     count(*) filter (where status <> 'CANCELLED')::int as orders, count(*) filter (where status = 'CANCELLED')::int as cancelled,
                     coalesce(sum(subtotal_fils) filter (where status <> 'CANCELLED'), 0)::bigint as gross_fils,
                     coalesce(sum(tax_fils) filter (where status <> 'CANCELLED'), 0)::bigint as vat_fils,
                     coalesce(sum(service_charge_fils) filter (where status <> 'CANCELLED'), 0)::bigint as service_fils
                   from orders where submitted_at >= $1 and submitted_at < $2 group by 1),
        p as (select to_char(date_trunc('${unit}', paid_at at time zone $3), 'YYYY-MM-DD') as period,
                     sum(amount_fils)::bigint as collected_fils,
                     sum(amount_fils) filter (where method = 'ONLINE')::bigint as online_fils,
                     sum(amount_fils) filter (where method = 'CASH')::bigint as cash_fils,
                     sum(amount_fils) filter (where method = 'COUNTER')::bigint as counter_fils
              from payments where status = 'PAID' and paid_at >= $1 and paid_at < $2 group by 1)
        select coalesce(o.period, p.period) as period, coalesce(o.orders, 0) as orders, coalesce(o.cancelled, 0) as cancelled,
               coalesce(o.gross_fils, 0) as gross_fils, coalesce(o.vat_fils, 0) as vat_fils, coalesce(o.service_fils, 0) as service_fils,
               coalesce(p.collected_fils, 0) as collected_fils, coalesce(p.online_fils, 0) as online_fils, coalesce(p.cash_fils, 0) as cash_fils,
               coalesce(p.counter_fils, 0) as counter_fils,
               case when coalesce(o.orders, 0) > 0 then round(coalesce(o.gross_fils, 0)::numeric / o.orders) else 0 end as avg_order_fils
        from o full join p on p.period = o.period order by 1`, p)).rows;
      columns = ['period', 'orders', 'cancelled', 'gross_fils', 'vat_fils', 'service_fils', 'collected_fils', 'online_fils', 'cash_fils', 'counter_fils', 'avg_order_fils'];
    } else if (type === 'products') {
      rows = (await analytics(tx, req.query)).products;
      columns = ['name', 'category', 'qty', 'orders', 'revenue'];
    } else if (type === 'payments') {
      rows = (await tx.query(`select p.transaction_ref, o.order_number, t.number as table_number, p.method, p.status, p.amount_fils,
          to_char(p.created_at at time zone $3, 'YYYY-MM-DD HH24:MI') as created_local, to_char(p.paid_at at time zone $3, 'YYYY-MM-DD HH24:MI') as paid_local,
          u.full_name as confirmed_by, p.provider, p.provider_payment_id, p.failure_reason, p.is_demo
        from payments p join orders o on o.id = p.order_id join restaurant_tables t on t.id = o.table_id left join users u on u.id = p.confirmed_by
        where p.created_at >= $1 and p.created_at < $2 order by p.created_at desc limit 20000`, p)).rows;
      columns = ['transaction_ref', 'order_number', 'table_number', 'method', 'status', 'amount_fils', 'created_local', 'paid_local', 'confirmed_by', 'provider', 'provider_payment_id', 'failure_reason', 'is_demo'];
    } else if (type === 'orders') {
      rows = (await tx.query(`select o.order_number, t.number as table_number, to_char(o.created_at at time zone $3, 'YYYY-MM-DD HH24:MI') as created_local,
          o.status, o.payment_method, o.payment_status, (select sum(quantity) from order_items oi where oi.order_id = o.id)::int as items,
          o.subtotal_fils, o.service_charge_fils, o.tax_fils, o.total_fils,
          round(extract(epoch from (o.ready_at - o.accepted_at)) / 60)::int as prep_minutes,
          round(extract(epoch from (o.served_at - o.submitted_at)) / 60)::int as total_minutes, w.full_name as waiter, o.cancel_reason, o.is_demo
        from orders o join restaurant_tables t on t.id = o.table_id left join users w on w.id = o.serving_waiter_id
        where o.created_at >= $1 and o.created_at < $2 order by o.created_at desc limit 20000`, p)).rows;
      columns = ['order_number', 'table_number', 'created_local', 'status', 'payment_method', 'payment_status', 'items', 'subtotal_fils', 'service_charge_fils', 'tax_fils', 'total_fils', 'prep_minutes', 'total_minutes', 'waiter', 'cancel_reason', 'is_demo'];
    } else {
      rows = (await tx.query(`select u.full_name as name, u.role,
          count(*) filter (where e.to_status = 'ACCEPTED' and e.event_type = 'STATUS_CHANGED')::int as accepted,
          count(*) filter (where e.to_status = 'READY' and e.event_type = 'STATUS_CHANGED')::int as marked_ready,
          count(*) filter (where e.to_status = 'SERVED' and e.event_type = 'STATUS_CHANGED')::int as served,
          count(*) filter (where e.event_type = 'PAYMENT_PAID')::int as payments_confirmed,
          count(*) filter (where e.event_type like 'ISSUE_%')::int as issues_reported,
          (select count(*) from customer_requests r where coalesce(r.completed_by, r.acknowledged_by) = u.id
             and r.created_at >= $1 and r.created_at < $2)::int as requests_handled,
          count(e.id)::int as total_actions,
          to_char(max(e.created_at) at time zone $3, 'YYYY-MM-DD HH24:MI') as last_action_local
        from users u left join order_events e on e.actor_user_id = u.id and e.created_at >= $1 and e.created_at < $2
        group by u.id, u.full_name, u.role order by total_actions desc, name`, p)).rows;
      columns = ['name', 'role', 'accepted', 'marked_ready', 'served', 'payments_confirmed', 'requests_handled', 'issues_reported', 'total_actions', 'last_action_local'];
    }
    return { type, from: fmtDate(rg.from_d), to: fmtDate(rg.to_d), timezone: rg.timezone, columns, rows };
  });
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="icons-${report.type}-report-${report.from}-to-${report.to}.csv"`);
    return res.send(toCsv(report.columns, report.rows));
  }
  res.json(report);
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
adminRouter.get('/settings', async (req, res) => {
  const raw = await withCtx(ctx(req), (tx) => loadRestaurant(tx));
  res.json({ restaurant: { ...publicRestaurant(raw), delay_grace_minutes: raw.delay_grace_minutes },
    integrations: { stripe: stripeConfigured(), stripe_webhook: !!config.stripe.webhookSecret, public_url: config.publicUrl, demo_mode: config.demoMode } });
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
adminRouter.patch('/settings', async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(1).max(120).optional(),
    welcome_message: z.string().trim().max(300).nullish(),
    wifi_ssid: z.string().trim().max(64).nullish(),
    wifi_password: z.string().trim().max(64).nullish(),
    address: z.string().trim().max(200).nullish(),
    phone: z.string().trim().max(40).nullish(),
    vat_rate_bps: z.number().int().min(0).max(5000).optional(),
    service_charge_bps: z.number().int().min(0).max(5000).optional(),
    prices_include_tax: z.boolean().optional(),
    order_mode: z.enum(['AUTO', 'OPEN', 'CLOSED']).optional(),
    delay_grace_minutes: z.number().int().min(0).max(120).optional(),
    opening_hours: z.array(z.object({ open: hhmm, close: hhmm, closed: z.boolean() })).length(7).optional(),
    timezone: z.string().max(60).refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'unknown timezone').optional(),
  }), req.body ?? {});
  await withCtx(ctx(req), async (tx) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      params.push(k === 'opening_hours' ? JSON.stringify(v) : v ?? null);
      sets.push(`${k} = $${params.length}`);
    }
    if (sets.length) await tx.query(`update restaurants set ${sets.join(', ')} where id = app.rid()`, params);
  });
  res.json({ ok: true });
});
