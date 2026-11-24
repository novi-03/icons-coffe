import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, Wifi, WifiOff } from 'lucide-react';
import type { OrderStatus, PaymentStatus } from '../lib/types';
import type { RtStatus } from '../lib/realtime';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------
export function Logo({ size = 'md', subtitle }: { size?: 'sm' | 'md' | 'lg'; subtitle?: string }) {
  const s = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-14 w-14' }[size];
  const t = { sm: 'text-base', md: 'text-lg', lg: 'text-2xl' }[size];
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 64 64" className={cx(s, 'shrink-0 drop-shadow-[0_0_12px_rgba(139,92,246,.45)]')} aria-hidden>
        <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c4b5fd" /><stop offset="1" stopColor="#7c3aed" /></linearGradient></defs>
        <rect width="64" height="64" rx="16" fill="#121834" stroke="rgba(196,181,253,.25)" />
        <path d="M16 24h26v8a13 13 0 0 1-26 0z" fill="url(#lg)" />
        <path d="M42 26a6 6 0 0 1 0 12" fill="none" stroke="#c4b5fd" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M14 47h32" stroke="#b8bcc8" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M24 12q-3 4 0 8M31 12q-3 4 0 8" stroke="#b8bcc8" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </svg>
      <div className="leading-tight">
        <div className={cx('font-display font-extrabold tracking-[0.18em] text-white', t)}>ICONS<span className="ml-1.5 font-semibold tracking-[0.12em] text-silver-300">COFFEE</span></div>
        {subtitle && <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-brand-300/80">{subtitle}</div>}
      </div>
    </div>
  );
}

export function DemoRibbon({ show, className }: { show?: boolean; className?: string }) {
  if (!show) return null;
  return (
    <div className={cx('bg-amber-500/10 px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-widest text-amber-300 ring-1 ring-inset ring-amber-500/20', className)}>
      Demo mode · sample menu, staff &amp; history are DEMO DATA
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons & inputs
// ---------------------------------------------------------------------------
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'outline';
type BtnSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
const btnVariant: Record<BtnVariant, string> = {
  primary: 'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow hover:from-brand-400 hover:to-brand-600',
  secondary: 'bg-navy-700 text-silver-100 ring-1 ring-inset ring-white/10 hover:bg-navy-600',
  ghost: 'text-silver-200 hover:bg-white/5',
  outline: 'text-silver-100 ring-1 ring-inset ring-white/15 hover:bg-white/5',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500',
  warning: 'bg-amber-500 text-black hover:bg-amber-400',
};
const btnSize: Record<BtnSize, string> = {
  xs: 'h-7 px-2.5 text-xs rounded-lg gap-1',
  sm: 'h-9 px-3 text-sm rounded-xl gap-1.5',
  md: 'h-11 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-5 text-base rounded-2xl gap-2',
  xl: 'h-16 px-6 text-lg rounded-2xl gap-3 font-bold tracking-wide',
};
export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx('inline-flex select-none items-center justify-center font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
        btnVariant[variant], btnSize[size], className)}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} {...rest}
      className={cx('inline-flex h-10 w-10 items-center justify-center rounded-xl text-silver-200 transition hover:bg-white/5 disabled:opacity-40', className)}>
      {children}
    </button>
  );
}

