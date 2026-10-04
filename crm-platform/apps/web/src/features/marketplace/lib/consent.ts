import {
  missingPermissionKeys,
  type MarketScopeRisk,
  type MarketScopeSummary,
} from '@crm/contracts';

/**
 * Consent is exact: the permission list the person confirms must EQUAL the scopes of the version being installed (fewer or extra is
 * `422 MKT_CONSENT_REQUIRED`). The screens therefore send the ids of the list they showed, never a subset and never more.
 */

const RISK_RANK: Record<MarketScopeRisk, number> = { low: 0, medium: 1, high: 2 };

/** Unique ids, sorted: the canonical form of a permission list. */
export function normalizeScopes(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/** What to send as `acceptedScopes`: the ids of exactly the scopes that were shown. */
export function acceptedScopesFor(shown: ReadonlyArray<Pick<MarketScopeSummary, 'id'>>): string[] {
  return normalizeScopes(shown.map((s) => s.id));
}

export interface ConsentDiff {
  /** Shown but not accepted. */
  missing: string[];
  /** Accepted but never shown. */
  unexpected: string[];
}

export function consentDiff(shown: readonly string[], accepted: readonly string[]): ConsentDiff {
  const s = new Set(shown);
  const a = new Set(accepted);
  return {
    missing: [...s].filter((id) => !a.has(id)).sort(),
    unexpected: [...a].filter((id) => !s.has(id)).sort(),
  };
}

/** Set equality: order and duplicates do not matter. */
export function consentMatches(shown: readonly string[], accepted: readonly string[]): boolean {
  const d = consentDiff(shown, accepted);
  return d.missing.length === 0 && d.unexpected.length === 0;
}

/**
 * The `errors` of a `MKT_CONSENT_REQUIRED` answer: `missing:<scope>` (the version asks for it, the request left it out) and
 * `unexpected:<scope>` (the request had it, the version no longer asks). Anything else (for example `must_equal_pending_scopes`
 * on a re-consent) counts as neither: the caller refetches and shows the whole list again.
 */
export function parseConsentProblems(
  fieldErrors: ReadonlyArray<{ path: string; message: string }>,
): ConsentDiff {
  const missing: string[] = [];
  const unexpected: string[] = [];
  for (const e of fieldErrors) {
    const m = /^(missing|unexpected):(.+)$/.exec(e.message);
    if (!m) continue;
    (m[1] === 'missing' ? missing : unexpected).push(m[2]!);
  }
  return { missing: normalizeScopes(missing), unexpected: normalizeScopes(unexpected) };
}

export interface ScopeChanges {
  /** In the new list, not in the one the person was looking at. */
  added: MarketScopeSummary[];
  /** In the list the person was looking at, no longer asked for. */
  removedIds: string[];
  /** Same id, but its risk, label or description changed. */
  changedIds: string[];
  changed: boolean;
}

/** What differs between the permission list shown earlier and the one the app asks for now: the highlight after a consent mismatch. */
export function scopeChanges(
  before: readonly MarketScopeSummary[],
  after: readonly MarketScopeSummary[],
): ScopeChanges {
  const was = new Map(before.map((s) => [s.id, s]));
  const now = new Map(after.map((s) => [s.id, s]));
  const added = after.filter((s) => !was.has(s.id));
  const removedIds = before.filter((s) => !now.has(s.id)).map((s) => s.id);
  const changedIds = after
    .filter((s) => {
      const old = was.get(s.id);
      return (
        old !== undefined &&
        (old.risk !== s.risk || old.label !== s.label || old.description !== s.description)
      );
    })
    .map((s) => s.id);
  return {
    added,
    removedIds,
    changedIds,
    changed: added.length + removedIds.length + changedIds.length > 0,
  };
}

/** Highest risk first, then by label so the order is stable. */
export function sortByRisk<T extends Pick<MarketScopeSummary, 'risk' | 'label'>>(
  scopes: readonly T[],
): T[] {
  return [...scopes].sort(
    (a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk] || a.label.localeCompare(b.label),
  );
}

/** The highest risk of a list; `low` for none. The overall callout leads with this. */
export function overallRisk(
  scopes: ReadonlyArray<Pick<MarketScopeSummary, 'risk'>>,
): MarketScopeRisk {
  let top: MarketScopeRisk = 'low';
  for (const s of scopes) if (RISK_RANK[s.risk] > RISK_RANK[top]) top = s.risk;
  return top;
}

/** How many scopes carry each risk. */
export function riskCounts(
  scopes: ReadonlyArray<Pick<MarketScopeSummary, 'risk'>>,
): Record<MarketScopeRisk, number> {
  const out: Record<MarketScopeRisk, number> = { low: 0, medium: 0, high: 0 };
  for (const s of scopes) out[s.risk] += 1;
  return out;
}

/**
 * Preflight only: permission keys the signed-in person lacks among those the scopes stand for. The API enforces this
 * (`MKT_SCOPE_EXCEEDS_INSTALLER`), so a warning, never a block.
 */
export function installerGaps(
  scopeIds: readonly string[],
  held: Readonly<Record<string, unknown>>,
): string[] {
  return missingPermissionKeys(scopeIds, (key) => key in held);
}
