import type { Tx } from '../db.js';

/** Order columns visible to each audience. Kitchen never receives money fields. */
const KITCHEN_COLS = `o.id, o.order_number, o.status, o.priority, o.notes, o.est_prep_minutes, o.created_at, o.submitted_at,
  o.accepted_at, o.preparing_at, o.ready_at, o.collected_at, o.served_at, o.completed_at, o.cancelled_at, o.cancel_reason,
  o.serving_waiter_id, o.is_demo, o.table_id`;
const GUEST_COLS = `o.id, o.order_number, o.status, o.payment_method, o.payment_status, o.subtotal_fils, o.service_charge_fils,
  o.tax_fils, o.total_fils, o.vat_rate_bps, o.service_charge_bps, o.prices_include_tax, o.est_prep_minutes, o.notes,
  o.created_at, o.submitted_at, o.accepted_at, o.preparing_at, o.ready_at, o.served_at, o.completed_at, o.cancelled_at,
  o.cancel_reason, o.is_demo, o.table_id`;
const FULL_COLS = `o.*`;

const ITEMS = `coalesce((select json_agg(json_build_object('id', oi.id, 'menu_item_id', oi.menu_item_id, 'item_name', oi.item_name,
    'quantity', oi.quantity, 'unit_price_fils', oi.unit_price_fils, 'line_total_fils', oi.line_total_fils, 'options', oi.options,
    'special_instructions', oi.special_instructions, 'prep_minutes', oi.prep_minutes) order by oi.position, oi.created_at, oi.id)
  from order_items oi where oi.order_id = o.id), '[]') as items`;
const ITEMS_NO_MONEY = `coalesce((select json_agg(json_build_object('id', oi.id, 'item_name', oi.item_name, 'quantity', oi.quantity,
    'options', oi.options, 'special_instructions', oi.special_instructions, 'prep_minutes', oi.prep_minutes) order by oi.position, oi.created_at, oi.id)
  from order_items oi where oi.order_id = o.id), '[]') as items`;

export type Audience = 'guest' | 'kitchen' | 'staff';

/** `extra` adds select-list expressions (e.g. per-row permission flags). */
export function orderSelect(aud: Audience, extra = '') {
  const cols = aud === 'kitchen' ? KITCHEN_COLS : aud === 'guest' ? GUEST_COLS : FULL_COLS;
  const items = aud === 'kitchen' ? ITEMS_NO_MONEY : ITEMS;
  const staffExtra = aud === 'guest' ? '' : `, w.full_name as serving_waiter_name,
    (select wa.waiter_id from waiter_assignments wa where wa.table_id = o.table_id and wa.is_active) as assigned_waiter_id,
    (select u.full_name from waiter_assignments wa join users u on u.id = wa.waiter_id where wa.table_id = o.table_id and wa.is_active) as assigned_waiter_name,
    (select count(*) from order_issues oi2 where oi2.order_id = o.id and oi2.status = 'OPEN') as open_issues`;
  const review = aud === 'guest' ? `, (select json_build_object('rating', rv.rating, 'comment', rv.comment, 'created_at', rv.created_at)
      from reviews rv where rv.order_id = o.id) as review` : '';
  return `select ${cols}, t.number as table_number, ${items}${staffExtra}${review}${extra ? `, ${extra}` : ''}
    from orders o join restaurant_tables t on t.id = o.table_id
    ${aud === 'guest' ? '' : 'left join users w on w.id = o.serving_waiter_id'}`;
}

export async function getOrder(tx: Tx, aud: Audience, id: string) {
  const r = await tx.query(`${orderSelect(aud)} where o.id = $1`, [id]);
  return r.rows[0] ?? null;
}
