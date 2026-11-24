-- Public image lookup: resolves which restaurant owns an image so the media
-- endpoint can read it under that restaurant's RLS context.
create or replace function app.media_owner(p_id uuid)
returns table (restaurant_id uuid) language sql stable security definer set search_path = public, app as $$
  select m.restaurant_id from media m where m.id = p_id
$$;
revoke execute on function app.media_owner(uuid) from public;
grant execute on function app.media_owner(uuid) to icons_app;
