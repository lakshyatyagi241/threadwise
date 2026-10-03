/**
 * `wa_storefronts.payment_config_json` (WD-STORE-008): `{handle}` for the static providers, `{key_id, key_secret,
 * webhook_secret}` for `razorpay_api` with the two secrets encrypted at rest. `key_id` is plain and is shown back.
 */
export interface StoredRazorpayConfig {
  key_id?: string;
  key_secret?: string;
  webhook_secret?: string;
  handle?: string;
}

export interface PaymentConfigInput {
  provider: string | null;
  handle?: string | null;
  rzpKeyId?: string | null;
  rzpKeySecret?: string | null;
  rzpWebhookSecret?: string | null;
}

const present = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * What the settings form saves. For `razorpay_api` a blank field keeps the stored value (a typed secret is encrypted and
 * replaces it) and empty results are dropped; there is no way to clear one through the form. For any other provider the
 * config becomes `{handle}` when one was typed, else null, so switching AWAY from Razorpay drops the stored keys (exactly
 * WaDesk, recorded as a kept behavior).
 */
export function buildPaymentConfig(
  input: PaymentConfigInput,
  existing: StoredRazorpayConfig | null,
  encrypt: (plain: string) => string,
): StoredRazorpayConfig | null {
  if (input.provider === 'razorpay_api') {
    const old = existing ?? {};
    const keyId = (input.rzpKeyId ?? '').trim() || old.key_id;
    const keySecret = (input.rzpKeySecret ?? '').trim()
      ? encrypt((input.rzpKeySecret ?? '').trim())
      : old.key_secret;
    const webhookSecret = (input.rzpWebhookSecret ?? '').trim()
      ? encrypt((input.rzpWebhookSecret ?? '').trim())
      : old.webhook_secret;
    const out: StoredRazorpayConfig = {};
    if (present(keyId)) out.key_id = keyId;
    if (present(keySecret)) out.key_secret = keySecret;
    if (present(webhookSecret)) out.webhook_secret = webhookSecret;
    return Object.keys(out).length > 0 ? out : null;
  }
  return present(input.handle) ? { handle: input.handle } : null;
}

export interface RazorpayCredentialsPlain {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/** The stored config with the secrets decrypted. A value that cannot be decrypted reads as empty: the link is not minted and the webhook is refused (fail closed). */
export function readRazorpayConfig(
  stored: Record<string, unknown> | null | undefined,
  decrypt: (cipher: string) => string,
): RazorpayCredentialsPlain {
  const raw = (stored ?? {}) as StoredRazorpayConfig;
  const dec = (v: unknown): string => {
    if (!present(v)) return '';
    try {
      return decrypt(v);
    } catch {
      return '';
    }
  };
  return {
    keyId: present(raw.key_id) ? raw.key_id : '',
    keySecret: dec(raw.key_secret),
    webhookSecret: dec(raw.webhook_secret),
  };
}

/** Link minting needs the provider and both the key id and the key secret. */
export function supportsLinks(provider: string | null, creds: RazorpayCredentialsPlain): boolean {
  return provider === 'razorpay_api' && creds.keyId !== '' && creds.keySecret !== '';
}
