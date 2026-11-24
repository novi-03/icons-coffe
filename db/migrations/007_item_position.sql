-- Stable line order on tickets/receipts (items inserted in one transaction share created_at).
alter table order_items add column if not exists position integer not null default 0 check (position between 0 and 100);
