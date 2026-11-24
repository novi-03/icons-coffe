import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BarChart3, Bell, Boxes, ClipboardList, FileBarChart, LayoutDashboard, LogOut, Menu as MenuIcon, Settings, Star, Table2, Users, UtensilsCrossed, X } from 'lucide-react';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import { useData, useNow } from '../lib/hooks';
import { useRealtime, type RtEvent, type RtStatus } from '../lib/realtime';
import type { Notification } from '../lib/types';
import { StaffGate, type StaffUser } from '../components/StaffLogin';
import { cx, DemoRibbon, LiveIndicator, Logo, useToast } from '../components/ui';
import Overview from './Overview';
import Analytics from './Analytics';
import Orders from './Orders';
import MenuAdmin from './MenuAdmin';
import Tables from './Tables';
import Staff from './Staff';
import Inventory from './Inventory';
import Reviews from './Reviews';
import Reports from './Reports';
import Notifications from './Notifications';
import SettingsPage from './Settings';

interface AdminCtx { user: StaffUser; subscribe: (fn: (e: RtEvent) => void) => () => void; rt: RtStatus }
const Ctx = createContext<AdminCtx | null>(null);
export const useAdmin = () => useContext(Ctx)!;

/** Refetch helper: run `reload` whenever one of the given realtime topics fires (or on resync). */
export function useLive(topics: string[], reload: () => void) {
  const { subscribe } = useAdmin();
  useEffect(() => subscribe((e) => { if (e.t === 'resync' || topics.includes(e.t)) reload(); }), [subscribe, reload]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default function AdminApp() {
  return <StaffGate portal="admin">{(user, demo, logout) => <AdminShell user={user} demo={demo} logout={logout} />}</StaffGate>;
}

const NAV = [
  { to: 'overview', label: 'Overview', icon: LayoutDashboard },
  { to: 'analytics', label: 'Sales analytics', icon: BarChart3 },
  { to: 'orders', label: 'Orders', icon: ClipboardList },
  { to: 'menu', label: 'Menu', icon: UtensilsCrossed },
  { to: 'tables', label: 'Tables & QR', icon: Table2 },
  { to: 'staff', label: 'Staff', icon: Users },
  { to: 'inventory', label: 'Inventory', icon: Boxes },
  { to: 'reviews', label: 'Reviews', icon: Star },
  { to: 'reports', label: 'Reports', icon: FileBarChart },
  { to: 'notifications', label: 'Notifications', icon: Bell },
  { to: 'settings', label: 'Settings', icon: Settings },
];

function AdminShell({ user, demo, logout }: { user: StaffUser; demo: boolean; logout: () => Promise<void> }) {
  const toast = useToast();
  const loc = useLocation();
  const now = useNow(30000);
  const [listeners] = useState(() => new Set<(e: RtEvent) => void>());
  const [navOpen, setNavOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const notes = useData(() => api<{ notifications: Notification[]; unread: number }>('/notifications', { query: { limit: 15 } }), []);

  const rt = useRealtime('staff', (e) => {
    if (e.t === 'notification' || e.t === 'resync') notes.softReload();
    if (e.t === 'notification' && ['NEW_ORDER', 'KITCHEN_DELAY', 'LOW_STOCK', 'SERVICE_ISSUE', 'ORDER_CANCELLED', 'NEW_REVIEW', 'PAYMENT_UPDATE'].includes(e.nt ?? '')) {
      const label: Record<string, string> = { NEW_ORDER: 'New order', KITCHEN_DELAY: 'Kitchen delay', LOW_STOCK: 'Low stock alert', SERVICE_ISSUE: 'Service issue reported',
        ORDER_CANCELLED: 'Order cancelled', NEW_REVIEW: 'New customer review', PAYMENT_UPDATE: 'Payment update' };
      toast({ tone: e.nt === 'KITCHEN_DELAY' || e.nt === 'SERVICE_ISSUE' || e.nt === 'LOW_STOCK' ? 'error' : 'info', title: label[e.nt!] });
    }
    listeners.forEach((l) => l(e));
  });
  useEffect(() => { setNavOpen(false); setBellOpen(false); }, [loc.pathname]);
  useEffect(() => { document.title = 'Admin · ICONS Coffee'; }, []);

  const value: AdminCtx = { user, rt, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="px-2 pb-5 pt-2"><Logo size="sm" subtitle="Admin" /></div>
      {NAV.map((n) => (
        <NavLink key={n.to} to={`/admin/${n.to}`} className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
          isActive ? 'bg-brand-500/15 text-white ring-1 ring-inset ring-brand-500/30' : 'text-silver-400 hover:bg-white/5 hover:text-white')}>
          <n.icon className="h-[18px] w-[18px]" />{n.label}
          {n.to === 'notifications' && !!notes.data?.unread && <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[11px] text-white">{notes.data.unread}</span>}
        </NavLink>
      ))}
      <div className="mt-auto rounded-xl bg-ink-900 p-3 text-xs ring-1 ring-white/5">
        <div className="font-semibold text-white">{user.name}</div>
        <div className="truncate text-silver-500">{user.email}</div>
        <button onClick={logout} className="mt-2 flex items-center gap-1.5 font-semibold text-silver-300 hover:text-white"><LogOut className="h-3.5 w-3.5" />Sign out</button>
      </div>
    </nav>
  );

  return (
    <Ctx.Provider value={value}>
      <DemoRibbon show={demo} />
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-white/5 bg-ink-950/60 lg:block">{sidebar}</aside>
        {navOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/70" onClick={() => setNavOpen(false)} />
            <aside className="relative h-full w-64 bg-ink-900 shadow-2xl animate-slide-up">{sidebar}</aside>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/5 bg-ink-950/85 px-4 py-3 backdrop-blur-xl lg:px-8">
            <div className="flex items-center gap-2">
              <button className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/5 lg:hidden" aria-label="Open navigation" onClick={() => setNavOpen(true)}><MenuIcon className="h-5 w-5" /></button>
              <div className="font-display text-lg font-semibold text-white">{NAV.find((n) => loc.pathname.startsWith(`/admin/${n.to}`))?.label ?? 'Admin'}</div>
            </div>
            <div className="flex items-center gap-2">
              <LiveIndicator status={rt} />
              <div className="relative">
                <button className="relative flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/5" aria-label="Notifications" onClick={() => setBellOpen((v) => !v)}>
                  <Bell className="h-5 w-5" />
                  {!!notes.data?.unread && <span className="absolute right-1 top-1 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] leading-[18px] text-white">{notes.data.unread}</span>}
                </button>
                {bellOpen && (
                  <div className="absolute right-0 top-12 z-40 w-[min(92vw,380px)] overflow-hidden rounded-2xl bg-navy-900 shadow-2xl ring-1 ring-white/10 animate-pop">
                    <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
                      <span className="font-semibold text-white">Notifications</span>
                      <button aria-label="Close" onClick={() => setBellOpen(false)}><X className="h-4 w-4 text-silver-400" /></button>
                    </div>
                    <ul className="max-h-96 divide-y divide-white/5 overflow-y-auto">
                      {(notes.data?.notifications ?? []).map((n) => (
                        <li key={n.id} className={cx('px-4 py-2.5', !n.read_at && 'bg-brand-500/5')}>
                          <div className="text-sm font-semibold text-white">{n.title}</div>
                          {n.body && <div className="text-xs text-silver-300">{n.body}</div>}
                          <div className="text-[11px] text-silver-500">{ago(n.created_at, now)}</div>
                        </li>
                      ))}
                      {!notes.data?.notifications.length && <li className="px-4 py-6 text-center text-sm text-silver-500">No notifications yet</li>}
                    </ul>
                    <div className="flex border-t border-white/5">
                      <button className="flex-1 py-2.5 text-xs font-semibold text-silver-300 hover:bg-white/5" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); notes.reload(); }}>Mark all read</button>
                      <NavLink to="/admin/notifications" className="flex-1 py-2.5 text-center text-xs font-semibold text-brand-300 hover:bg-white/5">View all</NavLink>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-[1400px] p-4 lg:p-8">
            <Routes>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<Overview />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="orders" element={<Orders />} />
              <Route path="menu" element={<MenuAdmin />} />
              <Route path="tables" element={<Tables />} />
              <Route path="staff" element={<Staff />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="reviews" element={<Reviews />} />
              <Route path="reports" element={<Reports />} />
              <Route path="notifications" element={<Notifications onChange={notes.reload} />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="overview" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
