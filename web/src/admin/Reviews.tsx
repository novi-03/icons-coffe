import { useState } from 'react';
import { api } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { useData } from '../lib/hooks';
import { Badge, Button, Card, cx, ErrorBanner, PageLoader, Stars } from '../components/ui';
import { useLive } from './AdminApp';

export default function Reviews() {
  const [rating, setRating] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const { data, error, reload, softReload } = useData(() => api('/admin/reviews', { query: { rating, page } }), [rating, page]);
  useLive(['review.created'], softReload);
  if (!data) return error ? <ErrorBanner message={error} onRetry={reload} /> : <PageLoader />;
  const s = data.summary;
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <Card className="h-fit p-5">
        <div className="font-display text-4xl font-bold text-white">{s.average ?? '—'}</div>
        <Stars value={Math.round(Number(s.average ?? 0))} size="lg" />
        <div className="mt-1 text-sm text-silver-400">{s.count.toLocaleString()} reviews</div>
        <div className="mt-4 space-y-1.5">
          {[5, 4, 3, 2, 1].map((r) => (
            <button key={r} onClick={() => { setRating(rating === r ? null : r); setPage(1); }} className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1 text-sm', rating === r && 'bg-brand-500/15')}>
              <span className="w-6 text-silver-300">{r}★</span>
              <span className="h-2 flex-1 rounded-full bg-white/5"><span className="block h-2 rounded-full bg-amber-400" style={{ width: `${s.count ? (s[`r${r}`] / s.count) * 100 : 0}%` }} /></span>
              <span className="w-10 text-right tabular-nums text-silver-400">{s[`r${r}`]}</span>
            </button>
          ))}
        </div>
      </Card>
      <div className="space-y-3">
        {data.reviews.map((r: any) => (
          <Card key={r.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><Stars value={r.rating} />{r.is_demo && <Badge tone="amber">DEMO</Badge>}</div>
              <div className="text-xs text-silver-500">{dateTime(r.created_at)}</div>
            </div>
            <p className={cx('mt-2 text-sm', r.comment ? 'text-silver-100' : 'italic text-silver-500')}>{r.comment ?? 'No comment'}</p>
            <div className="mt-2 text-xs text-silver-500">Order #{r.order_number} · Table {String(r.table_number ?? '').padStart(2, '0')} · {money(r.total_fils)}</div>
          </Card>
        ))}
        {!data.reviews.length && <Card className="p-10 text-center text-sm text-silver-500">No reviews</Card>}
        {pages > 1 && <div className="flex items-center justify-between text-sm text-silver-400"><span>Page {page} of {pages}</span><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button><Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>}
      </div>
    </div>
  );
}
