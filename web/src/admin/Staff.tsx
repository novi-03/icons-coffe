import { useEffect, useState } from 'react';
import { KeyRound, Plus, Table2 } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { ago, dateTime, titleCase } from '../lib/format';
import { useData, useNow } from '../lib/hooks';
import { Badge, Button, Card, cx, ErrorBanner, Field, Input, Modal, PageLoader, Select, Toggle, useToast } from '../components/ui';
import { useAdmin, useLive } from './AdminApp';

type S = { id: string; email: string; full_name: string; role: 'admin' | 'waiter' | 'kitchen'; is_active: boolean; is_demo: boolean; last_login_at: string | null;
  is_on_duty: boolean; last_seen_at: string | null; current_activity: string | null; avatar_color: string; phone: string | null; tables: { id: string; number: number }[];
  actions_today: number; last_action: { event_type: string; to_status: string; created_at: string; order_number: string } | null };

export default function Staff() {
  const toast = useToast();
  const { user } = useAdmin();
  const now = useNow(30000);
  const { data, error, reload, softReload } = useData(() => api<{ staff: S[] }>('/admin/staff'), []);
  useLive(['staff.changed', 'table.changed'], softReload);
  const [edit, setEdit] = useState<S | 'new' | null>(null);
  const [tablesFor, setTablesFor] = useState<S | null>(null);
  if (!data) return error ? <ErrorBanner message={error} onRetry={reload} /> : <PageLoader />;
  const online = (s: S) => s.last_seen_at && now - new Date(s.last_seen_at).getTime() < 3 * 60000;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Add staff member</Button></div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-white/5 text-left text-xs uppercase tracking-wider text-silver-500">
            <tr><th className="px-4 py-3">Staff</th><th>Role</th><th>Status</th><th>Assigned tables</th><th>Current activity</th><th>Today</th><th className="pr-4" /></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.staff.map((s) => (
              <tr key={s.id} className={cx('text-silver-200', !s.is_active && 'opacity-50')}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: s.avatar_color }}>{s.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                    <div><div className="font-semibold text-white">{s.full_name}{s.is_demo && <Badge tone="amber" className="ml-2">DEMO</Badge>}</div><div className="text-xs text-silver-500">{s.email}</div></div>
                  </div>
                </td>
                <td><Badge tone={s.role === 'admin' ? 'violet' : s.role === 'waiter' ? 'blue' : 'amber'}>{titleCase(s.role)}</Badge></td>
                <td>
                  {!s.is_active ? <Badge tone="red">Deactivated</Badge> : (
                    <div className="space-y-0.5">
                      {s.role === 'waiter' && <Badge tone={s.is_on_duty ? 'green' : 'neutral'}>{s.is_on_duty ? 'On duty' : 'Off duty'}</Badge>}
                      <div className="text-xs text-silver-500">{online(s) ? <span className="text-emerald-300">● Connected now</span> : s.last_seen_at ? `Seen ${ago(s.last_seen_at, now)}` : s.last_login_at ? `Last login ${dateTime(s.last_login_at)}` : 'Never signed in'}</div>
                    </div>
                  )}
                </td>
                <td>{s.role === 'waiter' ? (
                  <button className="flex flex-wrap items-center gap-1 text-xs" onClick={() => setTablesFor(s)} disabled={!s.is_active}>
                    {s.tables.length ? s.tables.map((t) => <span key={t.id} className="rounded bg-navy-700 px-1.5 py-0.5 font-semibold">T{String(t.number).padStart(2, '0')}</span>) : <span className="text-silver-500">None</span>}
                    {s.is_active && <Table2 className="ml-1 h-3.5 w-3.5 text-brand-300" />}
                  </button>) : <span className="text-xs text-silver-600">—</span>}
                </td>
                <td className="text-xs text-silver-300">{s.current_activity ?? (s.last_action ? `${titleCase(s.last_action.to_status ?? s.last_action.event_type)} #${s.last_action.order_number}` : '—')}
                  {s.last_action && <div className="text-silver-500">{ago(s.last_action.created_at, now)}</div>}</td>
                <td className="tabular-nums">{s.actions_today} actions</td>
                <td className="pr-4 text-right"><Button size="xs" variant="secondary" onClick={() => setEdit(s)}>Manage</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <StaffEditor s={edit} selfId={user.id} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); toast({ tone: 'success', title: 'Staff saved' }); }} />
      <AssignTables s={tablesFor} onClose={() => setTablesFor(null)} onSaved={() => { setTablesFor(null); reload(); toast({ tone: 'success', title: 'Tables assigned' }); }} />
    </div>
  );
}

