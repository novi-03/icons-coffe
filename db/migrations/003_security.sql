-- ICONS Coffee — Migration 003: Row Level Security and privileges.
-- The API connects as the non-owner role "icons_app" (no BYPASSRLS), so every
-- query it runs is filtered by these policies. Request context (role, user,
-- restaurant, guest session) is set per transaction by the server after it
-- has verified the caller's signed session.
--
-- Roles seen by policies (app.role()):
--   guest   — a customer's QR table session (only their own orders/requests)
--   waiter  — service staff
--   kitchen — kitchen staff (no payment access at all)
--   admin   — restaurant administrator (full restaurant access)
--   system  — trusted server processes (payment provider verification, jobs)

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'icons_app') then
    create role icons_app login;
  end if;
end $$;

grant usage on schema public, app to icons_app;
grant select, insert, update, delete on all tables in schema public to icons_app;
grant usage, select on all sequences in schema public to icons_app;
grant execute on all functions in schema app to icons_app;

-- Password hashes are never readable by the application role directly.
revoke select on users from icons_app;
grant select (id, restaurant_id, email, full_name, role, is_active, is_demo, token_version, last_login_at, created_at, updated_at)
  on users to icons_app;
-- History is append-only.
revoke update, delete on order_events from icons_app;
revoke delete on orders, order_items, payments, inventory_transactions from icons_app;
revoke update on order_items, inventory_transactions from icons_app;

-- Pre-auth lookups (login and QR resolution) run before a restaurant context exists.
create or replace function app.auth_lookup(p_email text)
returns table (id uuid, restaurant_id uuid, password_hash text, role text, is_active boolean, full_name text, token_version integer)
language sql stable security definer set search_path = public, app as $$
  select u.id, u.restaurant_id, u.password_hash, u.role, u.is_active, u.full_name, u.token_version
  from users u where lower(u.email) = lower(trim(p_email))
$$;

create or replace function app.auth_session_check(p_user uuid)
returns table (restaurant_id uuid, role text, is_active boolean, token_version integer, full_name text)
language sql stable security definer set search_path = public, app as $$
  select u.restaurant_id, u.role, u.is_active, u.token_version, u.full_name from users u where u.id = p_user
$$;

create or replace function app.auth_record_login(p_user uuid)
returns void language sql security definer set search_path = public, app as $$
  update users set last_login_at = now() where id = p_user
$$;

create or replace function app.resolve_qr(p_token text)
returns table (table_id uuid, restaurant_id uuid, number integer, is_active boolean)
language sql stable security definer set search_path = public, app as $$
  select t.id, t.restaurant_id, t.number, t.is_active from restaurant_tables t where t.qr_token = p_token
$$;

create or replace function app.guest_session_check(p_session uuid)
returns table (restaurant_id uuid, table_id uuid, expires_at timestamptz, table_active boolean)
language sql stable security definer set search_path = public, app as $$
  select g.restaurant_id, g.table_id, g.expires_at, t.is_active
  from guest_sessions g join restaurant_tables t on t.id = g.table_id where g.id = p_session
$$;

revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to icons_app;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table restaurants enable row level security;
alter table users enable row level security;
alter table staff_profiles enable row level security;
alter table restaurant_tables enable row level security;
alter table guest_sessions enable row level security;
alter table media enable row level security;
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table product_variants enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table payments enable row level security;
alter table notifications enable row level security;
alter table customer_requests enable row level security;
alter table waiter_assignments enable row level security;
alter table reviews enable row level security;
alter table inventory_items enable row level security;
alter table menu_item_ingredients enable row level security;
alter table inventory_transactions enable row level security;
alter table order_events enable row level security;
alter table order_issues enable row level security;

-- Restaurants: everyone in the restaurant context can read; only admins edit.
create policy restaurants_read on restaurants for select using (id = app.rid());
create policy restaurants_admin on restaurants for update using (id = app.rid() and app.is_admin())
  with check (id = app.rid());

-- Users: staff can see colleagues (no password hashes — column privileges); admins manage.
create policy users_read on users for select using (restaurant_id = app.rid() and app.is_staff());
create policy users_admin_insert on users for insert with check (restaurant_id = app.rid() and app.is_admin());
create policy users_admin_update on users for update using (restaurant_id = app.rid() and app.is_admin())
  with check (restaurant_id = app.rid());
create policy users_admin_delete on users for delete using (restaurant_id = app.rid() and app.is_admin() and id <> app.uid());

create policy staff_profiles_read on staff_profiles for select using (restaurant_id = app.rid() and app.is_staff());
create policy staff_profiles_insert on staff_profiles for insert with check (restaurant_id = app.rid() and app.is_admin());
create policy staff_profiles_update on staff_profiles for update
  using (restaurant_id = app.rid() and (app.is_admin() or user_id = app.uid()))
  with check (restaurant_id = app.rid() and (app.is_admin() or user_id = app.uid()));
