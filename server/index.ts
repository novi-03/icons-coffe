import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { config, stripeConfigured } from './config.js';
import { pool } from './db.js';
import { HttpError, fromDbError } from './lib/errors.js';
import { attachRealtime, realtimeStats, stopRealtime } from './realtime.js';
import { startJobs } from './jobs.js';
import { authRouter } from './routes/auth.js';
import { guestRouter } from './routes/guest.js';
import { kitchenRouter } from './routes/kitchen.js';
import { staffRouter } from './routes/staff.js';
import { adminRouter } from './routes/admin.js';
import { notificationsRouter } from './routes/notifications.js';
import { mediaRouter } from './routes/media.js';
import { webhooksRouter } from './routes/webhooks.js';
import { demoRouter } from './routes/demo.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Webhooks need the raw body, so they are mounted before the JSON parser.
app.use('/api/webhooks', webhooksRouter);
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

// CSRF defence: every state-changing API call must carry a custom header, which
// browsers only send from our own origin (cross-site requests would need a CORS preflight we never grant).
app.use('/api', (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-icons-client') !== 'web') return next(new HttpError(403, 'CSRF', 'Missing client header'));
  next();
});
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', async (_req, res) => {
  const db = await pool.query('select 1').then(() => true).catch(() => false);
  res.status(db ? 200 : 503).json({ ok: db, db, realtime: realtimeStats(), stripe: stripeConfigured() });
});

app.use('/api/auth', authRouter);
app.use('/api/guest', guestRouter);
app.use('/api/kitchen', kitchenRouter);
app.use('/api/staff', staffRouter);
app.use('/api/admin', adminRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/demo', demoRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Unknown API endpoint')));

// Built web app (npm run build) — single origin for API, WebSocket and UI.
const dist = path.resolve(import.meta.dirname, '../web/dist');
if (fs.existsSync(dist)) {
  const csp = [
    "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "connect-src 'self' ws: wss:", "script-src 'self'", "frame-ancestors 'none'",
    "base-uri 'self'", "form-action 'self'",
  ].join('; ');
  app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => {
    if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  app.get('/{*splat}', (_req, res) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  let e: HttpError | null = err instanceof HttpError ? err : fromDbError(err);
  if (!e && err?.type === 'entity.parse.failed') e = new HttpError(400, 'BAD_JSON', 'Request body is not valid JSON');
  if (!e && err?.code === 'LIMIT_FILE_SIZE') e = new HttpError(413, 'FILE_TOO_LARGE', 'Image must be 3 MB or smaller');
  if (!e && err?.type === 'StripeInvalidRequestError') e = new HttpError(502, 'PAYMENT_PROVIDER_ERROR', `Payment provider: ${err.message}`);
  if (!e && typeof err?.type === 'string' && err.type.startsWith('Stripe')) {
    e = new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'The payment provider is not reachable right now. Please try again.');
  }
  if (!e) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    e = new HttpError(500, 'SERVER_ERROR', 'Something went wrong on our side. Please try again.');
  }
  res.status(e.status).json({ error: { code: e.code, message: e.message } });
});

const server = http.createServer(app);
await attachRealtime(server);
startJobs();
server.listen(config.port, () => {
  console.log(`ICONS Coffee API listening on http://localhost:${config.port} (${config.isProd ? 'production' : 'development'})`);
  if (!stripeConfigured()) console.warn('[config] STRIPE_SECRET_KEY not set — online payment is disabled (cash/counter still work).');
  if (stripeConfigured() && !config.stripe.webhookSecret) console.warn('[config] STRIPE_WEBHOOK_SECRET not set — payments are verified on return + by the reconcile job.');
});

const shutdown = async () => {
  console.log('Shutting down…');
  server.close();
  await stopRealtime();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
