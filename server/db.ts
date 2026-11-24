import pg from 'pg';
import { config } from './config.js';

// Return numerics as JS numbers (inventory quantities) and bigint counts as numbers.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)) as unknown as string);
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)) as unknown as string);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, idleTimeoutMillis: 30_000 });
pool.on('error', (err) => console.error('[db] idle client error', err.message));

export type Role = 'guest' | 'waiter' | 'kitchen' | 'admin' | 'system' | 'anon';

export interface DbContext {
  role: Role;
  restaurantId: string;
  userId?: string | null;
  guestSessionId?: string | null;
}

export type Tx = pg.PoolClient;

/**
 * Run `fn` inside a transaction with the request context applied. All RLS
 * policies and triggers read these settings, so every query is scoped to the
 * verified caller.
 */
export async function withCtx<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('app.role', $1, true), set_config('app.restaurant_id', $2, true),
              set_config('app.user_id', $3, true), set_config('app.guest_session_id', $4, true),
              set_config('timezone', 'UTC', true)`,
      [ctx.role, ctx.restaurantId, ctx.userId ?? '', ctx.guestSessionId ?? ''],
    );
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Queries that run before any restaurant context exists (login, QR resolution). */
export async function rawQuery<R extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  return pool.query<R>(sql, params);
}
