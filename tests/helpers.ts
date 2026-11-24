import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

export const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const credsFile = path.resolve(import.meta.dirname, '../.demo-credentials.json');

export function demoPassword(email: string): string {
  const c = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
  const a = c.accounts.find((x: any) => x.email === email);
  if (!a) throw new Error(`No demo account ${email} — run npm run db:reset`);
  return a.password;
}

export class ApiResponseError extends Error {
  constructor(public status: number, public body: any) { super(`${status} ${JSON.stringify(body)}`); }
}

/** Minimal HTTP client with its own cookie jar (one per simulated browser/device). */
export class Client {
  cookies = new Map<string, string>();
  constructor(public name = 'client') {}
  cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req<T = any>(method: string, p: string, body?: unknown, opts: { csrf?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { cookie: this.cookieHeader() };
    if (opts.csrf !== false) headers['x-icons-client'] = 'web';
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + '/api' + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (!v || /Expires=Thu, 01 Jan 1970/i.test(sc)) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    const text = await res.text();
    const data = text ? (res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text) : null;
    if (!res.ok) throw new ApiResponseError(res.status, data);
    return data as T;
  }
  get<T = any>(p: string) { return this.req<T>('GET', p); }
  post<T = any>(p: string, body: unknown = {}) { return this.req<T>('POST', p, body); }
  patch<T = any>(p: string, body: unknown) { return this.req<T>('PATCH', p, body); }
  put<T = any>(p: string, body: unknown) { return this.req<T>('PUT', p, body); }

  async login(email: string, portal?: 'admin' | 'staff' | 'kitchen') {
    await this.post('/auth/login', { email, password: demoPassword(email), portal });
    return this;
  }
  async scan(tableNumber: number) {
    const demo = await this.get('/demo');
    const t = demo.tables.find((x: any) => x.number === tableNumber);
    const token = t.path.split('/').pop();
    return this.post('/guest/session', { qr_token: token });
  }

  /** Open the realtime socket and record every event. */
  async listen(as: 'staff' | 'guest') {
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?as=${as}`, { headers: { cookie: this.cookieHeader() } });
    const events: any[] = [];
    const waiters: { pred: (e: any) => boolean; resolve: (e: any) => void }[] = [];
    ws.on('message', (m) => {
      const e = JSON.parse(String(m));
      events.push(e);
      for (const w of [...waiters]) if (w.pred(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); }
    });
    await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); ws.once('unexpected-response', (_r, res) => reject(new Error(`ws ${res.statusCode}`))); });
    const until = (pred: (e: any) => boolean, ms = 5000) => {
      const hit = events.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${this.name}: timed out waiting for realtime event`)), ms);
        waiters.push({ pred, resolve: (e) => { clearTimeout(t); resolve(e); } });
      });
    };
    return { ws, events, until, close: () => ws.close() };
  }
}

export async function expectStatus(p: Promise<unknown>, status: number) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiResponseError && e.status === status) return e.body;
    throw e;
  }
  throw new Error(`expected HTTP ${status} but request succeeded`);
}

export function defaults(item: any) {
  return item.variants.filter((v: any) => v.is_default).map((v: any) => v.id);
}

export async function placeOrder(guest: Client, names: string[], method: 'CASH' | 'COUNTER' | 'ONLINE' = 'CASH', key = crypto.randomUUID()) {
  const menu = await guest.get('/guest/menu');
  const items = names.map((n) => {
    const it = menu.items.find((i: any) => i.name === n);
    if (!it) throw new Error(`menu item ${n} missing`);
    return { menu_item_id: it.id, quantity: 1, variant_ids: defaults(it) };
  });
  return guest.post('/guest/orders', { idempotency_key: key, payment_method: method, items });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
