-- Background jobs enumerate restaurants without owner rights.
create or replace function app.all_restaurants()
returns table (id uuid) language sql stable security definer set search_path = public, app as $$
  select r.id from restaurants r
$$;
revoke execute on function app.all_restaurants() from public;
grant execute on function app.all_restaurants() to icons_app;
