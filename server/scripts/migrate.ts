/**
 * Applies db/migrations/*.sql in order using the OWNER connection
 * (MIGRATION_DATABASE_URL). Pass --reset to drop everything first (refused in production).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required (owner connection for migrations)');
const reset = process.argv.includes('--reset');
if (reset && process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
  throw new Error('Refusing to reset a production database without --force');
}

const dir = path.resolve(import.meta.dirname, '../../db/migrations');
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (reset) {
    console.log('Resetting database schema…');
    await client.query(`drop schema if exists app cascade; drop schema if exists public cascade; create schema public;
      grant usage on schema public to public;`);
    await client.query(`drop sequence if exists order_number_seq; drop sequence if exists txn_ref_seq;`).catch(() => {});
  }
  await client.query(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    console.log(`Applying ${f}`);
    await client.query('begin');
    try {
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('insert into schema_migrations(name) values ($1)', [f]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  }
  await client.query('revoke all on public.schema_migrations from icons_app').catch(() => {});
  if (process.env.APP_DB_PASSWORD) {
    await client.query(`alter role icons_app with login password '${process.env.APP_DB_PASSWORD.replace(/'/g, "''")}'`);
  }
  console.log('Migrations complete.');
} finally {
  await client.end();
}
