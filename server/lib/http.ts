import type { Request } from 'express';
import { z } from 'zod';
import { HttpError, badRequest } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    throw badRequest(`Invalid request — ${msg}`, r.error.issues);
  }
  return r.data;
}

export const uuid = z.string().uuid();
export const idParam = (req: Request, name = 'id') => parse(uuid, req.params[name]);

/** Small in-memory fixed-window rate limiter (per process). */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (key: string) => {
    const now = Date.now();
    const cur = hits.get(key);
    if (!cur || cur.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      return;
    }
    cur.n += 1;
    if (cur.n > limit) {
      throw new HttpError(429, 'RATE_LIMITED', `Too many attempts. Please wait ${Math.ceil((cur.reset - now) / 1000)} seconds and try again.`);
    }
  };
}

export function clientIp(req: Request) {
  return (req.ip ?? req.socket.remoteAddress ?? 'unknown').replace('::ffff:', '');
}
