-- Demo helpers: only rows flagged is_demo are ever returned (DEMO DATA).
create or replace function app.demo_tables(p_slug text)
returns table (number integer, qr_token text) language sql stable security definer set search_path = public, app as $$
  select t.number, t.qr_token from restaurant_tables t join restaurants r on r.id = t.restaurant_id
  where r.slug = p_slug and t.is_demo and t.is_active order by t.number
$$;
create or replace function app.demo_accounts(p_slug text)
returns table (role text, email text, full_name text) language sql stable security definer set search_path = public, app as $$
  select u.role, u.email, u.full_name from users u join restaurants r on r.id = u.restaurant_id
  where r.slug = p_slug and u.is_demo and u.is_active order by case u.role when 'admin' then 0 when 'waiter' then 1 else 2 end, u.full_name
$$;
revoke execute on function app.demo_tables(text), app.demo_accounts(text) from public;
grant execute on function app.demo_tables(text), app.demo_accounts(text) to icons_app;
