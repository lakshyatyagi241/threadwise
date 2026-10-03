import { timingSafeEqual } from 'node:crypto';
import type { WhatsappSignatureScheme } from '@crm/contracts';

/**
 * How a delivery of a registry provider proves where it came from. Pure: the webhook service gathers the facts (the provider of each
 * number in the payload, the raw body, the headers) and this decides. The default posture is to REFUSE: a provider that has a scheme
 * but no stored secret for it accepts nothing, and only `none` lets a delivery through on the URL secret alone.
 */

/** The header Meta (and any Meta-style BSP) puts the body signature in. */
export const META_SIGNATURE_HEADER = 'x-hub-signature-256';

export interface DeliveryProvider {
  key: string;
  signatureScheme: WhatsappSignatureScheme;
  /** Header that carries the secret (`shared_secret_header`). */
  signatureHeaderName: string | null;
  appSecret?: string;
  webhookSecret?: string;
}

export interface Delivery {
  /** Lower-case header name to its value. */
  header: (name: string) => string | undefined;
  /** The secret in the callback URL (`?k=`) matched the one we registered. */
  urlKeyValid: boolean;
  /** HMAC check of the raw body against the signature header, for one secret (the platform's verifier). */
  signatureMatches: (signatureHeader: string, secret: string) => boolean;
}

export type SchemeVerdict =
  { ok: true; via: 'signature' | 'shared_secret' | 'url_key' } | { ok: false; reason: string };

export function verifyProviderDelivery(p: DeliveryProvider, d: Delivery): SchemeVerdict {
  switch (p.signatureScheme) {
    case 'meta_app_secret_sha256': {
      const header = d.header(META_SIGNATURE_HEADER);
      if (!header) return { ok: false, reason: `${p.key}: missing signature` };
      if (!p.appSecret) return { ok: false, reason: `${p.key}: no app secret stored` };
      return d.signatureMatches(header, p.appSecret)
        ? { ok: true, via: 'signature' }
        : { ok: false, reason: `${p.key}: invalid signature` };
    }
    case 'shared_secret_header': {
      const name = p.signatureHeaderName?.toLowerCase();
      if (!name) return { ok: false, reason: `${p.key}: no signature header configured` };
      const header = d.header(name);
      if (!header) return { ok: false, reason: `${p.key}: missing signature` };
      if (!p.webhookSecret) return { ok: false, reason: `${p.key}: no webhook secret stored` };
      return safeEqual(header.trim(), p.webhookSecret)
        ? { ok: true, via: 'shared_secret' }
        : { ok: false, reason: `${p.key}: invalid signature` };
    }
    case 'none':
      return d.urlKeyValid
        ? { ok: true, via: 'url_key' }
        : { ok: false, reason: `${p.key}: missing URL key` };
    default:
      return { ok: false, reason: `${p.key}: unknown signature scheme` };
  }
}

/** Every provider in the payload must be satisfied; the first refusal is the answer. Empty list: nothing to add, the caller's own rule stands. */
export function verifyPayloadProviders(
  providers: readonly DeliveryProvider[],
  d: Delivery,
): SchemeVerdict | null {
  if (providers.length === 0) return null;
  let last: SchemeVerdict = { ok: false, reason: 'no provider' };
  for (const p of providers) {
    last = verifyProviderDelivery(p, d);
    if (!last.ok) return last;
  }
  return last;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
