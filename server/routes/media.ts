import { Router } from 'express';
import { pool } from '../db.js';
import { idParam } from '../lib/http.js';
import { notFound } from '../lib/errors.js';

/** Product images. Public (menu images), immutable by id, served with a locked-down CSP. */
export const mediaRouter = Router();

mediaRouter.get('/:id', async (req, res) => {
  const id = idParam(req);
  // Menu images are public. We resolve the owning restaurant, then read the bytes under that
  // restaurant's RLS context — nothing but the image itself is ever returned.
  const client = await pool.connect();
  try {
    await client.query('begin');
    const rid = (await client.query(`select restaurant_id from app.media_owner($1)`, [id])).rows[0]?.restaurant_id;
    if (!rid) throw notFound('Image not found');
    await client.query(`select set_config('app.role', 'anon', true), set_config('app.restaurant_id', $1, true)`, [rid]);
    const m = (await client.query(`select mime, bytes from media where id = $1`, [id])).rows[0];
    await client.query('commit');
    if (!m) throw notFound('Image not found');
    res.setHeader('Content-Type', m.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(m.bytes);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});
