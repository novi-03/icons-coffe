/** Restaurant pricing. Mirrors the integrity check in db/migrations/002_logic.sql exactly. */
export interface PricingSettings { vat_rate_bps: number; service_charge_bps: number; prices_include_tax: boolean }
export interface Totals { subtotal: number; service: number; tax: number; total: number }

export function computeTotals(subtotal: number, s: PricingSettings): Totals {
  if (!Number.isInteger(subtotal) || subtotal < 0) throw new Error('subtotal must be a non-negative integer (fils)');
  const service = Math.round((subtotal * s.service_charge_bps) / 10000);
  const base = subtotal + service;
  if (s.prices_include_tax) {
    const tax = Math.round((base * s.vat_rate_bps) / (10000 + s.vat_rate_bps));
    return { subtotal, service, tax, total: base };
  }
  const tax = Math.round((base * s.vat_rate_bps) / 10000);
  return { subtotal, service, tax, total: base + tax };
}
