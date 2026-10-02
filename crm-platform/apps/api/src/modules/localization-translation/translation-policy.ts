import { createHash } from 'node:crypto';
import {
  RESIDENCY_ALLOWED_PROVIDERS,
  UNOFFICIAL_PROVIDER_SLUGS,
  type DataResidency,
  type TranslationProviderSlug,
} from '@crm/contracts';
import { DRIVERS, isKnownProvider } from '../../infra/providers/localization-translation/drivers';
import type { Credentials } from '../../infra/providers/localization-translation/translation-driver.port';

/**
 * The rules that decide WHICH providers may see a piece of customer text (WD-I18N-018, 019, 020). Pure, so the whole
 * routing matrix is unit-tested without a database or a network.
 */

export interface ProviderRow {
  slug: string;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  /** Stable tie-break (the row's internal id). */
  rank: number;
  credentials: Credentials;
}

export interface RoutePolicy {
  /** Platform lockdown: official providers only. */
  lockdown: boolean;
  /** The calling workspace's residency mode. */
  residency: DataResidency;
}

export interface ChainEntry {
  slug: TranslationProviderSlug;
  credentials: Credentials;
}

/** The credential keys a provider still needs before it may be switched on. */
export function missingCredentials(slug: string, credentials: Credentials): string[] {
  if (!isKnownProvider(slug)) return [];
  return DRIVERS[slug].credentialFields
    .filter((f) => f.required && !credentials[f.key]?.trim())
    .map((f) => f.key);
}

/** May this provider receive text under the policy? */
export function providerAllowed(slug: TranslationProviderSlug, policy: RoutePolicy): boolean {
  if (policy.lockdown && UNOFFICIAL_PROVIDER_SLUGS.includes(slug)) return false;
  if (policy.residency !== 'any') {
    return RESIDENCY_ALLOWED_PROVIDERS[policy.residency].includes(slug);
  }
  return true;
}

/**
 * Active providers, default first, then by sort order and rank; unknown slugs, lockdown and residency filter the rest.
 *
 * WaDesk always appended an unconfigured MyMemory as a last resort, even when the operator had switched MyMemory off.
 * Here that fallback exists only when the table has no MyMemory row at all (an install that never seeded it), so
 * "disabled" means disabled.
 */
export function buildChain(rows: readonly ProviderRow[], policy: RoutePolicy): ChainEntry[] {
  const chain = rows
    .filter((r) => r.isActive && isKnownProvider(r.slug))
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder || a.rank - b.rank,
    )
    .map((r) => ({ slug: r.slug as TranslationProviderSlug, credentials: r.credentials }))
    .filter((e) => providerAllowed(e.slug, policy));

  const hasMyMemoryRow = rows.some((r) => r.slug === 'mymemory');
  if (!hasMyMemoryRow && providerAllowed('mymemory', policy)) {
    chain.push({ slug: 'mymemory', credentials: {} });
  }
  return chain;
}

/**
 * The cache namespace carries the policy so a translation obtained under one set of rules is never served under a
 * stricter one (WaDesk cached by text alone, so a lockdown did not stop a free provider's old answers).
 */
export function cacheKey(
  kind: 'pair' | 'auto',
  lang: string,
  text: string,
  policy: RoutePolicy,
): string {
  const scope = `${policy.lockdown ? 'L' : 'o'}${policy.residency}`;
  const digest = createHash('md5').update(text).digest('hex');
  return `translate:${kind}:${lang}:${scope}:${digest}`;
}

/** Base language in lower case; `zh-CN` becomes `zh`. */
export const normalizeLang = (code: string): string =>
  code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
