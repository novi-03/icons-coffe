import { useEffect, useState } from 'react';
import { ImagePlus, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { money } from '../lib/format';
import { useData } from '../lib/hooks';
import type { Category, MenuItem, Variant } from '../lib/types';
import { Badge, Button, Card, ConfirmDialog, cx, ErrorBanner, Field, Input, Modal, PageLoader, Select, Textarea, Toggle, useToast } from '../components/ui';
import { useLive } from './AdminApp';

type Ing = { menu_item_id: string; inventory_item_id: string; quantity_per_unit: number; name: string; unit: string };
type MenuData = { categories: Category[]; items: MenuItem[]; ingredients: Ing[] };
const DIETS = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'contains-nuts', 'spicy', 'halal'];
const toFils = (s: string) => Math.round(Number(s) * 100);

export default function MenuAdmin() {
  const toast = useToast();
  const { data, error, reload, softReload } = useData(() => api<MenuData>('/admin/menu'), []);
  useLive(['menu.changed'], softReload);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [edit, setEdit] = useState<MenuItem | 'new' | null>(null);
  const [catEdit, setCatEdit] = useState<Category | 'new' | null>(null);
  const [del, setDel] = useState<MenuItem | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (!data) return error ? <ErrorBanner message={error} onRetry={reload} /> : <PageLoader />;
  const items = data.items.filter((i) => (showArchived || !i.is_archived) && (cat === 'all' || i.category_id === cat) && i.name.toLowerCase().includes(q.toLowerCase()));

  const patch = async (i: MenuItem, body: Partial<MenuItem>, msg: string) => {
    try { await api(`/admin/items/${i.id}`, { method: 'PATCH', body }); toast({ tone: 'success', title: msg }); reload(); }
    catch (e) { toast({ tone: 'error', title: 'Update failed', body: errMsg(e) }); }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
      <Card className="h-fit p-4">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-display font-semibold text-white">Categories</h3><Button size="xs" onClick={() => setCatEdit('new')}><Plus className="h-3.5 w-3.5" />Add</Button></div>
        <button onClick={() => setCat('all')} className={cx('mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm', cat === 'all' ? 'bg-brand-500/15 text-white' : 'text-silver-300 hover:bg-white/5')}>All products<span className="text-xs text-silver-500">{data.items.filter((i) => !i.is_archived).length}</span></button>
        {data.categories.map((c) => (
          <div key={c.id} className={cx('group flex items-center rounded-xl', cat === c.id ? 'bg-brand-500/15' : 'hover:bg-white/5')}>
            <button onClick={() => setCat(c.id)} className={cx('flex flex-1 items-center justify-between px-3 py-2 text-left text-sm', cat === c.id ? 'text-white' : 'text-silver-300', !c.is_active && 'line-through opacity-60')}>
              {c.name}<span className="text-xs text-silver-500">{data.items.filter((i) => i.category_id === c.id && !i.is_archived).length}</span>
            </button>
            <button aria-label={`Edit ${c.name}`} onClick={() => setCatEdit(c)} className="px-2 text-silver-500 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </Card>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-500" />
            <Input className="pl-9" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
          </div>
          <label className="flex items-center gap-2 text-sm text-silver-400"><Toggle checked={showArchived} onChange={setShowArchived} label="Show archived" />Archived</label>
          <Button onClick={() => setEdit('new')}><Plus className="h-4 w-4" />New product</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {items.map((i) => (
            <Card key={i.id} className={cx('flex gap-3 p-3', i.is_archived && 'opacity-50')}>
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-navy-800">{i.image_url && <img src={i.image_url} alt="" className="h-full w-full object-cover" />}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="truncate font-semibold text-white">{i.name}</div>
                  <div className="shrink-0 font-semibold text-brand-200">{money(i.price_fils)}</div>
                </div>
                <div className="text-xs text-silver-500">{data.categories.find((c) => c.id === i.category_id)?.name} · {i.prep_minutes} min{i.variants.length ? ` · ${i.variants.length} options` : ''}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {i.is_featured && <Badge tone="violet">Featured</Badge>}{i.is_popular && <Badge tone="amber">Popular</Badge>}
                  {i.is_archived && <Badge tone="red">Archived</Badge>}{i.is_demo && <Badge tone="amber">DEMO</Badge>}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-silver-300">
                    <Toggle checked={i.is_available} disabled={i.is_archived} label={`${i.name} available`}
                      onChange={(v) => patch(i, { is_available: v }, `${i.name} is now ${v ? 'available' : 'unavailable'}`)} />
                    {i.is_available ? 'Available' : 'Unavailable'}
                  </label>
                  <div className="flex gap-1">
                    {i.is_archived
                      ? <Button size="xs" variant="secondary" onClick={() => patch(i, { is_archived: false } as any, 'Product restored')}>Restore</Button>
                      : <>
                        <Button size="xs" variant="secondary" onClick={() => setEdit(i)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                        <Button size="xs" variant="ghost" className="text-red-300" aria-label={`Delete ${i.name}`} onClick={() => setDel(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </>}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
        {!items.length && <Card className="p-10 text-center text-sm text-silver-500">No products found</Card>}
      </div>

      <ItemEditor item={edit} data={data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
      <CategoryEditor cat={catEdit} onClose={() => setCatEdit(null)} onSaved={() => { setCatEdit(null); reload(); }} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name}?`} tone="danger" confirmLabel="Delete"
        body="Products that appear in past orders are archived instead of deleted, so order history stays intact."
        onConfirm={async () => { const r = await api(`/admin/items/${del!.id}`, { method: 'DELETE' }); toast({ tone: 'success', title: r.result === 'archived' ? 'Product archived (it has order history)' : 'Product deleted' }); reload(); }} />
    </div>
  );
}

function CategoryEditor({ cat, onClose, onSaved }: { cat: Category | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { if (cat) { setName(cat === 'new' ? '' : cat.name); setDesc(cat === 'new' ? '' : cat.description ?? ''); setActive(cat === 'new' ? true : cat.is_active); setError(null); } }, [cat]);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const body = { name, description: desc || null, is_active: active };
      if (cat === 'new') await api('/admin/categories', { body }); else await api(`/admin/categories/${cat!.id}`, { method: 'PATCH', body });
      toast({ tone: 'success', title: 'Category saved' }); onSaved();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!cat} onClose={onClose} title={cat === 'new' ? 'New category' : 'Edit category'} size="sm"
      footer={<div className="flex justify-between gap-2">
        {cat && cat !== 'new' ? <Button variant="ghost" className="text-red-300" onClick={() => setConfirmDel(true)}>Delete</Button> : <span />}
        <Button loading={busy} disabled={!name.trim()} onClick={save}>Save</Button>
      </div>}>
      <div className="space-y-4 p-5">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
        <Field label="Description"><Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} /></Field>
        <label className="flex items-center gap-3 text-sm text-silver-200"><Toggle checked={active} onChange={setActive} label="Visible" />Visible on the customer menu</label>
        <ErrorBanner message={error} />
      </div>
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} title="Delete category?" tone="danger" confirmLabel="Delete"
        body="Only empty categories can be deleted." onConfirm={async () => { await api(`/admin/categories/${(cat as Category).id}`, { method: 'DELETE' }); onSaved(); }} />
    </Modal>
  );
}

type VDraft = Omit<Variant, 'id'> & { id?: string; price: string };

function ItemEditor({ item, data, onClose, onSaved }: { item: MenuItem | 'new' | null; data: MenuData; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const inventory = useData(() => api<{ items: { id: string; name: string; unit: string }[] }>('/admin/inventory'), []);
  const [f, setF] = useState<any>(null);
  const [variants, setVariants] = useState<VDraft[]>([]);
  const [ings, setIngs] = useState<{ inventory_item_id: string; quantity_per_unit: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    const i = item === 'new' ? null : item;
    setF({
      name: i?.name ?? '', description: i?.description ?? '', price: i ? (i.price_fils / 100).toFixed(2) : '', prep_minutes: String(i?.prep_minutes ?? 10),
      category_id: i?.category_id ?? data.categories[0]?.id ?? '', is_available: i?.is_available ?? true, is_featured: i?.is_featured ?? false, is_popular: i?.is_popular ?? false,
      dietary: i?.dietary ?? [], calories: i?.calories != null ? String(i.calories) : '', image_media_id: i?.image_media_id ?? null, image_url: i?.image_url ?? null,
    });
    setVariants((i?.variants ?? []).map((v) => ({ ...v, price: (v.price_delta_fils / 100).toFixed(2) })));
    setIngs(data.ingredients.filter((g) => g.menu_item_id === i?.id).map((g) => ({ inventory_item_id: g.inventory_item_id, quantity_per_unit: String(g.quantity_per_unit) })));
    setError(null);
  }, [item, data]);
  if (!item || !f) return null;

  const upload = async (file: File) => {
    setUploading(true); setError(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await api<{ id: string; url: string }>('/admin/media', { form: fd });
      setF({ ...f, image_media_id: r.id, image_url: r.url });
    } catch (e) { setError(errMsg(e)); } finally { setUploading(false); }
  };
  const save = async () => {
    setError(null);
    const price = Number(f.price);
    if (!f.name.trim()) return setError('Name is required');
    if (!(price >= 0) || f.price === '') return setError('Enter a valid price');
    if (variants.some((v) => !v.name.trim() || !v.group_name.trim() || Number.isNaN(Number(v.price)))) return setError('Every option needs a group, a name and a valid price');
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(), description: f.description.trim() || null, price_fils: toFils(f.price), prep_minutes: Number(f.prep_minutes) || 0,
        category_id: f.category_id, is_available: f.is_available, is_featured: f.is_featured, is_popular: f.is_popular, dietary: f.dietary,
        calories: f.calories === '' ? null : Number(f.calories), image_media_id: f.image_media_id,
        variants: variants.map((v) => ({ id: v.id, kind: v.kind, group_name: v.group_name.trim(), name: v.name.trim(), price_delta_fils: toFils(v.price), is_default: v.is_default, is_available: v.is_available })),
        ingredients: ings.filter((g) => g.inventory_item_id && Number(g.quantity_per_unit) > 0).map((g) => ({ inventory_item_id: g.inventory_item_id, quantity_per_unit: Number(g.quantity_per_unit) })),
      };
      if (item === 'new') await api('/admin/items', { body }); else await api(`/admin/items/${item.id}`, { method: 'PATCH', body });
      toast({ tone: 'success', title: 'Product saved', body: 'The customer menu updates instantly.' });
      onSaved();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  const setV = (i: number, p: Partial<VDraft>) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...p } : p.is_default && v.kind !== 'EXTRA' && v.group_name === vs[i].group_name && v.kind === vs[i].kind ? { ...v, is_default: false } : v)));

  return (
    <Modal open onClose={onClose} size="xl" title={item === 'new' ? 'New product' : `Edit ${item.name}`}
      footer={<div className="flex items-center justify-between gap-3"><ErrorBanner message={error} /><Button loading={busy} onClick={save} className="ml-auto">Save product</Button></div>}>
      <div className="grid gap-6 p-5 lg:grid-cols-[220px_1fr]">
        <div className="space-y-3">
          <div className="aspect-square overflow-hidden rounded-2xl bg-navy-800 ring-1 ring-white/10">{f.image_url ? <img src={f.image_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-silver-600"><ImagePlus className="h-8 w-8" /></div>}</div>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy-700 px-3 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-navy-600">
            <ImagePlus className="h-4 w-4" />{uploading ? 'Uploading…' : 'Upload image'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <p className="text-xs text-silver-500">PNG, JPEG or WebP, up to 3 MB.</p>
        </div>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Category"><Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Price (AED)"><Input type="number" min={0} step="0.5" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
            <Field label="Preparation time (minutes)"><Input type="number" min={0} max={240} value={f.prep_minutes} onChange={(e) => setF({ ...f, prep_minutes: e.target.value })} /></Field>
            <Field label="Calories (optional)"><Input type="number" min={0} value={f.calories} onChange={(e) => setF({ ...f, calories: e.target.value })} /></Field>
          </div>
          <Field label="Description"><Textarea rows={2} maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-4 text-sm text-silver-200">
            {[['is_available', 'Available'], ['is_featured', 'Featured'], ['is_popular', 'Popular']].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><Toggle checked={f[k]} onChange={(v) => setF({ ...f, [k]: v })} label={l} />{l}</label>
            ))}
          </div>
          <Field label="Dietary information">
            <div className="flex flex-wrap gap-2">
              {DIETS.map((d) => (
                <button key={d} type="button" onClick={() => setF({ ...f, dietary: f.dietary.includes(d) ? f.dietary.filter((x: string) => x !== d) : [...f.dietary, d] })}
                  className={cx('rounded-full px-3 py-1 text-xs font-semibold ring-1', f.dietary.includes(d) ? 'bg-brand-500/20 text-brand-200 ring-brand-500/40' : 'text-silver-400 ring-white/10')}>{d}</button>
              ))}
            </div>
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-silver-400">Sizes, variations & extras</span>
              <div className="flex gap-1">
                {(['SIZE', 'VARIATION', 'EXTRA'] as const).map((k) => <Button key={k} size="xs" variant="secondary" onClick={() => setVariants((v) => [...v, { kind: k, group_name: k === 'SIZE' ? 'Size' : k === 'EXTRA' ? 'Extras' : 'Choice', name: '', price: '0', price_delta_fils: 0, is_default: false, is_available: true }])}><Plus className="h-3 w-3" />{k.toLowerCase()}</Button>)}
              </div>
            </div>
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={v.id ?? i} className="grid grid-cols-[90px_1fr_1fr_90px_auto] items-center gap-2 rounded-xl bg-ink-900 p-2 ring-1 ring-white/5">
                  <Badge tone={v.kind === 'EXTRA' ? 'green' : v.kind === 'SIZE' ? 'violet' : 'blue'}>{v.kind}</Badge>
                  <Input className="h-9" placeholder="Group" value={v.group_name} onChange={(e) => setV(i, { group_name: e.target.value })} aria-label="Option group" />
                  <Input className="h-9" placeholder="Option name" value={v.name} onChange={(e) => setV(i, { name: e.target.value })} aria-label="Option name" />
                  <Input className="h-9" type="number" step="0.5" value={v.price} onChange={(e) => setV(i, { price: e.target.value })} aria-label="Price change (AED)" title="Price change (AED)" />
                  <div className="flex items-center gap-2">
                    {v.kind !== 'EXTRA' && <label className="flex items-center gap-1 text-[11px] text-silver-400"><input type="radio" checked={v.is_default} onChange={() => setV(i, { is_default: true })} className="accent-violet-500" />default</label>}
                    <Toggle checked={v.is_available} onChange={(x) => setV(i, { is_available: x })} label="Option available" />
                    <button aria-label="Remove option" onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))} className="text-silver-500 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
              {!variants.length && <div className="text-xs text-silver-500">No options — customers order the product as is.</div>}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-silver-400">Ingredients used per unit (inventory)</span>
              <Button size="xs" variant="secondary" onClick={() => setIngs((g) => [...g, { inventory_item_id: '', quantity_per_unit: '' }])}><Plus className="h-3 w-3" />ingredient</Button></div>
            {ings.map((g, i) => {
              const inv = inventory.data?.items.find((x) => x.id === g.inventory_item_id);
              return (
                <div key={i} className="mb-2 grid grid-cols-[1fr_120px_auto] items-center gap-2">
                  <Select className="h-9" value={g.inventory_item_id} onChange={(e) => setIngs((x) => x.map((y, j) => (j === i ? { ...y, inventory_item_id: e.target.value } : y)))} aria-label="Ingredient">
                    <option value="">Choose ingredient…</option>{inventory.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
                  </Select>
                  <Input className="h-9" type="number" min={0} step="any" placeholder={inv?.unit ?? 'qty'} value={g.quantity_per_unit} onChange={(e) => setIngs((x) => x.map((y, j) => (j === i ? { ...y, quantity_per_unit: e.target.value } : y)))} aria-label="Quantity per unit" />
                  <button aria-label="Remove ingredient" onClick={() => setIngs((x) => x.filter((_, j) => j !== i))} className="text-silver-500 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                </div>
              );
            })}
            {!ings.length && <div className="text-xs text-silver-500">Optional. When set, stock is deducted automatically when the kitchen accepts an order.</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
