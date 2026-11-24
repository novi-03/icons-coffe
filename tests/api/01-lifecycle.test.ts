/**
 * PART 7 — the complete order lifecycle, exactly as specified, with live
 * WebSocket listeners for every role to prove nothing depends on refreshing.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, defaults, expectStatus } from '../helpers.ts';

const admin = new Client('admin');
const kitchen = new Client('kitchen');
const omar = new Client('omar');   // assigned to tables 1–7
const sara = new Client('sara');   // assigned to tables 8–14
const customer = new Client('table-05');

describe('Complete order lifecycle (Table 05)', () => {
  let rt: Record<string, Awaited<ReturnType<Client['listen']>>> = {};
  let orderId = '';
  let orderNumber = '';
  let total = 0;
  let revenueBefore = 0;

  before(async () => {
    await admin.login('admin@iconscoffee.demo', 'admin');
    await admin.patch('/admin/settings', { order_mode: 'OPEN' }); // tests must not depend on the clock
    await kitchen.login('kitchen@iconscoffee.demo', 'kitchen');
    await omar.login('omar@iconscoffee.demo', 'staff');
    await sara.login('sara@iconscoffee.demo', 'staff');
    revenueBefore = Number((await admin.get('/admin/overview')).kpis.revenue_today);
  });
  after(() => Object.values(rt).forEach((r) => r.close()));

  it('STEP 1 — scanning the Table 05 QR code identifies restaurant and table automatically', async () => {
    const s = await customer.scan(5);
    assert.equal(s.table.number, 5);
    assert.equal(s.restaurant.name, 'ICONS Coffee');
    assert.ok(customer.cookies.has('icons_guest'), 'guest session cookie issued');
    const ctx = await customer.get('/guest/context');
    assert.equal(ctx.table.number, 5);
    for (const [name, c] of Object.entries({ admin, kitchen, omar, sara })) rt[name] = await c.listen('staff');
    rt.customer = await customer.listen('guest');
  });

  it('STEP 2–4 — customer selects 1 Signature Latte + 1 Chicken Sandwich and checks out with cash', async () => {
    const menu = await customer.get('/guest/menu');
    assert.equal(menu.categories.length, 7);
    const latte = menu.items.find((i: any) => i.name === 'Signature Latte');
    const sandwich = menu.items.find((i: any) => i.name === 'Chicken Sandwich');
    const res = await customer.post('/guest/orders', {
      idempotency_key: crypto.randomUUID(), payment_method: 'CASH',
      items: [
        { menu_item_id: latte.id, quantity: 1, variant_ids: defaults(latte) },
        { menu_item_id: sandwich.id, quantity: 1, variant_ids: defaults(sandwich), special_instructions: 'No tomato' },
      ],
    });
    const o = res.order;
    orderId = o.id; orderNumber = o.order_number; total = o.total_fils;
    assert.match(o.order_number, /^ICN\d+$/);
    assert.equal(o.table_number, 5);
    assert.equal(o.status, 'RECEIVED');
    assert.equal(o.payment_status, 'PENDING');
    assert.equal(o.subtotal_fils, 2200 + 4200);
    assert.equal(o.total_fils, 6400);           // VAT-inclusive pricing
    assert.equal(o.tax_fils, Math.round(6400 * 500 / 10500));
  });

  it('STEP 5 — kitchen receives the new order immediately (realtime, no refresh)', async () => {
    await rt.kitchen.until((e) => e.t === 'order.changed' && e.o === orderId && e.s === 'RECEIVED');
    const k = await kitchen.get('/kitchen/orders');
    const ticket = k.active.find((o: any) => o.id === orderId);
    assert.ok(ticket, 'order on the kitchen display');
    assert.equal(ticket.items.length, 2);
    assert.equal(ticket.items[1].special_instructions, 'No tomato');
    assert.equal(ticket.total_fils, undefined, 'kitchen never receives money fields');
  });

  it('STEP 6 — admin dashboard is notified of the new order', async () => {
    await rt.admin.until((e) => e.t === 'notification' && e.nt === 'NEW_ORDER' && e.o === orderId);
    const list = await admin.get(`/admin/orders?search=${orderNumber}`);
    assert.equal(list.orders[0].id, orderId);
  });

  it('STEP 7–8 — kitchen accepts, then starts preparing; customer tracking follows live', async () => {
    await kitchen.post(`/kitchen/orders/${orderId}/status`, { status: 'ACCEPTED' });
    await rt.customer.until((e) => e.o === orderId && e.s === 'ACCEPTED');
    await kitchen.post(`/kitchen/orders/${orderId}/status`, { status: 'PREPARING' });
    await rt.customer.until((e) => e.o === orderId && e.s === 'PREPARING');
    const g = await customer.get(`/guest/orders/${orderId}`);
    assert.equal(g.order.status, 'PREPARING');
    assert.ok(g.order.accepted_at && g.order.preparing_at);
  });

  it('STEP 9–10 — MARK AS READY instantly notifies the ASSIGNED waiter only', async () => {
    await kitchen.post(`/kitchen/orders/${orderId}/status`, { status: 'READY' });
    const ev = await rt.omar.until((e) => e.t === 'notification' && e.nt === 'ORDER_READY' && e.o === orderId);
    assert.ok(ev.n);
    const n = (await omar.get('/notifications')).notifications.find((x: any) => x.order_id === orderId && x.type === 'ORDER_READY');
    assert.equal(n.title, 'TABLE 05');
    assert.equal(n.body, `ORDER #${orderNumber} · 2 ITEMS READY TO SERVE`);
    assert.equal(n.data.itemCount, 2);
    // Sara (not assigned to table 5) must not get it.
    const saraN = (await sara.get('/notifications')).notifications.filter((x: any) => x.order_id === orderId && x.type === 'ORDER_READY');
    assert.equal(saraN.length, 0);
    assert.ok(!rt.sara.events.some((e) => e.t === 'notification' && e.o === orderId));
    // Admin dashboard + customer see READY.
    await rt.admin.until((e) => e.t === 'order.changed' && e.o === orderId && e.s === 'READY');
    const ready = await rt.customer.until((e) => e.o === orderId && e.s === 'READY');
    assert.equal(ready.prev, 'PREPARING', 'customer can tell a real transition from a same-status update');
  });

  it('STEP 11–12 — waiter collects the order and marks it SERVED', async () => {
    await expectStatus(sara.post(`/staff/orders/${orderId}/serve`), 403); // another waiter's table
    const c = await omar.post(`/staff/orders/${orderId}/collect`);
    assert.ok(c.order.collected_at);
    const s = await omar.post(`/staff/orders/${orderId}/serve`);
    assert.equal(s.order.status, 'SERVED');
    assert.ok(s.order.served_at);
    const n = (await omar.get('/notifications')).notifications.find((x: any) => x.order_id === orderId && x.type === 'ORDER_READY');
    assert.ok(n.acknowledged_at, 'ready alert acknowledged on collect');
  });

  it('STEP 13 — customer sees the SERVED status live', async () => {
    await rt.customer.until((e) => e.o === orderId && e.s === 'SERVED');
    assert.equal((await customer.get(`/guest/orders/${orderId}`)).order.status, 'SERVED');
  });

  it('cash payment stays PENDING until staff confirm it; then the order auto-completes', async () => {
    const board = await omar.get('/staff/board');
    const pay = board.payments.find((p: any) => p.order_id === orderId);
    assert.equal(pay.amount_fils, total);
    await expectStatus(kitchen.post(`/staff/payments/${pay.id}/confirm`), 403);
    await omar.post(`/staff/payments/${pay.id}/confirm`);
    await omar.post(`/staff/payments/${pay.id}/confirm`); // idempotent double tap
    await rt.customer.until((e) => e.o === orderId && e.s === 'COMPLETED');
    const g = await customer.get(`/guest/orders/${orderId}`);
    assert.equal(g.order.status, 'COMPLETED');
    assert.equal(g.order.payment_status, 'PAID');
    assert.equal(g.payments.length, 1, 'exactly one payment record');
    assert.match(g.payments[0].transaction_ref, /^TXN-\d{6}-\d+$/);
  });

  it('STEP 14 — customer submits a rating and review (only once)', async () => {
    const r = await customer.post(`/guest/orders/${orderId}/review`, { rating: 5, comment: 'Lovely latte!' });
    assert.equal(r.review.rating, 5);
    await expectStatus(customer.post(`/guest/orders/${orderId}/review`, { rating: 1 }), 409);
    await rt.admin.until((e) => e.t === 'notification' && e.nt === 'NEW_REVIEW');
  });

  it('STEP 15 — admin sees the completed order with payment, history and revenue', async () => {
    const d = await admin.get(`/admin/orders/${orderId}`);
    assert.equal(d.order.status, 'COMPLETED');
    assert.equal(d.payments[0].status, 'PAID');
    assert.equal(d.payments[0].confirmed_by_name, 'Omar Khalid');
    assert.equal(d.review.rating, 5);
    const flow = d.events.filter((e: any) => e.event_type === 'STATUS_CHANGED').map((e: any) => e.to_status);
    assert.deepEqual(flow, ['ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED']);
    assert.equal(d.events.find((e: any) => e.to_status === 'READY').actor_name, 'Marco Rossi');
    const revenueAfter = Number((await admin.get('/admin/overview')).kpis.revenue_today);
    assert.equal(revenueAfter - revenueBefore, total);
    const csv = await admin.req('GET', `/admin/reports/orders?format=csv`);
    assert.ok(String(csv).includes(orderNumber), 'order appears in CSV export');
  });
});
