import { describe, expect, it } from 'vitest';
import { canSee, type SegmentAccess } from '../../../src/modules/crm/segments/segment-filter';
import type { SegmentRow } from '../../../src/modules/crm/segments/segments.repository';

/**
 * The one predicate that decides who sees a segment (get, list guard, contact filter, actions, audiences). `sharedWithMe`
 * is what the SQL answers for the caller (listed by name, or through a team); here it is the input.
 */
const row = (over: Partial<SegmentRow>): SegmentRow =>
  ({
    id: 1,
    ownerId: 10,
    visibility: 'private',
    sharedWithMe: false,
    ...over,
  }) as SegmentRow;

const access = (over: Partial<SegmentAccess> = {}): SegmentAccess => ({
  canRead: true,
  userId: 20,
  manageAll: false,
  ...over,
});

describe('canSee', () => {
  it('the owner sees every kind of their own segment', () => {
    for (const visibility of ['private', 'shared', 'specific'] as const) {
      expect(canSee(row({ visibility }), access({ userId: 10 }))).toBe(true);
    }
  });

  it('a person on the list of a specific segment sees it', () => {
    expect(canSee(row({ visibility: 'specific', sharedWithMe: true }), access())).toBe(true);
  });

  it('a person who is not on the list does not (removed, never added, or on another team)', () => {
    expect(canSee(row({ visibility: 'specific', sharedWithMe: false }), access())).toBe(false);
  });

  it('whoever can edit every segment always sees it, listed or not', () => {
    expect(canSee(row({ visibility: 'specific' }), access({ manageAll: true }))).toBe(true);
    expect(canSee(row({ visibility: 'private' }), access({ manageAll: true }))).toBe(true);
  });

  it('being on the list does not help without the permission to view segments', () => {
    expect(
      canSee(row({ visibility: 'specific', sharedWithMe: true }), access({ canRead: false })),
    ).toBe(false);
    expect(canSee(row({ visibility: 'specific' }), access({ canRead: false, userId: 10 }))).toBe(
      false,
    );
  });

  it('the list only counts for a specific segment', () => {
    expect(canSee(row({ visibility: 'private', sharedWithMe: true }), access())).toBe(false);
  });

  it('shared stays visible to everyone who can read; private stays hidden from others', () => {
    expect(canSee(row({ visibility: 'shared' }), access())).toBe(true);
    expect(canSee(row({ visibility: 'private' }), access())).toBe(false);
  });

  it('a context without a user (a job) sees nothing it was not given the right to see', () => {
    expect(
      canSee(row({ visibility: 'specific', sharedWithMe: false }), access({ userId: null })),
    ).toBe(false);
  });
});
