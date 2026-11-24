# ICONS Coffee — Digital Restaurant Management System

One shared backend, four role-based interfaces, live updates everywhere.

| Interface | Route | Built for | Who |
|---|---|---|---|
| Customer ordering site | `/t/<table-qr-token>` → `/menu`, `/cart`, `/order/:id`, `/orders`, `/service` | Phone | Guests (no account; QR table session) |
| Admin dashboard | `/admin` | Desktop / tablet | `admin` |
| Waiter / service app | `/staff` | Phone | `waiter` (admins can use it too) |
| Kitchen display (KDS) | `/kitchen` | Tablet / desktop | `kitchen` (admins can use it too) |

## Quick start (local)

Requirements: Node 20+ (tested on 22), PostgreSQL 14+ (tested on 16).

```bash
npm install
cp .env.example .env        # then fill in the values (see below)
npm run db:reset            # creates schema + RLS + DEMO DATA, prints demo logins
npm run build               # builds the web app into web/dist
npm start                   # http://localhost:3000 serves UI + API + WebSocket
```

For development with hot reload use `npm run dev` (API on :3000, Vite on :5173 with proxy).

Minimal local `.env`:

```
NODE_ENV=development
PUBLIC_URL=http://localhost:3000
DATABASE_URL=postgres://icons_app:<app-pw>@localhost:5432/icons_coffee
MIGRATION_DATABASE_URL=postgres://postgres:<owner-pw>@localhost:5432/icons_coffee
APP_DB_PASSWORD=<app-pw>
JWT_SECRET=<openssl rand -hex 32>
DEMO_MODE=true
STRIPE_SECRET_KEY=sk_test_...   # optional
```

### Demo mode

`npm run db:seed` / `db:reset` creates clearly labelled **DEMO DATA**: 20 tables (unique QR tokens), 7 categories, 32 products with sizes/variations/extras and illustrative images, ~60 days of sales history (~2,400 orders, ~500 reviews), explicit inventory quantities, 3 live orders, and 6 staff accounts:

| Role | Email | Tables |
|---|---|---|
| Admin | admin@iconscoffee.demo | — |
| Waiter | omar@iconscoffee.demo | 1–7 (on duty) |
| Waiter | sara@iconscoffee.demo | 8–14 (on duty) |
| Waiter | arjun@iconscoffee.demo | 15–20 (off duty) |
| Kitchen | kitchen@iconscoffee.demo, aisha@iconscoffee.demo | — |

Passwords are **generated randomly at seed time** and written to `.demo-credentials.json` (git-ignored, mode 600) — they are never hardcoded and never shown on a web page. Set `DEMO_PASSWORD` before seeding if you want one known password for all demo accounts.

With `DEMO_MODE=true` the home page (`/`) lists demo table links (so you can act as a customer without printing QR codes) and the demo account emails. Turn it off in production.

## How it fits together

```
 Customer phone ─┐                       ┌─ PostgreSQL ───────────────────────────┐
 Waiter phone  ──┤  HTTPS (REST, cookies)│  schema + RLS policies + triggers:     │
 Kitchen tablet ─┼──► Node/Express API ──┼─►  order & payment state machines,     │
 Admin desktop ──┤                       │    money integrity, notification       │
                 └◄── WebSocket /ws ◄────┤    routing, inventory, audit log       │
                     (fan-out by role,   │  pg_notify('icons_events') on COMMIT   │
                      user, guest session)└────────────────────────────────────────┘
                                              ▲
                     Stripe Checkout ─────────┘ (payment verified with Stripe API / signed webhook)
```

* **Backend**: `server/` — Express 5 + `pg`, TypeScript run with `tsx`.
* **Frontend**: `web/` — React 19 + Vite + Tailwind, one SPA with four lazily-loaded apps.
* **Database**: `db/migrations/*.sql` — plain PostgreSQL. All business rules that must never be bypassed live in the database:
  * Order state machine `AWAITING_PAYMENT → RECEIVED → ACCEPTED → PREPARING → READY → SERVED → COMPLETED` (+ `CANCELLED`), enforced per role by a trigger. Skipped or backwards transitions are rejected.
  * Separate payment state machine `PENDING / PROCESSING / PAID / FAILED / REFUNDED / CANCELLED`. Online payments can only become `PAID` from the trusted server path after Stripe verification; cash/counter payments are confirmed by a waiter or admin (recorded with who confirmed).
  * Order totals are recomputed and verified in the database (subtotal = sum of lines, VAT and service charge follow the restaurant formula); amounts are immutable afterwards — kitchen staff cannot change them, nor can anyone else.
  * At most one live payment per order (unique index), unique transaction references (`TXN-YYMMDD-n`), idempotency keys on order submission.
  * When the kitchen marks an order **READY**, a trigger creates an `ORDER_READY` notification for the right waiter: the waiter who claimed the order → else the waiter assigned to the table → else all on-duty waiters → else all waiters.
  * Every change emits a compact `pg_notify` event on commit. The API LISTENs and pushes "something changed" signals over WebSocket only to the sockets entitled to them; clients then refetch through the RLS-protected API. No private data travels over the socket, and multiple API instances work.
* **Real time**: new orders, status changes, ready alerts, payments, requests, menu availability, table and staff changes. Clients reconnect automatically and resync after network loss, tab sleep, or a server restart.

### Security model

