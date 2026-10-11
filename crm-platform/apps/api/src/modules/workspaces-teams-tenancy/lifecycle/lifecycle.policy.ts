import {
  ARCHIVE_REMINDER_LEAD_DAYS,
  DEFAULT_ARCHIVE_AFTER_DAYS,
  DEFAULT_DELETE_AFTER_DAYS,
  DELETE_REMINDER_LEAD_DAYS,
  MIN_FINAL_NOTICE_DAYS,
} from '@crm/contracts';

const DAY_MS = 86_400_000;

/** Minimum spacing between two reminders, so an overdue org cannot get all three at once. */
export const MIN_REMINDER_GAP_DAYS = 3;
/** An org must have been archived at least this long before it can be erased. */
export const MIN_ARCHIVED_DAYS_BEFORE_DELETE = 30;
/** A workspace its owner deleted is erased this many days after the deletion. */
export const OWNER_DELETED_GRACE_DAYS = 30;
/** Effective delete threshold must exceed the archive threshold by this much. */
export const MIN_DELETE_GAP_DAYS = 60;

export interface LifecycleOrgState {
  status: string;
  lastActivityAt: Date;
  archivedAt: Date | null;
  /** When the owner deleted the workspace themselves (status 'deleted'). */
  deletedAt: Date | null;
  archiveAfterDays: number | null;
  deleteAfterDays: number | null;
  retentionExempt: boolean;
  retentionExemptUntil: Date | null;
  legalHold: boolean;
  /** On an active paid plan (or a custom quote, or platform-owned): paying customers are never idle-archived. */
  exemptByPlan: boolean;
  /** Reminders already sent for the CURRENT inactivity cycle. */
  remindersSent: { archive: number; delete: number };
  lastReminderAt: Date | null;
}

export type LifecycleDecision =
  | { action: 'none'; reason: string }
  | { action: 'reminder'; stage: 'archive' | 'delete'; reminderNo: 1 | 2 | 3; daysInactive: number }
  | { action: 'archive'; daysInactive: number }
  | { action: 'delete'; daysInactive: number; cause?: 'owner_deleted' };

export function effectiveDays(
  org: Pick<LifecycleOrgState, 'archiveAfterDays' | 'deleteAfterDays'>,
): {
  archive: number;
  delete: number;
} {
  const archive = org.archiveAfterDays ?? DEFAULT_ARCHIVE_AFTER_DAYS;
  // A short archive override must never pull delete inside the safety gap.
  const del = Math.max(
    org.deleteAfterDays ?? DEFAULT_DELETE_AFTER_DAYS,
    archive + MIN_DELETE_GAP_DAYS,
  );
  return { archive, delete: del };
}

/** Exempt now? An expired exemption no longer protects the org. */
export function isExemptNow(
  org: Pick<LifecycleOrgState, 'retentionExempt' | 'retentionExemptUntil'>,
  now: Date,
): boolean {
  if (!org.retentionExempt) return false;
  return org.retentionExemptUntil === null || org.retentionExemptUntil.getTime() > now.getTime();
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/**
 * Pure decision: what, if anything, should happen to this org right now.
 *
 * One action per call. Reminders are strictly sequential and spaced, and each
 * destructive step requires that all three reminders for it were recorded
 * first with a minimum notice period after the last one — so a backlog (a
 * paused worker, a lapsed exemption, a lowered override) delays destruction
 * rather than skipping the warnings.
 */
export function decide(org: LifecycleOrgState, now: Date): LifecycleDecision {
  // The owner deleted it themselves: a request to erase, not an idle workspace. No reminders and the operator's never-delete switch
  // does not apply (a person's erasure request outranks a commercial courtesy); only a legal hold stops it.
  if (org.status === 'deleted') {
    if (org.legalHold) return { action: 'none', reason: 'legal hold' };
    if (!org.deletedAt) return { action: 'none', reason: 'no deletion date' };
    const sinceDeleted = daysBetween(org.deletedAt, now);
    if (sinceDeleted < OWNER_DELETED_GRACE_DAYS) {
      return {
        action: 'none',
        reason: `owner deleted ${sinceDeleted}d ago, grace ${OWNER_DELETED_GRACE_DAYS}d`,
      };
    }
    return {
      action: 'delete',
      daysInactive: daysBetween(org.lastActivityAt, now),
      cause: 'owner_deleted',
    };
  }
  if (org.status !== 'active' && org.status !== 'archived') {
    return { action: 'none', reason: `status ${org.status} is not managed` };
  }
  if (org.legalHold) return { action: 'none', reason: 'legal hold' };
  if (isExemptNow(org, now)) return { action: 'none', reason: 'retention exempt' };
  if (org.exemptByPlan) return { action: 'none', reason: 'active paid plan' };

  const days = daysBetween(org.lastActivityAt, now);
  const limits = effectiveDays(org);
  const sinceReminder = org.lastReminderAt ? daysBetween(org.lastReminderAt, now) : Infinity;

  const stage = org.status === 'active' ? 'archive' : 'delete';
  const threshold = stage === 'archive' ? limits.archive : limits.delete;
  const leads = stage === 'archive' ? ARCHIVE_REMINDER_LEAD_DAYS : DELETE_REMINDER_LEAD_DAYS;
  const sent = org.remindersSent[stage];

  if (sent < 3) {
    const nextNo = (sent + 1) as 1 | 2 | 3;
    const dueAt = threshold - leads[sent]!;
    if (days < dueAt)
      return { action: 'none', reason: `reminder ${nextNo} not due until day ${dueAt}` };
    if (sinceReminder < MIN_REMINDER_GAP_DAYS) {
      return { action: 'none', reason: 'reminder spacing' };
    }
    return { action: 'reminder', stage, reminderNo: nextNo, daysInactive: days };
  }

  if (days < threshold)
    return { action: 'none', reason: `${stage} not due until day ${threshold}` };

  const finalNotice = stage === 'archive' ? MIN_REMINDER_GAP_DAYS : MIN_FINAL_NOTICE_DAYS;
  if (sinceReminder < finalNotice) {
    return { action: 'none', reason: `final ${stage} notice period (${finalNotice}d) not elapsed` };
  }

  if (stage === 'archive') return { action: 'archive', daysInactive: days };

  if (!org.archivedAt || daysBetween(org.archivedAt, now) < MIN_ARCHIVED_DAYS_BEFORE_DELETE) {
    return { action: 'none', reason: 'archived less than 30 days' };
  }
  return { action: 'delete', daysInactive: days };
}

/** Dates the next destructive step is due, for the admin view. null = never. */
export function scheduledDates(
  org: LifecycleOrgState,
  now: Date,
): { archiveAt: Date | null; deleteAt: Date | null } {
  if (org.status === 'deleted') {
    return {
      archiveAt: null,
      deleteAt:
        org.legalHold || !org.deletedAt
          ? null
          : new Date(org.deletedAt.getTime() + OWNER_DELETED_GRACE_DAYS * DAY_MS),
    };
  }
  if (org.legalHold || org.exemptByPlan || isExemptNow(org, now))
    return { archiveAt: null, deleteAt: null };
  const limits = effectiveDays(org);
  const at = (d: number) => new Date(org.lastActivityAt.getTime() + d * DAY_MS);
  return {
    archiveAt: org.status === 'active' ? at(limits.archive) : null,
    deleteAt: at(limits.delete),
  };
}
