import {
  DPDP_CODE_CHECK_RESULTS,
  DPDP_GROUPS,
  DPDP_PENALTY_TIERS,
  dpdpCheckSource,
  type DpdpAttestableCheck,
  type DpdpAttestationView,
  type DpdpCatalogItem,
  type DpdpCheckKey,
  type DpdpCheckResult,
  type DpdpCheckView,
  type DpdpCodeCheck,
  type DpdpItemStatus,
  type DpdpItemView,
  type DpdpLiveCheck,
  type DpdpMilestone,
  type DpdpPenaltyTier,
  type DpdpRegisterResponse,
} from '@crm/contracts';

/**
 * Pure rules of the DPDP register (spec sections 3, 4 and 6): how the checks of an item decide its status, how a live probe, an
 * attestation or a declared code result becomes a check, and how the register response is assembled. No I/O, no clock (the caller
 * passes `now`), no logging. The service gathers the probe outcomes and the attestation rows; this file only combines them.
 *
 * The `detail` of a check is a key from a closed set that the web maps to a text. The ones set here are:
 * `probe_missing` (a live check with no probe outcome), `code_declared` (a code check), `attestation_missing`,
 * `attestation_expired`, `attested_pass` and `attested_fail`. A probe chooses its own detail keys.
 */

/** What one live probe found. A probe that threw is reported by the caller as `unknown`, never `pass`. */
export interface ProbeOutcome {
  result: DpdpCheckResult;
  detail: string;
  params?: Record<string, string | number | boolean>;
}

/** One row of `dpdp_register_attestations`, as the service reads it. */
export interface AttestationRecord {
  checkKey: DpdpAttestableCheck;
  result: 'pass' | 'fail';
  note: string;
  evidenceUrl: string | null;
  byName: string;
  attestedAt: Date;
  expiresAt: Date;
}

export interface EvaluateInput {
  catalog: readonly DpdpCatalogItem[];
  probes: Partial<Record<DpdpLiveCheck, ProbeOutcome>>;
  attestations: AttestationRecord[];
  now: Date;
}

