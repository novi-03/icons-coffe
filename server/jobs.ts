/**
 * Background jobs. Each run takes a Postgres advisory lock so that only one
 * API instance performs it at a time.
 */
import { pool, withCtx } from './db.js';
import { stripeConfigured } from './config.js';
import { systemCtx } from './auth.js';
import { abandonOnlinePayment, verifyOnlinePayment } from './services/payments.js';

async function withLock(key: number, fn: () => Promise<void>) {
  const c = await pool.connect();
  try {
    const got = (await c.query('select pg_try_advisory_lock($1) as ok', [key])).rows[0].ok;
    if (!got) return;
    try { await fn(); } finally { await c.query('select pg_advisory_unlock($1)', [key]); }
  } finally {
    c.release();
  }
}

async function restaurants(): Promise<string[]> {
  // Restaurants are discovered through a definer function so the job does not need owner rights.
  return (await pool.query(`select id from app.all_restaurants()`)).rows.map((r) => r.id);
}

/** Kitchen delay alerts: order accepted but not ready after its estimated prep time + grace. */
async function delayAlerts() {
  for (const rid of await restaurants()) {
    await withCtx(systemCtx(rid), async (tx) => {
      const late = (await tx.query(`
        select o.id, o.order_number, o.table_id, t.number, o.est_prep_minutes,
               floor(extract(epoch from now() - coalesce(o.accepted_at, o.submitted_at)) / 60)::int as waited
        from orders o join restaurant_tables t on t.id = o.table_id, restaurants r
        where r.id = app.rid() and o.status in ('RECEIVED','ACCEPTED','PREPARING') and o.delay_notified_at is null and not o.is_demo
          and coalesce(o.accepted_at, o.submitted_at) + make_interval(mins => o.est_prep_minutes + r.delay_grace_minutes) < now()`)).rows;
      for (const o of late) {
        await tx.query(`update orders set delay_notified_at = now() where id = $1`, [o.id]);
        for (const role of ['admin', 'kitchen']) {
          await tx.query(`select app.notify(app.rid(), null, $1, 'KITCHEN_DELAY', $2, $3, $4, $5, jsonb_build_object('orderNumber', $6::text, 'waited', $7::int))`,
            [role, `Delayed order #${o.order_number}`, `TABLE ${String(o.number).padStart(2, '0')} · waiting ${o.waited} min (estimate ${o.est_prep_minutes} min)`,
              o.id, o.table_id, o.order_number, o.waited]);
        }
      }
    });
  }
}

/** Online orders whose checkout was never completed: re-verify with Stripe, then cancel. */
async function expireUnpaidOnline() {
  for (const rid of await restaurants()) {
    const stale = await withCtx(systemCtx(rid), async (tx) => (await tx.query(
      `select o.id, p.id as payment_id from orders o left join payments p on p.order_id = o.id and p.status in ('PENDING','PROCESSING')
       where o.status = 'AWAITING_PAYMENT' and o.created_at < now() - interval '40 minutes'`)).rows);
    for (const o of stale) {
      try {
        if (stripeConfigured()) {
          if (o.payment_id && (await verifyOnlinePayment(rid, o.payment_id)) === 'PAID') continue;
          if (await abandonOnlinePayment(rid, o.id)) continue;
        }
        await withCtx(systemCtx(rid), (tx) => tx.query(
          `update orders set status = 'CANCELLED', cancel_reason = 'Online payment was not completed' where id = $1 and status = 'AWAITING_PAYMENT'`, [o.id]));
      } catch (e: any) {
        console.error('[jobs] expire unpaid order failed', o.id, e?.message);
      }
    }
  }
}

/** Safety net for missed webhooks: re-verify recent in-flight online payments. */
async function reconcileOnline() {
  if (!stripeConfigured()) return;
  for (const rid of await restaurants()) {
    const inflight = await withCtx(systemCtx(rid), async (tx) => (await tx.query(
      `select id from payments where method = 'ONLINE' and status = 'PROCESSING' and created_at > now() - interval '2 hours'
       and updated_at < now() - interval '45 seconds' limit 50`)).rows);
    for (const p of inflight) {
      try { await verifyOnlinePayment(rid, p.id); } catch (e: any) { console.error('[jobs] reconcile failed', p.id, e?.message); }
    }
  }
}

export function startJobs() {
  const run = (name: string, key: number, fn: () => Promise<void>, everyMs: number) => {
    const tick = () => withLock(key, fn).catch((e) => console.error(`[jobs] ${name} failed:`, e.message));
    setTimeout(tick, 5_000).unref();
    setInterval(tick, everyMs).unref();
  };
  run('delay-alerts', 71001, delayAlerts, 30_000);
  run('expire-unpaid', 71002, expireUnpaidOnline, 60_000);
  run('reconcile-online', 71003, reconcileOnline, 60_000);
}
