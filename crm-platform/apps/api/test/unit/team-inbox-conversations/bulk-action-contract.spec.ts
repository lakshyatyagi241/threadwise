import { describe, expect, it } from 'vitest';
import { bulkConversationsSchema } from '@crm/contracts';

const ID = '11111111-1111-4111-8111-111111111111';

/** The bulk request the bar sends for "Mark as unread", "Mark as not spam" and "Unsnooze" (the last two are the status route to open). */
describe('bulkConversationsSchema', () => {
  it('accepts mark_unread next to mark_read', () => {
    expect(
      bulkConversationsSchema.safeParse({ ids: [ID], action: { type: 'mark_unread' } }).success,
    ).toBe(true);
    expect(
      bulkConversationsSchema.safeParse({ ids: [ID], action: { type: 'mark_read' } }).success,
    ).toBe(true);
  });

  it('takes spam, not spam and unsnooze as a status move to open', () => {
    expect(
      bulkConversationsSchema.safeParse({
        ids: [ID],
        action: { type: 'status', status: 'open' },
      }).success,
    ).toBe(true);
  });

  it('refuses an action it does not know', () => {
    expect(
      bulkConversationsSchema.safeParse({ ids: [ID], action: { type: 'mark_all_unread' } }).success,
    ).toBe(false);
  });
});
