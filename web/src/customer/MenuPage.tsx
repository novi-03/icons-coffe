import { useMemo, useRef, useState } from 'react';
import { Check, Clock, Copy, Flame, Leaf, Search, Sparkles, Wifi, X } from 'lucide-react';
import { money } from '../lib/format';
import type { MenuItem } from '../lib/types';
import { Badge, Card, cx, EmptyState, ErrorBanner, PageLoader, useToast } from '../components/ui';
import { useCustomer } from './CustomerApp';
import ItemSheet from './ItemSheet';
import { newKey } from './cart';

export const DIET_LABEL: Record<string, string> = {
  vegetarian: 'Vegetarian', vegan: 'Vegan', 'gluten-free': 'Gluten-free', 'dairy-free': 'Dairy-free', 'contains-nuts': 'Contains nuts', spicy: 'Spicy', halal: 'Halal',
};

export default function MenuPage() {
  const { ctx, menu, menuError, reloadMenu, setCart } = useCustomer();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const r = ctx.restaurant;

  const items = useMemo(() => {
    const all = menu?.items.filter((i) => !i.is_archived) ?? [];
    const term = q.trim().toLowerCase();
    return term ? all.filter((i) => `${i.name} ${i.description ?? ''} ${i.dietary.join(' ')}`.toLowerCase().includes(term)) : all;
  }, [menu, q]);

  if (menuError && !menu) return <ErrorBanner message={menuError} onRetry={reloadMenu} />;
  if (!menu) return <PageLoader label="Loading menu…" />;

  const featured = menu.items.filter((i) => i.is_featured && !i.is_archived);
  const popular = menu.items.filter((i) => i.is_popular && !i.is_archived);
  const cats = menu.categories.filter((c) => items.some((i) => i.category_id === c.id));

  const quickAdd = (item: MenuItem) => {
    if (item.variants.length) return setSelected(item);
    setCart((c) => [...c, { key: newKey(), menu_item_id: item.id, quantity: 1, variant_ids: [] }]);
    toast({ tone: 'success', title: `${item.name} added to cart` });
  };

  return (
    <div className="space-y-6">
      {!q && (
        <>
          <Card className="relative overflow-hidden p-5">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-500/25 blur-3xl" />
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Table {String(ctx.table.number).padStart(2, '0')}{ctx.table.zone ? ` · ${ctx.table.zone}` : ''}</div>
            <h1 className="mt-2 font-display text-2xl font-bold text-white">Welcome to {r.name}</h1>
            <p className="mt-1 text-sm text-silver-300">{r.welcome_message}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge tone={r.status.isOpen ? 'green' : 'red'}><span className={cx('h-1.5 w-1.5 rounded-full', r.status.isOpen ? 'bg-emerald-400' : 'bg-red-400')} />{r.status.label}</Badge>
              <Badge tone="silver">Prices in AED{r.prices_include_tax ? ' · VAT included' : ''}</Badge>
            </div>
          </Card>
          {r.wifi_ssid && <WifiCard ssid={r.wifi_ssid} password={r.wifi_password} />}
        </>
      )}

      <div className="sticky top-[61px] z-20 -mx-4 space-y-3 bg-ink-950/90 px-4 pb-3 pt-1 backdrop-blur-xl">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coffee, food, desserts…" aria-label="Search the menu"
            className="h-12 w-full rounded-2xl bg-navy-900 pl-10 pr-10 text-sm text-white ring-1 ring-inset ring-white/10 placeholder:text-silver-500 focus:outline-none focus:ring-2 focus:ring-brand-500" />
          {q && <button aria-label="Clear search" onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-silver-400"><X className="h-4 w-4" /></button>}
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {cats.map((c) => (
            <button key={c.id} onClick={() => { setActive(c.id); sectionRefs.current[c.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              className={cx('whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset transition',
                active === c.id ? 'bg-brand-500 text-white ring-brand-400' : 'bg-navy-900 text-silver-200 ring-white/10 hover:bg-navy-800')}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {!q && featured.length > 0 && (
        <section>
          <SectionTitle icon={<Sparkles className="h-4 w-4 text-brand-300" />} title="Featured" />
          <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
            {featured.map((i) => (
              <button key={i.id} onClick={() => setSelected(i)} className="w-64 shrink-0 snap-start text-left">
                <Card className="overflow-hidden">
                  <ItemImage item={i} className="h-36" />
                  <div className="p-3">
                    <div className="font-semibold text-white">{i.name}</div>
                    <div className="mt-1 flex items-center justify-between text-sm"><span className="font-semibold text-brand-200">{money(i.price_fils)}</span>
                      <span className="flex items-center gap-1 text-xs text-silver-400"><Clock className="h-3 w-3" />{i.prep_minutes} min</span></div>
                  </div>
                </Card>
              </button>
            ))}
          </div>
        </section>
      )}

      {!q && popular.length > 0 && (
        <section>
          <SectionTitle icon={<Flame className="h-4 w-4 text-amber-400" />} title="Popular right now" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {popular.slice(0, 6).map((i) => (
              <button key={i.id} onClick={() => setSelected(i)} className="text-left">
                <Card className="h-full overflow-hidden">
                  <ItemImage item={i} className="h-24" />
                  <div className="p-2.5"><div className="truncate text-sm font-semibold text-white">{i.name}</div><div className="text-xs text-brand-200">{money(i.price_fils)}</div></div>
                </Card>
              </button>
            ))}
          </div>
        </section>
      )}

      {cats.length === 0 && <EmptyState icon={<Search className="h-6 w-6" />} title="No matches" body={`Nothing on the menu matches “${q}”.`} />}

      {cats.map((c) => (
        <section key={c.id} ref={(el) => { sectionRefs.current[c.id] = el; }} className="scroll-mt-40">
          <SectionTitle title={c.name} />
          <div className="space-y-3">
            {items.filter((i) => i.category_id === c.id).map((i) => <ItemRow key={i.id} item={i} onOpen={() => setSelected(i)} onAdd={() => quickAdd(i)} />)}
          </div>
        </section>
      ))}

      <ItemSheet item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function SectionTitle({ title, icon }: { title: string; icon?: React.ReactNode }) {
  return <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-white">{icon}{title}</h2>;
}

export function ItemImage({ item, className }: { item: MenuItem; className?: string }) {
  return (
    <div className={cx('relative overflow-hidden bg-navy-800', className)}>
      {item.image_url ? <img src={item.image_url} alt={item.name} loading="lazy" className="h-full w-full object-cover" />
        : <div className="flex h-full items-center justify-center text-3xl text-silver-600">☕</div>}
      {!item.is_available && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-bold uppercase tracking-widest text-silver-200">Unavailable</div>}
    </div>
  );
}

function ItemRow({ item, onOpen, onAdd }: { item: MenuItem; onOpen: () => void; onAdd: () => void }) {
  return (
    <Card className={cx('flex gap-3 overflow-hidden p-2.5', !item.is_available && 'opacity-60')}>
      <button onClick={onOpen} className="shrink-0" aria-label={`View ${item.name}`}><ItemImage item={item} className="h-24 w-24 rounded-xl" /></button>
      <div className="flex min-w-0 flex-1 flex-col">
        <button onClick={onOpen} className="text-left">
          <div className="font-semibold text-white">{item.name}</div>
          <div className="mt-0.5 line-clamp-2 text-xs text-silver-400">{item.description}</div>
        </button>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.dietary.slice(0, 2).map((d) => <Badge key={d} tone={d === 'contains-nuts' ? 'amber' : 'green'}>{d === 'contains-nuts' ? null : <Leaf className="h-3 w-3" />}{DIET_LABEL[d] ?? d}</Badge>)}
          <span className="flex items-center gap-1 text-[11px] text-silver-500"><Clock className="h-3 w-3" />{item.prep_minutes} min</span>
        </div>
        <div className="mt-auto flex items-center justify-between pt-1.5">
          <span className="font-semibold text-brand-200">{money(item.price_fils)}{item.variants.some((v) => v.price_delta_fils > 0) && <span className="ml-1 text-[11px] font-normal text-silver-500">+ options</span>}</span>
          <button onClick={onAdd} disabled={!item.is_available} aria-label={`Add ${item.name}`}
            className="h-9 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white shadow-glow transition active:scale-95 disabled:bg-navy-700 disabled:shadow-none">
            {item.is_available ? 'Add' : 'Sold out'}
          </button>
        </div>
      </div>
    </Card>
  );
}

function WifiCard({ ssid, password }: { ssid: string; password: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="rounded-xl bg-sky-500/15 p-2.5 text-sky-300"><Wifi className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-silver-400">Free Wi-Fi</div>
        <div className="truncate font-semibold text-white">{ssid}</div>
        {password && <div className="truncate text-silver-300">Password: <span className="font-mono text-white">{password}</span></div>}
      </div>
      {password && (
        <button className="flex items-center gap-1 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-silver-200 ring-1 ring-white/10"
          onClick={async () => { try { await navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }}>
          {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </Card>
  );
}
