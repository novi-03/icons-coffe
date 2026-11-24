import { api } from '../lib/api';
import { dateTime, titleCase } from '../lib/format';
import { useData } from '../lib/hooks';
import { Badge, Button, Card, cx, ErrorBanner, PageLoader } from '../components/ui';
import type { Notification } from '../lib/types';
import { useLive } from './AdminApp';

const TONE: Record<string, 'violet' | 'green' | 'amber' | 'red' | 'blue'> = {
  NEW_ORDER: 'blue', PAYMENT_UPDATE: 'green', KITCHEN_DELAY: 'red', WAITER_REQUEST: 'amber', LOW_STOCK: 'red', NEW_REVIEW: 'violet', SERVICE_ISSUE: 'red', ORDER_CANCELLED: 'amber',
};

export default function Notifications({ onChange }: { onChange: () => void }) {
  const { data, error, reload, softReload } = useData(() => api<{ notifications: Notification[]; unread: number }>('/notifications', { query: { limit: 200 } }), []);
  useLive(['notification'], softReload);
  if (!data) return error ? <ErrorBanner message={error} onRetry={reload} /> : <PageLoader />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div className="text-sm text-silver-400">{data.unread} unread</div>
        <Button variant="secondary" size="sm" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); reload(); onChange(); }}>Mark all as read</Button></div>
      <Card className="divide-y divide-white/5">
        {data.notifications.map((n) => (
          <button key={n.id} className={cx('flex w-full items-start gap-3 px-4 py-3 text-left', !n.read_at && 'bg-brand-500/5')}
            onClick={async () => { if (!n.read_at) { await api(`/notifications/${n.id}/read`, { method: 'POST' }); reload(); onChange(); } }}>
            <span className={cx('mt-2 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-400')} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-white">{n.title}</span><Badge tone={TONE[n.type] ?? 'violet'}>{titleCase(n.type)}</Badge></div>
              {n.body && <div className="text-sm text-silver-300">{n.body}</div>}
            </div>
            <div className="shrink-0 text-xs text-silver-500">{dateTime(n.created_at)}</div>
          </button>
        ))}
        {!data.notifications.length && <div className="p-10 text-center text-sm text-silver-500">No notifications yet</div>}
      </Card>
    </div>
  );
}
