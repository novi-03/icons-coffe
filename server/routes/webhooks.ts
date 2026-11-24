import { Router, raw } from 'express';
import { constructWebhookEvent, verifyOnlinePayment } from '../services/payments.js';

/**
 * Stripe webhook (configure the endpoint https://<PUBLIC_URL>/api/webhooks/stripe in the
 * Stripe dashboard and set STRIPE_WEBHOOK_SECRET). The signature is verified and the
 * payment state is then re-read from the Stripe API before anything is recorded.
 */
export const webhooksRouter = Router();

webhooksRouter.post('/stripe', raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const event = constructWebhookEvent(req.body as Buffer, req.headers['stripe-signature'] as string | undefined);
  const handled = ['checkout.session.completed', 'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed', 'checkout.session.expired'];
  if (handled.includes(event.type)) {
    const s = event.data.object as { metadata?: Record<string, string> };
    const paymentId = s.metadata?.payment_id;
    const restaurantId = s.metadata?.restaurant_id;
    if (paymentId && restaurantId) await verifyOnlinePayment(restaurantId, paymentId);
  }
  res.json({ received: true });
});
