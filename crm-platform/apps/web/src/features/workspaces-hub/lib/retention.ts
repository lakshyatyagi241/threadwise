import {
  DEFAULT_ARCHIVE_AFTER_DAYS,
  DEFAULT_DELETE_AFTER_DAYS,
  lifecycleStatusSchema,
  restoreOrgSchema,
  setOrgLegalHoldSchema,
  setOrgRetentionExemptSchema,
  updateOrgRetentionPolicySchema,
  type OrgLifecycleResponse,
  type SetOrgRetentionExemptInput,
  type UpdateOrgRetentionPolicyInput,
} from '@crm/contracts';
import type { LifecycleListFilters } from '../api';

/** Same numbers as the contract and the service; the gap rule lives in the service (ADR-0028), mirrored here. */
export const MIN_ARCHIVE_DAYS = 60;
export const MIN_DELETE_DAYS = 120;
export const MIN_GAP_DAYS = 60;
export const MIN_REASON = 5;
export const MAX_REASON = 500;

export const RETENTION_DEFAULTS: Record<'status' | 'min' | 'exempt', string> = {
  status: '',
  min: '',
  exempt: '',
};

/** The address' filters as the API's list query; a value the API does not know is dropped. */
export function toLifecycleFilters(values: Readonly<Record<string, string>>): LifecycleListFilters {
  const min = Number(values.min);
  return {
    status: lifecycleStatusSchema
      .optional()
      .catch(undefined)
      .parse(values.status || undefined),
    minDaysInactive: values.min !== '' && Number.isInteger(min) && min >= 0 ? min : undefined,
    exempt: values.exempt === 'true' ? 'true' : undefined,
  };
}

export const hasRetentionFilter = (v: Readonly<Record<string, string>>) =>
  Boolean(v.status || v.min || v.exempt);

export type ReasonError = 'reasonShort' | 'reasonLong' | null;
/** Reason rule shared by every write: 5 to 500 characters once trimmed. */
export function reasonError(reason: string): ReasonError {
  const n = reason.trim().length;
  return n < MIN_REASON ? 'reasonShort' : n > MAX_REASON ? 'reasonLong' : null;
}

export const reasonBody = (reason: string) => restoreOrgSchema.safeParse({ reason });
export const legalHoldBody = (legalHold: boolean, reason: string) =>
  setOrgLegalHoldSchema.safeParse({ legalHold, reason });

export interface TimingDraft {
  /** `default` clears the override (null on the wire). */
  mode: 'default' | 'custom';
  days: string;
}
export interface PolicyDraft {
  archive: TimingDraft;
  erase: TimingDraft;
  reason: string;
}
export type PolicyError =
  | 'archiveMin'
  | 'archiveMax'
  | 'archiveWhole'
  | 'eraseMin'
  | 'eraseMax'
  | 'eraseWhole'
  | 'gap'
  | 'noChange';

/** The form's starting point: an existing override is shown as custom, anything else follows the platform default. */
export function policyDraftFor(
  row: Pick<OrgLifecycleResponse, 'archiveOverride' | 'deleteOverride'>,
): PolicyDraft {
  const one = (o: number | null): TimingDraft =>
    o === null ? { mode: 'default', days: '' } : { mode: 'custom', days: String(o) };
  return { archive: one(row.archiveOverride), erase: one(row.deleteOverride), reason: '' };
}

function parseDays(t: TimingDraft): number | null | 'whole' {
  if (t.mode === 'default') return null;
  const s = t.days.trim();
  if (!/^\d+$/.test(s)) return 'whole';
  return Number(s);
}

/**
 * Checks a draft exactly like `updateOrgRetentionPolicySchema` (60 to 3650 and 120 to 7300 whole days, reason 5 to 500) plus the
 * service's rule that erase comes at least 60 days after archive, on the effective values. Only a timing that differs from the
 * current override is sent, so an untouched one is never rewritten.
 */
export function checkPolicy(
  row: Pick<OrgLifecycleResponse, 'archiveOverride' | 'deleteOverride'>,
  draft: PolicyDraft,
): { errors: PolicyError[]; reason: ReasonError; body: UpdateOrgRetentionPolicyInput | null } {
  const errors: PolicyError[] = [];
  const a = parseDays(draft.archive);
  const e = parseDays(draft.erase);
  if (a === 'whole') errors.push('archiveWhole');
  else if (a !== null && a < MIN_ARCHIVE_DAYS) errors.push('archiveMin');
  else if (a !== null && a > 3650) errors.push('archiveMax');
  if (e === 'whole') errors.push('eraseWhole');
  else if (e !== null && e < MIN_DELETE_DAYS) errors.push('eraseMin');
  else if (e !== null && e > 7300) errors.push('eraseMax');
  const reason = reasonError(draft.reason);

  if (errors.length === 0 && typeof a !== 'string' && typeof e !== 'string') {
    const effArchive = a ?? DEFAULT_ARCHIVE_AFTER_DAYS;
    const effErase = e ?? DEFAULT_DELETE_AFTER_DAYS;
    if (effErase - effArchive < MIN_GAP_DAYS) errors.push('gap');
    const patch: { archiveAfterDays?: number | null; deleteAfterDays?: number | null } = {};
    if (a !== row.archiveOverride) patch.archiveAfterDays = a;
    if (e !== row.deleteOverride) patch.deleteAfterDays = e;
    if (Object.keys(patch).length === 0) errors.push('noChange');
    if (errors.length === 0 && reason === null) {
      const parsed = updateOrgRetentionPolicySchema.safeParse({ ...patch, reason: draft.reason });
      return { errors, reason, body: parsed.success ? parsed.data : null };
    }
  }
  return { errors, reason, body: null };
}

export type ExemptError = 'untilPast' | null;

/** A date input (`YYYY-MM-DD`) as an end-of-day UTC instant; empty means indefinite (undefined). */
export function untilIso(date: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59.000Z` : undefined;
}

/** The never-delete body, or the reason it cannot be sent yet. */
export function checkExempt(
  on: boolean,
  reason: string,
  until: string,
  now: number = Date.now(),
): { reason: ReasonError; until: ExemptError; body: SetOrgRetentionExemptInput | null } {
  const r = reasonError(reason);
  const iso = on ? untilIso(until) : undefined;
  const u: ExemptError = iso && new Date(iso).getTime() <= now ? 'untilPast' : null;
  if (r || u) return { reason: r, until: u, body: null };
  const parsed = setOrgRetentionExemptSchema.safeParse(
    on ? { exempt: true, reason, ...(iso ? { until: iso } : {}) } : { exempt: false, reason },
  );
  return { reason: r, until: u, body: parsed.success ? parsed.data : null };
}
