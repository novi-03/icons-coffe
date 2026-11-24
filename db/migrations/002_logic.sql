-- ICONS Coffee — Migration 002: business rules enforced in the database.
-- Every trigger function that writes to other tables is SECURITY DEFINER so
-- that it runs with the schema owner's rights (bypassing RLS) — callers can
-- only reach it through a write that RLS has already allowed.

-- ---------------------------------------------------------------------------
-- Real-time event bus: every change emits a compact JSON message on the
-- "icons_events" channel. Delivery happens only on COMMIT, so listeners never
-- see uncommitted data. The API fans messages out to WebSocket clients.
-- ---------------------------------------------------------------------------
create or replace function app.emit(p_type text, p_restaurant uuid, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql as $$
begin
  perform pg_notify('icons_events', (jsonb_build_object('t', p_type, 'r', p_restaurant) || p_payload)::text);
end $$;

-- Waiters who should hear about a table/order:
-- 1) the waiter who claimed the order, else 2) the waiter assigned to the table,
-- else 3) all on-duty waiters, else 4) all active waiters.
create or replace function app.service_recipients(p_table uuid, p_order uuid default null)
returns setof uuid language plpgsql stable security definer set search_path = public, app as $$
declare v uuid; v_rid uuid;
begin
  if p_order is not null then
    select o.serving_waiter_id into v from orders o
      join users u on u.id = o.serving_waiter_id and u.is_active
      where o.id = p_order;
    if v is not null then return next v; return; end if;
  end if;
  select wa.waiter_id into v from waiter_assignments wa
    join users u on u.id = wa.waiter_id and u.is_active
    where wa.table_id = p_table and wa.is_active;
  if v is not null then return next v; return; end if;
  select restaurant_id into v_rid from restaurant_tables where id = p_table;
  return query select u.id from users u join staff_profiles sp on sp.user_id = u.id
    where u.restaurant_id = v_rid and u.role = 'waiter' and u.is_active and sp.is_on_duty;
  if not found then
    return query select u.id from users u
      where u.restaurant_id = v_rid and u.role = 'waiter' and u.is_active;
  end if;
end $$;

