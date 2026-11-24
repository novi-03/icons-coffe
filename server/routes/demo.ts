import { Router } from 'express';
import { config } from '../config.js';
import { rawQuery } from '../db.js';

/**
 * Evaluator helper. Only active when DEMO_MODE=true: lists demo table QR links and
 * demo account emails (never passwords). In production (DEMO_MODE unset) it reveals nothing.
 */
export const demoRouter = Router();

demoRouter.get('/', async (_req, res) => {
  if (!config.demoMode) return res.json({ demo_mode: false });
  const tables = (await rawQuery(`select number, qr_token from app.demo_tables($1)`, [config.restaurantSlug])).rows;
  const accounts = (await rawQuery(`select role, email, full_name from app.demo_accounts($1)`, [config.restaurantSlug])).rows;
  res.json({
    demo_mode: true,
    tables: tables.map((t) => ({ number: t.number, path: `/t/${t.qr_token}` })),
    accounts: accounts.map((a) => ({ role: a.role, email: a.email, name: a.full_name })),
  });
});
