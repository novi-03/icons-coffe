import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { rawQuery, type DbContext } from './db.js';
import { forbidden, unauthorized, HttpError } from './lib/errors.js';

export type StaffRole = 'admin' | 'waiter' | 'kitchen';
export interface StaffSession { userId: string; restaurantId: string; role: StaffRole; name: string }
export interface GuestSession { guestSessionId: string; restaurantId: string; tableId: string }

export const STAFF_COOKIE = 'icons_staff';
export const GUEST_COOKIE = 'icons_guest';
const STAFF_TTL_S = 12 * 3600;
export const GUEST_TTL_S = 12 * 3600;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { staff?: StaffSession; guest?: GuestSession }
  }
}

const cookieOpts = (maxAgeS: number) => ({
  httpOnly: true, sameSite: 'lax' as const, secure: config.cookieSecure, path: '/', maxAge: maxAgeS * 1000,
});

export function issueStaffCookie(res: Response, u: { id: string; restaurant_id: string; role: string; token_version: number }) {
  const token = jwt.sign({ sub: u.id, rid: u.restaurant_id, role: u.role, tv: u.token_version, typ: 'staff' }, config.jwtSecret,
    { expiresIn: STAFF_TTL_S, algorithm: 'HS256' });
  res.cookie(STAFF_COOKIE, token, cookieOpts(STAFF_TTL_S));
}
export function issueGuestCookie(res: Response, g: { id: string; restaurant_id: string; table_id: string }) {
  const token = jwt.sign({ gs: g.id, rid: g.restaurant_id, tb: g.table_id, typ: 'guest' }, config.jwtSecret,
    { expiresIn: GUEST_TTL_S, algorithm: 'HS256' });
  res.cookie(GUEST_COOKIE, token, cookieOpts(GUEST_TTL_S));
}
export const clearStaffCookie = (res: Response) => res.clearCookie(STAFF_COOKIE, { path: '/' });

/** Verifies the signed staff token AND re-checks the account in the DB, so deactivation/role changes apply immediately. */
export async function verifyStaffToken(token: string | undefined): Promise<StaffSession | null> {
  if (!token) return null;
  let p: any;
  try {
    p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  if (p?.typ !== 'staff' || typeof p.sub !== 'string') return null;
  const r = await rawQuery('select * from app.auth_session_check($1)', [p.sub]);
  const u = r.rows[0];
  if (!u || !u.is_active || u.role !== p.role || u.token_version !== p.tv || u.restaurant_id !== p.rid) return null;
  return { userId: p.sub, restaurantId: u.restaurant_id, role: u.role, name: u.full_name };
}

export async function verifyGuestToken(token: string | undefined): Promise<GuestSession | null> {
  if (!token) return null;
  let p: any;
  try {
    p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  if (p?.typ !== 'guest' || typeof p.gs !== 'string') return null;
  const r = await rawQuery('select * from app.guest_session_check($1)', [p.gs]);
  const g = r.rows[0];
  if (!g || new Date(g.expires_at).getTime() < Date.now() || g.table_id !== p.tb) return null;
  return { guestSessionId: p.gs, restaurantId: g.restaurant_id, tableId: g.table_id };
}

export function requireStaff(...roles: StaffRole[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const s = await verifyStaffToken(req.cookies?.[STAFF_COOKIE]);
    if (!s) return next(unauthorized());
    if (roles.length && !roles.includes(s.role)) {
      return next(forbidden(`This area is restricted to ${roles.join(' / ')} accounts`));
    }
    req.staff = s;
    next();
  };
}

export async function requireGuest(req: Request, _res: Response, next: NextFunction) {
  const g = await verifyGuestToken(req.cookies?.[GUEST_COOKIE]);
  if (!g) return next(new HttpError(401, 'NO_TABLE_SESSION', 'Your table session has expired. Please scan the QR code on your table again.'));
  req.guest = g;
  next();
}

export const staffCtx = (req: Request): DbContext => ({
  role: req.staff!.role, restaurantId: req.staff!.restaurantId, userId: req.staff!.userId,
});
export const guestCtx = (req: Request): DbContext => ({
  role: 'guest', restaurantId: req.guest!.restaurantId, guestSessionId: req.guest!.guestSessionId,
});
export const systemCtx = (restaurantId: string): DbContext => ({ role: 'system', restaurantId });