create policy staff_profiles_delete on staff_profiles for delete using (restaurant_id = app.rid() and app.is_admin());

-- Tables: staff see all; a guest sees only their own table.
create policy tables_read on restaurant_tables for select using (
  restaurant_id = app.rid() and (
    app.is_staff()
    or (app.role() = 'guest' and id = (select g.table_id from guest_sessions g where g.id = app.guest()))
  ));
create policy tables_admin_insert on restaurant_tables for insert with check (restaurant_id = app.rid() and app.is_admin());
create policy tables_admin_update on restaurant_tables for update using (restaurant_id = app.rid() and app.is_admin())
  with check (restaurant_id = app.rid());
create policy tables_admin_delete on restaurant_tables for delete using (restaurant_id = app.rid() and app.is_admin());

-- Guest sessions: created by the server (system); a guest reads only their own.
create policy guest_sessions_read on guest_sessions for select using (
  restaurant_id = app.rid() and (id = app.guest() or app.is_staff()));
create policy guest_sessions_system on guest_sessions for insert with check (restaurant_id = app.rid() and app.role() = 'system');
create policy guest_sessions_touch on guest_sessions for update using (
  restaurant_id = app.rid() and (app.role() = 'system' or id = app.guest())) with check (restaurant_id = app.rid());

-- Menu and media: readable by anyone in the restaurant (public menu); admins edit.
create policy media_read on media for select using (restaurant_id = app.rid());
create policy media_admin on media for insert with check (restaurant_id = app.rid() and app.is_admin());
create policy media_admin_delete on media for delete using (restaurant_id = app.rid() and app.is_admin());

create policy categories_read on menu_categories for select using (restaurant_id = app.rid());
create policy categories_admin_insert on menu_categories for insert with check (restaurant_id = app.rid() and app.is_admin());
create policy categories_admin_update on menu_categories for update using (restaurant_id = app.rid() and app.is_admin())
  with check (restaurant_id = app.rid());
create policy categories_admin_delete on menu_categories for delete using (restaurant_id = app.rid() and app.is_admin());

create policy items_read on menu_items for select using (restaurant_id = app.rid());
create policy items_admin_insert on menu_items for insert with check (restaurant_id = app.rid() and app.is_admin());
create policy items_admin_update on menu_items for update using (restaurant_id = app.rid() and app.is_admin())
  with check (restaurant_id = app.rid());
create policy items_admin_delete on menu_items for delete using (restaurant_id = app.rid() and app.is_admin());

create policy variants_read on product_variants for select using (restaurant_id = app.rid());
create policy variants_admin_insert on product_variants for insert with check (restaurant_id = app.rid() and app.is_admin());
create policy variants_admin_update on product_variants for update using (restaurant_id = app.rid() and app.is_admin())
  with check (restaurant_id = app.rid());
create policy variants_admin_delete on product_variants for delete using (restaurant_id = app.rid() and app.is_admin());

-- Orders
--  guest:   only orders from their own QR session
--  kitchen: everything that has been submitted (never unpaid online orders)
--  waiter/admin: all restaurant orders (waiters need the floor overview)
create policy orders_read on orders for select using (
  restaurant_id = app.rid() and (
    app.role() in ('admin', 'system', 'waiter')
    or (app.role() = 'kitchen' and status <> 'AWAITING_PAYMENT')
    or (app.role() = 'guest' and guest_session_id = app.guest())
  ));
create policy orders_insert on orders for insert with check (
  restaurant_id = app.rid() and (
    app.role() = 'system'
    or (app.role() = 'guest' and guest_session_id = app.guest())
  ));
create policy orders_update on orders for update using (
  restaurant_id = app.rid() and (
    app.role() in ('admin', 'system')
    or (app.role() = 'kitchen' and status not in ('AWAITING_PAYMENT'))
    or (app.role() = 'waiter' and (serving_waiter_id = app.uid() or app.waiter_can_serve(table_id)))
  )) with check (restaurant_id = app.rid());

create policy order_items_read on order_items for select using (
  restaurant_id = app.rid() and exists (select 1 from orders o where o.id = order_id));
create policy order_items_insert on order_items for insert with check (
  exists (select 1 from orders o where o.id = order_id and o.restaurant_id = app.rid()
          and (app.role() = 'system' or (app.role() = 'guest' and o.guest_session_id = app.guest()))));

-- Payments: kitchen has no access. Guests see/initiate only their own.
create policy payments_read on payments for select using (
  restaurant_id = app.rid() and (
    app.role() in ('admin', 'system', 'waiter')
    or (app.role() = 'guest' and exists (select 1 from orders o where o.id = order_id and o.guest_session_id = app.guest()))
  ));
