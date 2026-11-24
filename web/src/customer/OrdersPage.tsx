import { Link } from 'react-router-dom';
import { ChevronRight, ClipboardList } from 'lucide-react';
import { money, time } from '../lib/format';
import { Button, Card, EmptyState, OrderStatusBadge } from '../components/ui';
import { useCustomer } from './CustomerApp';

export default function OrdersPage() {
  const { orders, ctx } = useCustomer();
  if (!orders.length) {
    return <EmptyState icon={<ClipboardList className="h-7 w-7" />} title="No orders yet" body={`Orders you place at Table ${String(ctx.table.number).padStart(2, '0')} will appear here.`}
      action={<Link to="/menu"><Button>Browse menu</Button></Link>} />;
  }
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-white">My orders</h1>
      {orders.map((o) => (
        <Link key={o.id} to={`/order/${o.id}`} className="block">
          <Card className="flex items-center gap-3 p-4 transition hover:ring-brand-500/40">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="font-display font-semibold text-white">#{o.order_number}</span><OrderStatusBadge status={o.status} /></div>
              <div className="mt-1 truncate text-sm text-silver-400">{o.items.map((i) => `${i.quantity}× ${i.item_name}`).join(', ')}</div>
              <div className="mt-1 text-xs text-silver-500">{time(o.created_at)} · {money(o.total_fils)}</div>
            </div>
            <ChevronRight className="h-5 w-5 text-silver-500" />
          </Card>
        </Link>
      ))}
    </div>
  );
}
