import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Banknote, Bell, BellRing, CheckCheck, CircleCheckBig, HandPlatter, Hand, LogOut, PackageCheck, Receipt, Store, Wifi } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { ago, money, time } from '../lib/format';
import { useData, useNow } from '../lib/hooks';
import { useRealtime } from '../lib/realtime';
import { audioReady, playChime, unlockAudio, vibrate } from '../lib/sound';
import type { Notification, Order } from '../lib/types';
import { StaffGate, type StaffUser } from '../components/StaffLogin';
import { Badge, Button, Card, cx, DemoRibbon, EmptyState, ErrorBanner, Field, LiveIndicator, Logo, Modal, OrderStatusBadge, PageLoader, Select, Tabs, Textarea, Toggle, useToast } from '../components/ui';

type Req = { id: string; type: string; note: string | null; status: string; created_at: string; table_number: number; table_id: string; can_serve: boolean; acknowledged_by_name: string | null; assigned_waiter_id: string | null };
type Pay = { id: string; method: 'CASH' | 'COUNTER'; amount_fils: number; transaction_ref: string; order_id: string; order_number: string; order_status: string; table_number: number; can_serve: boolean; created_at: string };
type Board = { orders: Order[]; requests: Req[]; payments: Pay[]; me: string };
type Me = { profile: { id: string; name: string; role: string; is_on_duty: boolean; avatar_color: string }; tables: { id: string; number: number }[] };
type Tab = 'ready' | 'mine' | 'requests' | 'bills' | 'floor';

const REQ_LABEL: Record<string, { label: string; icon: React.ElementType }> = {
  CALL_WAITER: { label: 'Waiter called', icon: Hand }, REQUEST_BILL: { label: 'Bill requested', icon: Receipt },
  REQUEST_WIFI: { label: 'Wi-Fi help', icon: Wifi }, ASSISTANCE: { label: 'Assistance', icon: HandPlatter },
};

export default function StaffApp() {
  return <StaffGate portal="staff">{(user, demo, logout) => <Waiter user={user} demo={demo} logout={logout} />}</StaffGate>;
}

