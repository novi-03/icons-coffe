import type { MenuItem } from '../lib/types';

export interface CartLine { key: string; menu_item_id: string; quantity: number; variant_ids: string[]; special_instructions?: string }

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function unitPrice(item: MenuItem, variantIds: string[]) {
  return item.price_fils + item.variants.filter((v) => variantIds.includes(v.id)).reduce((s, v) => s + v.price_delta_fils, 0);
}

/** Why a cart line can't be ordered right now (null if fine). */
export function lineProblem(item: MenuItem | undefined, line: CartLine): string | null {
  if (!item || item.is_archived) return 'No longer on the menu';
  if (!item.is_available) return 'Currently unavailable';
  for (const id of line.variant_ids) {
    const v = item.variants.find((x) => x.id === id);
    if (!v) return 'Options changed — please edit';
    if (!v.is_available) return `${v.name} unavailable`;
  }
  const groups = new Set(item.variants.filter((v) => v.kind !== 'EXTRA').map((v) => `${v.kind}:${v.group_name}`));
  for (const g of groups) {
    if (item.variants.filter((v) => `${v.kind}:${v.group_name}` === g && line.variant_ids.includes(v.id)).length !== 1) return 'Options changed — please edit';
  }
  return null;
}

/** Mirrors server/lib/pricing.ts so the cart shows exactly what will be charged. */
export function computeTotals(subtotal: number, s: { vat_rate_bps: number; service_charge_bps: number; prices_include_tax: boolean }) {
  const service = Math.round((subtotal * s.service_charge_bps) / 10000);
  const base = subtotal + service;
  if (s.prices_include_tax) return { subtotal, service, tax: Math.round((base * s.vat_rate_bps) / (10000 + s.vat_rate_bps)), total: base };
  const tax = Math.round((base * s.vat_rate_bps) / 10000);
  return { subtotal, service, tax, total: base + tax };
}
