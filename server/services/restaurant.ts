import type { Tx } from '../db.js';

export interface DayHours { open: string; close: string; closed: boolean }

function localParts(tz: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { dow, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Opening status in the restaurant's own timezone. Supports overnight hours (e.g. 06:00–02:00). */
export function openingStatus(r: { timezone: string; opening_hours: DayHours[]; order_mode: string }, at = new Date()) {
  if (r.order_mode === 'OPEN') return { isOpen: true, label: 'Open now', reason: 'manual' as const };
  if (r.order_mode === 'CLOSED') return { isOpen: false, label: 'Temporarily closed', reason: 'manual' as const };
  const hours = r.opening_hours;
  if (!Array.isArray(hours) || hours.length !== 7) return { isOpen: true, label: 'Open now', reason: 'hours' as const };
  const { dow, minutes } = localParts(r.timezone, at);
  const today = hours[dow];
  const yesterday = hours[(dow + 6) % 7];
  const inDay = (d: DayHours) => {
    if (d.closed) return false;
    const o = toMin(d.open), c = toMin(d.close);
    return c > o ? minutes >= o && minutes < c : minutes >= o;
  };
  const carry = !yesterday.closed && toMin(yesterday.close) <= toMin(yesterday.open) && minutes < toMin(yesterday.close);
  if (inDay(today) || carry) {
    const closeAt = carry && !inDay(today) ? yesterday.close : today.close;
    return { isOpen: true, label: `Open · closes ${closeAt}`, reason: 'hours' as const };
  }
  const opensAt = !today.closed && minutes < toMin(today.open) ? today.open : null;
  return { isOpen: false, label: opensAt ? `Closed · opens ${opensAt}` : 'Closed now', reason: 'hours' as const };
}

export async function loadRestaurant(tx: Tx) {
  const r = await tx.query(`select * from restaurants where id = app.rid()`);
  return r.rows[0];
}

export function publicRestaurant(r: any) {
  return {
    id: r.id, name: r.name, slug: r.slug, timezone: r.timezone, currency: r.currency,
    vat_rate_bps: r.vat_rate_bps, service_charge_bps: r.service_charge_bps, prices_include_tax: r.prices_include_tax,
    welcome_message: r.welcome_message, wifi_ssid: r.wifi_ssid, wifi_password: r.wifi_password,
    address: r.address, phone: r.phone, opening_hours: r.opening_hours, order_mode: r.order_mode,
    status: openingStatus(r),
  };
}

export async function loadMenu(tx: Tx, opts: { includeArchived?: boolean } = {}) {
  const cats = await tx.query(
    `select id, name, slug, description, icon, sort_order, is_active from menu_categories
     ${opts.includeArchived ? '' : 'where is_active'} order by sort_order, name`);
  const items = await tx.query(
    `select i.id, i.category_id, i.name, i.description, i.price_fils, i.prep_minutes, i.is_available, i.is_featured,
            i.is_popular, i.dietary, i.calories, i.sort_order, i.is_archived, i.is_demo, i.image_media_id,
            case when i.image_media_id is null then null else '/api/media/' || i.image_media_id end as image_url,
            coalesce((select json_agg(json_build_object('id', v.id, 'kind', v.kind, 'group_name', v.group_name, 'name', v.name,
                       'price_delta_fils', v.price_delta_fils, 'is_default', v.is_default, 'is_available', v.is_available)
                       order by v.kind, v.sort_order) from product_variants v where v.menu_item_id = i.id), '[]') as variants
     from menu_items i
     ${opts.includeArchived ? '' : 'where not i.is_archived'}
     order by i.sort_order, i.name`);
  return { categories: cats.rows, items: items.rows };
}
