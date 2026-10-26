import { bulkKindsFor, commonStatus } from './bulk-context';
import type { BulkKind } from './bulk-bar';

const ALL: readonly BulkKind[] = [
  'read',
  'unread',
  'status',
  'assign',
  'label',
  'priority',
  'snooze',
  'spam',
  'reopen',
  'unsnooze',
  'notSpam',
];
const row = (status: Parameters<typeof commonStatus>[0][number]['status'], unreadCount = 1) => ({
  status,
  unreadCount,
});

describe('bulkKindsFor', () => {
  it('lists the plain actions for open conversations with unread messages', () => {
    expect(bulkKindsFor([row('open'), row('open')], ALL)).toEqual([
      'read',
      'status',
      'assign',
      'label',
      'priority',
      'snooze',
      'spam',
    ]);
  });

  it('swaps Snooze for Unsnooze only when every one is snoozed', () => {
    expect(bulkKindsFor([row('snoozed'), row('snoozed')], ALL)).toContain('unsnooze');
    expect(bulkKindsFor([row('snoozed'), row('snoozed')], ALL)).not.toContain('snooze');
    expect(bulkKindsFor([row('snoozed'), row('open')], ALL)).toContain('snooze');
  });

  it('swaps Mark as spam for Not spam, and drops Status and Snooze, when every one is spam', () => {
    const kinds = bulkKindsFor([row('spam', 0), row('spam', 0)], ALL);
    expect(kinds).toContain('notSpam');
    expect(kinds).not.toContain('spam');
    expect(kinds).not.toContain('status');
    expect(kinds).not.toContain('snooze');
  });

  it('swaps Status for Reopen when every one is resolved or closed', () => {
    const kinds = bulkKindsFor([row('resolved'), row('closed')], ALL);
    expect(kinds).toContain('reopen');
    expect(kinds).not.toContain('status');
    expect(bulkKindsFor([row('resolved'), row('open')], ALL)).toContain('status');
  });

  it('swaps Mark as read for Mark as unread when none of them has anything unread', () => {
    const none = bulkKindsFor([row('open', 0), row('open', 0)], ALL);
    expect(none).toContain('unread');
    expect(none).not.toContain('read');
    const some = bulkKindsFor([row('open', 0), row('open', 3)], ALL);
    expect(some).toContain('read');
    expect(some).not.toContain('unread');
  });

  it('does not offer Mark as unread to someone who may not read', () => {
    expect(bulkKindsFor([row('open', 0)], ['assign'])).not.toContain('unread');
  });

  it('only offers what the person may do, the undo included', () => {
    expect(bulkKindsFor([row('snoozed'), row('snoozed')], ['read', 'assign'])).toEqual([
      'read',
      'assign',
    ]);
    expect(bulkKindsFor([row('snoozed'), row('snoozed')], ['snooze'])).toEqual([]);
  });

  it('keeps the plain actions when it does not know the chosen ones', () => {
    expect(bulkKindsFor([], ALL)).toContain('snooze');
  });
});

describe('commonStatus', () => {
  it('is the status they all have, or null when they differ or there are none', () => {
    expect(commonStatus([row('open'), row('open')])).toBe('open');
    expect(commonStatus([row('open'), row('spam')])).toBeNull();
    expect(commonStatus([])).toBeNull();
  });
});