function StaffEditor({ s, selfId, onClose, onSaved }: { s: S | 'new' | null; selfId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ full_name: '', email: '', role: 'waiter', password: '', phone: '', is_active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (s) { setError(null); setF(s === 'new' ? { full_name: '', email: '', role: 'waiter', password: '', phone: '', is_active: true } : { full_name: s.full_name, email: s.email, role: s.role, password: '', phone: s.phone ?? '', is_active: s.is_active }); } }, [s]);
  if (!s) return null;
  const isNew = s === 'new';
  const self = !isNew && s.id === selfId;
  return (
    <Modal open onClose={onClose} size="sm" title={isNew ? 'Add staff member' : `Manage ${s.full_name}`}
      footer={<Button className="w-full" loading={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          if (isNew) await api('/admin/staff', { body: { full_name: f.full_name, email: f.email, role: f.role, password: f.password, phone: f.phone || null } });
          else await api(`/admin/staff/${s.id}`, { method: 'PATCH', body: { full_name: f.full_name, role: f.role, is_active: f.is_active, phone: f.phone || null, ...(f.password ? { password: f.password } : {}) } });
          onSaved();
        } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
      }}>{isNew ? 'Create account' : 'Save changes'}</Button>}>
      <div className="space-y-4 p-5">
        <Field label="Full name"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={f.email} disabled={!isNew} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role"><Select value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="waiter">Waiter</option><option value="kitchen">Kitchen staff</option><option value="admin">Administrator</option></Select></Field>
        <Field label="Phone (optional)"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label={isNew ? 'Password' : 'Reset password (optional)'} hint="At least 10 characters. Changing it signs the person out everywhere.">
          <div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-500" /><Input type="password" autoComplete="new-password" className="pl-9" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        </Field>
        {!isNew && !self && <label className="flex items-center gap-3 text-sm text-silver-200"><Toggle checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Account active" />Account active (deactivating signs them out immediately)</label>}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}

function AssignTables({ s, onClose, onSaved }: { s: S | null; onClose: () => void; onSaved: () => void }) {
  const tables = useData(() => api<{ tables: { id: string; number: number; assigned_waiter_id: string | null; assigned_waiter_name: string | null; is_active: boolean }[] }>('/admin/tables'), [s?.id]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (s) setSel(new Set(s.tables.map((t) => t.id))); }, [s]);
  if (!s) return null;
  return (
    <Modal open onClose={onClose} title={`Tables for ${s.full_name}`} size="md"
      footer={<Button className="w-full" loading={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await api(`/admin/staff/${s.id}/tables`, { method: 'PUT', body: { table_ids: [...sel] } }); onSaved(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
      }}>Save {sel.size} table{sel.size === 1 ? '' : 's'}</Button>}>
      <div className="p-5">
        <p className="mb-3 text-sm text-silver-400">Ready-to-serve alerts and customer requests for these tables go to {s.full_name}. Selecting a table assigned to someone else moves it.</p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {(tables.data?.tables ?? []).filter((t) => t.is_active).map((t) => {
            const on = sel.has(t.id);
            const other = t.assigned_waiter_id && t.assigned_waiter_id !== s.id;
            return (
              <button key={t.id} onClick={() => setSel((x) => { const n = new Set(x); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}
                className={cx('rounded-xl px-2 py-2 text-center ring-1', on ? 'bg-brand-500/20 text-white ring-brand-500/50' : 'bg-ink-900 text-silver-300 ring-white/10')}>
                <div className="font-display font-bold">T{String(t.number).padStart(2, '0')}</div>
                {other && <div className="truncate text-[10px] text-silver-500">{t.assigned_waiter_name?.split(' ')[0]}</div>}
              </button>
            );
          })}
        </div>
        <div className="mt-3"><ErrorBanner message={error} /></div>
      </div>
    </Modal>
  );
}
