import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BellRing, ChefHat, Clock, Flame, LogOut, Play, Volume2, VolumeX, X } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { clock, minutesSince, time } from '../lib/format';
import { useData, useLocalStorage, useNow } from '../lib/hooks';
import { useRealtime } from '../lib/realtime';
import { playChime, unlockAudio } from '../lib/sound';
import type { Order } from '../lib/types';
import { StaffGate, type StaffUser } from '../components/StaffLogin';
import { Badge, Button, ConfirmDialog, cx, DemoRibbon, ErrorBanner, LiveIndicator, Logo, Modal, PageLoader, Tabs, useToast } from '../components/ui';

type KitchenData = { active: Order[]; completed: Order[]; timezone: string; delay_grace_minutes: number; server_time: string };
type Lane = 'new' | 'preparing' | 'ready' | 'completed';

export default function KitchenApp() {
  return <StaffGate portal="kitchen">{(user, demo, logout) => <Kitchen user={user} demo={demo} logout={logout} />}</StaffGate>;
}

function Kitchen({ user, demo, logout }: { user: StaffUser; demo: boolean; logout: () => Promise<void> }) {
  const toast = useToast();
  const now = useNow(1000);
  const { data, error, reload, softReload } = useData(() => api<KitchenData>('/kitchen/orders'), []);
  const [sound, setSound] = useLocalStorage('icons.kitchen.sound', { enabled: true, volume: 0.7 });
  const [started, setStarted] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [lane, setLane] = useState<Lane>('new');
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [reject, setReject] = useState<Order | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const rt = useRealtime('staff', (e) => {
    if (e.t === 'order.changed' || e.t === 'resync') softReload();
    if (e.t === 'order.changed' && e.s === 'RECEIVED' && e.prev !== 'RECEIVED' && e.o) {
      if (soundRef.current.enabled) playChime('new-order', soundRef.current.volume);
      setFlash((f) => new Set(f).add(e.o!));
      window.setTimeout(() => setFlash((f) => { const n = new Set(f); n.delete(e.o!); return n; }), 6000);
      toast({ tone: 'info', title: 'New order received' });
    }
    if (e.t === 'notification' && e.nt === 'KITCHEN_DELAY') {
      if (soundRef.current.enabled) playChime('alert', soundRef.current.volume);
      toast({ tone: 'error', title: 'Order delayed', body: 'An order has passed its estimated preparation time.' });
    }
  });

  const act = useCallback(async (o: Order, path: string, body: unknown) => {
    setBusy(o.id);
    try {
      await api(`/kitchen/orders/${o.id}/${path}`, { body });
      reload();
    } catch (e) {
      toast({ tone: 'error', title: `Could not update #${o.order_number}`, body: errMsg(e) });
      reload();
    } finally {
      setBusy(null);
    }
  }, [reload, toast]);

  useEffect(() => { document.title = 'Kitchen · ICONS Coffee'; }, []);

  if (!started) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
        <Logo size="lg" subtitle="Kitchen Display" />
        <p className="max-w-md text-silver-300">Signed in as <span className="font-semibold text-white">{user.name}</span>. Start the display to enable live order alerts and sound.</p>
        <Button size="xl" onClick={() => { unlockAudio(); setStarted(true); }}><Play className="h-6 w-6" />Start kitchen display</Button>
        <button className="text-sm text-silver-500 underline" onClick={logout}>Sign out</button>
      </div>
    );
  }

  const active = data?.active ?? [];
  const grace = data?.delay_grace_minutes ?? 5;
  const lanes: Record<Lane, Order[]> = {
    new: active.filter((o) => o.status === 'RECEIVED'),
    preparing: active.filter((o) => o.status === 'ACCEPTED' || o.status === 'PREPARING'),
    ready: active.filter((o) => o.status === 'READY'),
    completed: data?.completed ?? [],
  };
  const delayedCount = active.filter((o) => isDelayed(o, grace, now)).length;
  const LANES: { id: Lane; title: string; tone: string }[] = [
    { id: 'new', title: 'New orders', tone: 'text-sky-300' },
    { id: 'preparing', title: 'Preparing', tone: 'text-brand-300' },
    { id: 'ready', title: 'Ready', tone: 'text-emerald-300' },
    { id: 'completed', title: 'Completed', tone: 'text-silver-400' },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoRibbon show={demo} />
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-ink-950/90 px-4 py-3 backdrop-blur-xl lg:px-6">
        <div className="flex items-center gap-4">
          <Logo size="sm" subtitle="Kitchen" />
          <div className="hidden font-display text-3xl font-bold tabular-nums text-white sm:block">{time(new Date(now).toISOString())}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {delayedCount > 0 && <Badge tone="red" className="animate-pulse px-3 py-1 text-sm"><AlertTriangle className="h-4 w-4" />{delayedCount} delayed</Badge>}
          <Badge tone="blue" className="px-3 py-1 text-sm">{lanes.new.length} new</Badge>
          <Badge tone="violet" className="px-3 py-1 text-sm">{lanes.preparing.length} cooking</Badge>
          <LiveIndicator status={rt} />
          <button onClick={() => setSoundOpen(true)} className="flex h-10 items-center gap-2 rounded-xl bg-navy-800 px-3 text-sm font-semibold ring-1 ring-white/10" aria-label="Sound settings">
            {sound.enabled ? <Volume2 className="h-5 w-5 text-emerald-300" /> : <VolumeX className="h-5 w-5 text-red-300" />}<span className="hidden md:inline">Sound</span>
          </button>
          <button onClick={logout} className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm text-silver-400 hover:bg-white/5" aria-label="Sign out"><LogOut className="h-5 w-5" /></button>
        </div>
      </header>

      <div className="px-4 pt-3 xl:hidden">
        <Tabs value={lane} onChange={setLane} tabs={LANES.map((l) => ({ value: l.id, label: l.title, count: l.id === 'completed' ? undefined : lanes[l.id].length }))} />
      </div>
      {error && <div className="px-4 pt-3"><ErrorBanner message={error} onRetry={reload} /></div>}
      {!data ? <PageLoader label="Loading orders…" /> : (
        <main className="grid flex-1 gap-4 p-4 xl:grid-cols-4 lg:px-6">
          {LANES.map((l) => (
            <section key={l.id} className={cx('min-w-0 flex-col', lane === l.id ? 'flex' : 'hidden xl:flex')}>
              <h2 className={cx('mb-3 hidden items-center justify-between font-display text-lg font-bold uppercase tracking-wider xl:flex', l.tone)}>
                {l.title}<span className="rounded-full bg-white/5 px-2.5 text-base text-white">{lanes[l.id].length}</span>
              </h2>
              <div className={cx('space-y-3', l.id !== 'completed' && 'md:grid md:grid-cols-2 md:gap-3 md:space-y-0 xl:block xl:space-y-3')}>
                {lanes[l.id].length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-silver-500">{l.id === 'new' ? 'No new orders' : 'Nothing here'}</div>}
                {l.id === 'completed'
                  ? lanes.completed.map((o) => <CompletedRow key={o.id} order={o} />)
                  : lanes[l.id].map((o) => (
                    <TicketCard key={o.id} order={o} now={now} grace={grace} flash={flash.has(o.id)} busy={busy === o.id}
                      onAccept={() => act(o, 'status', { status: 'ACCEPTED' })}
                      onStart={() => act(o, 'status', { status: 'PREPARING' })}
                      onReady={() => act(o, 'status', { status: 'READY' })}
                      onRush={() => act(o, 'priority', { priority: o.priority === 'RUSH' ? 'NORMAL' : 'RUSH' })}
                      onReject={() => setReject(o)} />
                  ))}
              </div>
            </section>
          ))}
        </main>
      )}

      <Modal open={soundOpen} onClose={() => setSoundOpen(false)} title="Sound notifications" size="sm">
        <div className="space-y-5 p-5">
          <label className="flex items-center justify-between gap-3 text-white">
            <span className="font-semibold">Play sound for new orders &amp; delays</span>
            <input type="checkbox" className="h-5 w-5 accent-violet-500" checked={sound.enabled} onChange={(e) => setSound({ ...sound, enabled: e.target.checked })} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm text-silver-400">Volume · {Math.round(sound.volume * 100)}%</span>
            <input type="range" min={0.1} max={1} step={0.1} value={sound.volume} onChange={(e) => setSound({ ...sound, volume: Number(e.target.value) })} className="w-full accent-violet-500" />
          </label>
          <Button variant="secondary" className="w-full" onClick={() => { unlockAudio(); playChime('new-order', sound.volume); }}><BellRing className="h-4 w-4" />Test sound</Button>
        </div>
      </Modal>
      <ConfirmDialog open={!!reject} onClose={() => setReject(null)} title={`Reject order #${reject?.order_number}?`} tone="danger" confirmLabel="Reject order"
        body="The customer and manager will see the order as cancelled with your reason." input={{ label: 'Reason', placeholder: 'e.g. Item out of stock', required: true, minLength: 3 }}
        onConfirm={async (reason) => { await api(`/kitchen/orders/${reject!.id}/reject`, { body: { reason } }); reload(); }} />
    </div>
  );
}

