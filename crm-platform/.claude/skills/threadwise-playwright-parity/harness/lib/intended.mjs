// Differences from Reference that are ALLOWED because this repo's architecture says so. A rule only matches a
// narrow, mechanical signal. Everything else that differs is a defect until a human records it as intended
// in the feature's twin spec (`intended: [{scenario, key, rule|quirk, reason}]`, reason is mandatory).
//
// The rule ids and references mirror threadwise-verify-parity's list of legal reasons. Add a rule here only when the
// repo decided it (ADR / CONTRIBUTING); do not add one to make a finding go away.

export const RULES = [
  {
    id: 'cursor-pagination',
    ref: 'verify-parity: cursor pagination instead of page numbers/totals',
    match: (f) =>
      /^ui\.pagination\.(kind|showsTotal)$/.test(f.key) ||
      (/^ui\.table\.\d+\.sortableHeaders$/.test(f.key) && f.ours < f.threadwise),
    reason: 'lists use cursor "load more" with server-side filters and no totals',
  },
  {
    id: 'uuid-ids',
    ref: 'CONTRIBUTING 4: internal ids never leave the system',
    match: (f) => f.key === 'enum.idStyle',
    reason: 'responses and URLs carry uuids, never bigint ids',
  },
  {
    id: 'problem-json',
    ref: 'CONTRIBUTING: errors are AppError with a stable code (problem+json)',
    match: (f) => f.key === 'enum.errorFormat',
    reason: 'errors are problem+json with a stable code, not HTML redirects with flash messages',
  },
  {
    id: 'hard-delete-audit',
    ref: 'verify-parity: hard delete + audit instead of soft delete',
    match: (f) => f.key === 'enum.deleteMode' || f.key === 'flag.restorable',
    reason: 'rows are hard-deleted and audited; Reference soft-deletes/trashes',
  },
  {
    id: 'optimistic-locking',
    ref: 'verify-parity: optimistic locking (rowVersion, 409 ROW_VERSION_CONFLICT)',
    match: (f) => f.key === 'enum.concurrentEdit',
    reason: 'stale updates return 409 instead of last-write-wins',
  },
  {
    id: 'tenant-404',
    ref: 'CONTRIBUTING 1: tenant-scoped everything (other tenant gets 404, never 403 with data)',
    match: (f) => f.key === 'enum.crossTenant' && f.ours === 'not-found',
    reason: 'a row of another tenant is indistinguishable from a missing row',
  },
  {
    id: 'idempotency-key',
    ref: 'verify-parity: idempotency keys on mutations',
    match: (f) =>
      /double-submit$/.test(f.scenario) &&
      /^num\.(submitRequests|rowsCreated)$/.test(f.key) &&
      typeof f.ours === 'number' &&
      typeof f.threadwise === 'number' &&
      f.ours < f.threadwise,
    reason:
      'a repeated submit is replayed by Idempotency-Key and creates a single row (Reference creates duplicates)',
  },
  {
    id: 'permission-keys',
    ref: 'verify-parity: permission keys instead of role names',
    match: (f) => f.key === 'enum.permissionModel',
    reason: 'access is decided by permission keys, not role names',
  },
];

/** Returns {rule, ref, reason, source} when an architecture rule or the spec's own intended[] covers this finding. */
export function matchIntended(finding, specIntended = []) {
  for (const i of specIntended) {
    const scenarioOk =
      !i.scenario ||
      (i.scenario instanceof RegExp
        ? i.scenario.test(finding.scenario)
        : String(i.scenario) === finding.scenario);
    const keyOk =
      !i.key || (i.key instanceof RegExp ? i.key.test(finding.key) : String(i.key) === finding.key);
    if (scenarioOk && keyOk) {
      if (!i.reason || String(i.reason).trim().length < 8)
        return {
          invalid: `intended entry for ${i.scenario ?? '*'} / ${i.key ?? '*'} has no reason; reasons are mandatory`,
        };
      return {
        rule: i.rule || (i.quirk ? `quirk:${i.quirk}` : 'spec'),
        ref: i.ref || i.quirk || 'twin spec',
        reason: i.reason,
        source: 'spec',
      };
    }
  }
  for (const r of RULES)
    if (r.match(finding))
      return { rule: r.id, ref: r.ref, reason: r.reason, source: 'architecture' };
  return null;
}
