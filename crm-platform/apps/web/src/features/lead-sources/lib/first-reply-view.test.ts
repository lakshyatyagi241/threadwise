import { describe, expect, it } from 'vitest';
import { LEAD_FIRST_REPLY_REASONS, LEAD_FIRST_REPLY_STATUSES } from '@crm/contracts';
import { FIRST_REPLY_TONE, knownReason, momentOf } from './first-reply-view';

describe('how a first message is shown', () => {
  it('has a colour for every status', () => {
    for (const s of LEAD_FIRST_REPLY_STATUSES) expect(FIRST_REPLY_TONE[s], s).toBeDefined();
    expect(FIRST_REPLY_TONE.held).toBe('warning');
    expect(FIRST_REPLY_TONE.sent).toBe('success');
    expect(FIRST_REPLY_TONE.blocked).toBe('danger');
  });

  it('knows every reason the contract names and nothing else', () => {
    for (const r of LEAD_FIRST_REPLY_REASONS) expect(knownReason(r), r).toBe(r);
    expect(knownReason('something_new')).toBeNull();
    expect(knownReason(null)).toBeNull();
  });

  it('shows when it is due while it waits, when it left once sent, and no moment otherwise', () => {
    const base = { dueAt: '2026-10-16T10:00:00.000Z', sentAt: '2026-10-16T10:01:00.000Z' };
    expect(momentOf({ ...base, status: 'scheduled' })).toEqual({ kind: 'due', at: base.dueAt });
    expect(momentOf({ ...base, status: 'held' })).toEqual({ kind: 'due', at: base.dueAt });
    expect(momentOf({ ...base, status: 'sent' })).toEqual({ kind: 'sent', at: base.sentAt });
    expect(momentOf({ dueAt: base.dueAt, sentAt: null, status: 'sent' })).toBeNull();
    for (const s of ['blocked', 'skipped', 'failed', 'sending'] as const) {
      expect(momentOf({ ...base, status: s }), s).toBeNull();
    }
  });
});