function isDelayed(o: Order, grace: number, now: number) {
  if (!['RECEIVED', 'ACCEPTED', 'PREPARING'].includes(o.status)) return false;
  return minutesSince(o.accepted_at ?? o.submitted_at, now) > o.est_prep_minutes + grace;
}

function TicketCard({ order: o, now, grace, flash, busy, onAccept, onStart, onReady, onRush, onReject }: {
  order: Order; now: number; grace: number; flash: boolean; busy: boolean; onAccept: () => void; onStart: () => void; onReady: () => void; onRush: () => void; onReject: () => void;
}) {
  const delayed = isDelayed(o, grace, now);
  const since = o.status === 'READY' ? o.ready_at : o.accepted_at ?? o.submitted_at;
  const over = Math.round(minutesSince(o.accepted_at ?? o.submitted_at, now) - o.est_prep_minutes);
  return (
    <article data-testid={`ticket-${o.order_number}`} className={cx('overflow-hidden rounded-2xl bg-navy-900 ring-2 transition',
      delayed ? 'ring-red-500 animate-pulse-ring' : o.priority === 'RUSH' ? 'ring-amber-400' : o.status === 'READY' ? 'ring-emerald-500/60' : 'ring-white/10',
      flash && 'animate-flash')}>
      <div className={cx('flex items-center justify-between gap-2 px-4 py-3',
        o.status === 'RECEIVED' ? 'bg-sky-500/15' : o.status === 'READY' ? 'bg-emerald-500/15' : 'bg-brand-500/15')}>
        <div>
          <div className="font-display text-2xl font-extrabold tracking-wide text-white">#{o.order_number}</div>
          <div className="text-xs text-silver-300">Received {time(o.submitted_at)} · est {o.est_prep_minutes} min</div>
        </div>
        <div className="text-right">
          <div className="rounded-xl bg-white px-3 py-1 font-display text-xl font-extrabold text-ink-950">T{String(o.table_number).padStart(2, '0')}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-4 py-2">
        <div className={cx('flex items-center gap-1.5 font-mono text-xl font-bold tabular-nums', delayed ? 'text-red-400' : 'text-white')}>
          <Clock className="h-5 w-5" />{clock(since, now)}
        </div>
        <div className="flex items-center gap-1.5">
          {delayed && <Badge tone="red"><AlertTriangle className="h-3 w-3" />DELAYED +{over}m</Badge>}
          {o.status === 'ACCEPTED' && <Badge tone="violet">Accepted</Badge>}
          {o.status !== 'READY' && (
            <button onClick={onRush} disabled={busy} className={cx('flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1',
              o.priority === 'RUSH' ? 'bg-amber-400 text-black ring-amber-300' : 'text-silver-400 ring-white/10 hover:text-amber-300')}>
              <Flame className="h-3.5 w-3.5" />RUSH
            </button>
          )}
        </div>
      </div>
      <ul className="space-y-2.5 px-4 py-3">
        {o.items.map((it) => (
          <li key={it.id}>
            <div className="flex gap-3 text-lg font-semibold leading-snug text-white"><span className="min-w-[2.2rem] rounded-lg bg-white/10 text-center font-display">{it.quantity}×</span><span>{it.item_name}</span></div>
            {it.options.length > 0 && <div className="ml-[3rem] text-sm text-silver-300">{it.options.map((x) => x.name).join(' · ')}</div>}
            {it.special_instructions && <div className="ml-[3rem] mt-1 rounded-lg bg-amber-400/15 px-2 py-1 text-sm font-semibold text-amber-200">⚠ {it.special_instructions}</div>}
          </li>
        ))}
      </ul>
      {o.notes && <div className="mx-4 mb-3 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-100 ring-1 ring-amber-400/20"><span className="font-bold">Order note:</span> {o.notes}</div>}
      <div className="p-3 pt-0">
        {o.status === 'RECEIVED' && (
          <div className="flex gap-2">
            <Button size="xl" className="flex-1" loading={busy} onClick={onAccept}>ACCEPT ORDER</Button>
            <button onClick={onReject} disabled={busy} aria-label="Reject order" className="flex h-16 w-14 items-center justify-center rounded-2xl text-silver-400 ring-1 ring-white/10 hover:text-red-300"><X className="h-6 w-6" /></button>
          </div>
        )}
        {o.status === 'ACCEPTED' && <Button size="xl" variant="secondary" className="w-full ring-brand-500/50" loading={busy} onClick={onStart}><ChefHat className="h-6 w-6" />START PREPARING</Button>}
        {o.status === 'PREPARING' && <Button size="xl" variant="success" className="w-full" loading={busy} onClick={onReady}>MARK AS READY</Button>}
        {o.status === 'READY' && (
          <div className="rounded-xl bg-emerald-500/10 px-3 py-3 text-center text-sm font-semibold text-emerald-200">
            {o.collected_at ? `Collected by ${o.serving_waiter_name ?? 'waiter'} · ${time(o.collected_at)}` : `Waiting for ${o.serving_waiter_name ?? o.assigned_waiter_name ?? 'a waiter'} to collect`}
          </div>
        )}
      </div>
    </article>
  );
}

function CompletedRow({ order: o }: { order: Order }) {
  const cancelled = o.status === 'CANCELLED';
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-navy-900/60 px-4 py-3 ring-1 ring-white/5">
      <div className="min-w-0">
        <div className={cx('font-display font-bold', cancelled ? 'text-red-300 line-through' : 'text-silver-200')}>#{o.order_number} · T{String(o.table_number).padStart(2, '0')}</div>
        <div className="truncate text-xs text-silver-500">{o.items.map((i) => `${i.quantity}× ${i.item_name}`).join(', ')}</div>
      </div>
      <div className="shrink-0 text-right text-xs text-silver-400">
        <div>{cancelled ? 'Cancelled' : o.status === 'SERVED' ? 'Served' : 'Completed'}</div>
        <div>{time(o.served_at ?? o.cancelled_at ?? o.completed_at)}</div>
      </div>
    </div>
  );
}
