import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ClipboardList, ConciergeBell, QrCode, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import { api, ApiError, errMsg } from '../lib/api';
import { setTimezone } from '../lib/format';
import { useData, useLocalStorage } from '../lib/hooks';
import { useRealtime, type RtEvent, type RtStatus } from '../lib/realtime';
import type { Category, MenuItem, Order, Restaurant } from '../lib/types';
import { Button, Card, cx, DemoRibbon, ErrorBanner, LiveIndicator, Logo, PageLoader, useToast } from '../components/ui';
import type { CartLine } from './cart';
import MenuPage from './MenuPage';
import CartPage from './CartPage';
import OrderPage from './OrderPage';
import OrdersPage from './OrdersPage';
import ServicePage from './ServicePage';

export interface GuestContext {
  restaurant: Restaurant;
  table: { id: string; number: number; label: string; zone: string | null };
  demo_mode: boolean;
  online_payment_available: boolean;
}

interface Ctx {
  ctx: GuestContext;
  menu: { categories: Category[]; items: MenuItem[] } | null;
  menuError: string | null;
  reloadMenu: () => void;
  cart: CartLine[];
  setCart: (f: (c: CartLine[]) => CartLine[]) => void;
  orders: Order[];
  reloadOrders: () => void;
  subscribe: (fn: (e: RtEvent) => void) => () => void;
  rt: RtStatus;
}
const CustomerCtx = createContext<Ctx | null>(null);
export const useCustomer = () => useContext(CustomerCtx)!;

export default function CustomerApp() {
  const { token } = useParams();
  if (token) return <QrEntry token={token} />;
  return <CustomerShell />;
}

function QrEntry({ token }: { token: string }) {
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api('/guest/session', { body: { qr_token: token } })
      .then(() => nav('/menu', { replace: true }))
      .catch((e) => setError(errMsg(e)));
  }, [token, nav]);
  if (error) return <NoTable message={error} />;
  return <PageLoader label="Finding your table…" />;
}

function NoTable({ message }: { message?: string }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo size="lg" />
      <Card className="w-full p-6">
        <QrCode className="mx-auto h-12 w-12 text-brand-400" />
        <div className="mt-4 font-display text-xl font-semibold text-white">Scan the QR code on your table</div>
        <p className="mt-2 text-sm text-silver-400">Each table has its own code so we know exactly where to bring your order.</p>
        {message && <div className="mt-4 text-left"><ErrorBanner message={message} /></div>}
      </Card>
    </div>
  );
}

function CustomerShell() {
  const loc = useLocation();
  const toast = useToast();
  const [ctx, setCtx] = useState<GuestContext | null>(null);
  const [ctxError, setCtxError] = useState<{ noSession: boolean; message: string } | null>(null);
  const [listeners] = useState(() => new Set<(e: RtEvent) => void>());

  const loadCtx = useCallback(async () => {
    try {
      const c = await api<GuestContext>('/guest/context');
      setTimezone(c.restaurant.timezone);
      setCtx(c);
      setCtxError(null);
    } catch (e) {
      setCtxError({ noSession: e instanceof ApiError && e.status === 401, message: errMsg(e) });
    }
  }, []);
  useEffect(() => { loadCtx(); }, [loadCtx]);

  const menu = useData(() => api<{ categories: Category[]; items: MenuItem[] }>('/guest/menu'), [ctx?.table.id]);
  const orders = useData(() => (ctx ? api<{ orders: Order[] }>('/guest/orders').then((r) => r.orders) : Promise.resolve([])), [ctx?.table.id]);
  const [cart, setCartRaw] = useLocalStorage<CartLine[]>(`icons.cart.${ctx?.table.id ?? 'none'}`, []);

  const rt = useRealtime('guest', (e) => {
    if (e.t === 'menu.changed') { menu.softReload(); loadCtx(); }
    if (e.t === 'order.changed' || e.t === 'payment.changed' || e.t === 'resync') orders.softReload();
    if (e.t === 'resync') { menu.softReload(); loadCtx(); }
    if (e.t === 'order.changed' && e.s === 'READY' && e.prev !== 'READY') toast({ tone: 'success', title: 'Your order is ready', body: 'A waiter is bringing it to your table.' });
    listeners.forEach((l) => l(e));
  }, !!ctx);

  const value = useMemo<Ctx | null>(() => ctx && ({
    ctx,
    menu: menu.data,
    menuError: menu.error,
    reloadMenu: menu.reload,
    cart,
    setCart: (f) => setCartRaw((c) => f(c)),
    orders: orders.data ?? [],
    reloadOrders: orders.reload,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    rt,
  }), [ctx, menu.data, menu.error, cart, orders.data, rt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ctxError?.noSession) return <NoTable message={ctxError.message} />;
  if (ctxError) return <div className="mx-auto max-w-md p-6"><ErrorBanner message={ctxError.message} onRetry={loadCtx} /></div>;
  if (!value) return <PageLoader label="Loading menu…" />;

  const path = loc.pathname;
  const page = path.startsWith('/cart') ? <CartPage /> : path.startsWith('/order/') ? <OrderPage /> : path.startsWith('/orders') ? <OrdersPage />
    : path.startsWith('/service') ? <ServicePage /> : path.startsWith('/menu') ? <MenuPage /> : <Navigate to="/menu" replace />;
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const activeOrders = (orders.data ?? []).filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status)).length;

  return (
    <CustomerCtx.Provider value={value}>
      <div className="mx-auto min-h-dvh max-w-2xl pb-28">
        <DemoRibbon show={ctx!.demo_mode} />
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/5 bg-ink-950/85 px-4 py-3 backdrop-blur-xl">
          <Link to="/menu"><Logo size="sm" /></Link>
          <div className="flex items-center gap-2">
            <LiveIndicator status={rt} compact />
            <span className="rounded-xl bg-brand-500/15 px-3 py-1.5 font-display text-sm font-bold tracking-wide text-brand-200 ring-1 ring-brand-500/30">
              TABLE {String(ctx!.table.number).padStart(2, '0')}
            </span>
          </div>
        </header>
        <main className="px-4 pt-4">{page}</main>
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-ink-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
          <div className="mx-auto grid max-w-2xl grid-cols-4">
            <NavItem to="/menu" active={path.startsWith('/menu')} icon={<UtensilsCrossed className="h-5 w-5" />} label="Menu" />
            <NavItem to="/orders" active={path.startsWith('/order')} icon={<ClipboardList className="h-5 w-5" />} label="My orders" badge={activeOrders} />
            <NavItem to="/service" active={path.startsWith('/service')} icon={<ConciergeBell className="h-5 w-5" />} label="Service" />
            <NavItem to="/cart" active={path.startsWith('/cart')} icon={<ShoppingBag className="h-5 w-5" />} label="Cart" badge={cartCount} highlight />
          </div>
        </nav>
      </div>
    </CustomerCtx.Provider>
  );
}

function NavItem({ to, active, icon, label, badge, highlight }: { to: string; active: boolean; icon: React.ReactNode; label: string; badge?: number; highlight?: boolean }) {
  return (
    <Link to={to} className={cx('relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition', active ? 'text-white' : 'text-silver-400')}>
      <span className={cx('relative rounded-xl px-4 py-1', active && 'bg-brand-500/20 text-brand-200')}>
        {icon}
        {!!badge && <span className={cx('absolute -right-1 -top-1 min-w-[18px] rounded-full px-1 text-center text-[10px] leading-[18px] text-white', highlight ? 'bg-brand-500' : 'bg-emerald-600')}>{badge}</span>}
      </span>
      {label}
    </Link>
  );
}