function Waiter({ user, demo, logout }: { user: StaffUser; demo: boolean; logout: () => Promise<void> }) {
  const toast = useToast();
  const now = useNow(15000);
  const board = useData(() => api<Board>('/staff/board'), []);
  const me = useData(() => api<Me>('/staff/me'), []);
  const notes = useData(() => api<{ notifications: Notification[]; unread: number }>('/notifications', { query: { limit: 60 } }), []);
  const [tab, setTab] = useState<Tab>('ready');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [issueFor, setIssueFor] = useState<Order | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(audioReady());

  const rt = useRealtime('staff', (e) => {
    if (['order.changed', 'payment.changed', 'request.changed', 'table.changed', 'resync'].includes(e.t)) board.softReload();
    if (e.t === 'table.changed' || e.t === 'resync') me.softReload();
    if (e.t === 'notification' || e.t === 'resync') notes.softReload();
    if (e.t === 'notification' && e.nt === 'ORDER_READY') { playChime('ready'); vibrate([300, 120, 300, 120, 600]); }
    if (e.t === 'notification' && e.nt === 'WAITER_REQUEST') { playChime('request'); vibrate([200, 100, 200]); toast({ tone: 'info', title: 'New customer request' }); }
  });

  // The READY TO SERVE alert: unacknowledged ready notifications for me whose order is still waiting.
  const readyAlerts = useMemo(() => {
    const readyIds = new Set((board.data?.orders ?? []).filter((o) => o.status === 'READY' && !o.collected_at).map((o) => o.id));
    return (notes.data?.notifications ?? []).filter((n) => n.type === 'ORDER_READY' && !n.acknowledged_at && n.order_id && readyIds.has(n.order_id) && !hidden.has(n.id));
  }, [notes.data, board.data, hidden]);
  const alert = readyAlerts[0];
  const alertOrder = alert && board.data?.orders.find((o) => o.id === alert.order_id);

  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast({ tone: 'success', title: success });
    } catch (e) {
      toast({ tone: 'error', title: 'Action failed', body: errMsg(e) });
    } finally {
      setBusy(null);
      board.reload();
      notes.reload();
    }
  };

  useEffect(() => { document.title = 'Waiter · ICONS Coffee'; }, []);
  const myTables = new Set((me.data?.tables ?? []).map((t) => t.id));
  const meId = board.data?.me ?? user.id;
  const orders = board.data?.orders ?? [];
  const isMine = (o: Order) => o.serving_waiter_id === meId || (!o.serving_waiter_id && myTables.has(o.table_id)) || (!o.serving_waiter_id && !o.assigned_waiter_id);
  const ready = orders.filter((o) => o.status === 'READY' && (isMine(o) || o.can_serve));
  const mine = orders.filter((o) => isMine(o) && o.status !== 'READY');
  const requests = (board.data?.requests ?? []);
  const bills = (board.data?.payments ?? []);
  const onDuty = me.data?.profile.is_on_duty ?? user.is_on_duty;

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-10">
      <DemoRibbon show={demo} />
      <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/90 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display font-bold text-white" style={{ background: me.data?.profile.avatar_color ?? '#8b5cf6' }}>
              {user.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
            </div>
            <div className="min-w-0">
              <div className="truncate font-semibold text-white">{user.name}</div>
              <div className="flex items-center gap-2 text-xs text-silver-400">
                <Toggle checked={onDuty} label="On duty" onChange={(v) => run('duty', () => api('/staff/me/duty', { body: { on_duty: v } }).then(() => me.reload()), v ? 'You are on duty' : 'You are offline')} />
                <span className={onDuty ? 'text-emerald-300' : 'text-silver-500'}>{onDuty ? 'Online' : 'Offline'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <LiveIndicator status={rt} compact />
            <button className="relative flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/5" aria-label="Notifications" onClick={() => setBellOpen(true)}>
              <Bell className="h-5 w-5" />
              {!!notes.data?.unread && <span className="absolute right-1 top-1 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] leading-[18px] text-white">{notes.data.unread}</span>}
            </button>
            <button className="flex h-10 w-10 items-center justify-center rounded-xl text-silver-400 hover:bg-white/5" aria-label="Sign out" onClick={logout}><LogOut className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="no-scrollbar mt-3 flex items-center gap-1.5 overflow-x-auto text-xs">
          <span className="shrink-0 font-semibold uppercase tracking-wider text-silver-500">My tables</span>
          {(me.data?.tables ?? []).map((t) => <span key={t.id} className="shrink-0 rounded-lg bg-navy-700 px-2 py-1 font-bold text-silver-100">T{String(t.number).padStart(2, '0')}</span>)}
          {me.data && !me.data.tables.length && <span className="text-silver-500">None assigned — you see unassigned tables</span>}
        </div>
      </header>

      {!soundOn && (
        <button onClick={() => { unlockAudio(); setSoundOn(true); playChime('request', 0.4); }} className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-2.5 text-left text-sm font-semibold text-amber-200 ring-1 ring-amber-500/25">
          <BellRing className="h-4 w-4" />Tap to enable sound alerts for ready orders
        </button>
      )}

      <div className="px-4 pt-3">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'ready', label: 'Ready', count: ready.length },
          { value: 'mine', label: 'Orders', count: mine.length },
          { value: 'requests', label: 'Requests', count: requests.length },
          { value: 'bills', label: 'Bills', count: bills.length },
          { value: 'floor', label: 'Floor' },
        ]} />
      </div>

      <main className="space-y-3 px-4 pt-4">
        <ErrorBanner message={board.error} onRetry={board.reload} />
        {!board.data ? <PageLoader /> : (
          <>
            {tab === 'ready' && (ready.length ? ready.map((o) => <OrderCard key={o.id} o={o} meId={meId} busy={busy} run={run} onIssue={setIssueFor} highlight />)
              : <EmptyState icon={<PackageCheck className="h-7 w-7" />} title="Nothing waiting at the pass" body="You'll get a full-screen alert the moment the kitchen marks one of your orders ready." />)}
            {tab === 'mine' && (mine.length ? mine.map((o) => <OrderCard key={o.id} o={o} meId={meId} busy={busy} run={run} onIssue={setIssueFor} />)
              : <EmptyState icon={<HandPlatter className="h-7 w-7" />} title="No active orders for your tables" />)}
            {tab === 'requests' && (requests.length ? requests.map((r) => {
              const L = REQ_LABEL[r.type] ?? REQ_LABEL.ASSISTANCE;
              const mineReq = r.assigned_waiter_id === meId || (!r.assigned_waiter_id);
              return (
                <Card key={r.id} className={cx('p-4', r.status === 'OPEN' && mineReq && 'ring-amber-400/50')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-amber-500/15 p-2.5 text-amber-300"><L.icon className="h-5 w-5" /></div>
                      <div>
                        <div className="font-display text-lg font-bold text-white">TABLE {String(r.table_number).padStart(2, '0')}</div>
                        <div className="text-sm text-silver-300">{L.label}{r.note ? ` · “${r.note}”` : ''}</div>
                        <div className="text-xs text-silver-500">{ago(r.created_at, now)}{r.acknowledged_by_name ? ` · acknowledged by ${r.acknowledged_by_name}` : ''}</div>
                      </div>
                    </div>
                    <Badge tone={r.status === 'OPEN' ? 'amber' : 'green'}>{r.status === 'OPEN' ? 'New' : 'On it'}</Badge>
                  </div>
                  {r.can_serve ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button variant="secondary" disabled={r.status !== 'OPEN'} loading={busy === `ack-${r.id}`} onClick={() => run(`ack-${r.id}`, () => api(`/staff/requests/${r.id}/ack`, { method: 'POST' }))}>Acknowledge</Button>
                      <Button variant="success" loading={busy === `done-${r.id}`} onClick={() => run(`done-${r.id}`, () => api(`/staff/requests/${r.id}/complete`, { method: 'POST' }), 'Request completed')}>Done</Button>
                    </div>
                  ) : <div className="mt-3 text-xs text-silver-500">Assigned to another waiter</div>}
                </Card>
              );
            }) : <EmptyState icon={<Hand className="h-7 w-7" />} title="No customer requests" />)}
            {tab === 'bills' && (bills.length ? bills.map((p) => (
              <Card key={p.id} data-testid={`bill-${p.order_number}`} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-display text-lg font-bold text-white">TABLE {String(p.table_number).padStart(2, '0')} · #{p.order_number}</div>
                  <div className="flex items-center gap-1.5 text-sm text-silver-300">{p.method === 'CASH' ? <Banknote className="h-4 w-4" /> : <Store className="h-4 w-4" />}{p.method === 'CASH' ? 'Cash at table' : 'Pay at counter'} · {p.transaction_ref}</div>
                  <div className="text-xs text-silver-500">Order {p.order_status.toLowerCase()}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-lg font-bold text-white">{money(p.amount_fils)}</div>
                  <Button size="sm" variant="success" className="mt-1" loading={busy === `pay-${p.id}`}
                    onClick={() => run(`pay-${p.id}`, () => api(`/staff/payments/${p.id}/confirm`, { method: 'POST' }), `Payment of ${money(p.amount_fils)} confirmed`)}>
                    Confirm received
                  </Button>
                </div>
              </Card>
            )) : <EmptyState icon={<Receipt className="h-7 w-7" />} title="No unpaid cash or counter bills" />)}
            {tab === 'floor' && (orders.length ? orders.map((o) => <OrderCard key={o.id} o={o} meId={meId} busy={busy} run={run} onIssue={setIssueFor} compact />)
              : <EmptyState title="The floor is quiet" />)}
          </>
        )}
      </main>

      {/* CRITICAL: full-screen READY TO SERVE alert */}
      {alert && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-emerald-950/95 backdrop-blur-md" role="alertdialog" aria-labelledby="ready-title">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="rounded-full bg-emerald-500/20 p-5 ring-4 ring-emerald-400/40 animate-pulse"><CircleCheckBig className="h-14 w-14 text-emerald-300" /></div>
            <div className="text-sm font-bold uppercase tracking-[0.3em] text-emerald-300">Ready to serve</div>
            <div id="ready-title" className="font-display text-6xl font-extrabold tracking-wide text-white">{alert.title}</div>
            <div className="font-display text-2xl font-bold text-emerald-100">ORDER #{alert.data?.orderNumber}</div>
            <div className="text-lg font-semibold text-white">{alert.data?.itemCount} {alert.data?.itemCount === 1 ? 'ITEM' : 'ITEMS'} READY TO SERVE</div>
            {alertOrder && <div className="max-w-sm text-sm text-emerald-100/80">{alertOrder.items.map((i) => `${i.quantity}× ${i.item_name}`).join(' · ')}</div>}
            {readyAlerts.length > 1 && <Badge tone="amber">+{readyAlerts.length - 1} more ready</Badge>}
          </div>
          <div className="space-y-2 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <Button size="xl" variant="success" className="h-20 w-full text-2xl" loading={busy === `collect-${alert.order_id}`}
              onClick={() => run(`collect-${alert.order_id}`, () => api(`/staff/orders/${alert.order_id}/collect`, { method: 'POST' }), 'Order collected — mark it served at the table')}>
              COLLECT ORDER
            </Button>
            <Button variant="ghost" className="w-full text-emerald-200" onClick={() => {
              setHidden((h) => new Set(h).add(alert.id));
              api(`/notifications/${alert.id}/read`, { method: 'POST' }).catch(() => {});
              setTab('ready');
            }}>Later — keep it in Ready</Button>
          </div>
        </div>
      )}

      <IssueModal order={issueFor} onClose={() => setIssueFor(null)} onSaved={() => { setIssueFor(null); board.reload(); toast({ tone: 'success', title: 'Issue reported to the manager' }); }} />
      <NotificationsDrawer open={bellOpen} onClose={() => setBellOpen(false)} data={notes.data} reload={notes.reload} now={now} />
    </div>
  );
}

