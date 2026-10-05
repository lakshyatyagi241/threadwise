import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CheckoutRequest,
  CheckoutResult,
  InvoicePaymentGateway,
  WebhookHeaders,
} from './invoice-payment-gateway.port';

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/** Replay tolerance of a signed webhook: an event older (or further in the future) than this is refused. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Bank transfer: nothing is hosted and nothing can be confirmed by a provider, so the page shows the instructions from the
 * workspace's invoicing profile and a person records the payment when the money arrives. Its webhook verification is always
 * false: there is no such webhook, and a signature check that could pass would be a hole.
 */
export class ManualTransferGateway implements InvoicePaymentGateway {
  readonly provider = 'manual';

  async createCheckout(_request: CheckoutRequest): Promise<CheckoutResult> {
    return { kind: 'instructions' };
  }

  verifyWebhookSignature(): boolean {
    return false;
  }
}

/**
 * A generic signed-webhook receiver, the skeleton real adapters copy. The sender signs `"<t>.<raw body>"` with HMAC-SHA256 and the
 * shared secret and sends `X-Invoice-Signature: t=<unix seconds>,v1=<hex>`. There is no hosted checkout: the buyer pays wherever the
 * integration collects money and that system calls the webhook with the attempt id as the reference.
 */
export class HmacGenericGateway implements InvoicePaymentGateway {
  readonly provider = 'hmac_generic';

  async createCheckout(_request: CheckoutRequest): Promise<CheckoutResult> {
    return { kind: 'instructions' };
  }

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: WebhookHeaders,
    secret: string,
    now: Date = new Date(),
  ): boolean {
    // Fail closed: no secret means nothing can be verified.
    if (!secret || secret.length < 16) return false;
    const header = first(headers['x-invoice-signature']);
    if (!header || header.length > 512) return false;
    let t: string | undefined;
    const sigs: string[] = [];
    for (const part of header.split(',')) {
      const [k, v] = part.trim().split('=');
      if (k === 't' && v) t = v;
      else if (k === 'v1' && v) sigs.push(v);
    }
    if (!t || !/^\d{1,12}$/.test(t) || sigs.length === 0) return false;
    if (Math.abs(now.getTime() / 1000 - Number(t)) > WEBHOOK_TOLERANCE_SECONDS) return false;

    const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
    return sigs.some((sig) => {
      if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
      return timingSafeEqual(expected, Buffer.from(sig, 'hex'));
    });
  }
}
