import { describe, expect, it } from 'vitest';
import { summary } from './fixtures';
import { pickedState } from './selection';

const vip = { id: 'l-1', name: 'VIP', color: null };
const mine = { user: { id: 'u-me', name: 'Me' }, team: null, aiAgent: null };

describe('pickedState', () => {
  it('offers every action while nothing is picked', () => {
    const s = pickedState([], 'u-me');
    expect(s.allSpam).toBe(false);
    expect(s.allSnoozed).toBe(false);
    expect(s.allRead).toBe(false);
    expect(s.canMoveTo('resolved')).toBe(true);
    expect(s.canAddTag('l-1')).toBe(true);
    expect(s.canRemoveTag('l-1')).toBe(true);
    expect(s.canAssignMe).toBe(true);
    expect(s.canUnassign).toBe(true);
    expect(s.canRemoveTeam).toBe(true);
  });

  it('is all spam only when every picked conversation is spam, and a spam thread moves only to open', () => {
    expect(pickedState([summary({ status: 'spam' })], 'u-me').allSpam).toBe(true);
    const mixed = pickedState([summary({ status: 'spam' }), summary({ status: 'open' })], 'u-me');
    expect(mixed.allSpam).toBe(false);
    const spamOnly = pickedState([summary({ status: 'spam' })], 'u-me');
    expect(spamOnly.canMoveTo('resolved')).toBe(false);
    expect(spamOnly.canMoveTo('closed')).toBe(false);
    expect(spamOnly.canMoveTo('open')).toBe(true);
  });

  it('is all snoozed only when every picked conversation is snoozed', () => {
    expect(pickedState([summary({ status: 'snoozed' })], 'u-me').allSnoozed).toBe(true);
    expect(
      pickedState([summary({ status: 'snoozed' }), summary({ status: 'open' })], 'u-me').allSnoozed,
    ).toBe(false);
  });

  it('flags a picked spam or snoozed conversation, even one among others', () => {
    expect(pickedState([summary({ status: 'resolved' })], 'u-me').someSpam).toBe(false);
    expect(pickedState([summary({ status: 'resolved' })], 'u-me').someSnoozed).toBe(false);
    const mixed = pickedState(
      [summary({ status: 'resolved' }), summary({ id: 'row-2', status: 'spam' })],
      'u-me',
    );
    expect(mixed.someSpam).toBe(true);
    expect(mixed.someSnoozed).toBe(false);
    expect(pickedState([summary({ status: 'snoozed' })], 'u-me').someSnoozed).toBe(true);
  });

  it('is all read only when no picked conversation has an unread message', () => {
    expect(pickedState([summary({ unreadCount: 0 })], 'u-me').allRead).toBe(true);
    expect(
      pickedState([summary({ unreadCount: 0 }), summary({ unreadCount: 1 })], 'u-me').allRead,
    ).toBe(false);
  });

  it('offers to add a tag some picked conversation lacks, and to remove a tag some carries', () => {
    const s = pickedState([summary({ labels: [vip] }), summary({ id: 'row-2' })], 'u-me');
    expect(s.canAddTag('l-1')).toBe(true);
    expect(s.canRemoveTag('l-1')).toBe(true);
    expect(s.canRemoveTag('l-2')).toBe(false);
    const all = pickedState([summary({ labels: [vip] }), summary({ labels: [vip] })], 'u-me');
    expect(all.canAddTag('l-1')).toBe(false);
  });

  it('stops offering assign to me once every picked conversation is mine', () => {
    expect(pickedState([summary({ assignment: mine })], 'u-me').canAssignMe).toBe(false);
    expect(pickedState([summary({ assignment: mine }), summary({})], 'u-me').canAssignMe).toBe(
      true,
    );
  });
});
