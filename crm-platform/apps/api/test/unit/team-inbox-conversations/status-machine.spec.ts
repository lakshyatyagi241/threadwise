import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_STATUSES,
  SETTABLE_CONVERSATION_STATUSES,
  canMoveConversationStatus,
  setConversationStatusSchema,
  type ConversationStatus,
} from '@crm/contracts';

/** The transition guard (TW-TIB1-034): every pair of statuses, decided once, shared by the API and the web. */
describe('canMoveConversationStatus', () => {
  const allowed: Array<[ConversationStatus, ConversationStatus]> = [
    ['open', 'pending'],
    ['open', 'resolved'],
    ['open', 'closed'],
    ['pending', 'open'],
    ['pending', 'resolved'],
    ['pending', 'closed'],
    ['snoozed', 'open'],
    ['snoozed', 'resolved'],
    ['snoozed', 'closed'],
    ['resolved', 'open'],
    ['resolved', 'closed'],
    ['closed', 'open'],
    ['closed', 'resolved'],
    ['spam', 'open'],
  ];

  it.each(allowed)('%s -> %s is allowed', (from, to) => {
    expect(canMoveConversationStatus(from, to)).toBe(true);
  });

  it('refuses every other move between different statuses', () => {
    const ok = new Set(allowed.map(([a, b]) => `${a}>${b}`));
    for (const from of CONVERSATION_STATUSES) {
      for (const to of CONVERSATION_STATUSES) {
        if (from === to) continue;
        expect(canMoveConversationStatus(from, to), `${from} -> ${to}`).toBe(
          ok.has(`${from}>${to}`),
        );
      }
    }
  });

  it('treats a move to the status the thread already has as allowed (a no-op, never an error)', () => {
    for (const s of CONVERSATION_STATUSES) expect(canMoveConversationStatus(s, s)).toBe(true);
  });

  it('never lets an agent resolve a spam thread or move anything into snoozed or spam', () => {
    expect(canMoveConversationStatus('spam', 'resolved')).toBe(false);
    expect(canMoveConversationStatus('spam', 'closed')).toBe(false);
    for (const from of CONVERSATION_STATUSES) {
      if (from !== 'snoozed') expect(canMoveConversationStatus(from, 'snoozed')).toBe(false);
      if (from !== 'spam') expect(canMoveConversationStatus(from, 'spam')).toBe(false);
    }
  });

  it('the request body only accepts the statuses an agent can set', () => {
    expect([...SETTABLE_CONVERSATION_STATUSES]).toEqual(['open', 'pending', 'resolved', 'closed']);
    expect(
      setConversationStatusSchema.safeParse({ rowVersion: 1, status: 'snoozed' }).success,
    ).toBe(false);
    expect(setConversationStatusSchema.safeParse({ rowVersion: 1, status: 'spam' }).success).toBe(
      false,
    );
    expect(setConversationStatusSchema.safeParse({ rowVersion: 0, status: 'open' }).success).toBe(
      false,
    );
    expect(
      setConversationStatusSchema.safeParse({ rowVersion: 3, status: 'resolved' }).success,
    ).toBe(true);
  });
});
