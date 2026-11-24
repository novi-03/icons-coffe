export const money = (fils: number | string | null | undefined, opts: { plain?: boolean } = {}) => {
  const n = Number(fils ?? 0) / 100;
  const s = n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return opts.plain ? s : `AED ${s}`;
};

let restaurantTz = 'Asia/Dubai';
export const setTimezone = (tz: string | undefined) => { if (tz) restaurantTz = tz; };
export const getTimezone = () => restaurantTz;

export const time = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: restaurantTz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';
export const dateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: restaurantTz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';
export const date = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: restaurantTz, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—';

/** Today's date (YYYY-MM-DD) in the restaurant timezone, offset by `days`. */
export const localDate = (days = 0) => {
  const d = new Date(Date.now() + days * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: restaurantTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

export const minutesSince = (iso: string | null | undefined, now = Date.now()) => (iso ? Math.max(0, (now - new Date(iso).getTime()) / 60000) : 0);
export const clock = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return '00:00';
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
export const ago = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return '';
  const m = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return dateTime(iso);
};
export const tableNo = (n: number | string | null | undefined) => (n === null || n === undefined ? '—' : String(n).padStart(2, '0'));
export const pct = (bps: number) => `${(bps / 100).toLocaleString('en', { maximumFractionDigits: 2 })}%`;
export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
