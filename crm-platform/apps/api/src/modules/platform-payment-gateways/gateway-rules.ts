import {
  credentialFieldsFor,
  webhookFieldKeys,
} from '../../infra/providers/platform-payment-gateways';

/**
 * Pure rules of the gateway configuration (WD-PAYGW-003, 004, 006, 027 rule 1). No database, no crypto: the services call
 * these with already-decrypted maps so every rule is testable on its own.
 */

export type Credentials = Record<string, string>;

export interface MergeResult {
  merged: Credentials;
  /** Keys written in this submission (keys only: values never go to the audit trail). */
  keysSet: string[];
  keysCleared: string[];
}

/**
 * Starts from what is stored; a submitted key overwrites it only when the schema declares the key AND the value is non-blank,
 * so an unknown key can never be injected and a blank field keeps the stored secret (WaDesk). Unlike WaDesk a credential can
 * also be removed, by naming it in `clear` (explicit, never by leaving a box empty).
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
  for (const [k, v] of Object.entries(submitted ?? {})) {
    if (allowed.has(k) && v.trim() !== '') {
      merged[k] = v.trim();
      keysSet.push(k);
    }
  }
  for (const k of clear ?? []) {
    if (allowed.has(k) && k in merged && !keysSet.includes(k)) {
      delete merged[k];
      keysCleared.push(k);
    }
  }
  return { merged, keysSet, keysCleared };
}

const isBlank = (v: string | undefined): boolean => v === undefined || v.trim() === '';

/**
 * Required fields still empty. WaDesk used PHP `empty()`, which also treats the string "0" as empty; a real value of "0" is not
 * a credential anyone has, but blank-only is the honest rule and is what is reproduced here.
 */
export function missingRequired(slug: string, creds: Credentials): string[] {
  return credentialFieldsFor(slug)
    .filter((f) => f.required && isBlank(creds[f.key]))
    .map((f) => f.key);
}

/**
 * Webhook state (WD-PAYGW-027 rule 1): the gateway declares signing fields but none holds a value, so provider notifications
 * cannot be authenticated and must be refused.
 */
export function webhookSecretMissing(slug: string, creds: Credentials): boolean {
  const keys = webhookFieldKeys(slug);
  return keys.length > 0 && keys.every((k) => isBlank(creds[k]));
}

/** Empty or NULL whitelist accepts everything; otherwise case-insensitive membership. */
export function acceptsCurrency(
  whitelist: readonly string[] | null | undefined,
  code: string,
): boolean {
  if (!whitelist || whitelist.length === 0) return true;
  const c = code.toUpperCase();
  return whitelist.some((x) => x.toUpperCase() === c);
}

/**
 * Currencies a buyer can choose (WD-PAYGW-006 rule 2): the enabled platform currencies, narrowed to what the active gateways
 * accept. Any active gateway with an empty whitelist, an empty union, or an empty intersection leaves every enabled currency.
 */
export function availableCurrencies(
  enabled: readonly string[],
  activeWhitelists: ReadonlyArray<readonly string[] | null>,
): string[] {
  const all = [...new Set(enabled.map((c) => c.toUpperCase()))].sort();
  if (activeWhitelists.length === 0 || activeWhitelists.some((w) => !w || w.length === 0))
    return all;
  const union = new Set(activeWhitelists.flatMap((w) => (w ?? []).map((c) => c.toUpperCase())));
  const inter = all.filter((c) => union.has(c));
  return inter.length > 0 ? inter : all;
}
