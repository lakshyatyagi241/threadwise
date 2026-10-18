import { describe, expect, it } from 'vitest';
import {
  RETENTION_ITEMS,
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
