-- ICONS Coffee — Digital Restaurant Management System
-- Migration 001: core schema
-- Plain PostgreSQL (>= 14). Compatible with Supabase Postgres.
-- All money is stored as integer fils (1 AED = 100 fils).
-- All timestamps are timestamptz (stored in UTC) and rendered in the restaurant timezone.

create extension if not exists pgcrypto;

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Request context helpers. The API server sets these per transaction with
-- set_config(..., true) after verifying the caller's session. RLS policies
-- and triggers read them.
-- ---------------------------------------------------------------------------
create or replace function app.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.role', true), ''), 'anon')
$$;
create or replace function app.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
create or replace function app.rid() returns uuid language sql stable as $$
  select nullif(current_setting('app.restaurant_id', true), '')::uuid
$$;
create or replace function app.guest() returns uuid language sql stable as $$
  select nullif(current_setting('app.guest_session_id', true), '')::uuid
$$;
create or replace function app.is_admin() returns boolean language sql stable as $$
  select app.role() in ('admin', 'system')
$$;
create or replace function app.is_staff() returns boolean language sql stable as $$
  select app.role() in ('admin', 'waiter', 'kitchen', 'system')
$$;

create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create sequence if not exists order_number_seq start with 5001;
create sequence if not exists txn_ref_seq start with 100001;

-- ---------------------------------------------------------------------------
-- 1. Restaurants
-- ---------------------------------------------------------------------------
create table restaurants (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name                text not null check (length(name) between 1 and 120),
  timezone            text not null default 'Asia/Dubai',
  currency            char(3) not null default 'AED',
  vat_rate_bps        integer not null default 500 check (vat_rate_bps between 0 and 5000),
  service_charge_bps  integer not null default 0 check (service_charge_bps between 0 and 5000),
  prices_include_tax  boolean not null default true,
  welcome_message     text,
  wifi_ssid           text,
  wifi_password       text,
  address             text,
  phone               text,
  -- 7 entries, index 0 = Sunday: {"open":"06:00","close":"02:00","closed":false}
  opening_hours       jsonb not null default '[]'::jsonb,
  -- AUTO = follow opening_hours, OPEN = force open, CLOSED = force closed
  order_mode          text not null default 'AUTO' check (order_mode in ('AUTO', 'OPEN', 'CLOSED')),
  delay_grace_minutes integer not null default 5 check (delay_grace_minutes between 0 and 120),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Users (staff accounts: admin / waiter / kitchen). Customers are guests.
-- ---------------------------------------------------------------------------
create table users (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  email          text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash  text not null,
  full_name      text not null check (length(full_name) between 1 and 120),
  role           text not null check (role in ('admin', 'waiter', 'kitchen')),
  is_active      boolean not null default true,
  is_demo        boolean not null default false,
  token_version  integer not null default 0,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));
create index users_restaurant_role_idx on users (restaurant_id, role);

-- ---------------------------------------------------------------------------
-- 3. Staff profiles
-- ---------------------------------------------------------------------------
create table staff_profiles (
  user_id          uuid primary key references users(id) on delete cascade,
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  phone            text,
  avatar_color     text not null default '#8b5cf6',
  is_on_duty       boolean not null default false,
  last_seen_at     timestamptz,
  current_activity text,
  updated_at       timestamptz not null default now()
);
create index staff_profiles_restaurant_idx on staff_profiles (restaurant_id);

-- ---------------------------------------------------------------------------
-- 4. Tables
-- ---------------------------------------------------------------------------
create table restaurant_tables (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  number         integer not null check (number between 1 and 999),
  label          text,
  seats          integer not null default 4 check (seats between 1 and 50),
  zone           text,
  qr_token       text not null unique check (qr_token ~ '^[A-Za-z0-9_-]{16,64}$'),
  is_active      boolean not null default true,
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, number)
);