create policy payments_insert on payments for insert with check (
  restaurant_id = app.rid() and (
    app.role() in ('admin', 'system')
    or (app.role() = 'guest' and exists (select 1 from orders o where o.id = order_id and o.guest_session_id = app.guest()))
  ));
create policy payments_update on payments for update using (
  restaurant_id = app.rid() and (
    app.role() in ('admin', 'system')
    or (app.role() = 'waiter' and method <> 'ONLINE')
    or (app.role() = 'guest' and exists (select 1 from orders o where o.id = order_id and o.guest_session_id = app.guest()))
  )) with check (restaurant_id = app.rid());

-- Notifications: only the intended recipient (user, or role broadcast).
create policy notifications_read on notifications for select using (
  restaurant_id = app.rid() and (
    recipient_user_id = app.uid()
    or (recipient_user_id is null and recipient_role = app.role())
  ));
create policy notifications_update on notifications for update using (
  restaurant_id = app.rid() and (
    recipient_user_id = app.uid()
    or (recipient_user_id is null and recipient_role = app.role())
  )) with check (restaurant_id = app.rid());
create policy notifications_insert on notifications for insert with check (restaurant_id = app.rid() and app.is_admin());

-- Customer requests
create policy requests_read on customer_requests for select using (
  restaurant_id = app.rid() and (
    app.role() in ('admin', 'system', 'waiter')
    or (app.role() = 'guest' and guest_session_id = app.guest())
  ));
create policy requests_insert on customer_requests for insert with check (
  restaurant_id = app.rid() and app.role() = 'guest' and guest_session_id = app.guest());
create policy requests_update on customer_requests for update using (
  restaurant_id = app.rid() and (
    app.role() in ('admin', 'system')
    or (app.role() = 'waiter' and app.waiter_can_serve(table_id))
    or (app.role() = 'guest' and guest_session_id = app.guest())
  )) with check (restaurant_id = app.rid());

-- Waiter assignments
create policy assignments_read on waiter_assignments for select using (restaurant_id = app.rid() and app.is_staff());
create policy assignments_admin_insert on waiter_assignments for insert with check (restaurant_id = app.rid() and app.is_admin());
create policy assignments_admin_update on waiter_assignments for update using (restaurant_id = app.rid() and app.is_admin())
  with check (restaurant_id = app.rid());
create policy assignments_admin_delete on waiter_assignments for delete using (restaurant_id = app.rid() and app.is_admin());

-- Reviews
create policy reviews_read on reviews for select using (
  restaurant_id = app.rid() and (app.is_admin() or (app.role() = 'guest' and guest_session_id = app.guest())));
create policy reviews_insert on reviews for insert with check (
  restaurant_id = app.rid() and (app.role() = 'system' or (app.role() = 'guest' and guest_session_id = app.guest())));

-- Inventory (admin manages; kitchen may view)
create policy inventory_read on inventory_items for select using (restaurant_id = app.rid() and app.role() in ('admin', 'system', 'kitchen'));
create policy inventory_admin_insert on inventory_items for insert with check (restaurant_id = app.rid() and app.is_admin());
create policy inventory_admin_update on inventory_items for update using (restaurant_id = app.rid() and app.is_admin())
  with check (restaurant_id = app.rid());
create policy inventory_admin_delete on inventory_items for delete using (restaurant_id = app.rid() and app.is_admin());

create policy ingredients_read on menu_item_ingredients for select using (restaurant_id = app.rid() and app.role() in ('admin', 'system', 'kitchen'));
create policy ingredients_admin_insert on menu_item_ingredients for insert with check (restaurant_id = app.rid() and app.is_admin());
create policy ingredients_admin_update on menu_item_ingredients for update using (restaurant_id = app.rid() and app.is_admin())
  with check (restaurant_id = app.rid());
create policy ingredients_admin_delete on menu_item_ingredients for delete using (restaurant_id = app.rid() and app.is_admin());

create policy inventory_tx_read on inventory_transactions for select using (restaurant_id = app.rid() and app.role() in ('admin', 'system', 'kitchen'));
create policy inventory_tx_insert on inventory_transactions for insert with check (restaurant_id = app.rid() and app.is_admin());

-- Audit trail and issues
create policy order_events_read on order_events for select using (restaurant_id = app.rid() and app.is_staff());
create policy order_events_insert on order_events for insert with check (restaurant_id = app.rid() and app.role() = 'system');

create policy issues_read on order_issues for select using (restaurant_id = app.rid() and app.is_staff());
create policy issues_insert on order_issues for insert with check (
  restaurant_id = app.rid() and app.role() in ('admin', 'waiter') and reported_by = app.uid());
create policy issues_update on order_issues for update using (restaurant_id = app.rid() and app.is_admin())
  with check (restaurant_id = app.rid());
