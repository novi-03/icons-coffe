import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { rawQuery, withCtx } from '../db.js';
import { clearStaffCookie, issueStaffCookie, requireStaff, staffCtx } from '../auth.js';
import { clientIp, parse, rateLimiter } from '../lib/http.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';

export const authRouter = Router();
const loginLimit = rateLimiter(8, 60_000);
// Constant-time-ish failure path: compare against a dummy hash when the user does not exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-' + Math.random(), 11);

authRouter.post('/login', async (req, res) => {
  const body = parse(z.object({
    email: z.string().trim().email().max(200),
    password: z.string().min(1).max(200),
    portal: z.enum(['admin', 'staff', 'kitchen']).optional(),
  }), req.body ?? {});
  loginLimit(`${clientIp(req)}:${body.email.toLowerCase()}`);
  const r = await rawQuery('select * from app.auth_lookup($1)', [body.email]);
  const u = r.rows[0];
  const ok = await bcrypt.compare(body.password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  if (!u.is_active) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated. Please contact your manager.');
  const allowed: Record<string, string[]> = { admin: ['admin'], staff: ['waiter', 'admin'], kitchen: ['kitchen', 'admin'] };
  if (body.portal && !allowed[body.portal].includes(u.role)) {
    throw new HttpError(403, 'WRONG_PORTAL', `This ${u.role} account cannot sign in to the ${body.portal} portal.`);
  }
  await rawQuery('select app.auth_record_login($1)', [u.id]);
  issueStaffCookie(res, u);
  res.json({ user: { id: u.id, name: u.full_name, role: u.role, restaurant_id: u.restaurant_id } });
});

authRouter.post('/logout', (_req, res) => {
  clearStaffCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireStaff(), async (req, res) => {
  const me = await withCtx(staffCtx(req), async (tx) => (await tx.query(
    `select u.id, u.full_name as name, u.email, u.role, u.restaurant_id, sp.is_on_duty, sp.avatar_color, r.name as restaurant_name, r.timezone
     from users u join staff_profiles sp on sp.user_id = u.id join restaurants r on r.id = u.restaurant_id where u.id = app.uid()`)).rows[0]);
  res.json({ user: me, demo_mode: config.demoMode });
});
