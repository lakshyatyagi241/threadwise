import type { WebhookPayment } from '../../../infra/providers/platform-payment-gateways';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined;

/**
 * The notification Razorpay sends when a PAYMENT LINK is paid (`payment_link.paid`). The shared Razorpay driver reads the checkout
 * events (`payment.captured`, `order.paid`) whose payment carries our reference in its notes; a link carries it as the link's own
 * `reference_id`, so it is read here. Null for any other event.
 */
export function parseRazorpayLinkPaid(body: unknown): WebhookPayment | null {
  const evt = obj(body);
  if (evt.event !== 'payment_link.paid') return null;
  const payload = obj(evt.payload);
  const link = obj(obj(payload.payment_link).entity);
  const payment = obj(obj(payload.payment).entity);
  const amount = link.amount ?? payment.amount;
  return {
    orderNumber: text(link.reference_id),
    gatewayOrderId: text(link.id),
    gatewayPaymentId: text(payment.id),
    amountMinor: typeof amount === 'number' && Number.isFinite(amount) ? BigInt(amount) : undefined,
    currency: (text(link.currency) ?? text(payment.currency))?.toUpperCase(),
    payload: { razorpay_link: text(link.short_url) ?? null },
  };
}
