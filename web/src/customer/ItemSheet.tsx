import { useEffect, useMemo, useState } from 'react';
import { Clock, Flame, Leaf, Minus, Plus } from 'lucide-react';
import { money } from '../lib/format';
import type { MenuItem, Variant } from '../lib/types';
import { Badge, Button, cx, Modal, Textarea, useToast } from '../components/ui';
import { useCustomer } from './CustomerApp';
import { newKey, unitPrice, type CartLine } from './cart';
import { DIET_LABEL, ItemImage } from './MenuPage';

/** Product customization: sizes, variations, extras, quantity and special instructions. Pass `editing` to change an existing cart line. */
export default function ItemSheet({ item, onClose, editing }: { item: MenuItem | null; onClose: () => void; editing?: CartLine }) {
  const { setCart } = useCustomer();
  const toast = useToast();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');

  const groups = useMemo(() => {
    if (!item) return [];
    const map = new Map<string, { key: string; kind: Variant['kind']; name: string; options: Variant[] }>();
    for (const v of item.variants) {
      const key = `${v.kind}:${v.group_name}`;
      if (!map.has(key)) map.set(key, { key, kind: v.kind, name: v.group_name, options: [] });
      map.get(key)!.options.push(v);
    }
    const order = { SIZE: 0, VARIATION: 1, EXTRA: 2 };
    return [...map.values()].sort((a, b) => order[a.kind] - order[b.kind]);
  }, [item]);

  useEffect(() => {
    if (!item) return;
    const c: Record<string, string> = {};
    for (const g of groups) {
      if (g.kind === 'EXTRA') continue;
      const fromEdit = editing && g.options.find((o) => editing.variant_ids.includes(o.id) && o.is_available);
      const def = fromEdit ?? g.options.find((o) => o.is_default && o.is_available) ?? g.options.find((o) => o.is_available);
      if (def) c[g.key] = def.id;
    }
    setChoice(c);
    setExtras(editing ? editing.variant_ids.filter((id) => item.variants.some((v) => v.id === id && v.kind === 'EXTRA' && v.is_available)) : []);
    setQty(editing?.quantity ?? 1);
    setNotes(editing?.special_instructions ?? '');
  }, [item, groups, editing]);

  if (!item) return null;
  const variantIds = [...Object.values(choice), ...extras];
  const unit = unitPrice(item, variantIds);
  const missing = groups.filter((g) => g.kind !== 'EXTRA' && !choice[g.key]);

  const save = () => {
    const line: CartLine = { key: editing?.key ?? newKey(), menu_item_id: item.id, quantity: qty, variant_ids: variantIds, special_instructions: notes.trim() || undefined };
    setCart((c) => (editing ? c.map((l) => (l.key === editing.key ? line : l)) : [...c, line]));
    toast({ tone: 'success', title: editing ? 'Cart updated' : `${qty} × ${item.name} added to cart` });
    onClose();
  };

  return (
    <Modal open={!!item} onClose={onClose} sheet
      footer={
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-2xl bg-ink-900 ring-1 ring-white/10">
            <button aria-label="Decrease quantity" className="flex h-12 w-12 items-center justify-center text-silver-200 disabled:opacity-30" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}><Minus className="h-4 w-4" /></button>
            <span className="w-8 text-center font-display text-lg font-bold text-white" aria-live="polite">{qty}</span>
            <button aria-label="Increase quantity" className="flex h-12 w-12 items-center justify-center text-silver-200 disabled:opacity-30" disabled={qty >= 20} onClick={() => setQty((q) => q + 1)}><Plus className="h-4 w-4" /></button>
          </div>
          <Button size="lg" className="flex-1" disabled={!item.is_available || missing.length > 0} onClick={save}>
            {!item.is_available ? 'Currently unavailable' : `${editing ? 'Update' : 'Add'} · ${money(unit * qty)}`}
          </Button>
        </div>
      }>
      <ItemImage item={item} className="h-56 w-full sm:h-64" />
      <div className="space-y-5 p-5">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-2xl font-bold text-white">{item.name}</h2>
            <div className="shrink-0 font-display text-lg font-semibold text-brand-200">{money(item.price_fils)}</div>
          </div>
          <p className="mt-1.5 text-sm text-silver-300">{item.description}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone="silver"><Clock className="h-3 w-3" /> ~{item.prep_minutes} min</Badge>
            {item.calories != null && <Badge tone="silver"><Flame className="h-3 w-3" /> {item.calories} kcal</Badge>}
            {item.dietary.map((d) => <Badge key={d} tone={d === 'contains-nuts' ? 'amber' : 'green'}>{d !== 'contains-nuts' && <Leaf className="h-3 w-3" />}{DIET_LABEL[d] ?? d}</Badge>)}
          </div>
        </div>

        {groups.map((g) => (
          <fieldset key={g.key}>
            <legend className="mb-2 flex w-full items-center justify-between text-sm font-semibold text-white">
              {g.name}
              <span className="text-xs font-medium text-silver-500">{g.kind === 'EXTRA' ? 'Optional · choose any' : 'Required · choose 1'}</span>
            </legend>
            <div className="space-y-2">
              {g.options.map((o) => {
                const checked = g.kind === 'EXTRA' ? extras.includes(o.id) : choice[g.key] === o.id;
                return (
                  <label key={o.id} className={cx('flex cursor-pointer items-center gap-3 rounded-xl px-3.5 py-3 ring-1 ring-inset transition',
                    checked ? 'bg-brand-500/15 ring-brand-500/50' : 'bg-ink-900 ring-white/10', !o.is_available && 'cursor-not-allowed opacity-40')}>
                    <input type={g.kind === 'EXTRA' ? 'checkbox' : 'radio'} name={g.key} className="h-4 w-4 accent-violet-500" disabled={!o.is_available} checked={checked}
                      onChange={() => g.kind === 'EXTRA'
                        ? setExtras((x) => (x.includes(o.id) ? x.filter((y) => y !== o.id) : [...x, o.id]))
                        : setChoice((c) => ({ ...c, [g.key]: o.id }))} />
                    <span className="flex-1 text-sm text-silver-100">{o.name}{!o.is_available && ' (unavailable)'}</span>
                    <span className="text-sm text-silver-400">{o.price_delta_fils ? `${o.price_delta_fils > 0 ? '+' : '−'}${money(Math.abs(o.price_delta_fils))}` : ''}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div>
          <label htmlFor="notes" className="mb-2 block text-sm font-semibold text-white">Special instructions <span className="font-normal text-silver-500">(optional)</span></label>
          <Textarea id="notes" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. No sugar, extra hot, allergy information…" />
        </div>
      </div>
    </Modal>
  );
}
