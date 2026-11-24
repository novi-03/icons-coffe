/**
 * Browser end-to-end test: four devices at once, driven through the real UI.
 * Customer (phone) → Kitchen (tablet) → Waiter (phone) → Admin (desktop), with no page refreshes.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { BASE, Client, demoPassword } from '../helpers.ts';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const SHOTS = process.env.E2E_SHOTS_DIR;
let browser: any;
const pages: Record<string, any> = {};
const consoleErrors: string[] = [];

async function newPage(name: string, opts: any) {
  const ctx = await browser.newContext({ ...opts, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e: Error) => consoleErrors.push(`${name}: ${e.message}`));
  page.on('console', (m: any) => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) consoleErrors.push(`${name}: ${m.text()}`); });
  pages[name] = page;
  return page;
}
async function login(page: any, path: string, email: string) {
  await page.goto(BASE + path);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(demoPassword(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
}
const shot = async (name: string, page: any) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };

describe('UI: complete lifecycle across all four interfaces', () => {
  let orderNumber = '';
  before(async () => {
    const admin = new Client(); await admin.login('admin@iconscoffee.demo');
    await admin.patch('/admin/settings', { order_mode: 'OPEN' });
    browser = await chromium.launch();
  });
  after(async () => { await browser?.close(); });

  it('staff sign in to kitchen, waiter and admin interfaces', async () => {
    const k = await newPage('kitchen', { viewport: { width: 1366, height: 1024 } });
    await login(k, '/kitchen', 'kitchen@iconscoffee.demo');
    await k.getByRole('button', { name: /Start kitchen display/ }).click();
    await k.getByRole('heading', { name: /New orders/i }).waitFor();
    const w = await newPage('waiter', devices['Pixel 7']);
    await login(w, '/staff', 'omar@iconscoffee.demo');
    await w.getByText('My tables').waitFor();
    const a = await newPage('admin', { viewport: { width: 1440, height: 900 } });
    await login(a, '/admin', 'admin@iconscoffee.demo');
    await a.getByText("Today's revenue").waitFor();
    await a.goto(BASE + '/admin/orders');
  });

  it('customer scans the Table 05 QR code, customises items and places a cash order', async () => {
    const c = await newPage('customer', devices['iPhone 13']);
    const demo = await (await fetch(BASE + '/api/demo')).json();
    await c.goto(BASE + demo.tables.find((t: any) => t.number === 5).path);
    await c.waitForURL('**/menu');
    await c.getByText('TABLE 05').first().waitFor();
    // Signature Latte: Medium + Oat milk
    await c.getByRole('button', { name: 'Add Signature Latte' }).click();
    await c.getByLabel('Medium').check();
    await c.getByLabel('Oat milk').check();
    await c.getByRole('button', { name: /^Add · AED 28\.00$/ }).click();
    // Chicken Sandwich with a special instruction
    await c.getByRole('button', { name: 'Add Chicken Sandwich' }).click();
    await c.getByLabel(/Special instructions/).fill('No tomato please');
    await c.getByRole('button', { name: /^Add · AED 42\.00$/ }).click();
    // Refresh must not lose the cart.
    await c.reload();
    await c.getByRole('link', { name: /Cart/ }).click();
    await c.getByText('Medium · Oat milk').waitFor();
    await c.getByText('AED 70.00').first().waitFor();
    await c.getByRole('radio', { name: /Cash at table/ }).click();
    await shot('e2e-customer-cart', c);
    await c.getByRole('button', { name: /Place order · AED 70\.00/ }).click();
    await c.waitForURL('**/order/**');
    const header = await c.getByText(/Order #ICN\d+ · Table 05/).textContent();
    orderNumber = /ICN\d+/.exec(header!)![0];
    await c.getByText('We have your order').waitFor();
  });

  it('kitchen sees the new ticket instantly and moves it through preparation', async () => {
    const k = pages.kitchen;
    const ticket = k.getByTestId(`ticket-${orderNumber}`);
    await ticket.waitFor({ timeout: 5000 });
    assert.ok(await ticket.getByText('No tomato please').isVisible());
    await shot('e2e-kitchen-new', k);
    await ticket.getByRole('button', { name: 'ACCEPT ORDER' }).click();
    await pages.customer.getByText('The kitchen has accepted your order').waitFor();
    // The assigned waiter sees the order on their own list and may take the serving task.
    const w = pages.waiter;
    await w.getByRole('tab', { name: /Orders/ }).click();
    await w.getByTestId(`waiter-order-${orderNumber}`).getByRole('button', { name: 'Accept serving task' }).click();
    await w.getByTestId(`waiter-order-${orderNumber}`).getByText('Your task').waitFor();
    await w.getByRole('tab', { name: /Ready/ }).click();
    await ticket.getByRole('button', { name: 'START PREPARING' }).click();
    await pages.customer.getByText('Your order is being prepared').waitFor();
    await ticket.getByRole('button', { name: 'MARK AS READY' }).click();
  });

  it('the assigned waiter immediately gets the full-screen READY TO SERVE alert', async () => {
    const w = pages.waiter;
    const alert = w.getByRole('alertdialog');
    await alert.waitFor({ timeout: 5000 });
    assert.equal(await alert.getByText('TABLE 05').textContent(), 'TABLE 05');
    await alert.getByText(`ORDER #${orderNumber}`).waitFor();
    await alert.getByText('2 ITEMS READY TO SERVE').waitFor();
    await shot('e2e-waiter-alert', w);
    await alert.getByRole('button', { name: 'COLLECT ORDER' }).click();
    // Our alert clears; any other queued ready orders (from earlier activity) are deferred with "Later".
    await w.getByRole('alertdialog').filter({ hasText: `ORDER #${orderNumber}` }).waitFor({ state: 'detached' });
    while (await w.getByRole('alertdialog').isVisible()) await w.getByRole('button', { name: /Later/ }).click();
    await pages.kitchen.getByTestId(`ticket-${orderNumber}`).getByText(/Collected by Omar Khalid/).waitFor();
    const card = w.getByTestId(`waiter-order-${orderNumber}`);
    await card.getByRole('button', { name: /MARK AS SERVED/ }).click();
    await card.waitFor({ state: 'detached' });
  });

  it('customer tracking updates to Served without refreshing', async () => {
    await pages.customer.getByText('Enjoy! Your order has been served').waitFor();
    await shot('e2e-customer-served', pages.customer);
  });

  it('waiter confirms the cash payment; order completes and the customer leaves a review', async () => {
    const w = pages.waiter;
    await w.getByRole('tab', { name: /Bills/ }).click();
    await w.getByTestId(`bill-${orderNumber}`).getByRole('button', { name: 'Confirm received' }).click();
    const c = pages.customer;
    await c.getByText('All done — thank you for visiting').waitFor();
    await c.getByRole('radio', { name: '5 stars' }).click();
    await c.getByPlaceholder(/Tell us about/).fill('Fantastic latte and quick service');
    await c.getByRole('button', { name: 'Submit review' }).click();
    await c.getByText('Thanks for your review!').waitFor();
  });

  it('admin sees the completed, paid order in real time', async () => {
    const a = pages.admin;
    const row = a.locator('tr', { hasText: `#${orderNumber}` });
    await row.getByText('Completed').waitFor({ timeout: 5000 });
    await row.getByText('Paid').waitFor();
    await row.click();
    await a.getByText('Customer review').waitFor();
    await a.getByText('Fantastic latte and quick service').waitFor();
    await shot('e2e-admin-order', a);
  });

  it('survives a network interruption: offline customer catches up after reconnecting', async () => {
    const c = pages.customer;
    await c.goto(BASE + '/menu');
    await c.getByRole('button', { name: 'Add Espresso' }).click();
    await c.getByRole('link', { name: /Cart/ }).click();
    await c.getByRole('radio', { name: /Pay at counter/ }).click();
    await c.getByRole('button', { name: /Place order/ }).click();
    await c.waitForURL('**/order/**');
    const num = /ICN\d+/.exec((await c.getByText(/Order #ICN\d+/).textContent())!)![0];
    await c.context().setOffline(true);
    await c.evaluate(() => window.dispatchEvent(new Event('offline')));
    await pages.kitchen.getByTestId(`ticket-${num}`).getByRole('button', { name: 'ACCEPT ORDER' }).click();
    await c.context().setOffline(false);
    await c.evaluate(() => window.dispatchEvent(new Event('online')));
    await c.getByText('The kitchen has accepted your order').waitFor({ timeout: 10000 });
  });

  it('no JavaScript errors occurred in any interface', () => {
    assert.deepEqual(consoleErrors, []);
  });
});
