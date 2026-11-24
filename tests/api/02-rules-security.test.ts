/**
 * PART 8 business rules, role permissions (API + database RLS), duplicate
 * submissions, simultaneous orders and notification routing.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import pg from 'pg';
import { Client, defaults, expectStatus, placeOrder } from '../helpers.ts';

const admin = new Client('admin');
const kitchen = new Client('kitchen');
const omar = new Client('omar');
const sara = new Client('sara');
const arjun = new Client('arjun');

before(async () => {
  await admin.login('admin@iconscoffee.demo', 'admin');
  await admin.patch('/admin/settings', { order_mode: 'OPEN' });
  await kitchen.login('kitchen@iconscoffee.demo', 'kitchen');
  await omar.login('omar@iconscoffee.demo', 'staff');
  await sara.login('sara@iconscoffee.demo', 'staff');
  await arjun.login('arjun@iconscoffee.demo', 'staff');
});

describe('QR entry', () => {
  it('rejects unknown QR codes and disabled tables with helpful messages', async () => {
    const g = new Client();
    const bad = await expectStatus(g.post('/guest/session', { qr_token: 'AAAAAAAAAAAAAAAAAAAAAAAA' }), 404);
    assert.match(bad.error.message, /not recognised/);
    const tables = (await admin.get('/admin/tables')).tables;
    const t20 = tables.find((t: any) => t.number === 20);
    await admin.patch(`/admin/tables/${t20.id}`, { is_active: false });
    try {
      const r = await expectStatus(g.post('/guest/session', { qr_token: t20.qr_token }), 409);
      assert.match(r.error.message, /Table 20/);
    } finally {
      await admin.patch(`/admin/tables/${t20.id}`, { is_active: true });
    }
  });

  it('every table has a unique QR token', async () => {
    const tables = (await admin.get('/admin/tables')).tables;
    assert.equal(tables.length, 20);
    assert.equal(new Set(tables.map((t: any) => t.qr_token)).size, 20);
    const png = await fetch(`http://localhost:3000/api/admin/tables/${tables[0].id}/qr.png`, { headers: { cookie: admin.cookieHeader() } });
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.ok((await png.arrayBuffer()).byteLength > 1000);
  });
});

describe('Customer privacy and order integrity', () => {
  it("a customer cannot see another table's orders", async () => {
    const a = new Client(); await a.scan(3);
    const b = new Client(); await b.scan(4);
    const { order } = await placeOrder(a, ['Espresso']);
    await expectStatus(b.get(`/guest/orders/${order.id}`), 404);
    assert.ok(!(await b.get('/guest/orders')).orders.some((o: any) => o.id === order.id));
    await expectStatus(b.post(`/guest/orders/${order.id}/review`, { rating: 1 }), 404);
  });

  it('duplicate submissions (5 concurrent requests, same key) create exactly one order', async () => {
    const g = new Client(); await g.scan(6);
    const key = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => placeOrder(g, ['Americano'], 'CASH', key)));
    assert.equal(new Set(results.map((r) => r.order.id)).size, 1);
    const mine = (await g.get('/guest/orders')).orders.filter((o: any) => o.id === results[0].order.id);
    assert.equal(mine.length, 1);
    const detail = await g.get(`/guest/orders/${results[0].order.id}`);
    assert.equal(detail.payments.length, 1, 'one payment record');
  });

  it('prices come from the server: options from another product are rejected, required choices enforced', async () => {
    const g = new Client(); await g.scan(2);
    const menu = await g.get('/guest/menu');
    const latte = menu.items.find((i: any) => i.name === 'Signature Latte');
    const burger = menu.items.find((i: any) => i.name === 'Wagyu Burger');
    await expectStatus(g.post('/guest/orders', { idempotency_key: crypto.randomUUID(), payment_method: 'CASH',
      items: [{ menu_item_id: latte.id, quantity: 1, variant_ids: [...defaults(latte), burger.variants[3].id] }] }), 400);
    const r = await expectStatus(g.post('/guest/orders', { idempotency_key: crypto.randomUUID(), payment_method: 'CASH',
      items: [{ menu_item_id: latte.id, quantity: 1, variant_ids: [] }] }), 400);
    assert.match(r.error.message, /Please choose one Size/);
    // Extras are priced by the server: Large (+6) + Oat (+3) + extra shot (+4) = 22 + 13 = 35 AED
    const pick = (n: string) => latte.variants.find((v: any) => v.name === n).id;
    const ok = await g.post('/guest/orders', { idempotency_key: crypto.randomUUID(), payment_method: 'COUNTER',
      items: [{ menu_item_id: latte.id, quantity: 2, variant_ids: [pick('Large'), pick('Oat milk'), pick('Extra espresso shot')] }] });
    assert.equal(ok.order.items[0].unit_price_fils, 3500);
    assert.equal(ok.order.total_fils, 7000);
  });

  it('orders cannot be placed while the restaurant is closed', async () => {
    const g = new Client(); await g.scan(2);
    await admin.patch('/admin/settings', { order_mode: 'CLOSED' });
    try {
      const r = await expectStatus(placeOrder(g, ['Espresso']), 409);
      assert.equal(r.error.code, 'RESTAURANT_CLOSED');
    } finally {
      await admin.patch('/admin/settings', { order_mode: 'OPEN' });
    }
  });

  it('reviews are only accepted after the order is served', async () => {
    const g = new Client(); await g.scan(7);
    const { order } = await placeOrder(g, ['Espresso']);
    const r = await expectStatus(g.post(`/guest/orders/${order.id}/review`, { rating: 4 }), 409);
    assert.match(r.error.message, /once your order has been served/);
  });
});

describe('Order state machine', () => {
  it('rejects skipped or backwards transitions', async () => {
    const g = new Client(); await g.scan(1);
    const { order } = await placeOrder(g, ['Espresso']);
    await expectStatus(kitchen.post(`/kitchen/orders/${order.id}/status`, { status: 'READY' }), 409);
    await expectStatus(omar.post(`/staff/orders/${order.id}/serve`), 409);
    await kitchen.post(`/kitchen/orders/${order.id}/status`, { status: 'ACCEPTED' });
    await kitchen.post(`/kitchen/orders/${order.id}/status`, { status: 'ACCEPTED' }); // idempotent double tap
    await expectStatus(kitchen.post(`/kitchen/orders/${order.id}/reject`, { reason: 'too late now' }), 409);
    await expectStatus(admin.post(`/admin/orders/${order.id}/status`, { status: 'SERVED' }), 409);
    // Authorized cancellation with reason, inventory returned.
    const c = await admin.post(`/admin/orders/${order.id}/cancel`, { reason: 'Customer left' });
    assert.equal(c.order.status, 'CANCELLED');
    assert.equal(c.order.payment_status, 'CANCELLED');
    await expectStatus(admin.post(`/admin/orders/${order.id}/status`, { status: 'PREPARING' }), 409);
    const hist = await admin.get(`/admin/orders/${order.id}`);
    assert.ok(hist.events.some((e: any) => e.to_status === 'CANCELLED' && e.details.reason === 'Customer left'));
  });
});

describe('Role-based access control (API layer)', () => {
  it('waiters and kitchen staff cannot use the admin API', async () => {
    await expectStatus(omar.get('/admin/overview'), 403);
    await expectStatus(kitchen.get('/admin/orders'), 403);
    await expectStatus(omar.patch('/admin/settings', { vat_rate_bps: 0 }), 403);
  });
  it('kitchen cannot use waiter/payment endpoints; waiters cannot use kitchen endpoints', async () => {
    await expectStatus(kitchen.get('/staff/board'), 403);
    await expectStatus(omar.get('/kitchen/orders'), 403);
  });
  it('only admins can change menu prices', async () => {
    const menu = await admin.get('/admin/menu');
    const item = menu.items.find((i: any) => i.name === 'Espresso');
    await expectStatus(omar.patch(`/admin/items/${item.id}`, { price_fils: 1 }), 403);
    const g = new Client(); await g.scan(2);
    await expectStatus(g.patch(`/admin/items/${item.id}`, { price_fils: 1 }), 401);
  });
  it('a staff login cannot enter the wrong portal', async () => {
    const c = new Client();
    const r = await expectStatus(c.post('/auth/login', { email: 'omar@iconscoffee.demo', password: (await import('../helpers.ts')).demoPassword('omar@iconscoffee.demo'), portal: 'admin' }), 403);
    assert.equal(r.error.code, 'WRONG_PORTAL');
  });
  it('wrong passwords are rejected and unauthenticated calls get 401', async () => {
    await expectStatus(new Client().post('/auth/login', { email: 'admin@iconscoffee.demo', password: 'nope-nope-nope' }), 401);
    await expectStatus(new Client().get('/kitchen/orders'), 401);
    await expectStatus(new Client().get('/guest/menu'), 401);
  });
  it('state-changing requests without the client header are refused (CSRF)', async () => {
    await expectStatus(admin.req('POST', '/notifications/read-all', {}, { csrf: false }), 403);
  });
  it('deactivating a staff member ends their session immediately', async () => {
    const created = await admin.post('/admin/staff', { email: `temp${Date.now()}@iconscoffee.demo`, full_name: 'Temp Waiter', role: 'waiter', password: 'temporary-pass-123' });
    const t = new Client();
    await t.post('/auth/login', { email: created.user.email, password: 'temporary-pass-123' });
    await t.get('/staff/me');
    await admin.patch(`/admin/staff/${created.user.id}`, { is_active: false });
    await expectStatus(t.get('/staff/me'), 401);
  });
});

describe('Database-level Row Level Security (defence in depth)', () => {
  const asRole = async (role: string, extra: Record<string, string>, sql: string, params: unknown[] = []) => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('begin');
      const rid = (await admin.get('/admin/settings')).restaurant.id;
      await c.query(`select set_config('app.role',$1,true), set_config('app.restaurant_id',$2,true), set_config('app.user_id',$3,true), set_config('app.guest_session_id',$4,true)`,
        [role, rid, extra.user ?? '', extra.guest ?? '']);
      return await c.query(sql, params);
    } finally {
      await c.query('rollback').catch(() => {});
      await c.end();
    }
  };

  it('the API database role cannot bypass RLS or read password hashes', async () => {
    await assert.rejects(asRole('admin', {}, 'select password_hash from users'), /permission denied/);
    const r = await asRole('anon', {}, 'select count(*)::int as c from orders');
    assert.equal(r.rows[0].c, 0, 'no context → no rows');
  });
  it('kitchen staff cannot read payments or change order amounts, even with direct SQL', async () => {
    const r = await asRole('kitchen', {}, 'select count(*)::int as c from payments');
    assert.equal(r.rows[0].c, 0);
    const o = await asRole('admin', {}, `select id from orders where status = 'COMPLETED' limit 1`);
    await assert.rejects(asRole('kitchen', {}, 'update orders set total_fils = 1 where id = $1', [o.rows[0].id]), /ORDER_IMMUTABLE/);
    await assert.rejects(asRole('kitchen', {}, `update orders set status = 'SERVED' where id = $1`, [o.rows[0].id]), /INVALID_TRANSITION/);
  });
  it('a waiter cannot mark an online payment as paid, and nobody can alter a paid amount', async () => {
    await assert.rejects(asRole('admin', {}, `update payments set amount_fils = 1 where status = 'PAID'`), /PAYMENT_IMMUTABLE/);
    const r = await asRole('waiter', {}, `update payments set status = 'PAID' where method = 'ONLINE' and status = 'PROCESSING' returning id`);
    assert.equal(r.rowCount, 0);
  });
  it('a guest session only ever sees its own orders', async () => {
    const r = await asRole('guest', { guest: crypto.randomUUID() }, 'select count(*)::int as c from orders');
    assert.equal(r.rows[0].c, 0);
  });
  it('order history cannot be deleted', async () => {
    await assert.rejects(asRole('admin', {}, 'delete from orders'), /permission denied/);
  });
});

describe('Simultaneous orders — notifications go to the right waiter', () => {
  it('3 tables order at once; each READY alert reaches only that table’s waiter', async () => {
    // Table 5 → Omar, Table 9 → Sara, Table 16 → Arjun (assigned even though off duty).
    const listeners = { omar: await omar.listen('staff'), sara: await sara.listen('staff'), arjun: await arjun.listen('staff') };
    const guests = await Promise.all([5, 9, 16].map(async (n) => { const g = new Client(`t${n}`); await g.scan(n); return g; }));
    const orders = await Promise.all(guests.map((g, i) => placeOrder(g, i === 0 ? ['Cold Brew', 'Truffle Fries'] : i === 1 ? ['Karak Chai'] : ['Fresh Orange Juice', 'Granola Bowl', 'Espresso'])));
    const ids = orders.map((o) => o.order.id);
    // The waiter board flags exactly which orders each waiter may act on.
    const board = await omar.get('/staff/board');
    const flag = (id: string) => board.orders.find((o: any) => o.id === id)?.can_serve;
    assert.deepEqual([flag(ids[0]), flag(ids[1]), flag(ids[2])], [true, false, false]);
    await Promise.all(ids.map(async (id) => {
      for (const s of ['ACCEPTED', 'PREPARING', 'READY']) await kitchen.post(`/kitchen/orders/${id}/status`, { status: s });
    }));
    const expectFor: [keyof typeof listeners, Client, string, number][] = [['omar', omar, ids[0], 2], ['sara', sara, ids[1], 1], ['arjun', arjun, ids[2], 3]];
    for (const [name, client, id, count] of expectFor) {
      await listeners[name].until((e) => e.t === 'notification' && e.nt === 'ORDER_READY' && e.o === id);
      const n = (await client.get('/notifications')).notifications.filter((x: any) => x.type === 'ORDER_READY' && ids.includes(x.order_id));
      assert.deepEqual(n.map((x: any) => x.order_id), [id], `${name} received only their own table`);
      assert.equal(n[0].data.itemCount, count);
    }
    // Each waiter serves their own; a waiter cannot serve someone else's table.
    await expectStatus(omar.post(`/staff/orders/${ids[1]}/serve`), 403);
    await omar.post(`/staff/orders/${ids[0]}/serve`);
    await sara.post(`/staff/orders/${ids[1]}/serve`);
    await arjun.post(`/staff/orders/${ids[2]}/serve`);
    for (const [i, g] of guests.entries()) assert.equal((await g.get(`/guest/orders/${ids[i]}`)).order.status, 'SERVED');
    Object.values(listeners).forEach((l) => l.close());
  });

  it('unassigned tables notify every on-duty waiter, and the first to claim it owns the order', async () => {
    const tables = (await admin.get('/admin/tables')).tables;
    const t10 = tables.find((t: any) => t.number === 10);
    await admin.put(`/admin/tables/${t10.id}/waiter`, { waiter_id: null });
    try {
      const g = new Client(); await g.scan(10);
      const { order } = await placeOrder(g, ['Espresso']);
      for (const s of ['ACCEPTED', 'PREPARING', 'READY']) await kitchen.post(`/kitchen/orders/${order.id}/status`, { status: s });
      const got = async (c: Client) => (await c.get('/notifications')).notifications.some((x: any) => x.order_id === order.id && x.type === 'ORDER_READY');
      assert.ok(await got(omar), 'on-duty Omar notified');
      assert.ok(await got(sara), 'on-duty Sara notified');
      assert.ok(!(await got(arjun)), 'off-duty Arjun not notified');
      await sara.post(`/staff/orders/${order.id}/collect`);
      const r = await expectStatus(omar.post(`/staff/orders/${order.id}/serve`), 409);
      assert.equal(r.error.code, 'ORDER_TAKEN');
      await sara.post(`/staff/orders/${order.id}/serve`);
    } finally {
      await admin.put(`/admin/tables/${t10.id}/waiter`, { waiter_id: (await sara.get('/staff/me')).profile.id });
    }
  });
});

describe('Menu availability sync', () => {
  it('admin marks an item unavailable → customers are told live and cannot order it', async () => {
    const g = new Client(); await g.scan(8);
    const live = await g.listen('guest');
    const menu = await admin.get('/admin/menu');
    const item = menu.items.find((i: any) => i.name === 'Pistachio Kunafa');
    await admin.patch(`/admin/items/${item.id}`, { is_available: false });
    try {
      await live.until((e) => e.t === 'menu.changed');
      const gm = await g.get('/guest/menu');
      assert.equal(gm.items.find((i: any) => i.id === item.id).is_available, false);
      const r = await expectStatus(placeOrder(g, ['Pistachio Kunafa']), 409);
      assert.equal(r.error.code, 'ITEM_UNAVAILABLE');
    } finally {
      await admin.patch(`/admin/items/${item.id}`, { is_available: true });
      live.close();
    }
  });
});

describe('Customer requests', () => {
  it('call waiter → assigned waiter notified → acknowledged → completed; duplicates blocked', async () => {
    const g = new Client(); await g.scan(4);
    const live = await omar.listen('staff');
    const { request } = await g.post('/guest/requests', { type: 'REQUEST_BILL' });
    await live.until((e) => e.t === 'notification' && e.nt === 'WAITER_REQUEST');
    const dup = await expectStatus(g.post('/guest/requests', { type: 'REQUEST_BILL' }), 409);
    assert.match(dup.error.message, /already have an open request/);
    await expectStatus(sara.post(`/staff/requests/${request.id}/ack`), 403);
    await omar.post(`/staff/requests/${request.id}/ack`);
    assert.equal((await g.get('/guest/requests')).requests.find((r: any) => r.id === request.id).status, 'ACKNOWLEDGED');
    await omar.post(`/staff/requests/${request.id}/complete`);
    assert.equal((await g.get('/guest/requests')).requests.find((r: any) => r.id === request.id).status, 'COMPLETED');
    live.close();
  });
});

describe('Inventory', () => {
  it('accepting an order consumes configured ingredients; low stock raises an admin alert', async () => {
    const inv = async () => (await admin.get('/admin/inventory')).items.find((i: any) => i.name === 'Matcha Powder');
    const before = await inv();
    // Bring matcha to just above its alert level so one order crosses it.
    const target = before.low_stock_threshold + 2;
    if (target !== before.quantity) await admin.post(`/admin/inventory/${before.id}/adjust`, { delta: target - before.quantity, reason: 'ADJUSTMENT', note: 'test setup' });
    const adminLive = await admin.listen('staff');
    const g = new Client(); await g.scan(11);
    const { order } = await placeOrder(g, ['Matcha Latte']);
    await kitchen.post(`/kitchen/orders/${order.id}/status`, { status: 'ACCEPTED' });
    const after = await inv();
    assert.equal(Number((after.quantity).toFixed(3)), Number((target - 4).toFixed(3)), '4 g matcha used');
    await adminLive.until((e) => e.t === 'notification' && e.nt === 'LOW_STOCK');
    await expectStatus(admin.post(`/admin/inventory/${before.id}/adjust`, { delta: -999999, reason: 'WASTE' }), 400);
    adminLive.close();
  });
});