/** The two commencement dates of the Rules (Consent Manager registration, rule 4; the main duties), at 00:00 UTC. */
export const MILESTONES: readonly { id: 'consent_managers' | 'main_duties'; date: string }[] = [
  { id: 'consent_managers', date: '2026-11-14' },
  { id: 'main_duties', date: '2027-05-14' },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Worst first, so the register opens on what needs work. */
const STATUS_ORDER: readonly DpdpItemStatus[] = [
  'not_following',
  'partial',
  'unverified',
  'following',
  'not_applicable',
];

/**
 * The status of one item (spec section 4). With P passes, F fails and U unknowns: no fail and no unknown is `following`; no fail with an
 * unknown is `unverified`; a fail beside a pass or an unknown is `partial`; only fails is `not_following`. An item with no checks
 * takes its baseline.
 */
export function resolveItemStatus(item: DpdpCatalogItem, checks: DpdpCheckView[]): DpdpItemStatus {
  if (checks.length === 0) return item.baseline;
  let pass = 0;
  let fail = 0;
  let unknown = 0;
  for (const check of checks) {
    if (check.result === 'pass') pass += 1;
    else if (check.result === 'fail') fail += 1;
    else unknown += 1;
  }
  if (fail === 0) return unknown === 0 ? 'following' : 'unverified';
  return pass > 0 || unknown > 0 ? 'partial' : 'not_following';
}

function liveCheck(
  key: DpdpLiveCheck,
  probes: Partial<Record<DpdpLiveCheck, ProbeOutcome>>,
): DpdpCheckView {
  const outcome = probes[key];
  if (!outcome) return { key, source: 'live', result: 'unknown', detail: 'probe_missing' };
  const view: DpdpCheckView = {
    key,
    source: 'live',
    result: outcome.result,
    detail: outcome.detail,
  };
  if (outcome.params) view.params = outcome.params;
  return view;
}

function codeCheck(key: DpdpCodeCheck): DpdpCheckView {
  return { key, source: 'code', result: DPDP_CODE_CHECK_RESULTS[key], detail: 'code_declared' };
}

/** The newest record per key by `attestedAt`; on equal times the later one in the list wins. */
function newestAttestations(
  attestations: readonly AttestationRecord[],
): Map<DpdpAttestableCheck, AttestationRecord> {
  const newest = new Map<DpdpAttestableCheck, AttestationRecord>();
  for (const record of attestations) {
    const current = newest.get(record.checkKey);
    if (!current || record.attestedAt.getTime() >= current.attestedAt.getTime()) {
      newest.set(record.checkKey, record);
    }
  }
  return newest;
}

function attestationView(record: AttestationRecord): DpdpAttestationView {
  return {
    result: record.result,
    note: record.note,
    evidenceUrl: record.evidenceUrl,
    byName: record.byName,
    at: record.attestedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  };
}

/** Counts while `expiresAt` is after `now`; at the instant of expiry and after, the check is unknown again. */
function attestedCheck(
  key: DpdpAttestableCheck,
  newest: ReadonlyMap<DpdpAttestableCheck, AttestationRecord>,
  now: Date,
): DpdpCheckView {
  const record = newest.get(key);
  if (!record) return { key, source: 'attested', result: 'unknown', detail: 'attestation_missing' };
  const attestation = attestationView(record);
  if (record.expiresAt.getTime() <= now.getTime()) {
    return {
      key,
      source: 'attested',
      result: 'unknown',
      detail: 'attestation_expired',
      attestation,
    };
  }
  return {
    key,
    source: 'attested',
    result: record.result,
    detail: record.result === 'pass' ? 'attested_pass' : 'attested_fail',
    attestation,
  };
}

function milestoneView(milestone: (typeof MILESTONES)[number], now: Date): DpdpMilestone {
  const msLeft = Date.parse(`${milestone.date}T00:00:00.000Z`) - now.getTime();
  return {
    id: milestone.id,
    date: milestone.date,
    daysLeft: Math.max(0, Math.ceil(msLeft / MS_PER_DAY)),
    passed: msLeft <= 0,
  };
}

function compareItems(a: DpdpItemView, b: DpdpItemView): number {
  const byStatus = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
  if (byStatus !== 0) return byStatus;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** The register: every catalog item with its checks and status, grouped A to I, plus the summary and the milestones. */
export function evaluate(input: EvaluateInput): DpdpRegisterResponse {
  const { catalog, probes, attestations, now } = input;
  const newest = newestAttestations(attestations);

  const items: DpdpItemView[] = catalog.map((item) => {
    const checks = item.checks.map((key: DpdpCheckKey): DpdpCheckView => {
      const source = dpdpCheckSource(key);
      if (source === 'live') return liveCheck(key as DpdpLiveCheck, probes);
      if (source === 'attested') return attestedCheck(key as DpdpAttestableCheck, newest, now);
      return codeCheck(key as DpdpCodeCheck);
    });
    return {
      id: item.id,
      group: item.group,
      citation: item.citation,
      owner: item.owner,
      penaltyTier: item.penaltyTier,
      planItems: [...item.planItems],
      status: resolveItemStatus(item, checks),
      conditional: item.conditional === true,
      checks,
    };
  });

  const byTier = Object.fromEntries(
    DPDP_PENALTY_TIERS.map((tier) => [tier, { notFollowing: 0, partial: 0, unverified: 0 }]),
  ) as Record<DpdpPenaltyTier, { notFollowing: number; partial: number; unverified: number }>;
  const summary = { total: 0, following: 0, partial: 0, notFollowing: 0, unverified: 0, byTier };

  for (const item of items) {
    if (item.status === 'not_applicable') continue;
    summary.total += 1;
    const tier = byTier[item.penaltyTier];
    if (item.status === 'following') summary.following += 1;
    else if (item.status === 'partial') {
      summary.partial += 1;
      tier.partial += 1;
    } else if (item.status === 'not_following') {
      summary.notFollowing += 1;
      tier.notFollowing += 1;
    } else {
      summary.unverified += 1;
      tier.unverified += 1;
    }
  }

  const groups = DPDP_GROUPS.map((id) => ({
    id,
    items: items.filter((item) => item.group === id).sort(compareItems),
  })).filter((group) => group.items.length > 0);

  return {
    generatedAt: now.toISOString(),
    milestones: MILESTONES.map((milestone) => milestoneView(milestone, now)),
    summary,
    groups,
  };
}