function OrderCard({ o, meId, busy, run, onIssue, highlight, compact }: {
  o: Order; meId: string; busy: string | null; run: (k: string, fn: () => Promise<unknown>, s?: string) => void; onIssue: (o: Order) => void; highlight?: boolean; compact?: boolean;
}) {
  const takenByOther = !!o.serving_waiter_id && o.serving_waiter_id !== meId;
  const blocked = takenByOther || (!o.serving_waiter_id && !o.can_serve);
  const owner = o.serving_waiter_name ?? o.assigned_waiter_name;
  const items = o.items.reduce((s, i) => s + i.quantity, 0);
  return (
    <Card data-testid={`waiter-order-${o.order_number}`} className={cx('overflow-hidden', highlight && o.status === 'READY' && 'ring-2 ring-emerald-500/60')}>
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div>
          <div className="font-display text-xl font-extrabold text-white">TABLE {String(o.table_number).padStart(2, '0')}</div>
          <div className="text-sm text-silver-400">#{o.order_number} · {items} item{items === 1 ? '' : 's'} · {time(o.submitted_at ?? o.created_at)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <OrderStatusBadge status={o.status} />
          {o.collected_at && o.status === 'READY' && <Badge tone="blue">Collected</Badge>}
          {o.payment_status && o.payment_status !== 'PAID' && <Badge tone="amber">{o.payment_method === 'ONLINE' ? 'Online' : o.payment_method === 'CASH' ? 'Cash' : 'Counter'} · unpaid</Badge>}
        </div>
      </div>
      {!compact && (
        <ul className="space-y-1 px-4 pt-3 text-sm">
          {o.items.map((it) => (
            <li key={it.id} className="text-silver-100">
              <span className="font-semibold">{it.quantity}×</span> {it.item_name}
              {it.options.length > 0 && <span className="text-silver-400"> · {it.options.map((x) => x.name).join(', ')}</span>}
              {it.special_instructions && <div className="text-xs font-semibold text-amber-200">⚠ {it.special_instructions}</div>}
            </li>
          ))}
          {o.notes && <li className="text-xs text-amber-200/90">Note: {o.notes}</li>}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 p-4">
        {blocked ? (
          <span className="text-xs text-silver-500">{owner ? `Handled by ${owner}` : 'Assigned to another waiter'}</span>
        ) : (
          <>
            {o.status === 'READY' && !o.collected_at && (
              <Button size="lg" className="flex-1" loading={busy === `collect-${o.id}`} onClick={() => run(`collect-${o.id}`, () => api(`/staff/orders/${o.id}/collect`, { method: 'POST' }), 'Order collected')}>COLLECT ORDER</Button>
            )}
            {o.status === 'READY' && (
              <Button size="lg" variant="success" className="flex-1" loading={busy === `serve-${o.id}`} onClick={() => run(`serve-${o.id}`, () => api(`/staff/orders/${o.id}/serve`, { method: 'POST' }), `Table ${String(o.table_number).padStart(2, '0')} served`)}>
                <CheckCheck className="h-5 w-5" />MARK AS SERVED
              </Button>
            )}
            {['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status) && !o.serving_waiter_id && (
              <Button size="sm" variant="secondary" loading={busy === `claim-${o.id}`} onClick={() => run(`claim-${o.id}`, () => api(`/staff/orders/${o.id}/claim`, { method: 'POST' }), 'Serving task accepted')}>Accept serving task</Button>
            )}
            {o.serving_waiter_id === meId && o.status !== 'READY' && <Badge tone="violet">Your task</Badge>}
            <Button size="sm" variant="ghost" className="ml-auto text-amber-200" onClick={() => onIssue(o)}><AlertTriangle className="h-4 w-4" />Report issue</Button>
          </>
        )}
      </div>
    </Card>
  );
}

function IssueModal({ order, onClose, onSaved }: { order: Order | null; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'MISSING_ITEM' | 'SERVICE_ISSUE'>('MISSING_ITEM');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prev = useRef<string | null>(null);
  if (order && prev.current !== order.id) { prev.current = order.id; setNote(''); setError(null); setType('MISSING_ITEM'); }
  return (
    <Modal open={!!order} onClose={onClose} title={`Report issue · #${order?.order_number}`} size="sm"
      footer={<Button className="w-full" loading={busy} disabled={note.trim().length < 3} onClick={async () => {
        setBusy(true); setError(null);
        try { await api(`/staff/orders/${order!.id}/issues`, { body: { type, note: note.trim() } }); onSaved(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
      }}>Send to manager</Button>}>
      <div className="space-y-4 p-5">
        <Field label="Issue type">
          <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="MISSING_ITEM">Missing item</option>
            <option value="SERVICE_ISSUE">Service issue</option>
          </Select>
        </Field>
        <Field label="Details"><Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'MISSING_ITEM' ? 'Which item is missing?' : 'What happened?'} /></Field>
        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}

export function NotificationsDrawer({ open, onClose, data, reload, now }: { open: boolean; onClose: () => void; data: { notifications: Notification[]; unread: number } | null; reload: () => void; now: number }) {
  return (
    <Modal open={open} onClose={onClose} title="Notifications" size="md"
      footer={<Button variant="secondary" className="w-full" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }).catch(() => {}); reload(); }}>Mark all as read</Button>}>
      {!data?.notifications.length ? <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" /> : (
        <ul className="divide-y divide-white/5">
          {data.notifications.map((n) => (
            <li key={n.id} className={cx('flex gap-3 px-5 py-3', !n.read_at && 'bg-brand-500/5')}>
              <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-400')} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">{n.title}</div>
                {n.body && <div className="text-sm text-silver-300">{n.body}</div>}
                <div className="text-xs text-silver-500">{ago(n.created_at, now)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
