import type { StoreGatewaySource } from '@crm/contracts';
import {
  credentialFieldsFor,
  gatewayMeta,
  hasDriver,
  webhookFieldKeys,
} from '../../../infra/providers/platform-payment-gateways';

/**
 * Pure rules of the shared workspace gateway: no database, no crypto. The services hand these already-decrypted maps so every rule
 * is testable on its own (credential merge and masking, which gateway wins, what the legacy keys look like).
 */

export type Credentials = Record<string, string>;

const isBlank = (v: string | undefined): boolean => v === undefined || v.trim() === '';

/** Gateways that take no online payment: nothing to charge, nothing to link. */
const OFFLINE = new Set(['bank_transfer', 'offline']);

/**
 * Gateways whose `initiate` answers a hosted page a buyer opens from a WhatsApp link (a redirect). The others hand the browser a
 * widget or an auto-posting form (Cashfree, PayU, Braintree, HyperPay, Skrill, Authorize.Net) and cannot be sent as a link; Razorpay
 * is linked through its Payment Links API instead of its checkout widget. Chosen by reading the drivers; the runtime still checks
 * the answer and refuses a result with no redirect.
 */
const NO_LINK = new Set(['cashfree', 'payu', 'braintree', 'hyperpay', 'skrill', 'authorize_net']);

export const supportsPaymentLinks = (slug: string): boolean =>
  hasDriver(slug) && !OFFLINE.has(slug) && !NO_LINK.has(slug);

export const gatewayName = (slug: string): string => gatewayMeta(slug)?.name ?? slug;

/** A saved value as the screen may show it: bullets, plus the last four characters when the value is long enough to stay secret. */
export function maskCredential(value: string | undefined): string | null {
  if (isBlank(value)) return null;
  const v = (value as string).trim();
  return v.length >= 12 ? `${'•'.repeat(8)}${v.slice(-4)}` : '•'.repeat(8);
}

export interface MergeResult {
  merged: Credentials;
  /** Keys written in this submission (keys only: values never go to the audit trail). */
  keysSet: string[];
  keysCleared: string[];
  /** Submitted keys the gateway does not declare: refused by the caller. */
  unknown: string[];
}

/**
 * Starts from what is stored; a submitted key overwrites it only when it is declared by the gateway's schema and non-blank, so a
 * blank field keeps the stored secret (WaDesk) and an unknown key can never be injected. A credential is removed only by naming it
 * in `clear` (never by leaving a box empty).
 */
export function mergeCredentials(
  slug: string,
  existing: Credentials,
  submitted: Record<string, string> | undefined,
  clear: readonly string[] | undefined,
): MergeResult {
  const allowed = new Set(credentialFieldsFor(slug).map((f) => f.key));
  const merged = { ...existing };
  const keysSet: string[] = [];
  const keysCleared: string[] = [];
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(submitted ?? {})) {
    if (!allowed.has(k)) {
      unknown.push(k);
      continue;
    }
    if (v.trim() !== '') {
      merged[k] = v.trim();
      keysSet.push(k);
    }
  }
  for (const k of clear ?? []) {
    if (!allowed.has(k)) unknown.push(k);
    else if (k in merged && !keysSet.includes(k)) {
      delete merged[k];
      keysCleared.push(k);
    }
  }
  return { merged, keysSet, keysCleared, unknown };
}

/** Required fields still empty. */
export function missingRequired(slug: string, creds: Credentials): string[] {
  return credentialFieldsFor(slug)
    .filter((f) => f.required && isBlank(creds[f.key]))
    .map((f) => f.key);
}

/** The gateway declares signing fields but none holds a value: provider notifications cannot be authenticated. */
export function webhookSecretMissing(slug: string, creds: Credentials): boolean {
  const keys = webhookFieldKeys(slug);
  return keys.length > 0 && keys.every((k) => isBlank(creds[k]));
}

/** A row can take a payment: a driver exists and every required field has a value. */
export const isConfigured = (slug: string, creds: Credentials): boolean =>
  hasDriver(slug) && missingRequired(slug, creds).length === 0;

/** `live` / `test` as the screens and WaDesk say it; the drivers say `live` / `sandbox`. */
export const toDriverMode = (mode: string): 'live' | 'sandbox' =>
  mode === 'test' ? 'sandbox' : 'live';

/** One configured row of a scope, as the picker sees it. `storefrontId` 0 is the workspace. */
export interface GatewayCandidate {
  id: number;
  storefrontId: number;
  slug: string;
  active: boolean;
  isDefault: boolean;
  sortOrder: number;
  configured: boolean;
}

/** The shop's own Razorpay keys on `wa_storefronts.payment_config_json`, when the shop is set to `razorpay_api` with both keys. */
export interface LegacyCandidate {
  slug: 'razorpay';
}

/** Within one scope: the default row, else the lowest sort order, else the oldest; only active, configured rows (and the slug asked for). */
export function pickRow<T extends GatewayCandidate>(
  rows: readonly T[],
  scope: number,
  slug?: string,
): T | null {
  const usable = rows.filter(
    (r) => r.storefrontId === scope && r.active && r.configured && (!slug || r.slug === slug),
  );
  usable.sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder || a.id - b.id,
  );
  return usable[0] ?? null;
}

export type Pick<T> =
  | { source: Exclude<StoreGatewaySource, 'legacy_storefront'>; row: T }
  | { source: 'legacy_storefront'; row: null }
  | null;

/**
 * Which gateway a checkout or an invoice uses (owner decision 2026-10-05): the shop's own override, else the workspace default,
 * else the keys saved on the shop itself before the shared store existed, else nothing. `slug` narrows every step to one gateway
 * (an operator choosing "Send checkout via Stripe"). Invoices ask with no shop, so the last step never applies to them.
 */
export function chooseGateway<T extends GatewayCandidate>(
  rows: readonly T[],
  storefrontId: number | null,
  legacy: LegacyCandidate | null,
  slug?: string,
): Pick<T> {
  if (storefrontId && storefrontId > 0) {
    const own = pickRow(rows, storefrontId, slug);
    if (own) return { source: 'store_override', row: own };
  }
  const shared = pickRow(rows, 0, slug);
  if (shared) return { source: 'workspace_default', row: shared };
  if (storefrontId && storefrontId > 0 && legacy && (!slug || slug === legacy.slug)) {
    return { source: 'legacy_storefront', row: null };
  }
  return null;
}

/** The keys `wa_storefronts.payment_config_json` and a migrated row's `meta.legacy` carry: key id plain, the two secrets ciphertext. */
export interface LegacyRazorpayRaw {
  key_id?: unknown;
  key_secret?: unknown;
  webhook_secret?: unknown;
}

/**
 * Decodes that shape into the credential map of the `razorpay` gateway. A secret that cannot be decrypted (key rotated away) reads
 * as empty, so the gateway counts as not configured and the webhook is refused: fail closed.
 */
export function decodeLegacyRazorpay(
  raw: LegacyRazorpayRaw | null | undefined,
  decrypt: (cipher: string) => string,
): Credentials {
  const dec = (v: unknown): string => {
    if (typeof v !== 'string' || v === '') return '';
    try {
      return decrypt(v);
    } catch {
      return '';
    }
  };
  const out: Credentials = {};
  if (typeof raw?.key_id === 'string' && raw.key_id !== '') out.key_id = raw.key_id;
  const secret = dec(raw?.key_secret);
  if (secret) out.key_secret = secret;
  const hook = dec(raw?.webhook_secret);
  if (hook) out.webhook_secret = hook;
  return out;
}
