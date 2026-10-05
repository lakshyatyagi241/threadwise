import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentLinkRequest } from './razorpay.port';

export const RAZORPAY_API = 'https://api.razorpay.com/v1';
/** Razorpay will not create a link below this amount (minor units). */
export const RAZORPAY_MIN_AMOUNT_MINOR = 100;

/** The body of `POST /payment_links`, exactly the fields WaDesk sent. Empty customer fields are left out. */
export function buildPaymentLinkBody(req: PaymentLinkRequest): Record<string, unknown> {
  const customer = Object.fromEntries(
    Object.entries(req.customer).filter(([, v]) => typeof v === 'string' && v !== ''),
  );
  return {
    amount: req.amountMinor,
    currency: req.currency.toUpperCase(),
    accept_partial: false,
    reference_id: req.referenceId,
    description: req.description,
    customer,
    // The link is delivered over WhatsApp by us, so Razorpay's own messages stay off.
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: req.notes,
    callback_url: req.callbackUrl,
    callback_method: 'get',
  };
}

export const basicAuthHeader = (keyId: string, keySecret: string): string =>
  `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

/**
 * HMAC-SHA256 of the raw body with the shop's webhook secret, compared in constant time with the `X-Razorpay-Signature`
 * header. A missing secret or header never verifies (fail closed).
 */
export function verifyRazorpaySignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = signature.trim().toLowerCase();
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export const signRazorpayBody = (rawBody: Buffer | string, secret: string): string =>
  createHmac('sha256', secret).update(rawBody).digest('hex');
