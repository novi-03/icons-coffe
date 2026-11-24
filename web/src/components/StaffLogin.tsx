import { useEffect, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button, Card, DemoRibbon, ErrorBanner, Field, Input, Logo, PageLoader } from './ui';
import { api, ApiError, errMsg } from '../lib/api';
import { setTimezone } from '../lib/format';

export type StaffUser = { id: string; name: string; email: string; role: 'admin' | 'waiter' | 'kitchen'; restaurant_name: string; timezone: string; is_on_duty: boolean; avatar_color: string };
type Portal = 'admin' | 'staff' | 'kitchen';
const ALLOWED: Record<Portal, string[]> = { admin: ['admin'], staff: ['waiter', 'admin'], kitchen: ['kitchen', 'admin'] };
const TITLES: Record<Portal, string> = { admin: 'Admin Dashboard', staff: 'Waiter App', kitchen: 'Kitchen Display' };

/** Gate for staff portals: shows the login form until a session with an allowed role exists. */
export function StaffGate({ portal, children }: { portal: Portal; children: (user: StaffUser, demo: boolean, logout: () => Promise<void>) => ReactNode }) {
  const [state, setState] = useState<{ user: StaffUser | null; demo: boolean; loading: boolean; wrongRole?: string }>({ user: null, demo: false, loading: true });

  const load = async () => {
    try {
      const r = await api<{ user: StaffUser; demo_mode: boolean }>('/auth/me');
      setTimezone(r.user.timezone);
      if (!ALLOWED[portal].includes(r.user.role)) setState({ user: null, demo: r.demo_mode, loading: false, wrongRole: r.user.role });
      else setState({ user: r.user, demo: r.demo_mode, loading: false });
    } catch (e) {
      const demo = await api('/demo').then((d) => d.demo_mode).catch(() => false);
      setState({ user: null, demo, loading: false });
      if (!(e instanceof ApiError && e.status === 401)) console.warn(e);
    }
  };
  useEffect(() => { load(); }, []);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setState((s) => ({ ...s, user: null, wrongRole: undefined })); };

  if (state.loading) return <PageLoader />;
  if (state.user) return <>{children(state.user, state.demo, logout)}</>;
  return <LoginForm portal={portal} demo={state.demo} wrongRole={state.wrongRole} onLogout={logout} onSuccess={load} />;
}

function LoginForm({ portal, demo, wrongRole, onSuccess, onLogout }: { portal: Portal; demo: boolean; wrongRole?: string; onSuccess: () => void; onLogout: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="min-h-dvh">
      <DemoRibbon show={demo} />
      <div className="mx-auto flex min-h-[90dvh] max-w-md flex-col justify-center px-5 py-10">
        <Logo size="lg" subtitle={TITLES[portal]} />
        <Card className="mt-8 p-6">
          <div className="mb-5 flex items-center gap-2 font-display text-xl font-semibold text-white"><Lock className="h-5 w-5 text-brand-400" /> Staff sign in</div>
          {wrongRole && (
            <div className="mb-4 space-y-3">
              <ErrorBanner message={`You are signed in as a ${wrongRole} account, which cannot access the ${TITLES[portal]}.`} />
              <Button variant="secondary" size="sm" onClick={onLogout}>Sign out and switch account</Button>
            </div>
          )}
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true); setError(null);
            try {
              await api('/auth/login', { body: { email, password, portal } });
              onSuccess();
            } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
          }}>
            <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@iconscoffee.ae" /></Field>
            <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <ErrorBanner message={error} />
            <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
          </form>
          {demo && <p className="mt-4 text-xs text-silver-500">Demo mode: account emails are listed on the home page; passwords are in <code className="text-brand-300">.demo-credentials.json</code> on the server.</p>}
        </Card>
      </div>
    </div>
  );
}
