import { describe, expect, it } from 'vitest';
import {
  decodeListCursor,
  encodeListCursor,
  likePattern,
} from '../../../src/modules/team-inbox-conversations/conversations.repository';

describe('inbox list cursor', () => {
  it('round-trips microsecond timestamps and the pinned marker without losing precision', () => {
    const c = {
      pinnedAt: '2026-10-02T10:00:00.123456Z',
      lastMessageAt: '2026-10-02T09:59:59.000001Z',
      id: 4242,
    };
    expect(decodeListCursor(encodeListCursor(c))).toEqual(c);
    const unpinned = { pinnedAt: null, lastMessageAt: '2026-10-02T09:59:59.999999Z', id: 7 };
    expect(decodeListCursor(encodeListCursor(unpinned))).toEqual(unpinned);
  });

  it('refuses anything that is not a cursor it made, with a validation error', () => {
    const bad = [
      '',
      'not-base64!',
      Buffer.from('[1,2]').toString('base64url'),
      Buffer.from('[null,"x",1]').toString('base64url'),
      Buffer.from('[null,"2026-10-02T09:59:59Z",1.5]').toString('base64url'),
    ];
    for (const raw of bad)
      expect(() => decodeListCursor(raw), raw).toThrowError(/pagination cursor/i);
  });
});

describe('likePattern', () => {
  it('escapes the characters LIKE treats specially, so a search for 50% looks for a percent sign', () => {
    expect(likePattern('50%')).toBe('%50\\%%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
    expect(likePattern('back\\slash')).toBe('%back\\\\slash%');
    expect(likePattern('plain')).toBe('%plain%');
  });
});
