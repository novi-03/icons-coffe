/** RFC 4180 CSV with protection against spreadsheet formula injection. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => cell(c.endsWith('_fils') ? c.replace(/_fils$/, '_aed') : c)).join(',');
  const body = rows.map((r) => columns.map((c) => {
    const v = r[c];
    // Money is stored in fils; export as AED with 2 decimals for spreadsheets.
    if (c.endsWith('_fils') && v !== null && v !== undefined && v !== '') return (Number(v) / 100).toFixed(2);
    return cell(v);
  }).join(','));
  return '﻿' + [header, ...body].join('\r\n') + '\r\n';
}
