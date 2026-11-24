export type OrderStatus = 'AWAITING_PAYMENT' | 'RECEIVED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'SERVED' | 'COMPLETED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
export type PaymentMethod = 'ONLINE' | 'CASH' | 'COUNTER';

export interface Variant { id: string; kind: 'SIZE' | 'VARIATION' | 'EXTRA'; group_name: string; name: string; price_delta_fils: number; is_default: boolean; is_available: boolean }
export interface MenuItem {
  id: string; category_id: string; name: string; description: string | null; price_fils: number; prep_minutes: number;
  is_available: boolean; is_featured: boolean; is_popular: boolean; dietary: string[]; calories: number | null;
  image_url: string | null; image_media_id: string | null; variants: Variant[]; is_archived: boolean; is_demo: boolean; sort_order: number;
}
export interface Category { id: string; name: string; slug: string; description: string | null; icon: string | null; sort_order: number; is_active: boolean }
export interface OrderItem { id: string; menu_item_id?: string; item_name: string; quantity: number; unit_price_fils?: number; line_total_fils?: number;
  options: { id: string; kind: string; group: string; name: string; price_delta_fils: number }[]; special_instructions: string | null; prep_minutes?: number }
export interface Order {
  id: string; order_number: string; status: OrderStatus; payment_method?: PaymentMethod; payment_status?: PaymentStatus;
  subtotal_fils?: number; service_charge_fils?: number; tax_fils?: number; total_fils?: number; vat_rate_bps?: number; service_charge_bps?: number;
  prices_include_tax?: boolean; est_prep_minutes: number; notes: string | null; priority?: 'NORMAL' | 'RUSH';
  created_at: string; submitted_at: string | null; accepted_at: string | null; preparing_at: string | null; ready_at: string | null;
  collected_at?: string | null; served_at: string | null; completed_at: string | null; cancelled_at: string | null; cancel_reason: string | null;
  table_id: string; table_number: number; items: OrderItem[]; is_demo: boolean;
  serving_waiter_id?: string | null; serving_waiter_name?: string | null; assigned_waiter_id?: string | null; assigned_waiter_name?: string | null;
  open_issues?: number; can_serve?: boolean; review?: { rating: number; comment: string | null } | null; updated_at?: string;
}
export interface Restaurant {
  id: string; name: string; timezone: string; currency: string; vat_rate_bps: number; service_charge_bps: number; prices_include_tax: boolean;
  welcome_message: string | null; wifi_ssid: string | null; wifi_password: string | null; address: string | null; phone: string | null;
  opening_hours: { open: string; close: string; closed: boolean }[]; order_mode: 'AUTO' | 'OPEN' | 'CLOSED';
  status: { isOpen: boolean; label: string };
}
export interface Notification { id: string; type: string; title: string; body: string | null; order_id: string | null; table_id: string | null;
  table_number: number | null; data: any; read_at: string | null; acknowledged_at: string | null; created_at: string }