-- Guest (QR) sessions: customers order without registering.
create table guest_sessions (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  table_id       uuid not null references restaurant_tables(id) on delete cascade,
  user_agent     text,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '12 hours'
);
create index guest_sessions_table_idx on guest_sessions (table_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Media (uploaded product images) — stored in the DB so every app instance
-- shares them.
-- ---------------------------------------------------------------------------
create table media (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  mime           text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')),
  bytes          bytea not null,
  size_bytes     integer not null check (size_bytes between 1 and 3145728),
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Menu categories
-- ---------------------------------------------------------------------------
create table menu_categories (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  name           text not null check (length(name) between 1 and 60),
  slug           text not null check (slug ~ '^[a-z0-9-]{1,60}$'),
  description    text,
  icon           text,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, slug)
);

-- ---------------------------------------------------------------------------
-- 6. Menu items
-- ---------------------------------------------------------------------------
create table menu_items (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  category_id     uuid not null references menu_categories(id) on delete restrict,
  name            text not null check (length(name) between 1 and 80),
  description     text check (length(description) <= 500),
  price_fils      integer not null check (price_fils between 0 and 10000000),
  image_media_id  uuid references media(id) on delete set null,
  prep_minutes    integer not null default 10 check (prep_minutes between 0 and 240),
  is_available    boolean not null default true,
  is_featured     boolean not null default false,
  is_popular      boolean not null default false,
  dietary         text[] not null default '{}',
  calories        integer check (calories between 0 and 5000),
  sort_order      integer not null default 0,
  is_archived     boolean not null default false,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index menu_items_restaurant_cat_idx on menu_items (restaurant_id, category_id, sort_order);

-- ---------------------------------------------------------------------------
-- 7. Product variants (sizes, variations, extras)
-- ---------------------------------------------------------------------------
create table product_variants (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  menu_item_id     uuid not null references menu_items(id) on delete cascade,
  kind             text not null check (kind in ('SIZE', 'VARIATION', 'EXTRA')),
  group_name       text not null check (length(group_name) between 1 and 40),
  name             text not null check (length(name) between 1 and 60),
  price_delta_fils integer not null default 0 check (price_delta_fils between -1000000 and 1000000),
  is_default       boolean not null default false,
  is_available     boolean not null default true,
  sort_order       integer not null default 0
);
create index product_variants_item_idx on product_variants (menu_item_id, kind, sort_order);

-- ---------------------------------------------------------------------------
-- 8. Orders
-- ---------------------------------------------------------------------------
create table orders (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references restaurants(id) on delete restrict,
  table_id            uuid not null references restaurant_tables(id) on delete restrict,
  guest_session_id    uuid references guest_sessions(id) on delete set null,
  order_number        text not null default ('ICN' || nextval('order_number_seq')::text),
  idempotency_key     text check (length(idempotency_key) between 8 and 80),
  status              text not null check (status in
                        ('AWAITING_PAYMENT', 'RECEIVED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED')),
  payment_method      text not null check (payment_method in ('ONLINE', 'CASH', 'COUNTER')),
  payment_status      text not null default 'PENDING' check (payment_status in
                        ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED')),
  subtotal_fils       integer not null check (subtotal_fils >= 0),
  service_charge_fils integer not null default 0 check (service_charge_fils >= 0),
  tax_fils            integer not null default 0 check (tax_fils >= 0),
  total_fils          integer not null check (total_fils > 0),
  vat_rate_bps        integer not null,
  service_charge_bps  integer not null,
  prices_include_tax  boolean not null,
  est_prep_minutes    integer not null default 10,
  notes               text check (length(notes) <= 500),
  priority            text not null default 'NORMAL' check (priority in ('NORMAL', 'RUSH')),
  serving_waiter_id   uuid references users(id) on delete set null,
  submitted_at        timestamptz,
  accepted_at         timestamptz,
  preparing_at        timestamptz,
  ready_at            timestamptz,
  collected_at        timestamptz,
  served_at           timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  cancelled_by        uuid references users(id) on delete set null,
  delay_notified_at   timestamptz,
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (restaurant_id, order_number)
);
create unique index orders_idempotency_uq on orders (guest_session_id, idempotency_key) where idempotency_key is not null;
create index orders_restaurant_status_idx on orders (restaurant_id, status, created_at desc);
create index orders_restaurant_created_idx on orders (restaurant_id, created_at desc);
create index orders_table_idx on orders (table_id, created_at desc);
create index orders_guest_idx on orders (guest_session_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 9. Order items (price snapshot at order time)
-- ---------------------------------------------------------------------------
create table order_items (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references restaurants(id) on delete restrict,
  order_id             uuid not null references orders(id) on delete cascade,
  menu_item_id         uuid references menu_items(id) on delete set null,
  item_name            text not null,
  unit_price_fils      integer not null check (unit_price_fils >= 0),
  quantity             integer not null check (quantity between 1 and 50),
  options              jsonb not null default '[]'::jsonb,
  special_instructions text check (length(special_instructions) <= 300),
  line_total_fils      integer not null check (line_total_fils >= 0),
  prep_minutes         integer not null default 10,
  created_at           timestamptz not null default now(),
  check (line_total_fils = unit_price_fils * quantity)
);
create index order_items_order_idx on order_items (order_id);
create index order_items_menu_item_idx on order_items (menu_item_id);

-- ---------------------------------------------------------------------------
-- 10. Payments
-- ---------------------------------------------------------------------------
create table payments (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references restaurants(id) on delete restrict,
  order_id            uuid not null references orders(id) on delete restrict,
  method              text not null check (method in ('ONLINE', 'CASH', 'COUNTER')),
  status              text not null default 'PENDING' check (status in
                        ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED')),
  amount_fils         integer not null check (amount_fils > 0),
  currency            char(3) not null default 'AED',
  transaction_ref     text not null unique default
                        ('TXN-' || to_char(now() at time zone 'UTC', 'YYMMDD') || '-' || nextval('txn_ref_seq')::text),
  provider            text check (provider in ('stripe')),
  provider_session_id text unique,
  provider_payment_id text,
  checkout_url        text,
  confirmed_by        uuid references users(id) on delete set null,
  paid_at             timestamptz,
  failure_reason      text,
  refunded_at         timestamptz,
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Real online payments always carry a provider reference. Seeded DEMO history is flagged is_demo.
  check (method <> 'ONLINE' or provider is not null or is_demo)
);
-- Prevent duplicate payment records: at most one live payment per order.
create unique index payments_one_active_per_order on payments (order_id)
  where status in ('PENDING', 'PROCESSING', 'PAID');
create index payments_restaurant_status_idx on payments (restaurant_id, status, created_at desc);
create index payments_paid_at_idx on payments (restaurant_id, paid_at) where status = 'PAID';

-- ---------------------------------------------------------------------------
-- 11. Notifications
-- ---------------------------------------------------------------------------
create table notifications (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  recipient_user_id  uuid references users(id) on delete cascade,
  recipient_role     text check (recipient_role in ('admin', 'waiter', 'kitchen')),
  type               text not null check (type in ('NEW_ORDER', 'ORDER_READY', 'PAYMENT_UPDATE', 'KITCHEN_DELAY',
                        'WAITER_REQUEST', 'LOW_STOCK', 'NEW_REVIEW', 'SERVICE_ISSUE', 'ORDER_CANCELLED')),
  title              text not null,
  body               text,
  order_id           uuid references orders(id) on delete cascade,
  table_id           uuid references restaurant_tables(id) on delete set null,
  data               jsonb not null default '{}'::jsonb,
  read_at            timestamptz,
  acknowledged_at    timestamptz,
  created_at         timestamptz not null default now(),
  check (recipient_user_id is not null or recipient_role is not null)
);
create index notifications_user_idx on notifications (recipient_user_id, created_at desc);
create index notifications_role_idx on notifications (restaurant_id, recipient_role, created_at desc);

-- ---------------------------------------------------------------------------
-- 12. Customer requests
-- ---------------------------------------------------------------------------
create table customer_requests (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  table_id           uuid not null references restaurant_tables(id) on delete cascade,
  guest_session_id   uuid references guest_sessions(id) on delete set null,
  type               text not null check (type in ('CALL_WAITER', 'REQUEST_BILL', 'REQUEST_WIFI', 'ASSISTANCE')),
  note               text check (length(note) <= 300),
  status             text not null default 'OPEN' check (status in ('OPEN', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED')),
  acknowledged_by    uuid references users(id) on delete set null,
  acknowledged_at    timestamptz,
  completed_by       uuid references users(id) on delete set null,
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);
create unique index customer_requests_one_open on customer_requests (guest_session_id, type)
  where status in ('OPEN', 'ACKNOWLEDGED');
create index customer_requests_restaurant_idx on customer_requests (restaurant_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- 13. Waiter assignments
-- ---------------------------------------------------------------------------
create table waiter_assignments (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  table_id       uuid not null references restaurant_tables(id) on delete cascade,
  waiter_id      uuid not null references users(id) on delete cascade,
  is_active      boolean not null default true,
  assigned_by    uuid references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  ended_at       timestamptz
);
create unique index waiter_assignments_one_active on waiter_assignments (table_id) where is_active;
create index waiter_assignments_waiter_idx on waiter_assignments (waiter_id) where is_active;

-- ---------------------------------------------------------------------------
-- 14. Reviews
-- ---------------------------------------------------------------------------
create table reviews (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  order_id          uuid not null unique references orders(id) on delete cascade,
  guest_session_id  uuid references guest_sessions(id) on delete set null,
  table_id          uuid references restaurant_tables(id) on delete set null,
  rating            integer not null check (rating between 1 and 5),
  comment           text check (length(comment) <= 1000),
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now()
);
create index reviews_restaurant_idx on reviews (restaurant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 15. Inventory
-- ---------------------------------------------------------------------------
create table inventory_items (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references restaurants(id) on delete cascade,
  name                 text not null check (length(name) between 1 and 80),
  unit                 text not null check (unit in ('g', 'kg', 'ml', 'L', 'pcs')),
  quantity             numeric(12, 3) not null default 0,
  low_stock_threshold  numeric(12, 3) not null default 0 check (low_stock_threshold >= 0),
  is_demo              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index inventory_items_name_uq on inventory_items (restaurant_id, lower(name));

create table menu_item_ingredients (
  menu_item_id       uuid not null references menu_items(id) on delete cascade,
  inventory_item_id  uuid not null references inventory_items(id) on delete cascade,
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  quantity_per_unit  numeric(12, 3) not null check (quantity_per_unit > 0),
  primary key (menu_item_id, inventory_item_id)
);

-- ---------------------------------------------------------------------------
-- 16. Inventory transactions
-- ---------------------------------------------------------------------------
create table inventory_transactions (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  inventory_item_id  uuid not null references inventory_items(id) on delete cascade,
  delta              numeric(12, 3) not null check (delta <> 0),
  quantity_after     numeric(12, 3) not null,
  reason             text not null check (reason in ('RESTOCK', 'ADJUSTMENT', 'WASTE', 'CONSUMPTION', 'RETURN')),
  note               text check (length(note) <= 300),
  order_id           uuid references orders(id) on delete set null,
  created_by         uuid references users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index inventory_transactions_item_idx on inventory_transactions (inventory_item_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Supporting: audit trail of order / payment events and service issues.
-- ---------------------------------------------------------------------------
create table order_events (
  id             bigserial primary key,
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  order_id       uuid not null references orders(id) on delete cascade,
  event_type     text not null,
  from_status    text,
  to_status      text,
  actor_user_id  uuid references users(id) on delete set null,
  actor_role     text not null,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index order_events_order_idx on order_events (order_id, id);
create index order_events_actor_idx on order_events (restaurant_id, actor_user_id, created_at desc);

create table order_issues (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  order_id       uuid not null references orders(id) on delete cascade,
  type           text not null check (type in ('MISSING_ITEM', 'SERVICE_ISSUE')),
  note           text not null check (length(note) between 1 and 500),
  status         text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  reported_by    uuid references users(id) on delete set null,
  resolved_by    uuid references users(id) on delete set null,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index order_issues_restaurant_idx on order_issues (restaurant_id, status, created_at desc);

-- updated_at triggers
create trigger t_restaurants_upd before update on restaurants for each row execute function app.touch_updated_at();
create trigger t_users_upd before update on users for each row execute function app.touch_updated_at();
create trigger t_staff_profiles_upd before update on staff_profiles for each row execute function app.touch_updated_at();
create trigger t_tables_upd before update on restaurant_tables for each row execute function app.touch_updated_at();
create trigger t_categories_upd before update on menu_categories for each row execute function app.touch_updated_at();
create trigger t_items_upd before update on menu_items for each row execute function app.touch_updated_at();
create trigger t_orders_upd before update on orders for each row execute function app.touch_updated_at();
create trigger t_payments_upd before update on payments for each row execute function app.touch_updated_at();
create trigger t_inventory_upd before update on inventory_items for each row execute function app.touch_updated_at();
