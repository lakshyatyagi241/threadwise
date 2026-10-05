import {
  MARKET_SLUG_RE,
  needsReconsent,
  newScopes,
  type MarketLock,
  type MarketVersionStatus,
} from '@crm/contracts';

/**
 * The pure rules of the Marketplace: no database, no clock, no framework. The services decide what to load; these decide what it means.
 */

/** Normalises a requested name so "Just Dial", "JustDial" and "justdial!" are one request. */
export function requestNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 80);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type AppRef = { by: 'uuid'; value: string } | { by: 'slug'; value: string };
/** An app is addressed by uuid or slug; anything else is not an address. */
export function parseAppRef(ref: string): AppRef | null {
  if (UUID_RE.test(ref)) return { by: 'uuid', value: ref.toLowerCase() };
  return MARKET_SLUG_RE.test(ref) ? { by: 'slug', value: ref } : null;
}

// --- consent ------------------------------------------------------------------------------------------------------------------------------

/** The scopes the admin confirmed must be exactly the scopes the version asks for: not fewer (they did not see them all), not more. */
export function consentProblems(
  requested: readonly string[],
  accepted: readonly string[],
): { missing: string[]; extra: string[] } {
  return { missing: newScopes(accepted, requested), extra: newScopes(requested, accepted) };
}
export const consentMatches = (
  requested: readonly string[],
  accepted: readonly string[],
): boolean => {
  const p = consentProblems(requested, accepted);
  return p.missing.length === 0 && p.extra.length === 0;
};

export type UpgradeDecision =
  /** The new version asks for nothing that was not granted: the installation moves to it at once, with the narrower grant. */
  | { kind: 'upgrade'; granted: string[] }
  /** It asks for more: the installation keeps running on its old version until the admin accepts. */
  | { kind: 'consent'; added: string[] };

export function decideUpgrade(
  granted: readonly string[],
  versionScopes: readonly string[],
): UpgradeDecision {
  return needsReconsent(granted, versionScopes)
    ? { kind: 'consent', added: newScopes(granted, versionScopes) }
    : { kind: 'upgrade', granted: [...new Set(versionScopes)].sort() };
}

// --- version and app lifecycle ---------------------------------------------------------------------------------------------------------------

export type VersionAction = 'edit' | 'submit' | 'approve' | 'reject' | 'publish';

const VERSION_ALLOWED: Record<VersionAction, readonly MarketVersionStatus[]> = {
  edit: ['draft', 'rejected'],
  submit: ['draft', 'rejected'],
  approve: ['draft', 'in_review'],
  reject: ['draft', 'in_review'],
  publish: ['approved'],
};
export const versionAllows = (status: MarketVersionStatus, action: VersionAction): boolean =>
  VERSION_ALLOWED[action].includes(status);

// --- locks -----------------------------------------------------------------------------------------------------------------------------------------

export interface LockFacts {
  planFeature: string | null;
  planFeatureOn: boolean;
  moduleSlug: string | null;
  moduleOn: boolean;
  installed: boolean;
  installedCount: number;
  /** 0 = unlimited. */
  cap: number;
}

/** Why a workspace cannot install an app now, or null. An app already installed is never locked (it can be managed and removed). */
export function lockOf(f: LockFacts, upgradeUrl: string): MarketLock | null {
  if (f.installed) return null;
  if (f.moduleSlug && !f.moduleOn)
    return { reason: 'module_disabled', key: f.moduleSlug, upgradeUrl: null };
  if (f.planFeature && !f.planFeatureOn)
    return { reason: 'plan_feature', key: f.planFeature, upgradeUrl };
  if (f.cap > 0 && f.installedCount >= f.cap)
    return { reason: 'limit_reached', key: 'installed_apps', upgradeUrl };
  return null;
}

// --- keyset cursors ---------------------------------------------------------------------------------------------------------------------------------

/** The values of a row's sort keys plus its id, as an opaque cursor. Used only as a WHERE bound, never as authority. */
export function encodeKeyset(keys: readonly string[], id: number): string {
  return Buffer.from(JSON.stringify({ k: keys, i: id }), 'utf8').toString('base64url');
}
export function decodeKeyset(raw: string, width: number): { keys: string[]; id: number } | null {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      k?: unknown;
      i?: unknown;
    };
    if (!Array.isArray(v.k) || v.k.length !== width || !v.k.every((x) => typeof x === 'string'))
      return null;
    if (typeof v.i !== 'number' || !Number.isInteger(v.i)) return null;
    return { keys: v.k as string[], id: v.i };
  } catch {
    return null;
  }
}

/** `%`, `_` and `\` are literal in a search box. */
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
