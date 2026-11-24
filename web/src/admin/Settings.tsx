import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { useData } from '../lib/hooks';
import { Badge, Button, Card, ErrorBanner, Field, Input, PageLoader, Select, Textarea, Toggle, useToast } from '../components/ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function SettingsPage() {
  const toast = useToast();
  const { data, error, reload } = useData(() => api('/admin/settings'), []);
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { if (data) setF({ ...data.restaurant, vat: (data.restaurant.vat_rate_bps / 100).toString(), svc: (data.restaurant.service_charge_bps / 100).toString() }); }, [data]);
  if (!data || !f) return error ? <ErrorBanner message={error} onRetry={reload} /> : <PageLoader />;
  const int = data.integrations;
  const save = async () => {
    setBusy(true); setSaveError(null);
    try {
      await api('/admin/settings', { method: 'PATCH', body: {
        name: f.name, welcome_message: f.welcome_message || null, wifi_ssid: f.wifi_ssid || null, wifi_password: f.wifi_password || null,
        address: f.address || null, phone: f.phone || null, vat_rate_bps: Math.round(Number(f.vat) * 100), service_charge_bps: Math.round(Number(f.svc) * 100),
        prices_include_tax: f.prices_include_tax, order_mode: f.order_mode, opening_hours: f.opening_hours, delay_grace_minutes: Number(f.delay_grace_minutes),
      } });
      toast({ tone: 'success', title: 'Settings saved', body: 'Customer screens update immediately.' });
      reload();
    } catch (e) { setSaveError(errMsg(e)); } finally { setBusy(false); }
  };
  const setDay = (i: number, p: any) => setF({ ...f, opening_hours: f.opening_hours.map((d: any, j: number) => (j === i ? { ...d, ...p } : d)) });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="space-y-4 p-5">
        <h3 className="font-display font-semibold text-white">Restaurant</h3>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Welcome message"><Textarea rows={2} value={f.welcome_message ?? ''} onChange={(e) => setF({ ...f, welcome_message: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Wi-Fi network"><Input value={f.wifi_ssid ?? ''} onChange={(e) => setF({ ...f, wifi_ssid: e.target.value })} /></Field>
          <Field label="Wi-Fi password"><Input value={f.wifi_password ?? ''} onChange={(e) => setF({ ...f, wifi_password: e.target.value })} /></Field>
          <Field label="Address"><Input value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Phone"><Input value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <h3 className="pt-2 font-display font-semibold text-white">Pricing</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="VAT %"><Input type="number" min={0} max={50} step="0.01" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} /></Field>
          <Field label="Service charge %"><Input type="number" min={0} max={50} step="0.01" value={f.svc} onChange={(e) => setF({ ...f, svc: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-3 text-sm text-silver-200"><Toggle checked={f.prices_include_tax} onChange={(v) => setF({ ...f, prices_include_tax: v })} label="Prices include VAT" />Menu prices include VAT (UAE standard)</label>
        <p className="text-xs text-silver-500">Changes apply to new orders only — existing orders keep the rates they were placed with.</p>
      </Card>
      <Card className="space-y-4 p-5">
        <h3 className="font-display font-semibold text-white">Ordering & hours <Badge tone={data.restaurant.status.isOpen ? 'green' : 'red'} className="ml-2">{data.restaurant.status.label}</Badge></h3>
        <Field label="Order mode"><Select value={f.order_mode} onChange={(e) => setF({ ...f, order_mode: e.target.value })}>
          <option value="AUTO">Follow opening hours</option><option value="OPEN">Force open (accept orders now)</option><option value="CLOSED">Force closed (pause ordering)</option>
        </Select></Field>
        <div className="space-y-2">
          {f.opening_hours.map((d: any, i: number) => (
            <div key={i} className="grid grid-cols-[100px_1fr_1fr_auto] items-center gap-2 text-sm">
              <span className="text-silver-300">{DAYS[i]}</span>
              <Input type="time" className="h-9" value={d.open} disabled={d.closed} onChange={(e) => setDay(i, { open: e.target.value })} aria-label={`${DAYS[i]} opens`} />
              <Input type="time" className="h-9" value={d.close} disabled={d.closed} onChange={(e) => setDay(i, { close: e.target.value })} aria-label={`${DAYS[i]} closes`} />
              <label className="flex items-center gap-1.5 text-xs text-silver-400"><input type="checkbox" className="accent-violet-500" checked={d.closed} onChange={(e) => setDay(i, { closed: e.target.checked })} />Closed</label>
            </div>
          ))}
          <p className="text-xs text-silver-500">Times in {data.restaurant.timezone}. A closing time earlier than opening means the restaurant closes after midnight.</p>
        </div>
        <Field label="Kitchen delay alert after estimate + (minutes)"><Input type="number" min={0} max={120} value={f.delay_grace_minutes} onChange={(e) => setF({ ...f, delay_grace_minutes: e.target.value })} /></Field>
        <h3 className="pt-2 font-display font-semibold text-white">Integrations</h3>
        <div className="space-y-2 text-sm">
          <Integration ok={int.stripe} label="Stripe online payments" hint={int.stripe ? 'Configured — online payments are verified with Stripe.' : 'Missing STRIPE_SECRET_KEY — online payment is disabled for customers.'} />
          <Integration ok={int.stripe_webhook} label="Stripe webhook" hint={int.stripe_webhook ? 'Signature-verified webhook active.' : `Optional: set STRIPE_WEBHOOK_SECRET and point Stripe to ${int.public_url}/api/webhooks/stripe. Payments are still verified on return and by a background reconcile job.`} />
          <Integration ok label="QR code base URL" hint={int.public_url} />
        </div>
      </Card>
      <div className="flex items-center gap-3 xl:col-span-2"><Button size="lg" loading={busy} onClick={save}>Save settings</Button><ErrorBanner message={saveError} /></div>
    </div>
  );
}

function Integration({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-ink-900 px-3 py-2.5 ring-1 ring-white/5">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />}
      <div><div className="font-semibold text-white">{label}</div><div className="break-all text-xs text-silver-400">{hint}</div></div>
    </div>
  );
}
