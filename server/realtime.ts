/**
 * Real-time delivery. Database triggers publish compact events with pg_notify on
 * COMMIT; this module LISTENs on a dedicated connection and forwards each event
 * only to the sockets entitled to it (by restaurant, role, user, or guest session).
 * Clients treat events as "something changed" signals and refetch through the
 * RLS-protected REST API, so no private data travels over the socket.
 * Running several API instances is safe: each one LISTENs independently.
 */
import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import pg from 'pg';
import cookie from 'cookie-parser';
import { config } from './config.js';
import { GUEST_COOKIE, STAFF_COOKIE, verifyGuestToken, verifyStaffToken, type StaffRole } from './auth.js';
import { withCtx } from './db.js';

interface Client {
  ws: WebSocket;
  restaurantId: string;
  kind: 'staff' | 'guest';
  role?: StaffRole;
  userId?: string;
  guestSessionId?: string;
  alive: boolean;
}

const clients = new Set<Client>();

interface DbEvent {
  t: string; r: string; o?: string; tb?: string; g?: string | null; s?: string; ps?: string; prev?: string | null;
  u?: string | null; role?: string | null; nt?: string; n?: string; p?: string; q?: string; i?: string;
}

const STAFF_TOPICS: Record<string, StaffRole[]> = {
  'order.changed': ['admin', 'kitchen', 'waiter'],
  'payment.changed': ['admin', 'waiter'],
  'request.changed': ['admin', 'waiter'],
  'review.created': ['admin'],
  'menu.changed': ['admin', 'kitchen', 'waiter'],
  'table.changed': ['admin', 'waiter', 'kitchen'],
  'staff.changed': ['admin', 'waiter'],
  'inventory.changed': ['admin', 'kitchen'],
};
const GUEST_TOPICS = new Set(['order.changed', 'payment.changed', 'request.changed', 'review.created']);

function route(ev: DbEvent) {
  for (const c of clients) {
    if (c.restaurantId !== ev.r || c.ws.readyState !== WebSocket.OPEN) continue;
    let msg: Record<string, unknown> | null = null;
    if (c.kind === 'staff') {
      if (ev.t === 'notification') {
        if ((ev.u && ev.u === c.userId) || (!ev.u && ev.role === c.role)) msg = { t: ev.t, n: ev.n, nt: ev.nt, o: ev.o };
      } else if (STAFF_TOPICS[ev.t]?.includes(c.role!)) {
        // Kitchen never hears about unpaid online orders.
        if (c.role === 'kitchen' && ev.t === 'order.changed' && ev.s === 'AWAITING_PAYMENT') continue;
        msg = { t: ev.t, o: ev.o, tb: ev.tb, s: ev.s, ps: ev.ps, prev: ev.prev, q: ev.q, i: ev.i };
      }
    } else {
      if (ev.t === 'menu.changed') msg = { t: ev.t };
      else if (GUEST_TOPICS.has(ev.t) && ev.g && ev.g === c.guestSessionId) msg = { t: ev.t, o: ev.o, s: ev.s, ps: ev.ps, prev: ev.prev };
    }
    if (msg) c.ws.send(JSON.stringify(msg));
  }
}

let listener: pg.Client | null = null;
let stopping = false;

async function listen() {
  const c = new pg.Client({ connectionString: config.databaseUrl });
  c.on('notification', (m) => {
    if (!m.payload) return;
    try {
      route(JSON.parse(m.payload));
    } catch (e) {
      console.error('[realtime] bad event', e);
    }
  });
  c.on('error', (e) => {
    console.error('[realtime] listener error:', e.message);
  });
  c.on('end', () => {
    listener = null;
    if (!stopping) {
      console.warn('[realtime] listener disconnected — reconnecting in 2s');
      // Tell clients to resync: they may have missed events while we were down.
      for (const cl of clients) if (cl.ws.readyState === WebSocket.OPEN) cl.ws.send(JSON.stringify({ t: 'resync' }));
      setTimeout(() => listen().catch((e) => console.error('[realtime] reconnect failed', e.message)), 2000);
    }
  });
  await c.connect();
  await c.query('listen icons_events');
  listener = c;
}

export async function attachRealtime(server: Server) {
  await listen();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const parseCookies = cookie();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws') return socket.destroy();
    // Reuse cookie-parser on the raw upgrade request.
    parseCookies(req as any, {} as any, async () => {
      try {
        const cookies = (req as any).cookies ?? {};
        const as = url.searchParams.get('as');
        let client: Omit<Client, 'ws' | 'alive'> | null = null;
        if (as === 'staff') {
          const s = await verifyStaffToken(cookies[STAFF_COOKIE]);
          if (s) client = { kind: 'staff', restaurantId: s.restaurantId, role: s.role, userId: s.userId };
        } else if (as === 'guest') {
          const g = await verifyGuestToken(cookies[GUEST_COOKIE]);
          if (g) client = { kind: 'guest', restaurantId: g.restaurantId, guestSessionId: g.guestSessionId };
        }
        if (!client) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          return socket.destroy();
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          const c: Client = { ...client!, ws, alive: true };
          clients.add(c);
          ws.on('pong', () => { c.alive = true; });
          ws.on('message', () => { /* clients do not send commands over the socket */ });
          ws.on('close', () => clients.delete(c));
          ws.send(JSON.stringify({ t: 'hello', kind: c.kind }));
          if (c.kind === 'staff') touchStaff(c).catch(() => {});
        });
      } catch (e) {
        console.error('[realtime] upgrade failed', e);
        socket.destroy();
      }
    });
  });

  // Heartbeat: drop dead sockets, record staff presence.
  const hb = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { c.ws.terminate(); clients.delete(c); continue; }
      c.alive = false;
      c.ws.ping();
      if (c.kind === 'staff') touchStaff(c).catch(() => {});
    }
  }, 25_000);
  hb.unref();
}

const lastTouch = new Map<string, number>();
async function touchStaff(c: Client) {
  const now = Date.now();
  if ((lastTouch.get(c.userId!) ?? 0) > now - 60_000) return;
  lastTouch.set(c.userId!, now);
  await withCtx({ role: c.role!, restaurantId: c.restaurantId, userId: c.userId }, (tx) =>
    tx.query(`update staff_profiles set last_seen_at = now() where user_id = $1`, [c.userId]));
}

export async function stopRealtime() {
  stopping = true;
  for (const c of clients) c.ws.close(1001, 'server shutting down');
  await listener?.end().catch(() => {});
}

export const realtimeStats = () => ({ clients: clients.size, listening: !!listener });
