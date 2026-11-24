import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}. See .env.example`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  /** Connection used by the API at runtime — must be the non-owner role "icons_app" so RLS applies. */
  databaseUrl: req('DATABASE_URL'),
  /** Owner connection, only used by migrations / seed scripts. */
  migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL ?? '',
  jwtSecret: (() => {
    const s = req('JWT_SECRET');
    if (s.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
    return s;
  })(),
  /** Public base URL used in QR codes and payment redirects, e.g. https://order.iconscoffee.ae */
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, ''),
  restaurantSlug: process.env.RESTAURANT_SLUG ?? 'icons-coffee',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  },
  demoMode: process.env.DEMO_MODE === 'true',
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
};

export const stripeConfigured = () => config.stripe.secretKey.length > 0;