-- True when the current waiter may act on a table (it is assigned to them or to nobody).
create or replace function app.waiter_can_serve(p_table uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select not exists (
    select 1 from waiter_assignments wa
    where wa.table_id = p_table and wa.is_active and wa.waiter_id <> app.uid()
  )
$$;

create or replace function app.table_number(p_table uuid) returns integer
language sql stable security definer set search_path = public, app as $$
  select number from restaurant_tables where id = p_table
$$;

create or replace function app.notify(p_restaurant uuid, p_user uuid, p_role text, p_type text, p_title text,
  p_body text, p_order uuid, p_table uuid, p_data jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  insert into notifications (restaurant_id, recipient_user_id, recipient_role, type, title, body, order_id, table_id, data)
  values (p_restaurant, p_user, p_role, p_type, p_title, p_body, p_order, p_table, p_data);
end $$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create or replace function app.orders_before_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_table restaurant_tables; v_gs guest_sessions; v_svc integer; v_tax integer;
begin
  select * into v_table from restaurant_tables where id = new.table_id;
  if v_table.id is null or v_table.restaurant_id <> new.restaurant_id then
    raise exception 'ORDER_INVALID: table does not belong to this restaurant' using errcode = 'P0001';
  end if;
  if not v_table.is_active then
    raise exception 'TABLE_DISABLED: this table is not accepting orders' using errcode = 'P0001';
  end if;
  if new.guest_session_id is not null then
    select * into v_gs from guest_sessions where id = new.guest_session_id;
    if v_gs.table_id <> new.table_id then
      raise exception 'ORDER_INVALID: guest session belongs to another table' using errcode = 'P0001';
    end if;
  end if;
  if app.role() <> 'system' then
    if new.status not in ('AWAITING_PAYMENT', 'RECEIVED') then
      raise exception 'ORDER_INVALID: new orders must start as RECEIVED or AWAITING_PAYMENT' using errcode = 'P0001';
    end if;
    if (new.payment_method = 'ONLINE') <> (new.status = 'AWAITING_PAYMENT') then
      raise exception 'ORDER_INVALID: online orders wait for payment; cash/counter orders go straight to the kitchen' using errcode = 'P0001';
    end if;
    new.payment_status := 'PENDING';
    new.created_at := now();
  end if;
  -- Money integrity: totals must follow the restaurant pricing formula.
  v_svc := round(new.subtotal_fils::numeric * new.service_charge_bps / 10000.0);
  if new.service_charge_fils <> v_svc then
    raise exception 'ORDER_INVALID: service charge mismatch' using errcode = 'P0001';
  end if;
  if new.prices_include_tax then
    -- VAT portion contained in a tax-inclusive price: total * rate / (1 + rate)
    v_tax := round((new.subtotal_fils + v_svc)::numeric * new.vat_rate_bps / (10000.0 + new.vat_rate_bps));
    if new.total_fils <> new.subtotal_fils + v_svc or new.tax_fils <> v_tax then
      raise exception 'ORDER_INVALID: total mismatch' using errcode = 'P0001';
    end if;
  else
    v_tax := round((new.subtotal_fils + v_svc)::numeric * new.vat_rate_bps / 10000.0);
    if new.tax_fils <> v_tax or new.total_fils <> new.subtotal_fils + v_svc + v_tax then
      raise exception 'ORDER_INVALID: total mismatch' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'RECEIVED' and new.submitted_at is null then new.submitted_at := now(); end if;
  return new;
end $$;
create trigger t_orders_before_insert before insert on orders for each row execute function app.orders_before_insert();

-- Items must add up to the subtotal; checked at COMMIT so items can be inserted after the order row.
create or replace function app.orders_check_totals() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_sum bigint; v_count integer;
begin
  select coalesce(sum(line_total_fils), 0), count(*) into v_sum, v_count from order_items where order_id = new.id;
  if v_count = 0 then
    raise exception 'ORDER_INVALID: an order needs at least one item' using errcode = 'P0001';
  end if;
  if v_sum <> new.subtotal_fils then
    raise exception 'ORDER_INVALID: item totals (%) do not match subtotal (%)', v_sum, new.subtotal_fils using errcode = 'P0001';
  end if;
  return null;
end $$;
create constraint trigger t_orders_check_totals after insert on orders
  deferrable initially deferred for each row execute function app.orders_check_totals();

create or replace function app.order_items_before_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_order orders;
begin
  select * into v_order from orders where id = new.order_id;
  -- Items can only be added in the same transaction that created the order.
  if app.role() <> 'system' and v_order.created_at <> now() then
    raise exception 'ORDER_LOCKED: items cannot be added to a submitted order' using errcode = 'P0001';
  end if;
  new.restaurant_id := v_order.restaurant_id;
  return new;
end $$;
create trigger t_order_items_before_insert before insert on order_items for each row execute function app.order_items_before_insert();

-- The order state machine:
-- AWAITING_PAYMENT → RECEIVED → ACCEPTED → PREPARING → READY → SERVED → COMPLETED (+ CANCELLED)
create or replace function app.orders_before_update() returns trigger language plpgsql as $$
declare
  r text := app.role();
  internal boolean := pg_trigger_depth() > 1;
  ok boolean;
begin
  if new.restaurant_id <> old.restaurant_id or new.table_id <> old.table_id
     or new.order_number <> old.order_number or new.idempotency_key is distinct from old.idempotency_key
     or new.subtotal_fils <> old.subtotal_fils or new.service_charge_fils <> old.service_charge_fils
     or new.tax_fils <> old.tax_fils or new.total_fils <> old.total_fils
     or new.vat_rate_bps <> old.vat_rate_bps or new.service_charge_bps <> old.service_charge_bps
     or new.prices_include_tax <> old.prices_include_tax or new.created_at <> old.created_at
     or new.is_demo <> old.is_demo
     or (new.guest_session_id is distinct from old.guest_session_id and new.guest_session_id is not null) then
    raise exception 'ORDER_IMMUTABLE: order identity and amounts cannot be changed' using errcode = 'P0001';
  end if;
  if new.payment_status <> old.payment_status and not internal then
    raise exception 'FORBIDDEN: payment status is managed through payment records' using errcode = 'P0001';
  end if;
  if new.payment_method <> old.payment_method and not (internal or r in ('system', 'admin')) then
    raise exception 'FORBIDDEN: payment method cannot be changed by %', r using errcode = 'P0001';
  end if;
  if r not in ('kitchen', 'waiter', 'admin', 'system') and not internal then
    raise exception 'FORBIDDEN: % cannot update orders', r using errcode = 'P0001';
  end if;
  if r = 'kitchen' and not internal and (new.serving_waiter_id is distinct from old.serving_waiter_id
      or new.collected_at is distinct from old.collected_at or new.notes is distinct from old.notes) then
    raise exception 'FORBIDDEN: kitchen staff can only change preparation status' using errcode = 'P0001';
  end if;
  if r = 'waiter' and not internal then
    if new.priority <> old.priority or new.notes is distinct from old.notes then
      raise exception 'FORBIDDEN: waiters cannot change order priority or notes' using errcode = 'P0001';
    end if;
    if old.serving_waiter_id is not null and old.serving_waiter_id <> app.uid() then
      raise exception 'ORDER_TAKEN: this order is being handled by another waiter' using errcode = 'P0001';
    end if;
    if new.serving_waiter_id is distinct from old.serving_waiter_id and new.serving_waiter_id is distinct from app.uid() then
      raise exception 'FORBIDDEN: waiters can only assign orders to themselves' using errcode = 'P0001';
    end if;
    if new.collected_at is distinct from old.collected_at and old.status <> 'READY' then
      raise exception 'INVALID_TRANSITION: only READY orders can be collected' using errcode = 'P0001';
    end if;
  end if;

  if new.status <> old.status then
    ok := case
      when old.status = 'AWAITING_PAYMENT' and new.status = 'RECEIVED' then internal or r = 'system'
      when old.status = 'AWAITING_PAYMENT' and new.status = 'CANCELLED' then internal or r in ('system', 'admin')
      when old.status = 'RECEIVED' and new.status = 'ACCEPTED' then r in ('kitchen', 'admin')
      when old.status = 'RECEIVED' and new.status = 'CANCELLED' then r in ('kitchen', 'admin', 'system')
      when old.status in ('ACCEPTED', 'PREPARING') and new.status = 'CANCELLED' then r in ('admin', 'system')
      when old.status = 'ACCEPTED' and new.status = 'PREPARING' then r in ('kitchen', 'admin')
      when old.status = 'PREPARING' and new.status = 'READY' then r in ('kitchen', 'admin')
      when old.status = 'READY' and new.status = 'SERVED' then r in ('waiter', 'admin')
      when old.status = 'SERVED' and new.status = 'COMPLETED' then internal or r in ('waiter', 'admin', 'system')
      else false
    end;
    if not ok then
      raise exception 'INVALID_TRANSITION: order % cannot move from % to % (role: %)',
        old.order_number, old.status, new.status, r using errcode = 'P0001';
    end if;
    case new.status
      when 'RECEIVED' then new.submitted_at := now();
      when 'ACCEPTED' then new.accepted_at := now();
      when 'PREPARING' then new.preparing_at := now();
      when 'READY' then new.ready_at := now();
      when 'SERVED' then
        new.served_at := now();
        new.collected_at := coalesce(new.collected_at, now());
        if r = 'waiter' then new.serving_waiter_id := coalesce(new.serving_waiter_id, app.uid()); end if;
      when 'COMPLETED' then new.completed_at := now();
      when 'CANCELLED' then
        new.cancelled_at := now();
        new.cancelled_by := app.uid();
        new.cancel_reason := coalesce(nullif(trim(new.cancel_reason), ''), 'Cancelled');
      else null;
    end case;
  end if;
  return new;
end $$;
create trigger t_orders_before_update before update on orders for each row execute function app.orders_before_update();

create or replace function app.apply_inventory(p_order uuid, p_sign integer, p_reason text)
returns void language plpgsql security definer set search_path = public, app as $$
declare rec record;
begin
  for rec in
    select mii.inventory_item_id, sum(mii.quantity_per_unit * oi.quantity) as qty, o.restaurant_id
    from order_items oi
    join orders o on o.id = oi.order_id
    join menu_item_ingredients mii on mii.menu_item_id = oi.menu_item_id
    where oi.order_id = p_order
    group by mii.inventory_item_id, o.restaurant_id
  loop
    insert into inventory_transactions (restaurant_id, inventory_item_id, delta, quantity_after, reason, order_id, created_by, note)
    values (rec.restaurant_id, rec.inventory_item_id, p_sign * rec.qty, 0, p_reason, p_order, app.uid(),
            case when p_sign < 0 then 'Used by order' else 'Returned from cancelled order' end);
  end loop;
end $$;

create or replace function app.orders_after_change() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_tn integer := app.table_number(new.table_id);
  v_tlabel text := 'TABLE ' || lpad(v_tn::text, 2, '0');
  v_items integer;
  w uuid;
begin
  if tg_op = 'INSERT' then
    insert into order_events (restaurant_id, order_id, event_type, to_status, actor_user_id, actor_role, details)
    values (new.restaurant_id, new.id, 'ORDER_CREATED', new.status, app.uid(), app.role(),
            jsonb_build_object('payment_method', new.payment_method, 'total_fils', new.total_fils));
  elsif new.status <> old.status then
    insert into order_events (restaurant_id, order_id, event_type, from_status, to_status, actor_user_id, actor_role, details)
    values (new.restaurant_id, new.id, 'STATUS_CHANGED', old.status, new.status, app.uid(),
            case when pg_trigger_depth() > 1 then 'system' else app.role() end,
            case when new.status = 'CANCELLED' then jsonb_build_object('reason', new.cancel_reason) else '{}'::jsonb end);
  elsif new.collected_at is distinct from old.collected_at and new.collected_at is not null then
    insert into order_events (restaurant_id, order_id, event_type, from_status, to_status, actor_user_id, actor_role)
    values (new.restaurant_id, new.id, 'COLLECTED', new.status, new.status, app.uid(), app.role());
  elsif new.serving_waiter_id is distinct from old.serving_waiter_id and new.serving_waiter_id is not null then
    insert into order_events (restaurant_id, order_id, event_type, from_status, to_status, actor_user_id, actor_role)
    values (new.restaurant_id, new.id, 'SERVING_CLAIMED', new.status, new.status, app.uid(), app.role());
  end if;

  -- Order reached the kitchen (cash/counter immediately; online after verified payment).
  if new.status = 'RECEIVED' and (tg_op = 'INSERT' or old.status <> 'RECEIVED') then
    perform app.notify(new.restaurant_id, null, 'admin', 'NEW_ORDER',
      'New order #' || new.order_number, v_tlabel || ' · ' || to_char(new.total_fils / 100.0, 'FM999990.00') || ' ' || 'AED',
      new.id, new.table_id, jsonb_build_object('orderNumber', new.order_number, 'tableNumber', v_tn));
  end if;

  if tg_op = 'UPDATE' and new.status <> old.status then
    if new.status = 'ACCEPTED' then
      perform app.apply_inventory(new.id, -1, 'CONSUMPTION');
    end if;

    -- CRITICAL: kitchen marked the order READY → notify the responsible waiter(s).
    if new.status = 'READY' then
      select coalesce(sum(quantity), 0) into v_items from order_items where order_id = new.id;
      for w in select * from app.service_recipients(new.table_id, new.id) loop
        perform app.notify(new.restaurant_id, w, null, 'ORDER_READY', v_tlabel,
          'ORDER #' || new.order_number || ' · ' || v_items || case when v_items = 1 then ' ITEM' else ' ITEMS' end || ' READY TO SERVE',
          new.id, new.table_id,
          jsonb_build_object('orderNumber', new.order_number, 'tableNumber', v_tn, 'itemCount', v_items));
      end loop;
    end if;

    if new.status = 'CANCELLED' then
      if old.accepted_at is not null then
        perform app.apply_inventory(new.id, 1, 'RETURN');
      end if;
      update payments set status = 'CANCELLED', failure_reason = 'Order cancelled'
        where order_id = new.id and status in ('PENDING', 'PROCESSING');
      perform app.notify(new.restaurant_id, null, 'admin', 'ORDER_CANCELLED',
        'Order #' || new.order_number || ' cancelled',
        v_tlabel || ' · ' || new.cancel_reason ||
          case when exists (select 1 from payments where order_id = new.id and status = 'PAID') then ' · REFUND REQUIRED' else '' end,
        new.id, new.table_id, jsonb_build_object('orderNumber', new.order_number, 'tableNumber', v_tn));
    end if;
  end if;

  -- Served and paid → completed.
  if new.status = 'SERVED' and new.payment_status = 'PAID' then
    update orders set status = 'COMPLETED' where id = new.id;
  end if;

  perform app.emit('order.changed', new.restaurant_id, jsonb_build_object(
    'o', new.id, 'tb', new.table_id, 'g', new.guest_session_id, 's', new.status,
    'ps', new.payment_status, 'prev', case when tg_op = 'UPDATE' then old.status else null end));
  return null;
end $$;
create trigger t_orders_after_change after insert or update on orders for each row execute function app.orders_after_change();

-- ---------------------------------------------------------------------------
-- Payments (status machine, kept separate from the order status)
-- ---------------------------------------------------------------------------
create or replace function app.payments_before_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_order orders;
begin
  select * into v_order from orders where id = new.order_id;
  if v_order.id is null or v_order.restaurant_id <> new.restaurant_id then
    raise exception 'PAYMENT_INVALID: order not found' using errcode = 'P0001';
  end if;
  if new.amount_fils <> v_order.total_fils then
    raise exception 'PAYMENT_AMOUNT_MISMATCH: payment amount must equal the order total' using errcode = 'P0001';
  end if;
  if new.method <> v_order.payment_method then
    raise exception 'PAYMENT_INVALID: payment method does not match the order' using errcode = 'P0001';
  end if;
  if app.role() <> 'system' then
    if v_order.status in ('CANCELLED', 'COMPLETED') then
      raise exception 'PAYMENT_INVALID: order is already %', lower(v_order.status) using errcode = 'P0001';
    end if;
    if new.status not in ('PENDING', 'PROCESSING') then
      raise exception 'PAYMENT_INVALID: new payments must be PENDING or PROCESSING' using errcode = 'P0001';
    end if;
    new.created_at := now();
    new.paid_at := null;
    new.confirmed_by := null;
  end if;
  if app.role() = 'kitchen' then
    raise exception 'FORBIDDEN: kitchen staff cannot create payments' using errcode = 'P0001';
  end if;
  new.currency := 'AED';
  return new;
end $$;
create trigger t_payments_before_insert before insert on payments for each row execute function app.payments_before_insert();

create or replace function app.payments_before_update() returns trigger language plpgsql as $$
declare r text := app.role(); internal boolean := pg_trigger_depth() > 1; ok boolean;
begin
  if new.amount_fils <> old.amount_fils or new.order_id <> old.order_id or new.method <> old.method
     or new.restaurant_id <> old.restaurant_id or new.currency <> old.currency
     or new.transaction_ref <> old.transaction_ref or new.created_at <> old.created_at
     or (old.provider_session_id is not null and new.provider_session_id is distinct from old.provider_session_id) then
    raise exception 'PAYMENT_IMMUTABLE: payment amount and identity cannot be changed' using errcode = 'P0001';
  end if;
  if r = 'kitchen' then
    raise exception 'FORBIDDEN: kitchen staff cannot change payments' using errcode = 'P0001';
  end if;
  if new.status <> old.status then
    ok := case
      when old.status in ('PENDING', 'PROCESSING') and new.status = 'PAID' then
        case when old.method = 'ONLINE' then r = 'system'          -- only provider-verified
             else r in ('waiter', 'admin', 'system') end           -- staff-confirmed cash/counter
      when old.status = 'PENDING' and new.status = 'PROCESSING' then r = 'system' or internal
      when old.status in ('PENDING', 'PROCESSING') and new.status = 'FAILED' then r = 'system' or internal
      when old.status in ('PENDING', 'PROCESSING') and new.status = 'CANCELLED' then internal or r in ('system', 'admin', 'guest')
      when old.status = 'PAID' and new.status = 'REFUNDED' then r in ('admin', 'system')
      else false
    end;
    if not ok then
      raise exception 'INVALID_TRANSITION: payment % cannot move from % to % (role: %)',
        old.transaction_ref, old.status, new.status, r using errcode = 'P0001';
    end if;
    if new.status = 'PAID' then
      new.paid_at := now();
      if r in ('waiter', 'admin') then new.confirmed_by := app.uid(); end if;
    elsif new.status = 'REFUNDED' then
      new.refunded_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger t_payments_before_update before update on payments for each row execute function app.payments_before_update();

create or replace function app.payments_after_change() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_order orders; v_tn integer;
begin
  select * into v_order from orders where id = new.order_id;
  v_tn := app.table_number(v_order.table_id);
  if tg_op = 'INSERT' or new.status <> old.status then
    insert into order_events (restaurant_id, order_id, event_type, from_status, to_status, actor_user_id, actor_role, details)
    values (new.restaurant_id, new.order_id, 'PAYMENT_' || new.status,
            case when tg_op = 'UPDATE' then old.status else null end, new.status, app.uid(), app.role(),
            jsonb_build_object('payment_id', new.id, 'transaction_ref', new.transaction_ref,
                               'method', new.method, 'amount_fils', new.amount_fils));

    -- Mirror onto the order unless another live payment owns the order's state.
    if new.status in ('PENDING', 'PROCESSING', 'PAID')
       or not exists (select 1 from payments p where p.order_id = new.order_id and p.id <> new.id
                      and p.status in ('PENDING', 'PROCESSING', 'PAID')) then
      update orders set payment_status = new.status where id = new.order_id and payment_status <> new.status;
    end if;

    if new.status = 'PAID' and v_order.status = 'AWAITING_PAYMENT' then
      update orders set status = 'RECEIVED' where id = new.order_id;
    end if;

    if new.status in ('PAID', 'FAILED', 'REFUNDED') and not new.is_demo then
      perform app.notify(new.restaurant_id, null, 'admin', 'PAYMENT_UPDATE',
        'Payment ' || lower(new.status) || ' · #' || v_order.order_number,
        'TABLE ' || lpad(v_tn::text, 2, '0') || ' · ' || new.method || ' · ' ||
          to_char(new.amount_fils / 100.0, 'FM999990.00') || ' AED · ' || new.transaction_ref,
        new.order_id, v_order.table_id,
        jsonb_build_object('orderNumber', v_order.order_number, 'status', new.status, 'paymentId', new.id));
    end if;
  end if;
  perform app.emit('payment.changed', new.restaurant_id,
    jsonb_build_object('o', new.order_id, 'p', new.id, 'g', v_order.guest_session_id, 'ps', new.status));
  return null;
end $$;
create trigger t_payments_after_change after insert or update on payments for each row execute function app.payments_after_change();

-- ---------------------------------------------------------------------------
-- Notifications → realtime
-- ---------------------------------------------------------------------------
create or replace function app.notifications_after_insert() returns trigger language plpgsql as $$
begin
  perform app.emit('notification', new.restaurant_id, jsonb_build_object(
    'n', new.id, 'u', new.recipient_user_id, 'role', new.recipient_role, 'nt', new.type, 'o', new.order_id));
  return null;
end $$;
create trigger t_notifications_after_insert after insert on notifications for each row execute function app.notifications_after_insert();

-- ---------------------------------------------------------------------------
-- Customer requests
-- ---------------------------------------------------------------------------
create or replace function app.requests_before_write() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_gs guest_sessions; ok boolean;
begin
  if tg_op = 'INSERT' then
    if new.guest_session_id is not null then
      select * into v_gs from guest_sessions where id = new.guest_session_id;
      if v_gs.table_id <> new.table_id or v_gs.restaurant_id <> new.restaurant_id then
        raise exception 'REQUEST_INVALID: session does not belong to this table' using errcode = 'P0001';
      end if;
    end if;
    new.status := 'OPEN';
    new.created_at := now();
    return new;
  end if;
  if new.table_id <> old.table_id or new.type <> old.type or new.guest_session_id is distinct from old.guest_session_id
     and new.guest_session_id is not null then
    raise exception 'REQUEST_IMMUTABLE: request details cannot be changed' using errcode = 'P0001';
  end if;
  if new.status <> old.status then
    ok := (old.status = 'OPEN' and new.status in ('ACKNOWLEDGED', 'COMPLETED', 'CANCELLED'))
       or (old.status = 'ACKNOWLEDGED' and new.status in ('COMPLETED', 'CANCELLED'));
    if not ok then
      raise exception 'INVALID_TRANSITION: request cannot move from % to %', old.status, new.status using errcode = 'P0001';
    end if;
    if new.status = 'ACKNOWLEDGED' then
      new.acknowledged_at := now(); new.acknowledged_by := app.uid();
    elsif new.status = 'COMPLETED' then
      new.completed_at := now(); new.completed_by := app.uid();
      new.acknowledged_at := coalesce(new.acknowledged_at, now());
      new.acknowledged_by := coalesce(new.acknowledged_by, app.uid());
    end if;
  end if;
  return new;
end $$;
create trigger t_requests_before_write before insert or update on customer_requests for each row execute function app.requests_before_write();

create or replace function app.requests_after_change() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_tn integer := app.table_number(new.table_id); w uuid; v_label text;
begin
  if tg_op = 'INSERT' then
    v_label := case new.type when 'CALL_WAITER' then 'Waiter called' when 'REQUEST_BILL' then 'Bill requested'
                             when 'REQUEST_WIFI' then 'Wi-Fi help requested' else 'Assistance requested' end;
    for w in select * from app.service_recipients(new.table_id, null) loop
      perform app.notify(new.restaurant_id, w, null, 'WAITER_REQUEST', 'TABLE ' || lpad(v_tn::text, 2, '0'),
        v_label || coalesce(' · ' || new.note, ''), null, new.table_id,
        jsonb_build_object('requestId', new.id, 'requestType', new.type, 'tableNumber', v_tn));
    end loop;
    perform app.notify(new.restaurant_id, null, 'admin', 'WAITER_REQUEST', v_label || ' · TABLE ' || lpad(v_tn::text, 2, '0'),
      new.note, null, new.table_id, jsonb_build_object('requestId', new.id, 'requestType', new.type, 'tableNumber', v_tn));
  end if;
  perform app.emit('request.changed', new.restaurant_id, jsonb_build_object('q', new.id, 'tb', new.table_id, 'g', new.guest_session_id));
  return null;
end $$;
create trigger t_requests_after_change after insert or update on customer_requests for each row execute function app.requests_after_change();

-- ---------------------------------------------------------------------------
-- Reviews: only after the order was served, one per order.
-- ---------------------------------------------------------------------------
create or replace function app.reviews_before_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_order orders;
begin
  select * into v_order from orders where id = new.order_id;
  if v_order.id is null or v_order.restaurant_id <> new.restaurant_id then
    raise exception 'REVIEW_INVALID: order not found' using errcode = 'P0001';
  end if;
  if app.role() <> 'system' then
    if v_order.status not in ('SERVED', 'COMPLETED') then
      raise exception 'REVIEW_NOT_ALLOWED: you can review once your order has been served' using errcode = 'P0001';
    end if;
    if new.guest_session_id is distinct from v_order.guest_session_id then
      raise exception 'REVIEW_NOT_ALLOWED: you can only review your own order' using errcode = 'P0001';
    end if;
    new.created_at := now();
  end if;
  new.table_id := v_order.table_id;
  return new;
end $$;
create trigger t_reviews_before_insert before insert on reviews for each row execute function app.reviews_before_insert();

create or replace function app.reviews_after_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_on text;
begin
  if app.role() <> 'system' then
    select order_number into v_on from orders where id = new.order_id;
    perform app.notify(new.restaurant_id, null, 'admin', 'NEW_REVIEW', repeat('★', new.rating) || ' review · #' || v_on,
      left(new.comment, 140), new.order_id, new.table_id, jsonb_build_object('rating', new.rating, 'reviewId', new.id));
  end if;
  perform app.emit('review.created', new.restaurant_id, jsonb_build_object('o', new.order_id, 'g', new.guest_session_id));
  return null;
end $$;
create trigger t_reviews_after_insert after insert on reviews for each row execute function app.reviews_after_insert();

-- ---------------------------------------------------------------------------
-- Inventory: every stock movement is a transaction row; the item quantity is
-- derived by applying the delta atomically.
-- ---------------------------------------------------------------------------
create or replace function app.inventory_tx_before_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_item inventory_items;
begin
  update inventory_items set quantity = quantity + new.delta
    where id = new.inventory_item_id and restaurant_id = new.restaurant_id
    returning * into v_item;
  if v_item.id is null then
    raise exception 'INVENTORY_INVALID: inventory item not found' using errcode = 'P0001';
  end if;
  new.quantity_after := v_item.quantity;
  new.created_at := now();
  return new;
end $$;
create trigger t_inventory_tx_before_insert before insert on inventory_transactions for each row execute function app.inventory_tx_before_insert();

create or replace function app.inventory_after_update() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.quantity <= new.low_stock_threshold and (old.quantity > old.low_stock_threshold or tg_op = 'INSERT') then
    perform app.notify(new.restaurant_id, null, 'admin', 'LOW_STOCK', 'Low stock: ' || new.name,
      'Only ' || trim(to_char(new.quantity, 'FM999999990.###')) || ' ' || new.unit || ' left (alert at ' ||
      trim(to_char(new.low_stock_threshold, 'FM999999990.###')) || ' ' || new.unit || ')',
      null, null, jsonb_build_object('inventoryItemId', new.id));
  end if;
  perform app.emit('inventory.changed', new.restaurant_id, jsonb_build_object('i', new.id));
  return null;
end $$;
create trigger t_inventory_after_update after update on inventory_items for each row execute function app.inventory_after_update();

-- ---------------------------------------------------------------------------
-- Service issues reported by waiters
-- ---------------------------------------------------------------------------
create or replace function app.issues_after_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare v_order orders; v_reporter text;
begin
  select * into v_order from orders where id = new.order_id;
  select full_name into v_reporter from users where id = new.reported_by;
  insert into order_events (restaurant_id, order_id, event_type, actor_user_id, actor_role, details)
  values (new.restaurant_id, new.order_id, 'ISSUE_' || new.type, app.uid(), app.role(), jsonb_build_object('note', new.note));
  perform app.notify(new.restaurant_id, null, 'admin', 'SERVICE_ISSUE',
    case new.type when 'MISSING_ITEM' then 'Missing item' else 'Service issue' end || ' · #' || v_order.order_number,
    new.note || coalesce(' — ' || v_reporter, ''), new.order_id, v_order.table_id, jsonb_build_object('issueId', new.id));
  perform app.emit('order.changed', new.restaurant_id, jsonb_build_object('o', new.order_id, 'tb', v_order.table_id, 'g', v_order.guest_session_id));
  return null;
end $$;
create trigger t_issues_after_insert after insert on order_issues for each row execute function app.issues_after_insert();

-- ---------------------------------------------------------------------------
-- Change feeds for menu / tables / staff / settings
-- ---------------------------------------------------------------------------
create or replace function app.emit_row_change() returns trigger language plpgsql as $$
declare rec record;
begin
  if tg_op = 'DELETE' then rec := old; else rec := new; end if;
  perform app.emit(tg_argv[0], rec.restaurant_id, '{}'::jsonb);
  return null;
end $$;

create or replace function app.emit_restaurant_change() returns trigger language plpgsql as $$
begin
  perform app.emit('menu.changed', new.id, '{}'::jsonb);
  return null;
end $$;

create trigger t_menu_items_emit after insert or update or delete on menu_items for each row execute function app.emit_row_change('menu.changed');
create trigger t_menu_categories_emit after insert or update or delete on menu_categories for each row execute function app.emit_row_change('menu.changed');
create trigger t_variants_emit after insert or update or delete on product_variants for each row execute function app.emit_row_change('menu.changed');
create trigger t_tables_emit after insert or update or delete on restaurant_tables for each row execute function app.emit_row_change('table.changed');
create trigger t_assignments_emit after insert or update or delete on waiter_assignments for each row execute function app.emit_row_change('table.changed');
create trigger t_staff_emit after insert or update or delete on staff_profiles for each row execute function app.emit_row_change('staff.changed');
create trigger t_restaurant_emit after update on restaurants for each row execute function app.emit_restaurant_change();
