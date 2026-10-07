import { describe, expect, it } from 'vitest';
import {
  SEGMENT_SHARE_MAX,
  buildShareOptions,
  emptySelection,
  filterShareOptions,
  selectedChips,
  selectionSignature,
  selectionSize,
  shareSummary,
  toggleShare,
  type ShareOption,
} from './share';

const options: ShareOption[] = [
  { kind: 'user', id: 'u1', name: 'Asha Rao', email: 'asha@example.com' },
  { kind: 'user', id: 'u2', name: 'Ravi Menon', email: 'ravi@corp.test' },
  { kind: 'team', id: 't1', name: 'Sales', email: null, memberCount: 4 },
];

describe('toggleShare', () => {
  it('adds a person or team once and removes it again', () => {
    let s = emptySelection();
    s = toggleShare(s, 'user', 'u1', true);
    s = toggleShare(s, 'user', 'u1', true);
    s = toggleShare(s, 'team', 't1', true);
    expect(s).toEqual({ userIds: ['u1'], teamIds: ['t1'] });
    s = toggleShare(s, 'user', 'u1', false);
    expect(s).toEqual({ userIds: [], teamIds: ['t1'] });
    expect(toggleShare(s, 'user', 'zzz', false)).toBe(s);
  });

  it('stops at the cap the contract sets', () => {
    const full = {
      userIds: Array.from({ length: SEGMENT_SHARE_MAX }, (_, i) => `u${i}`),
      teamIds: [],
    };
    expect(toggleShare(full, 'user', 'extra', true)).toBe(full);
    expect(selectionSize(toggleShare(full, 'user', 'u0', false))).toBe(SEGMENT_SHARE_MAX - 1);
  });
});

describe('filterShareOptions', () => {
  it('matches name or email, any case; blank keeps everything', () => {
    expect(filterShareOptions(options, 'RAVI').map((o) => o.id)).toEqual(['u2']);
    expect(filterShareOptions(options, 'example.com').map((o) => o.id)).toEqual(['u1']);
    expect(filterShareOptions(options, '  ')).toHaveLength(3);
    expect(filterShareOptions(options, 'nobody')).toEqual([]);
  });
});

describe('buildShareOptions', () => {
  it('lists active people by name, then teams, and leaves out inactive people', () => {
    const out = buildShareOptions(
      [
        { id: 'b', fullName: 'Bela', email: 'b@x.test', status: 'active' },
        { id: 'a', fullName: 'Asha' },
        { id: 'c', fullName: 'Cleo', status: 'inactive' },
      ],
      [{ id: 't', name: 'Sales', members: [1, 2] }],
    );
    expect(out.map((o) => `${o.kind}:${o.id}`)).toEqual(['user:a', 'user:b', 'team:t']);
    expect(out[2]!.memberCount).toBe(2);
  });

  it('works while a lookup has not loaded', () => {
    expect(buildShareOptions(undefined, undefined)).toEqual([]);
  });
});

describe('selectedChips', () => {
  it('keeps the order picked, and falls back to the names the server sent', () => {
    const chips = selectedChips({ userIds: ['u2', 'u9'], teamIds: ['t1'] }, options, {
      users: [{ id: 'u9', name: 'Left Co', email: null }],
      teams: [],
    });
    expect(chips.map((c) => c.name)).toEqual(['Ravi Menon', 'Left Co', 'Sales']);
  });

  it('shows the id rather than nothing when a pick is unknown everywhere', () => {
    expect(selectedChips({ userIds: ['u9'], teamIds: [] }, [], undefined)[0]!.name).toBe('u9');
  });
});

describe('shareSummary', () => {
  it('counts people and teams and caps the names', () => {
    const users = Array.from({ length: 10 }, (_, i) => ({
      id: `u${i}`,
      name: `P${i}`,
      email: null,
    }));
    const s = shareSummary({ users, teams: [{ id: 't', name: 'Sales', memberCount: 2 }] }, 8);
    expect(s.count).toBe(11);
    expect(s.names).toHaveLength(8);
    expect(s.more).toBe(3);
    expect(shareSummary({ users: [], teams: [] })).toEqual({ count: 0, names: [], more: 0 });
  });
});

describe('selectionSignature', () => {
  it('does not depend on the order', () => {
    expect(selectionSignature({ userIds: ['b', 'a'], teamIds: [] })).toBe(
      selectionSignature({ userIds: ['a', 'b'], teamIds: [] }),
    );
  });
});
