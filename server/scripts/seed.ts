/**
 * Seeds ICONS Coffee DEMO DATA. Every generated record is flagged is_demo = true
 * and labelled "DEMO" in the interfaces.
 *
 * Staff passwords are NEVER hardcoded: they are generated randomly at seed time
 * (or taken from DEMO_PASSWORD if you set one) and written to .demo-credentials.json
 * (git-ignored) and printed once.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { demoImageSvg } from './demo-images.js';
import { computeTotals } from '../lib/pricing.js';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
const HISTORY_DAYS = Number(process.env.DEMO_HISTORY_DAYS ?? 60);
const TZ_OFFSET_HOURS = 4; // Asia/Dubai has no DST

// Deterministic PRNG so demo history is reproducible.
let seed = 0x1c0e5;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const randInt = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const token = () => crypto.randomBytes(18).toString('base64url');
const password = () => crypto.randomBytes(9).toString('base64url');
const aed = (n: number) => Math.round(n * 100);

type V = { kind: 'SIZE' | 'VARIATION' | 'EXTRA'; group: string; name: string; delta: number; def?: boolean };
type P = { name: string; desc: string; price: number; prep: number; diet?: string[]; kcal?: number; featured?: boolean; popular?: boolean; weight?: number; variants?: V[]; ingredients?: [string, number][] };

const sizes = (m = 3, l = 6): V[] => [
  { kind: 'SIZE', group: 'Size', name: 'Regular', delta: 0, def: true },
  { kind: 'SIZE', group: 'Size', name: 'Medium', delta: m },
  { kind: 'SIZE', group: 'Size', name: 'Large', delta: l },
];
const milk: V[] = [
  { kind: 'VARIATION', group: 'Milk', name: 'Full cream', delta: 0, def: true },
  { kind: 'VARIATION', group: 'Milk', name: 'Oat milk', delta: 3 },
  { kind: 'VARIATION', group: 'Milk', name: 'Almond milk', delta: 3 },
  { kind: 'VARIATION', group: 'Milk', name: 'Lactose-free', delta: 2 },
];
const coffeeExtras: V[] = [
  { kind: 'EXTRA', group: 'Extras', name: 'Extra espresso shot', delta: 4 },
  { kind: 'EXTRA', group: 'Extras', name: 'Vanilla syrup', delta: 2 },
  { kind: 'EXTRA', group: 'Extras', name: 'Caramel syrup', delta: 2 },
  { kind: 'EXTRA', group: 'Extras', name: 'Hazelnut syrup', delta: 2 },
];

const menu: { key: string; name: string; icon: string; items: P[] }[] = [
  { key: 'coffee', name: 'Coffee', icon: 'coffee', items: [
    { name: 'Signature Latte', desc: 'Our house espresso blend with velvety steamed milk and a hint of Madagascar vanilla.', price: 22, prep: 5, diet: ['vegetarian'], kcal: 190, featured: true, popular: true, weight: 10, variants: [...sizes(), ...milk, ...coffeeExtras], ingredients: [['Espresso Beans', 18], ['Whole Milk', 220]] },
    { name: 'Spanish Latte', desc: 'Double espresso, condensed milk and silky milk — sweet and smooth.', price: 24, prep: 5, diet: ['vegetarian'], kcal: 260, popular: true, weight: 8, variants: [...sizes(), ...milk, ...coffeeExtras], ingredients: [['Espresso Beans', 18], ['Whole Milk', 200]] },
    { name: 'Flat White', desc: 'Ristretto shots with micro-foamed milk for a strong, creamy cup.', price: 20, prep: 4, diet: ['vegetarian'], kcal: 120, weight: 6, variants: [...milk, ...coffeeExtras], ingredients: [['Espresso Beans', 18], ['Whole Milk', 160]] },
    { name: 'Cappuccino', desc: 'Equal parts espresso, steamed milk and airy foam, dusted with cocoa.', price: 20, prep: 4, diet: ['vegetarian'], kcal: 130, weight: 6, variants: [...sizes(), ...milk, ...coffeeExtras], ingredients: [['Espresso Beans', 18], ['Whole Milk', 180]] },
    { name: 'Americano', desc: 'Double espresso lengthened with hot water.', price: 16, prep: 3, diet: ['vegan', 'gluten-free'], kcal: 10, weight: 5, variants: [...sizes(2, 4), coffeeExtras[0]], ingredients: [['Espresso Beans', 18]] },
    { name: 'Espresso', desc: 'A rich double shot of our signature single-origin espresso.', price: 14, prep: 2, diet: ['vegan', 'gluten-free'], kcal: 5, weight: 4, ingredients: [['Espresso Beans', 18]] },
  ] },
  { key: 'hot', name: 'Hot Beverages', icon: 'cup-soda', items: [
    { name: 'Karak Chai', desc: 'Strong black tea simmered with cardamom, saffron and evaporated milk.', price: 10, prep: 4, diet: ['vegetarian', 'gluten-free'], kcal: 140, popular: true, weight: 7, variants: sizes(3, 5), ingredients: [['Black Tea', 6], ['Whole Milk', 120]] },
    { name: 'Matcha Latte', desc: 'Ceremonial-grade Uji matcha whisked with steamed milk.', price: 24, prep: 4, diet: ['vegetarian'], kcal: 170, weight: 4, variants: [...sizes(), ...milk], ingredients: [['Matcha Powder', 4], ['Whole Milk', 220]] },
    { name: 'Hot Chocolate', desc: 'Belgian 54% dark chocolate melted into steamed milk, topped with cream.', price: 22, prep: 5, diet: ['vegetarian'], kcal: 320, weight: 4, variants: [...sizes(), ...milk, { kind: 'EXTRA', group: 'Extras', name: 'Marshmallows', delta: 3 }], ingredients: [['Dark Chocolate', 40], ['Whole Milk', 250]] },
    { name: 'English Breakfast Tea', desc: 'Full-bodied loose-leaf black tea served in a pot.', price: 14, prep: 3, diet: ['vegan', 'gluten-free'], kcal: 5, weight: 2, ingredients: [['Black Tea', 5]] },
  ] },
  { key: 'cold', name: 'Cold Beverages', icon: 'glass-water', items: [
    { name: 'Violet Berry Lemonade', desc: 'Our signature butterfly-pea lemonade with mixed berries and mint.', price: 22, prep: 3, diet: ['vegan', 'gluten-free'], kcal: 140, featured: true, weight: 5 },
    { name: 'Iced Spanish Latte', desc: 'Condensed milk, espresso and cold milk over ice.', price: 26, prep: 4, diet: ['vegetarian'], kcal: 270, popular: true, weight: 8, variants: [...sizes(), ...milk, ...coffeeExtras], ingredients: [['Espresso Beans', 18], ['Whole Milk', 200]] },
    { name: 'Iced Latte', desc: 'Espresso over ice with cold milk.', price: 22, prep: 3, diet: ['vegetarian'], kcal: 150, weight: 6, variants: [...sizes(), ...milk, ...coffeeExtras], ingredients: [['Espresso Beans', 18], ['Whole Milk', 200]] },
    { name: 'Cold Brew', desc: 'Steeped for 18 hours for a smooth, low-acid coffee.', price: 24, prep: 2, diet: ['vegan', 'gluten-free'], kcal: 5, weight: 4, variants: sizes(3, 6) },
    { name: 'Mango Passion Smoothie', desc: 'Alphonso mango, passion fruit and yoghurt.', price: 26, prep: 4, diet: ['vegetarian', 'gluten-free'], kcal: 280, weight: 3 },
    { name: 'Fresh Orange Juice', desc: 'Freshly squeezed Valencia oranges.', price: 20, prep: 3, diet: ['vegan', 'gluten-free'], kcal: 160, weight: 3 },
  ] },
  { key: 'breakfast', name: 'Breakfast', icon: 'egg', items: [
    { name: 'Avocado Toast', desc: 'Smashed avocado on toasted sourdough, chilli flakes, feta and a poached egg.', price: 38, prep: 10, diet: ['vegetarian'], kcal: 480, popular: true, weight: 5, variants: [{ kind: 'EXTRA', group: 'Extras', name: 'Extra poached egg', delta: 5 }, { kind: 'EXTRA', group: 'Extras', name: 'Smoked salmon', delta: 14 }], ingredients: [['Sourdough Bread', 2], ['Avocados', 1], ['Eggs', 1]] },
    { name: 'Shakshuka', desc: 'Eggs baked in spiced tomato and pepper sauce, served with warm bread.', price: 42, prep: 14, diet: ['vegetarian'], kcal: 520, weight: 4, ingredients: [['Eggs', 3]] },
    { name: 'Croissant Benedict', desc: 'Butter croissant, turkey bacon, poached eggs and hollandaise.', price: 44, prep: 12, kcal: 690, weight: 3, ingredients: [['Eggs', 2]] },
    { name: 'Granola Bowl', desc: 'House granola, Greek yoghurt, berries and local Sidr honey.', price: 32, prep: 5, diet: ['vegetarian'], kcal: 410, weight: 3 },
  ] },
  { key: 'main', name: 'Main Course', icon: 'utensils', items: [
    { name: 'Chicken Sandwich', desc: 'Grilled herb chicken, rocket, tomato and garlic aioli on toasted sourdough.', price: 42, prep: 12, kcal: 610, featured: true, popular: true, weight: 8,
      variants: [
        { kind: 'VARIATION', group: 'Bread', name: 'Sourdough', delta: 0, def: true },
        { kind: 'VARIATION', group: 'Bread', name: 'Multigrain', delta: 0 },
        { kind: 'VARIATION', group: 'Bread', name: 'Gluten-free bread', delta: 4 },
        { kind: 'EXTRA', group: 'Extras', name: 'Cheddar cheese', delta: 4 },
        { kind: 'EXTRA', group: 'Extras', name: 'Avocado', delta: 6 },
        { kind: 'EXTRA', group: 'Extras', name: 'Side fries', delta: 9 },
      ], ingredients: [['Chicken Breast', 150], ['Sourdough Bread', 2]] },
    { name: 'Wagyu Burger', desc: 'Wagyu beef patty, caramelised onions, cheddar and truffle mayo in a brioche bun.', price: 68, prep: 16, kcal: 890, popular: true, weight: 5,
      variants: [
        { kind: 'VARIATION', group: 'Doneness', name: 'Medium', delta: 0, def: true },
        { kind: 'VARIATION', group: 'Doneness', name: 'Medium well', delta: 0 },
        { kind: 'VARIATION', group: 'Doneness', name: 'Well done', delta: 0 },
        { kind: 'EXTRA', group: 'Extras', name: 'Extra patty', delta: 22 },
        { kind: 'EXTRA', group: 'Extras', name: 'Beef bacon', delta: 8 },
      ], ingredients: [['Brioche Buns', 1]] },
    { name: 'Truffle Mushroom Pasta', desc: 'Rigatoni with wild mushrooms, parmesan cream and black truffle.', price: 58, prep: 15, diet: ['vegetarian'], kcal: 760, weight: 4 },
    { name: 'Chicken Caesar Salad', desc: 'Romaine, grilled chicken, parmesan, croutons and Caesar dressing.', price: 46, prep: 10, kcal: 520, weight: 3, ingredients: [['Chicken Breast', 120]] },
    { name: 'Halloumi Wrap', desc: 'Grilled halloumi, roasted peppers, pesto and greens in a toasted wrap.', price: 36, prep: 10, diet: ['vegetarian'], kcal: 560, weight: 3 },
  ] },
  { key: 'snacks', name: 'Snacks', icon: 'cookie', items: [
    { name: 'Truffle Fries', desc: 'Crispy fries tossed in truffle oil and parmesan.', price: 26, prep: 8, diet: ['vegetarian'], kcal: 450, popular: true, weight: 5 },
    { name: 'Hummus & Warm Pita', desc: 'Creamy hummus, olive oil, sumac and freshly baked pita.', price: 24, prep: 5, diet: ['vegan'], kcal: 380, weight: 3 },
    { name: 'Spicy Chicken Wings', desc: 'Six wings glazed in a smoky chilli-honey sauce.', price: 34, prep: 12, diet: ['gluten-free'], kcal: 540, weight: 3 },
  ] },
  { key: 'desserts', name: 'Desserts', icon: 'cake-slice', items: [
    { name: 'San Sebastian Cheesecake', desc: 'Burnt Basque cheesecake with a molten centre.', price: 32, prep: 3, diet: ['vegetarian', 'gluten-free'], kcal: 480, featured: true, popular: true, weight: 5, ingredients: [['Cream Cheese', 120]] },
    { name: 'Pistachio Kunafa', desc: 'Crispy kataifi, sweet cheese and Iranian pistachio with rose syrup.', price: 34, prep: 8, diet: ['vegetarian', 'contains-nuts'], kcal: 560, weight: 3, ingredients: [['Pistachios', 30]] },
    { name: 'Chocolate Fondant', desc: 'Warm dark-chocolate fondant with vanilla bean ice cream.', price: 30, prep: 12, diet: ['vegetarian'], kcal: 610, weight: 3, ingredients: [['Dark Chocolate', 60]] },
    { name: 'Sticky Date Cake', desc: 'Medjool date sponge with salted toffee sauce.', price: 28, prep: 6, diet: ['vegetarian'], kcal: 520, weight: 2 },
  ] },
];

// Explicitly entered DEMO inventory quantities (not derived or invented at runtime).
const inventory: { name: string; unit: string; qty: number; low: number }[] = [
  { name: 'Espresso Beans', unit: 'g', qty: 12000, low: 3000 },
  { name: 'Whole Milk', unit: 'ml', qty: 40000, low: 10000 },
  { name: 'Oat Milk', unit: 'ml', qty: 8000, low: 3000 },
  { name: 'Almond Milk', unit: 'ml', qty: 2500, low: 3000 },
  { name: 'Black Tea', unit: 'g', qty: 1500, low: 300 },
  { name: 'Matcha Powder', unit: 'g', qty: 400, low: 150 },
  { name: 'Dark Chocolate', unit: 'g', qty: 3000, low: 800 },
  { name: 'Chicken Breast', unit: 'g', qty: 6000, low: 2000 },
  { name: 'Sourdough Bread', unit: 'pcs', qty: 40, low: 10 },
  { name: 'Brioche Buns', unit: 'pcs', qty: 24, low: 8 },
  { name: 'Avocados', unit: 'pcs', qty: 18, low: 6 },
  { name: 'Eggs', unit: 'pcs', qty: 120, low: 30 },
  { name: 'Cream Cheese', unit: 'g', qty: 4000, low: 1000 },
  { name: 'Pistachios', unit: 'g', qty: 1200, low: 400 },
];

const staff = [
  { email: 'admin@iconscoffee.demo', name: 'Layla Haddad', role: 'admin', color: '#8b5cf6' },
  { email: 'omar@iconscoffee.demo', name: 'Omar Khalid', role: 'waiter', color: '#22c55e', tables: [1, 7], onDuty: true },
  { email: 'sara@iconscoffee.demo', name: 'Sara Mensah', role: 'waiter', color: '#f59e0b', tables: [8, 14], onDuty: true },
  { email: 'arjun@iconscoffee.demo', name: 'Arjun Nair', role: 'waiter', color: '#38bdf8', tables: [15, 20], onDuty: false },
  { email: 'kitchen@iconscoffee.demo', name: 'Marco Rossi', role: 'kitchen', color: '#ef4444' },
  { email: 'aisha@iconscoffee.demo', name: 'Aisha Rahman', role: 'kitchen', color: '#ec4899' },
] as const;

const reviewComments: Record<number, string[]> = {
  5: ['Best Spanish latte in Dubai!', 'Lovely atmosphere and super quick service.', 'The cheesecake is unreal. Will be back.', 'Ordering from the table was so easy.', 'Great coffee, friendly staff.'],
  4: ['Really good food, slightly busy at lunch.', 'Loved the signature latte, fries were a bit salty.', 'Nice place to work from, Wi-Fi was fast.'],
  3: ['Food was fine but took a while.', 'Coffee good, sandwich average.'],
  2: ['Order took longer than expected.'],
  1: ['Wrong item arrived and had to wait again.'],
};

const client = new pg.Client({ connectionString: url });
await client.connect();
const q = (sql: string, params: unknown[] = []) => client.query(sql, params);

async function main() {
  const existing = await q(`select id from restaurants where slug = $1`, [process.env.RESTAURANT_SLUG ?? 'icons-coffee']);
  if (existing.rowCount) {
    console.log('Demo restaurant already exists — run `npm run db:reset` to rebuild from scratch.');
    return;
  }
  await q('begin');
  await q(`select set_config('app.role', 'system', false)`);

  const hours = Array.from({ length: 7 }, () => ({ open: '06:00', close: '02:00', closed: false }));
  const r = await q(
    `insert into restaurants (slug, name, timezone, currency, vat_rate_bps, service_charge_bps, prices_include_tax,
       welcome_message, wifi_ssid, wifi_password, address, phone, opening_hours, order_mode)
     values ($1, 'ICONS Coffee', 'Asia/Dubai', 'AED', 500, 0, true,
       'Welcome to ICONS Coffee. Order from your table — we''ll bring it to you.',
       'ICONS-Guest', 'demo-wifi-2026', 'DEMO DATA · Jumeirah Lake Towers, Dubai, UAE', '+971 4 000 0000', $2, 'AUTO')
     returning id`,
    [process.env.RESTAURANT_SLUG ?? 'icons-coffee', JSON.stringify(hours)],
  );
  const rid: string = r.rows[0].id;
  await q(`select set_config('app.restaurant_id', $1, false)`, [rid]);

  // Staff with generated passwords
  const creds: { role: string; name: string; email: string; password: string }[] = [];
  const userIds: Record<string, string> = {};
  for (const s of staff) {
    const pw = process.env.DEMO_PASSWORD || password();
    const hash = await bcrypt.hash(pw, 11);
    const u = await q(`insert into users (restaurant_id, email, password_hash, full_name, role, is_demo) values ($1,$2,$3,$4,$5,true) returning id`,
      [rid, s.email, hash, s.name, s.role]);
    userIds[s.email] = u.rows[0].id;
    await q(`insert into staff_profiles (user_id, restaurant_id, avatar_color, is_on_duty, phone) values ($1,$2,$3,$4,'DEMO')`,
      [u.rows[0].id, rid, s.color, 'onDuty' in s ? s.onDuty : true]);
    creds.push({ role: s.role, name: s.name, email: s.email, password: pw });
  }
  const adminId = userIds['admin@iconscoffee.demo'];
  const kitchenIds = [userIds['kitchen@iconscoffee.demo'], userIds['aisha@iconscoffee.demo']];

  // 20 tables with unique QR tokens
  const tables: { id: string; number: number; waiter: string | null }[] = [];
  for (let n = 1; n <= 20; n++) {
    const zone = n <= 10 ? 'Indoor' : n <= 16 ? 'Terrace' : 'Window bar';
    const seats = n <= 10 ? 4 : n <= 16 ? 6 : 2;
    const t = await q(`insert into restaurant_tables (restaurant_id, number, label, seats, zone, qr_token, is_demo) values ($1,$2,$3,$4,$5,$6,true) returning id`,
      [rid, n, `Table ${String(n).padStart(2, '0')}`, seats, zone, token()]);
    const w = staff.find((s) => 'tables' in s && n >= s.tables[0] && n <= s.tables[1]);
    const waiterId = w ? userIds[w.email] : null;
    if (waiterId) {
      await q(`insert into waiter_assignments (restaurant_id, table_id, waiter_id, assigned_by) values ($1,$2,$3,$4)`, [rid, t.rows[0].id, waiterId, adminId]);
    }
    tables.push({ id: t.rows[0].id, number: n, waiter: waiterId });
  }

  // Inventory
  const invIds: Record<string, string> = {};
  for (const i of inventory) {
    const row = await q(`insert into inventory_items (restaurant_id, name, unit, quantity, low_stock_threshold, is_demo) values ($1,$2,$3,0,$4,true) returning id`,
      [rid, i.name, i.unit, i.low]);
    invIds[i.name] = row.rows[0].id;
    await q(`insert into inventory_transactions (restaurant_id, inventory_item_id, delta, quantity_after, reason, note, created_by)
             values ($1,$2,$3,0,'RESTOCK','DEMO DATA — opening stock',$4)`, [rid, row.rows[0].id, i.qty, adminId]);
  }

  // Menu
  type Item = { id: string; name: string; price: number; prep: number; weight: number; variants: { id: string; kind: string; group_name: string; name: string; delta: number; def: boolean }[] };
  const items: Item[] = [];
  let catOrder = 0;
  for (const c of menu) {
    const cat = await q(`insert into menu_categories (restaurant_id, name, slug, icon, sort_order) values ($1,$2,$3,$4,$5) returning id`,
      [rid, c.name, c.key === 'hot' ? 'hot-beverages' : c.key === 'cold' ? 'cold-beverages' : c.key === 'main' ? 'main-course' : c.key, c.icon, catOrder++]);
    let order = 0;
    for (const p of c.items) {
      const svg = Buffer.from(demoImageSvg(c.key, p.name));
      const m = await q(`insert into media (restaurant_id, mime, bytes, size_bytes, created_by) values ($1,'image/svg+xml',$2,$3,$4) returning id`,
        [rid, svg, svg.length, adminId]);
      const it = await q(`insert into menu_items (restaurant_id, category_id, name, description, price_fils, image_media_id, prep_minutes,
          is_featured, is_popular, dietary, calories, sort_order, is_demo) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) returning id`,
        [rid, cat.rows[0].id, p.name, p.desc, aed(p.price), m.rows[0].id, p.prep, !!p.featured, !!p.popular, p.diet ?? [], p.kcal ?? null, order++]);
      const itemId = it.rows[0].id;
      const vs: Item['variants'] = [];
      let vo = 0;
      for (const v of p.variants ?? []) {
        const vr = await q(`insert into product_variants (restaurant_id, menu_item_id, kind, group_name, name, price_delta_fils, is_default, sort_order)
          values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [rid, itemId, v.kind, v.group, v.name, aed(v.delta), !!v.def, vo++]);
        vs.push({ id: vr.rows[0].id, kind: v.kind, group_name: v.group, name: v.name, delta: aed(v.delta), def: !!v.def });
      }
      for (const [ing, qty] of p.ingredients ?? []) {
        await q(`insert into menu_item_ingredients (menu_item_id, inventory_item_id, restaurant_id, quantity_per_unit) values ($1,$2,$3,$4)`,
          [itemId, invIds[ing], rid, qty]);
      }
      items.push({ id: itemId, name: p.name, price: aed(p.price), prep: p.prep, weight: p.weight ?? 2, variants: vs });
    }
  }
  await q('commit');

  // ---------------------------------------------------------------------------
  // DEMO sales history (completed orders over the last HISTORY_DAYS days)
  // ---------------------------------------------------------------------------
  const weighted: Item[] = items.flatMap((i) => Array(i.weight).fill(i));
  const settings = { vat_rate_bps: 500, service_charge_bps: 0, prices_include_tax: true };
  const hourWeights = [0, 0, 0, 0, 0, 0, 1, 4, 6, 6, 4, 3, 5, 6, 4, 3, 3, 4, 5, 5, 4, 3, 2, 1];
  const hourPool = hourWeights.flatMap((w, h) => Array(w).fill(h));
  const nowUtc = Date.now();
  const todayLocalMidnightUtc = (() => {
    const local = new Date(nowUtc + TZ_OFFSET_HOURS * 3600_000);
    return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - TZ_OFFSET_HOURS * 3600_000;
  })();
  let orderCount = 0;
  for (let d = HISTORY_DAYS; d >= 0; d--) {
    const dayStart = todayLocalMidnightUtc - d * 86400_000;
    const dow = new Date(dayStart + TZ_OFFSET_HOURS * 3600_000).getUTCDay();
    const weekend = dow === 5 || dow === 6;
    const growth = 1 + (HISTORY_DAYS - d) / (HISTORY_DAYS * 3);
    let n = Math.round(randInt(22, 38) * (weekend ? 1.35 : 1) * growth);
    await q('begin');
    await q(`select set_config('app.role', 'system', true), set_config('app.restaurant_id', $1, true)`, [rid]);
    for (let k = 0; k < n; k++) {
      const hour = pick(hourPool);
      const created = dayStart + hour * 3600_000 + randInt(0, 3599) * 1000;
      if (created > nowUtc - 45 * 60_000) continue; // keep the last 45 minutes for live orders
      const table = pick(tables);
      const lines: { item: Item; qty: number; opts: Item['variants']; unit: number }[] = [];
      const nLines = pick([1, 1, 2, 2, 2, 3, 3, 4]);
      for (let l = 0; l < nLines; l++) {
        const item = pick(weighted);
        const opts: Item['variants'] = [];
        const groups = new Map<string, Item['variants']>();
        for (const v of item.variants) if (v.kind !== 'EXTRA') groups.set(v.group_name, [...(groups.get(v.group_name) ?? []), v]);
        for (const g of groups.values()) opts.push(rand() < 0.65 ? g.find((v) => v.def) ?? g[0] : pick(g));
        const extras = item.variants.filter((v) => v.kind === 'EXTRA');
        if (extras.length && rand() < 0.25) opts.push(pick(extras));
        const unit = item.price + opts.reduce((s, o) => s + o.delta, 0);
        lines.push({ item, qty: rand() < 0.85 ? 1 : 2, opts, unit });
      }
      const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
      const t = computeTotals(subtotal, settings);
      const method = rand() < 0.45 ? 'ONLINE' : rand() < 0.55 ? 'CASH' : 'COUNTER';
      const cancelled = rand() < 0.03;
      const prep = Math.max(...lines.map((l) => l.item.prep));
      const at = (min: number) => new Date(created + min * 60_000).toISOString();
      const acc = randInt(1, 3), ready = acc + prep + randInt(-1, 6), served = ready + randInt(1, 5), done = served + randInt(5, 40);
      const o = await q(
        `insert into orders (restaurant_id, table_id, status, payment_method, subtotal_fils, service_charge_fils, tax_fils, total_fils,
           vat_rate_bps, service_charge_bps, prices_include_tax, est_prep_minutes, serving_waiter_id,
           submitted_at, accepted_at, preparing_at, ready_at, collected_at, served_at, completed_at, cancelled_at, cancel_reason, is_demo, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,500,0,true,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,true,$11) returning id`,
        [rid, table.id, cancelled ? 'CANCELLED' : 'COMPLETED', method, t.subtotal, t.service, t.tax, t.total, prep,
          cancelled ? null : table.waiter ?? userIds['omar@iconscoffee.demo'],
          at(0), cancelled ? null : at(acc), cancelled ? null : at(acc + 1), cancelled ? null : at(ready),
          cancelled ? null : at(served - 1), cancelled ? null : at(served), cancelled ? null : at(done),
          cancelled ? at(2) : null, cancelled ? 'DEMO DATA — customer left before preparation' : null]);
      const oid = o.rows[0].id;
      for (const [pos, l] of lines.entries()) {
        await q(`insert into order_items (order_id, restaurant_id, menu_item_id, item_name, unit_price_fils, quantity, options, line_total_fils, prep_minutes, created_at, position)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [oid, rid, l.item.id, l.item.name, l.unit, l.qty,
            JSON.stringify(l.opts.map((v) => ({ id: v.id, kind: v.kind, group: v.group_name, name: v.name, price_delta_fils: v.delta }))),
            l.unit * l.qty, l.item.prep, at(0), pos]);
      }
      await q(`insert into payments (restaurant_id, order_id, method, status, amount_fils, transaction_ref, confirmed_by, paid_at, is_demo, created_at, failure_reason)
               values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10)`,
        [rid, oid, method, cancelled ? 'CANCELLED' : 'PAID', t.total, `DEMO-${String(++orderCount).padStart(6, '0')}`,
          !cancelled && method !== 'ONLINE' ? table.waiter : null, cancelled ? null : at(method === 'ONLINE' ? 0 : done),
          at(0), cancelled ? 'Order cancelled' : null]);
      if (!cancelled) {
        const k = pick(kitchenIds);
        const w = table.waiter ?? userIds['omar@iconscoffee.demo'];
        await q(`insert into order_events (restaurant_id, order_id, event_type, from_status, to_status, actor_user_id, actor_role, created_at, details) values
          ($1,$2,'STATUS_CHANGED','RECEIVED','ACCEPTED',$3,'kitchen',$5,'{"demo":true}'),
          ($1,$2,'STATUS_CHANGED','ACCEPTED','PREPARING',$3,'kitchen',$6,'{"demo":true}'),
          ($1,$2,'STATUS_CHANGED','PREPARING','READY',$3,'kitchen',$7,'{"demo":true}'),
          ($1,$2,'STATUS_CHANGED','READY','SERVED',$4,'waiter',$8,'{"demo":true}'),
          ($1,$2,'STATUS_CHANGED','SERVED','COMPLETED',$4,'waiter',$9,'{"demo":true}')`,
          [rid, oid, k, w, at(acc), at(acc + 1), at(ready), at(served), at(done)]);
        if (rand() < 0.22) {
          const rating = pick([5, 5, 5, 5, 4, 4, 4, 3, 2, 1]);
          await q(`insert into reviews (restaurant_id, order_id, rating, comment, is_demo, created_at) values ($1,$2,$3,$4,true,$5)`,
            [rid, oid, rating, rand() < 0.8 ? pick(reviewComments[rating]) : null, at(done + 5)]);
        }
      }
    }
    await q('commit');
  }

  // A few live DEMO orders so every interface has something to show right away.
  const live: { table: number; status: string; method: string; lines: [string, number][] }[] = [
    { table: 3, status: 'RECEIVED', method: 'CASH', lines: [['Iced Spanish Latte', 2], ['Avocado Toast', 1]] },
    { table: 9, status: 'PREPARING', method: 'COUNTER', lines: [['Wagyu Burger', 1], ['Truffle Fries', 1], ['Cold Brew', 1]] },
    { table: 12, status: 'READY', method: 'CASH', lines: [['Karak Chai', 2], ['San Sebastian Cheesecake', 1]] },
  ];
  for (const lo of live) {
    const table = tables.find((t) => t.number === lo.table)!;
    const lines = lo.lines.map(([name, qty]) => {
      const item = items.find((i) => i.name === name)!;
      const opts = item.variants.filter((v) => v.def);
      return { item, qty, opts, unit: item.price + opts.reduce((s, o) => s + o.delta, 0) };
    });
    const t = computeTotals(lines.reduce((s, l) => s + l.unit * l.qty, 0), settings);
    await q('begin');
    await q(`select set_config('app.role', 'system', true), set_config('app.restaurant_id', $1, true), set_config('app.user_id', '', true)`, [rid]);
    const o = await q(`insert into orders (restaurant_id, table_id, status, payment_method, subtotal_fils, service_charge_fils, tax_fils, total_fils,
        vat_rate_bps, service_charge_bps, prices_include_tax, est_prep_minutes, is_demo, notes)
        values ($1,$2,'RECEIVED',$3,$4,$5,$6,$7,500,0,true,$8,true,'DEMO DATA') returning id`,
      [rid, table.id, lo.method, t.subtotal, t.service, t.tax, t.total, Math.max(...lines.map((l) => l.item.prep))]);
    const oid = o.rows[0].id;
    for (const [pos, l] of lines.entries()) {
      await q(`insert into order_items (order_id, restaurant_id, menu_item_id, item_name, unit_price_fils, quantity, options, line_total_fils, prep_minutes, position)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [oid, rid, l.item.id, l.item.name, l.unit, l.qty,
          JSON.stringify(l.opts.map((v) => ({ id: v.id, kind: v.kind, group: v.group_name, name: v.name, price_delta_fils: v.delta }))),
          l.unit * l.qty, l.item.prep, pos]);
    }
    await q(`insert into payments (restaurant_id, order_id, method, status, amount_fils, is_demo) values ($1,$2,$3,'PENDING',$4,true)`,
      [rid, oid, lo.method, t.total]);
    await q('commit');
    const steps = lo.status === 'RECEIVED' ? [] : lo.status === 'PREPARING' ? ['ACCEPTED', 'PREPARING'] : ['ACCEPTED', 'PREPARING', 'READY'];
    for (const s of steps) {
      await q('begin');
      await q(`select set_config('app.role', 'kitchen', true), set_config('app.restaurant_id', $1, true), set_config('app.user_id', $2, true)`, [rid, kitchenIds[0]]);
      await q(`update orders set status = $1 where id = $2`, [s, oid]);
      await q('commit');
    }
  }

  const file = path.resolve(import.meta.dirname, '../../.demo-credentials.json');
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), note: 'DEMO DATA accounts. Keep private; regenerate with npm run db:reset.', accounts: creds }, null, 2), { mode: 0o600 });
  const stats = await q(`select (select count(*) from orders) orders, (select count(*) from reviews) reviews, (select count(*) from menu_items) items`);
  console.log(`\nSeeded ICONS Coffee DEMO DATA: ${stats.rows[0].items} menu items, 20 tables, ${stats.rows[0].orders} orders, ${stats.rows[0].reviews} reviews.`);
  console.log(`Demo staff accounts written to ${file}:`);
  for (const c of creds) console.log(`  ${c.role.padEnd(8)} ${c.email.padEnd(28)} ${c.password}`);
}

try {
  await main();
} catch (e) {
  await q('rollback').catch(() => {});
  throw e;
} finally {
  await client.end();
}