* Staff log in with email + password (bcrypt). Sessions are signed, `HttpOnly`, `SameSite=Lax` cookies; every request re-checks the account in the DB, so deactivation, role changes and password resets take effect immediately.
* Customers get a guest session bound to their table when they scan the QR code (no registration). They can only ever see their own session's orders and requests.
* **Row Level Security** is enabled on every table. The API connects as `icons_app`, a non-owner role without `BYPASSRLS` that cannot even read password hashes; each transaction sets the verified caller's role/user/restaurant/guest session, and policies filter every query. Hiding buttons is never the protection — see `db/migrations/003_security.sql`.
* Role boundaries: waiters cannot use the admin API; kitchen staff cannot see payments or money fields at all; only admins change menu/prices/settings; a waiter can only act on tables assigned to them (or unassigned tables), and the first waiter to claim an order owns it.
* CSRF: state-changing calls require a custom header; login is rate-limited; uploads are checked by file signature (PNG/JPEG/WebP only); CSV exports are protected against formula injection; strict CSP on the SPA and images.
* All timestamps are stored as `timestamptz` (UTC) and displayed/reported in the restaurant timezone (`Asia/Dubai`). Money is stored as integer fils.

## Payments

| Method | Flow |
|---|---|
| **Online** | Order is saved as `AWAITING_PAYMENT` (the kitchen does not see it). Customer is sent to **Stripe Checkout**. On return the server retrieves the Checkout Session from Stripe and marks the payment `PAID` only if Stripe says it is paid *and* amount, currency and metadata match; the order then goes to the kitchen. A signature-verified webhook and a background reconcile job do the same if the customer never returns. Unpaid online orders are cancelled after 40 minutes; customers can also switch to cash/counter or cancel. Admins can refund (Stripe refund API). |
| **Cash at table** | Order goes straight to the kitchen; payment `PENDING` until a waiter taps *Confirm received*. |
| **Pay at counter** | Same as cash, confirmed by staff at the counter. |

An order that is served **and** paid completes automatically.

**Configuration status in this build:** Stripe is wired to `STRIPE_SECRET_KEY` (test mode verified: sessions created, verified, expired). `STRIPE_WEBHOOK_SECRET` is **not configured** — add a webhook endpoint at `PUBLIC_URL/api/webhooks/stripe` in the Stripe dashboard and set the secret for production (without it, payments are still verified on return and by the reconcile job). Without `STRIPE_SECRET_KEY`, the online option is shown as unavailable and the admin Settings page says what is missing.

## Admin features

Overview KPIs from live data (today's revenue, orders, average order value, active orders, pending payments, occupied/available tables, customers, with same-time-yesterday comparison when history exists) · sales analytics with date filters (daily/weekly/monthly revenue, payment methods, best products & categories, hourly and weekday volume) · orders table with search/filters/date range/detail/history/payment actions/cancellation · menu & categories (prices, images, variants, ingredients, availability — live on customer phones) · tables with visual occupancy, assigned waiter, current bill, QR PNG/SVG download, print sheet, QR regeneration, disable · staff (create, roles, deactivate, password reset, table assignment, presence & current activity) · inventory (stock, adjustments, low-stock alerts, product ingredient links, automatic consumption) · reviews · reports with CSV export (daily, weekly, monthly, products, payments, orders, staff activity) · notifications · settings (Wi-Fi, VAT, service charge, opening hours, pause ordering).

## Testing

With the server running against a seeded database:

```bash
npm test             # 41 API/integration tests: full lifecycle with live WebSocket listeners for every role,
                     # permissions (API + direct SQL against RLS), duplicate submissions, simultaneous orders,
                     # notification routing, menu sync, requests, inventory, Stripe test-mode payments
npm run test:e2e     # browser test: customer phone + kitchen tablet + waiter phone + admin desktop
                     # completing the whole lifecycle through the real UI, plus refresh & offline recovery
npm run typecheck    # server + tests (web: npx tsc -p web/tsconfig.json)
```

Tests create real orders; run `npm run db:reset` afterwards for a clean demo.

**Not automated:** completing Stripe's hosted checkout page with a test card. Stripe's checkout page did not render its card form reliably for a headless browser in the build sandbox, so the final *paid* step was not exercised end-to-end automatically. To verify it manually: order online, pay with card `4242 4242 4242 4242` (any future date / CVC), and watch the order appear in the kitchen.

## Deploying

1. Provision PostgreSQL (any managed Postgres, including Supabase's database). Use the owner connection as `MIGRATION_DATABASE_URL`; run `npm run db:migrate` (creates the `icons_app` role, sets its password from `APP_DB_PASSWORD`). Point `DATABASE_URL` at that role. For a real restaurant, create the restaurant/admin instead of seeding demo data (or seed, then rename/replace demo records).
2. Set `PUBLIC_URL` to the HTTPS address customers will reach — QR codes encode it. Regenerate/print QR codes from Admin → Tables after changing it.
3. `npm run build && npm start` behind HTTPS (set `TRUST_PROXY=true` behind a load balancer). WebSockets must be allowed on `/ws`.
4. Add Stripe keys and the webhook secret.

> **Supabase note:** the project brief asked to use Supabase if available. The Supabase connection in the build environment failed authentication, so the system was built and tested on PostgreSQL 16 with its own API layer. The migrations are plain PostgreSQL and are designed to run on Supabase's Postgres, but that has **not** been tested here.

## Project layout

```
db/migrations/      SQL schema, business-rule triggers, RLS policies
server/             API, realtime, payments, jobs, seed + migrate scripts
web/src/customer    customer ordering site       web/src/kitchen  kitchen display
web/src/staff       waiter app                   web/src/admin    admin dashboard
tests/api, tests/e2e
```
