import { describe, expect, it } from 'vitest';
import {
  RETENTION_GROUPS,
  RETENTION_ITEMS,
  retentionCrossProblem,
  retentionDeleteAfterDays,
  retentionProblem,
  retentionSaveRequestSchema,
  retentionSpecOf,
} from './index';

describe('retention rules', () => {
  it('every built-in default passes its own rules, so saving nothing is always a valid state', () => {
    for (const spec of RETENTION_ITEMS) {
      expect(retentionProblem(spec.id, spec.defaults), spec.id).toBeNull();
    }
  });

  it('keeps the live window inside the item limits, both ends included', () => {
    const { min, max } = retentionSpecOf('an_events').live;
    expect(retentionProblem('an_events', { liveDays: min, archiveDays: null })).toBeNull();
    expect(retentionProblem('an_events', { liveDays: max, archiveDays: null })).toBeNull();
    expect(retentionProblem('an_events', { liveDays: min - 1, archiveDays: null })).toBe(
      'live_out_of_range',
    );
    expect(retentionProblem('an_events', { liveDays: max + 1, archiveDays: null })).toBe(
      'live_out_of_range',
    );
    expect(retentionProblem('an_events', { liveDays: 30.5, archiveDays: null })).toBe(
      'live_out_of_range',
    );
  });

  it('refuses a closed month shorter than the 7 days the database will not drop before', () => {
    expect(retentionProblem('an_events', { liveDays: 3, archiveDays: null })).toBe(
      'live_out_of_range',
    );
    expect(retentionProblem('audit_log', { liveDays: 6, archiveDays: 30 })).toBe(
      'live_out_of_range',
    );
  });

  it('allows an archive window only where the item can be archived, and never zero or negative', () => {
    expect(retentionProblem('audit_log', { liveDays: 90, archiveDays: 275 })).toBeNull();
    expect(retentionProblem('audit_log', { liveDays: 90, archiveDays: 0 })).toBe(
      'archive_out_of_range',
    );
    expect(retentionProblem('audit_log', { liveDays: 90, archiveDays: -5 })).toBe(
      'archive_out_of_range',
    );
    expect(retentionProblem('audit_log', { liveDays: 90, archiveDays: 3651 })).toBe(
      'archive_out_of_range',
    );
    expect(retentionProblem('security_events', { liveDays: 90, archiveDays: 30 })).toBe(
      'archive_not_supported',
    );
    expect(retentionProblem('audit_log_exports', { liveDays: 7, archiveDays: 1 })).toBe(
      'archive_not_supported',
    );
  });

  it('keeps the record of policy changes for at least a month', () => {
    expect(retentionProblem('security_events', { liveDays: 29, archiveDays: null })).toBe(
      'live_out_of_range',
    );
    expect(retentionProblem('security_events', { liveDays: 30, archiveDays: null })).toBeNull();
  });

  it('deletes for good live + archive days after the write, and never when the archive keeps it for ever', () => {
    expect(retentionDeleteAfterDays({ liveDays: 90, archiveDays: 275 })).toBe(365);
    expect(retentionDeleteAfterDays({ liveDays: 60, archiveDays: null })).toBeNull();
  });

  it('takes whole numbers only in a save request and rejects unknown fields', () => {
    const ok = { liveDays: 60, archiveDays: null, rowVersion: null };
    expect(retentionSaveRequestSchema.safeParse(ok).success).toBe(true);
    expect(retentionSaveRequestSchema.safeParse({ ...ok, liveDays: 60.5 }).success).toBe(false);
    expect(retentionSaveRequestSchema.safeParse({ ...ok, rowVersion: 0 }).success).toBe(false);
    expect(retentionSaveRequestSchema.safeParse({ ...ok, item: 'x' }).success).toBe(false);
  });
});

describe('the registry', () => {
  it('lists every item once, in a group the page shows', () => {
    const ids = RETENTION_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of RETENTION_ITEMS) expect(RETENTION_GROUPS).toContain(spec.group);
  });

  it('gives an item an archive only when it can be archived, and a default inside its own limits', () => {
    for (const spec of RETENTION_ITEMS) {
      if (!spec.canArchive) expect(spec.defaults.archiveDays, spec.id).toBeNull();
      expect(spec.defaults.liveDays, spec.id).toBeGreaterThanOrEqual(spec.live.min);
      expect(spec.defaults.liveDays, spec.id).toBeLessThanOrEqual(spec.live.max);
    }
  });

  it('keeps today’s built-in numbers for the items that were hard-coded', () => {
    const live = (id: Parameters<typeof retentionSpecOf>[0]) => retentionSpecOf(id).defaults;
    expect(live('message_log')).toEqual({ liveDays: 90, archiveDays: 275 });
    expect(live('assignment_runs').liveDays).toBe(90);
    expect(live('form_events').liveDays).toBe(90);
    expect(live('lead_sync_runs').liveDays).toBe(90);
    expect(live('api_library_logs').liveDays).toBe(30);
    expect(live('flow_run_logs').liveDays).toBe(30);
    expect(live('webhook_forward_failures').liveDays).toBe(14);
    expect(live('push_devices_revoked').liveDays).toBe(30);
    expect(live('click_calls').liveDays).toBe(2);
    expect(live('call_recordings').liveDays).toBe(90);
  });

  it('allows the message log both windows, and an archive kept for ever', () => {
    expect(retentionProblem('message_log', { liveDays: 30, archiveDays: 335 })).toBeNull();
    expect(retentionProblem('message_log', { liveDays: 30, archiveDays: null })).toBeNull();
    expect(retentionProblem('message_log', { liveDays: 6, archiveDays: 10 })).toBe(
      'live_out_of_range',
    );
    expect(retentionDeleteAfterDays({ liveDays: 90, archiveDays: 275 })).toBe(365);
  });

  it('keeps a call recording window inside what a workspace may choose (7 to 365)', () => {
    expect(retentionProblem('call_recordings', { liveDays: 7, archiveDays: null })).toBeNull();
    expect(retentionProblem('call_recordings', { liveDays: 365, archiveDays: null })).toBeNull();
    expect(retentionProblem('call_recordings', { liveDays: 6, archiveDays: null })).toBe(
      'live_out_of_range',
    );
    expect(retentionProblem('call_recordings', { liveDays: 366, archiveDays: null })).toBe(
      'live_out_of_range',
    );
  });
});

describe('rules between items', () => {
  const other = { notificationsRead: 90, notificationsUnread: 180 };
  it('never deletes an unread notification before a read one', () => {
    const v = (liveDays: number) => ({ liveDays, archiveDays: null });
    expect(retentionCrossProblem('notifications_unread', v(89), other)).toBe('unread_before_read');
    expect(retentionCrossProblem('notifications_unread', v(90), other)).toBeNull();
    expect(retentionCrossProblem('notifications_read', v(181), other)).toBe('unread_before_read');
    expect(retentionCrossProblem('notifications_read', v(180), other)).toBeNull();
    expect(retentionCrossProblem('assignment_runs', v(1), other)).toBeNull();
  });
});
