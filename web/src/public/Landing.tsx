import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChefHat, ConciergeBell, LayoutDashboard, QrCode, Smartphone } from 'lucide-react';
import { Card, DemoRibbon, Logo } from '../components/ui';
import { api } from '../lib/api';

type DemoInfo = { demo_mode: boolean; tables?: { number: number; path: string }[]; accounts?: { role: string; email: string; name: string }[] };

export default function Landing() {
  const [demo, setDemo] = useState<DemoInfo | null>(null);
  useEffect(() => { api<DemoInfo>('/demo').then(setDemo).catch(() => setDemo({ demo_mode: false })); }, []);
  const portals = [
    { to: '/admin', icon: LayoutDashboard, title: 'Admin Dashboard', body: 'Revenue, orders, menu, tables & QR codes, staff, inventory, reports.', device: 'Desktop / tablet' },
    { to: '/staff', icon: ConciergeBell, title: 'Waiter App', body: 'Ready-to-serve alerts, serving workflow, customer requests, cash payments.', device: 'Mobile' },
    { to: '/kitchen', icon: ChefHat, title: 'Kitchen Display', body: 'Live order queue — accept, prepare, mark ready. Large, high-contrast UI.', device: 'Tablet / desktop' },
  ];
  return (
    <div className="min-h-dvh">
      <DemoRibbon show={demo?.demo_mode} />
      <div className="mx-auto max-w-6xl px-5 py-10 sm:py-16">
        <Logo size="lg" subtitle="Digital Restaurant System" />
        <h1 className="mt-10 max-w-3xl font-display text-4xl font-bold leading-tight sm:text-5xl"><span className="text-gradient">One connected system</span> for every table, every order, every team.</h1>
        <p className="mt-4 max-w-2xl text-silver-300">Customers order by scanning the QR code on their table. The kitchen sees it instantly, waiters are alerted the moment it's ready, and management sees every number live.</p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {portals.map((p) => (
            <Link key={p.to} to={p.to} className="group">
              <Card className="h-full p-6 transition group-hover:shadow-glow group-hover:ring-brand-500/40">
                <p.icon className="h-8 w-8 text-brand-400" />
                <div className="mt-4 font-display text-lg font-semibold text-white">{p.title}</div>
                <div className="mt-1 text-sm text-silver-400">{p.body}</div>
                <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-silver-500">{p.device} · {p.to}</div>
              </Card>
            </Link>
          ))}
        </div>

        <Card className="mt-6 p-6">
          <div className="flex items-start gap-4">
            <QrCode className="h-8 w-8 shrink-0 text-brand-400" />
            <div className="flex-1">
              <div className="font-display text-lg font-semibold text-white">Customer ordering</div>
              <p className="mt-1 text-sm text-silver-400">Customers reach the menu only through their table's unique QR code — the table is identified automatically. Print QR codes from Admin → Tables.</p>
              {demo?.demo_mode && demo.tables && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300"><Smartphone className="h-4 w-4" /> Demo: open a table as a customer</div>
                  <div className="flex flex-wrap gap-2">
                    {demo.tables.map((t) => (
                      <Link key={t.number} to={t.path} className="rounded-xl bg-navy-700 px-3 py-2 text-sm font-semibold text-silver-100 ring-1 ring-white/10 hover:bg-navy-600">
                        Table {String(t.number).padStart(2, '0')}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>

        {demo?.demo_mode && demo.accounts && (
          <Card className="mt-6 p-6">
            <div className="font-display text-lg font-semibold text-white">Demo staff accounts</div>
            <p className="mt-1 text-sm text-silver-400">Passwords are generated randomly when the demo data is seeded and are stored in <code className="rounded bg-white/5 px-1.5 py-0.5 text-brand-300">.demo-credentials.json</code> on the server — they are never shown on a web page.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {demo.accounts.map((a) => (
                <div key={a.email} className="rounded-xl bg-ink-900 px-3 py-2 text-sm ring-1 ring-white/5">
                  <div className="font-semibold text-white">{a.name} <span className="ml-1 text-xs font-medium uppercase text-brand-300">{a.role}</span></div>
                  <div className="text-silver-400">{a.email}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
