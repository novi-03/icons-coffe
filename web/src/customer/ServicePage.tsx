import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Check, HelpCircle, Receipt, Star, Wifi } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { ago } from '../lib/format';
import { useData, useNow } from '../lib/hooks';
import { Badge, Button, Card, cx, ErrorBanner, Modal, Textarea, useToast } from '../components/ui';
import { useCustomer } from './CustomerApp';

type Req = { id: string; type: string; note: string | null; status: 'OPEN' | 'ACKNOWLEDGED' | 'COMPLETED' | 'CANCELLED'; created_at: string };
const TYPES = [
  { type: 'CALL_WAITER', title: 'Call waiter', body: 'A waiter will come to your table', icon: BellRing, tone: 'bg-brand-500/15 text-brand-300' },
  { type: 'REQUEST_BILL', title: 'Request bill', body: 'We will bring your bill', icon: Receipt, tone: 'bg-emerald-500/15 text-emerald-300' },
  { type: 'REQUEST_WIFI', title: 'Wi-Fi help', body: 'Get help connecting', icon: Wifi, tone: 'bg-sky-500/15 text-sky-300' },
  { type: 'ASSISTANCE', title: 'Assistance', body: 'Anything else — tell us', icon: HelpCircle, tone: 'bg-amber-500/15 text-amber-300' },
] as const;

export default function ServicePage() {
  const { ctx, subscribe, orders } = useCustomer();
  const toast = useToast();
  const now = useNow(30000);
  const reqs = useData(() => api<{ requests: Req[] }>('/guest/requests').then((r) => r.requests), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => subscribe((e) => { if (e.t === 'request.changed' || e.t === 'resync') reqs.softReload(); }), [subscribe]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (reqs.data ?? []).filter((r) => r.status === 'OPEN' || r.status === 'ACKNOWLEDGED');
  const send = async (type: string, n?: string) => {
    setBusy(type); setError(null);
    try {
      await api('/guest/requests', { body: { type, note: n || undefined } });
      toast({ tone: 'success', title: 'Request sent', body: 'Our team has been notified.' });
      reqs.reload();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };
  const reviewable = orders.filter((o) => (o.status === 'SERVED' || o.status === 'COMPLETED') && !o.review);
  const w = ctx.restaurant;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">How can we help?</h1>
        <p className="mt-1 text-sm text-silver-400">Requests go straight to the team serving Table {String(ctx.table.number).padStart(2, '0')}.</p>
      </div>
      <ErrorBanner message={error} />
      <div className="grid grid-cols-2 gap-3">
        {TYPES.map((t) => {
          const pending = open.find((r) => r.type === t.type);
          return (
            <button key={t.type} disabled={!!busy || !!pending}
              onClick={() => (t.type === 'ASSISTANCE' ? (setNote(''), setNoteFor(t.type)) : send(t.type))}
              className="text-left disabled:cursor-default">
              <Card className={cx('h-full p-4 transition', !pending && 'hover:ring-brand-500/40 active:scale-[.98]', pending && 'ring-emerald-500/30')}>
                <div className={cx('inline-flex rounded-xl p-2.5', t.tone)}><t.icon className="h-6 w-6" /></div>
                <div className="mt-3 font-semibold text-white">{t.title}</div>
                <div className="mt-0.5 text-xs text-silver-400">{pending ? (pending.status === 'ACKNOWLEDGED' ? 'A waiter is on the way' : 'Sent — waiting for staff') : busy === t.type ? 'Sending…' : t.body}</div>
                {pending && <Badge tone={pending.status === 'ACKNOWLEDGED' ? 'green' : 'amber'} className="mt-2">{pending.status === 'ACKNOWLEDGED' ? <><Check className="h-3 w-3" />Acknowledged</> : 'Pending'}</Badge>}
              </Card>
            </button>
          );
        })}
      </div>

      {open.length > 0 && (
        <Card className="divide-y divide-white/5">
          {open.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div>
                <div className="font-semibold text-white">{TYPES.find((t) => t.type === r.type)?.title}</div>
                <div className="text-xs text-silver-400">{r.note ? `“${r.note}” · ` : ''}{ago(r.created_at, now)}</div>
              </div>
              <Button size="xs" variant="ghost" onClick={async () => { try { await api(`/guest/requests/${r.id}/cancel`, { method: 'POST' }); reqs.reload(); } catch (e) { setError(errMsg(e)); } }}>Cancel</Button>
            </div>
          ))}
        </Card>
      )}

      {w.wifi_ssid && (
        <Card className="p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-white"><Wifi className="h-4 w-4 text-sky-300" /> Wi-Fi</div>
          <div className="mt-1 text-silver-300">Network: <span className="font-semibold text-white">{w.wifi_ssid}</span></div>
          {w.wifi_password && <div className="text-silver-300">Password: <span className="font-mono text-white">{w.wifi_password}</span></div>}
        </Card>
      )}

      <Card className="p-4">
        <div className="flex items-center gap-2 font-semibold text-white"><Star className="h-4 w-4 text-amber-400" /> Reviews</div>
        {reviewable.length ? (
          <div className="mt-2 space-y-2">{reviewable.map((o) => <Link key={o.id} to={`/order/${o.id}`} className="block text-sm font-semibold text-brand-300 underline-offset-2 hover:underline">Rate order #{o.order_number} →</Link>)}</div>
        ) : <p className="mt-1 text-sm text-silver-400">You can rate your order once it has been served.</p>}
      </Card>

      <Modal open={!!noteFor} onClose={() => setNoteFor(null)} title="Request assistance" size="sm"
        footer={<Button className="w-full" loading={busy === 'ASSISTANCE'} onClick={async () => { await send('ASSISTANCE', note.trim()); setNoteFor(null); }}>Send request</Button>}>
        <div className="p-5"><Textarea autoFocus rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What do you need? (optional)" /></div>
      </Modal>
    </div>
  );
}
