import { describe, expect, it } from 'vitest';
import {
  decide,
  effectiveDays,
  scheduledDates,
  type LifecycleOrgState,
} from '../../../src/modules/workspaces-teams-tenancy/lifecycle/lifecycle.policy';

const NOW = new Date('2027-01-01T00:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const base = (over: Partial<LifecycleOrgState> = {}): LifecycleOrgState => ({
  status: 'active',
  lastActivityAt: ago(0),
  archivedAt: null,
  deletedAt: null,
  archiveAfterDays: null,
  deleteAfterDays: null,
  retentionExempt: false,
  retentionExemptUntil: null,
  legalHold: false,
  exemptByPlan: false,
  remindersSent: { archive: 0, delete: 0 },
  lastReminderAt: null,
  ...over,
});

describe('lifecycle policy', () => {
  it('does nothing for an active org', () => {
    expect(decide(base({ lastActivityAt: ago(10) }), NOW).action).toBe('none');
  });

  it('sends archive reminders at day 60, 75, 85 in order', () => {
    expect(decide(base({ lastActivityAt: ago(60) }), NOW)).toMatchObject({
      action: 'reminder',
      stage: 'archive',
      reminderNo: 1,
    });
    expect(
      decide(
        base({
          lastActivityAt: ago(75),
          remindersSent: { archive: 1, delete: 0 },
          lastReminderAt: ago(15),
        }),
        NOW,
      ),
    ).toMatchObject({ reminderNo: 2 });
    expect(
      decide(
        base({
          lastActivityAt: ago(85),
          remindersSent: { archive: 2, delete: 0 },
          lastReminderAt: ago(10),
        }),
        NOW,
      ),
    ).toMatchObject({ reminderNo: 3 });
  });

  it('archives at 90 only after three reminders', () => {
    expect(decide(base({ lastActivityAt: ago(95) }), NOW)).toMatchObject({
      action: 'reminder',
      reminderNo: 1,
    });
    expect(
      decide(
        base({
          lastActivityAt: ago(95),
          remindersSent: { archive: 3, delete: 0 },
          lastReminderAt: ago(10),
        }),
        NOW,
      ),
    ).toMatchObject({ action: 'archive' });
  });

  it('delays archive until the final-notice gap elapses', () => {
    const d = decide(
      base({
        lastActivityAt: ago(95),
        remindersSent: { archive: 3, delete: 0 },
        lastReminderAt: ago(1),
      }),
      NOW,
    );
    expect(d.action).toBe('none');
  });

  it('never sends two reminders inside the spacing window', () => {
    const d = decide(
      base({
        lastActivityAt: ago(100),
        remindersSent: { archive: 1, delete: 0 },
        lastReminderAt: ago(1),
      }),
      NOW,
    );
    expect(d).toMatchObject({ action: 'none', reason: 'reminder spacing' });
  });

  it('deletes at 180 only when archived 30+ days, 3 delete reminders, 7 days notice', () => {
    const ready = base({
      status: 'archived',
      lastActivityAt: ago(185),
      archivedAt: ago(95),
      remindersSent: { archive: 3, delete: 3 },
      lastReminderAt: ago(8),
    });
    expect(decide(ready, NOW).action).toBe('delete');
    expect(decide({ ...ready, lastReminderAt: ago(6) }, NOW).action).toBe('none');
    expect(decide({ ...ready, remindersSent: { archive: 3, delete: 2 } }, NOW).action).toBe(
      'reminder',
    );
    expect(decide({ ...ready, archivedAt: ago(10) }, NOW).action).toBe('none');
  });

  it('a long-idle active org is archived first, never deleted directly', () => {
    const d = decide(
      base({
        lastActivityAt: ago(400),
        remindersSent: { archive: 3, delete: 0 },
        lastReminderAt: ago(30),
      }),
      NOW,
    );
    expect(d.action).toBe('archive');
  });

  it('exempt orgs are untouched; expired exemption protects nothing', () => {
    const idle = { lastActivityAt: ago(500) };
    expect(decide(base({ ...idle, retentionExempt: true }), NOW).action).toBe('none');
    expect(
      decide(base({ ...idle, retentionExempt: true, retentionExemptUntil: ago(1) }), NOW).action,
    ).toBe('reminder');
    expect(
      decide(
        base({
          ...idle,
          retentionExempt: true,
          retentionExemptUntil: new Date(NOW.getTime() + 1000),
        }),
        NOW,
      ).action,
    ).toBe('none');
  });

  it('an active paid plan is never idle-archived', () => {
    expect(decide(base({ lastActivityAt: ago(500), exemptByPlan: true }), NOW).action).toBe('none');
    expect(scheduledDates(base({ exemptByPlan: true }), NOW)).toEqual({
      archiveAt: null,
      deleteAt: null,
    });
  });

  it('legal hold blocks everything', () => {
    expect(decide(base({ lastActivityAt: ago(500), legalHold: true }), NOW).action).toBe('none');
  });

  it('per-org override shifts every threshold', () => {
    // archive at 120 -> first reminder at day 90
    expect(decide(base({ lastActivityAt: ago(89), archiveAfterDays: 120 }), NOW).action).toBe(
      'none',
    );
    expect(decide(base({ lastActivityAt: ago(90), archiveAfterDays: 120 }), NOW).action).toBe(
      'reminder',
    );
  });

  it('keeps delete at least 60 days after archive', () => {
    expect(effectiveDays({ archiveAfterDays: 200, deleteAfterDays: 210 })).toEqual({
      archive: 200,
      delete: 260,
    });
  });

  it('erases a workspace its owner deleted 30 days after, with no reminders', () => {
    const del = (over: Partial<LifecycleOrgState> = {}) =>
      base({ status: 'deleted', deletedAt: ago(30), ...over });
    expect(decide(del(), NOW)).toMatchObject({ action: 'delete', cause: 'owner_deleted' });
    expect(decide(del({ deletedAt: ago(29) }), NOW).action).toBe('none');
    expect(decide(del({ deletedAt: null }), NOW).action).toBe('none');
  });

  it('the never-delete switch does not stop an owner erasure; a legal hold does', () => {
    const del = base({
      status: 'deleted',
      deletedAt: ago(40),
      retentionExempt: true,
      exemptByPlan: true,
    });
    expect(decide(del, NOW).action).toBe('delete');
    expect(decide({ ...del, legalHold: true }, NOW).action).toBe('none');
    expect(scheduledDates(del, NOW).deleteAt?.toISOString()).toBe(ago(10).toISOString());
  });

  it('ignores suspended orgs', () => {
    expect(decide(base({ status: 'suspended', lastActivityAt: ago(500) }), NOW).action).toBe(
      'none',
    );
  });

  it('exposes schedule, null when exempt', () => {
    expect(scheduledDates(base({ retentionExempt: true }), NOW)).toEqual({
      archiveAt: null,
      deleteAt: null,
    });
    expect(scheduledDates(base(), NOW).archiveAt?.toISOString()).toBe(
      new Date(NOW.getTime() + 90 * 86_400_000).toISOString(),
    );
  });
});
