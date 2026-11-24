/**
 * Online payments against the real Stripe API (test mode). An order paid online is
 * held back from the kitchen until Stripe confirms payment; nothing is simulated.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, expectStatus, placeOrder } from '../helpers.ts';

const admin = new Client('admin');
const kitchen = new Client('kitchen');

before(async () => {
  await admin.login('admin@iconscoffee.demo', 'admin');
  await admin.patch('/admin/settings', { order_mode: 'OPEN' });
  await kitchen.login('kitchen@iconscoffee.demo', 'kitchen');
  const s = await admin.get('/admin/settings');
  if (!s.integrations.stripe) throw new Error('STRIPE_SECRET_KEY is not configured — online payment tests need Stripe test mode');
});

describe('Online payment (Stripe Checkout, test mode)', () => {
  it('an online order waits for payment and is invisible to the kitchen', async () => {
    const g = new Client(); await g.scan(13);
    const kLive = await kitchen.listen('staff');
    const res = await placeOrder(g, ['Flat White'], 'ONLINE');
    assert.equal(res.order.status, 'AWAITING_PAYMENT');
    assert.match(res.checkout.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
    const k = await kitchen.get('/kitchen/orders');
    assert.ok(!k.active.some((o: any) => o.id === res.order.id), 'not on the kitchen display');
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(!kLive.events.some((e) => e.o === res.order.id), 'no realtime event to kitchen');
    kLive.close();

    // Verification asks Stripe: the session is open and unpaid, so nothing is marked paid.
    const v = await g.post(`/guest/orders/${res.order.id}/verify-payment`);
    assert.equal(v.status, 'PROCESSING');
    assert.equal(v.order.payment_status, 'PROCESSING');

    // Asking to pay again reuses the same open session — no duplicate payment record.
    const again = await g.post(`/guest/orders/${res.order.id}/payment`, { method: 'ONLINE' });
    assert.equal(again.checkout.checkoutUrl, res.checkout.checkoutUrl);
    const d = await g.get(`/guest/orders/${res.order.id}`);
    assert.equal(d.payments.length, 1);
    assert.equal(d.payments[0].status, 'PROCESSING');
  });

  it('switching an unpaid online order to cash closes the Stripe session and sends the order to the kitchen', async () => {
    const g = new Client(); await g.scan(13);
    const res = await placeOrder(g, ['Cappuccino'], 'ONLINE');
    const sw = await g.post(`/guest/orders/${res.order.id}/payment`, { method: 'CASH' });
    assert.equal(sw.order.status, 'RECEIVED');
    assert.equal(sw.order.payment_method, 'CASH');
    assert.equal(sw.order.payment_status, 'PENDING');
    const d = await g.get(`/guest/orders/${res.order.id}`);
    assert.deepEqual(d.payments.map((p: any) => `${p.method}:${p.status}`).sort(), ['CASH:PENDING', 'ONLINE:CANCELLED']);
    const k = await kitchen.get('/kitchen/orders');
    assert.ok(k.active.some((o: any) => o.id === res.order.id), 'now on the kitchen display');
    await expectStatus(g.post(`/guest/orders/${res.order.id}/payment`, { method: 'ONLINE' }), 409);
  });

  it('a customer can abandon an unpaid online order; it never reaches the kitchen', async () => {
    const g = new Client(); await g.scan(13);
    const res = await placeOrder(g, ['Espresso'], 'ONLINE');
    const c = await g.post(`/guest/orders/${res.order.id}/cancel`);
    assert.equal(c.order.status, 'CANCELLED');
    assert.equal(c.order.payment_status, 'CANCELLED');
  });

  it('staff can never mark an online payment as paid by hand', async () => {
    const g = new Client(); await g.scan(13);
    const res = await placeOrder(g, ['Espresso'], 'ONLINE');
    const p = (await admin.get(`/admin/orders/${res.order.id}`)).payments[0];
    const r = await expectStatus(admin.post(`/admin/payments/${p.id}/confirm`), 403);
    assert.match(r.error.message, /confirmed by the payment provider/);
    await g.post(`/guest/orders/${res.order.id}/cancel`);
  });

  it('webhook calls without a valid Stripe signature are rejected', async () => {
    const res = await fetch('http://localhost:3000/api/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"checkout.session.completed"}' });
    assert.ok([400, 503].includes(res.status), `got ${res.status}`);
  });
});
