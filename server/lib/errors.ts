export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Please sign in to continue') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string, code = 'CONFLICT') => new HttpError(409, code, msg);

const DB_CODE_STATUS: Record<string, number> = {
  INVALID_TRANSITION: 409,
  ORDER_TAKEN: 409,
  ORDER_LOCKED: 409,
  ORDER_IMMUTABLE: 403,
  PAYMENT_IMMUTABLE: 403,
  REQUEST_IMMUTABLE: 403,
  FORBIDDEN: 403,
  TABLE_DISABLED: 409,
  REVIEW_NOT_ALLOWED: 409,
  PAYMENT_AMOUNT_MISMATCH: 400,
};

/** Translate Postgres errors (RLS, constraints, our trigger exceptions) into useful HTTP errors. */
export function fromDbError(err: any): HttpError | null {
  if (!err || typeof err.code !== 'string') return null;
  if (err.code === 'P0001' && typeof err.message === 'string') {
    const m = /^([A-Z_]+): (.*)$/s.exec(err.message);
    if (m) return new HttpError(DB_CODE_STATUS[m[1]] ?? 400, m[1], m[2]);
    return new HttpError(400, 'RULE_VIOLATION', err.message);
  }
  if (err.code === '42501') return new HttpError(403, 'FORBIDDEN', 'You do not have permission to do that');
  if (err.code === '23505') return new HttpError(409, 'DUPLICATE', duplicateMessage(err.constraint));
  if (err.code === '23503') return new HttpError(409, 'IN_USE', 'This record is referenced by other records and cannot be changed this way');
  if (err.code === '23514') return new HttpError(400, 'INVALID_VALUE', `A value is out of the allowed range (${err.constraint ?? 'check'})`);
  if (err.code === '22P02') return new HttpError(400, 'INVALID_ID', 'Invalid identifier');
  return null;
}

function duplicateMessage(constraint?: string) {
  switch (constraint) {
    case 'payments_one_active_per_order': return 'This order already has an active payment';
    case 'customer_requests_one_open': return 'You already have an open request of this type — staff are on their way';
    case 'users_email_uq': return 'A user with this email already exists';
    case 'restaurant_tables_restaurant_id_number_key': return 'A table with this number already exists';
    case 'waiter_assignments_one_active': return 'This table already has an assigned waiter';
    case 'reviews_order_id_key': return 'This order has already been reviewed';
    case 'menu_categories_restaurant_id_slug_key': return 'A category with this name already exists';
    case 'inventory_items_name_uq': return 'An inventory item with this name already exists';
    default: return 'This record already exists';
  }
}