const fieldCls = 'w-full rounded-xl bg-ink-900 px-3.5 text-sm text-white ring-1 ring-inset ring-white/10 placeholder:text-silver-500 focus:outline-none focus:ring-2 focus:ring-brand-500';
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(fieldCls, 'h-11', className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(fieldCls, 'py-2.5', className)} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(fieldCls, 'h-11 pr-8', className)}>{children}</select>
);
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-silver-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-silver-500">{hint}</span>}
    </label>
  );
}
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-40', checked ? 'bg-brand-500' : 'bg-navy-600')}>
      <span className={cx('inline-block h-5 w-5 transform rounded-full bg-white shadow transition', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('rounded-2xl bg-navy-900/70 shadow-card ring-1 ring-inset ring-white/[.06] backdrop-blur', className)}>{children}</div>;
}
export function Badge({ tone = 'neutral', className, children }: { tone?: 'neutral' | 'violet' | 'green' | 'amber' | 'red' | 'blue' | 'silver'; className?: string; children: ReactNode }) {
  const t = {
    neutral: 'bg-white/5 text-silver-200 ring-white/10', violet: 'bg-brand-500/15 text-brand-300 ring-brand-500/30',
    green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    red: 'bg-red-500/15 text-red-300 ring-red-500/30', blue: 'bg-sky-500/15 text-sky-300 ring-sky-500/30', silver: 'bg-silver-300/10 text-silver-200 ring-silver-300/20',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', t, className)}>{children}</span>;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Awaiting payment', RECEIVED: 'Received', ACCEPTED: 'Accepted', PREPARING: 'Preparing', READY: 'Ready',
  SERVED: 'Served', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
const ORDER_TONE: Record<OrderStatus, Parameters<typeof Badge>[0]['tone']> = {
  AWAITING_PAYMENT: 'amber', RECEIVED: 'blue', ACCEPTED: 'violet', PREPARING: 'violet', READY: 'green', SERVED: 'silver', COMPLETED: 'neutral', CANCELLED: 'red',
};
export const OrderStatusBadge = ({ status }: { status: OrderStatus }) => <Badge tone={ORDER_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
const PAY_TONE: Record<PaymentStatus, Parameters<typeof Badge>[0]['tone']> = {
  PENDING: 'amber', PROCESSING: 'blue', PAID: 'green', FAILED: 'red', REFUNDED: 'violet', CANCELLED: 'neutral',
};
export const PaymentStatusBadge = ({ status }: { status: PaymentStatus }) => <Badge tone={PAY_TONE[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
export const METHOD_LABEL = { ONLINE: 'Online', CASH: 'Cash at table', COUNTER: 'Pay at counter' } as const;

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-5 w-5 animate-spin text-brand-400', className)} />;
}
export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-silver-400"><Spinner className="h-7 w-7" /><span className="text-sm">{label}</span></div>;
}
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-2 rounded-2xl bg-white/5 p-3 text-silver-400">{icon}</div>}
      <div className="font-display text-base font-semibold text-white">{title}</div>
      {body && <div className="max-w-sm text-sm text-silver-400">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
export function ErrorBanner({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-200 ring-1 ring-inset ring-red-500/25">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && <button onClick={onRetry} className="font-semibold text-red-100 underline underline-offset-2">Retry</button>}
    </div>
  );
}

export function LiveIndicator({ status, compact }: { status: RtStatus; compact?: boolean }) {
  const live = status === 'live';
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset',
      live ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25' : 'bg-amber-500/10 text-amber-300 ring-amber-500/25')}
      title={live ? 'Live updates connected' : 'Reconnecting to live updates…'}>
      {live ? <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
        : status === 'offline' ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3 animate-pulse" />}
      {!compact && (live ? 'Live' : status === 'offline' ? 'Offline' : 'Reconnecting')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------
export function Modal({ open, onClose, title, children, footer, size = 'md', sheet }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; sheet?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={cx('relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-navy-900 shadow-2xl ring-1 ring-white/10 animate-slide-up',
        sheet ? 'rounded-t-3xl sm:rounded-3xl' : 'rounded-t-3xl sm:rounded-2xl', w)}>
        {title !== undefined && (
          <div className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
            <div className="font-display text-lg font-semibold text-white">{title}</div>
            <IconButton label="Close" onClick={onClose}><X className="h-5 w-5" /></IconButton>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-white/5 bg-ink-900/60 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', tone = 'primary', onConfirm, onClose, input }: {
  open: boolean; title: string; body?: ReactNode; confirmLabel?: string; tone?: BtnVariant; onClose: () => void;
  onConfirm: (value: string) => Promise<void> | void; input?: { label: string; placeholder?: string; required?: boolean; minLength?: number };
}) {
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setValue(''); setError(null); } }, [open]);
  const invalid = !!input?.required && value.trim().length < (input.minLength ?? 1);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Back</Button>
        <Button variant={tone} loading={busy} disabled={invalid} onClick={async () => {
          setBusy(true); setError(null);
          try { await onConfirm(value.trim()); onClose(); } catch (e: any) { setError(e?.message ?? 'Failed'); } finally { setBusy(false); }
        }}>{confirmLabel}</Button>
      </div>}>
      <div className="space-y-4 p-5 text-sm text-silver-300">
        {body}
        {input && <Field label={input.label}><Input autoFocus value={value} placeholder={input.placeholder} onChange={(e) => setValue(e.target.value)} maxLength={200} /></Field>}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
type Toast = { id: number; tone: 'success' | 'error' | 'info'; title: string; body?: string };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const id = useRef(0);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const tid = ++id.current;
    setToasts((x) => [...x.slice(-3), { ...t, id: tid }]);
    window.setTimeout(() => setToasts((x) => x.filter((y) => y.id !== tid)), t.tone === 'error' ? 6000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3 sm:items-end sm:pr-5" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl px-4 py-3 shadow-2xl ring-1 animate-pop',
            t.tone === 'success' && 'bg-emerald-950/95 ring-emerald-500/30', t.tone === 'error' && 'bg-red-950/95 ring-red-500/30',
            t.tone === 'info' && 'bg-navy-800/95 ring-brand-500/30')}>
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" /> : t.tone === 'error' ? <AlertTriangle className="mt-0.5 h-5 w-5 text-red-400" /> : <Info className="mt-0.5 h-5 w-5 text-brand-300" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white">{t.title}</div>
              {t.body && <div className="mt-0.5 text-xs text-silver-300">{t.body}</div>}
            </div>
            <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-silver-400 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
export function Stat({ label, value, sub, icon, trend, tone = 'violet' }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; trend?: { pct: number | null; label: string } | null; tone?: 'violet' | 'green' | 'amber' | 'blue' | 'red';
}) {
  const ring = { violet: 'from-brand-500/25', green: 'from-emerald-500/20', amber: 'from-amber-500/20', blue: 'from-sky-500/20', red: 'from-red-500/20' }[tone];
  return (
    <Card className="relative overflow-hidden p-4">
      <div className={cx('pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br to-transparent blur-2xl', ring)} />
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-silver-400">{label}</div>
        {icon && <div className="text-silver-400">{icon}</div>}
      </div>
      <div className="mt-2 font-display text-2xl font-bold tabular-nums text-white">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-silver-400">
        {trend && trend.pct !== null && (
          <span className={cx('font-semibold', trend.pct >= 0 ? 'text-emerald-400' : 'text-red-400')}>{trend.pct >= 0 ? '▲' : '▼'} {Math.abs(trend.pct).toFixed(0)}%</span>
        )}
        {trend && trend.pct !== null && <span>{trend.label}</span>}
        {sub}
      </div>
    </Card>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={cx('flex gap-1 overflow-x-auto rounded-2xl bg-ink-900 p-1 ring-1 ring-inset ring-white/5', className)} role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx('flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition',
            value === t.value ? 'bg-navy-700 text-white shadow' : 'text-silver-400 hover:text-white')}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className={cx('rounded-full px-1.5 text-[11px]', value === t.value ? 'bg-brand-500 text-white' : 'bg-white/10')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'lg' }) {
  return (
    <span className={cx('inline-flex', size === 'lg' ? 'text-2xl' : 'text-sm')} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= value ? 'text-amber-400' : 'text-silver-600'}>★</span>)}
    </span>
  );
}
