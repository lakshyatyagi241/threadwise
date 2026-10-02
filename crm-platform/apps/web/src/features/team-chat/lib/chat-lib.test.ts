import { describe, expect, it } from 'vitest';
import { parseBody, plainBody } from './body';
import { errorKind } from './errors';
import { canEditNow, formatStamp, initials, nearBottom } from './format';
import {
  detectMention,
  filterMentionable,
  insertMention,
  mentionToken,
  moveIndex,
} from './mention';
import { EMPTY_THREAD, groupByDay, mergeById, threadReducer, type Pending } from './thread';

const ID = '3f2b8c1e-8c1a-4a55-9d3e-1b2c3d4e5f60';
const msg = (id: string, at = '2026-01-01T10:00:00Z') => ({ id, createdAt: at }) as never;
const pending = (key: string): Pending => ({
  key,
  body: 'hi',
  replyToId: null,
  file: null,
  status: 'sending',
  progress: 0,
  error: null,
  createdAt: '2026-01-01T10:00:00Z',
});

describe('body', () => {
  it('splits text and mention tokens, and shows tokens as @Name', () => {
    const body = `hi @[Sam](${ID.toUpperCase()}) bye`;
    expect(parseBody(body)).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'mention', name: 'Sam', userId: ID },
      { type: 'text', text: ' bye' },
    ]);
    expect(plainBody(body)).toBe('hi @Sam bye');
  });
});

describe('mention', () => {
  it('detects an @word at the caret only after whitespace or the start', () => {
    expect(detectMention('hi @sa', 6)).toEqual({ start: 3, query: 'sa' });
    expect(detectMention('a@b', 3)).toBeNull();
    expect(detectMention('@', 1)).toEqual({ start: 0, query: '' });
  });
  it('filters by name or email, excludes the caller, caps the rows', () => {
    const people = [
      { id: 'me', name: 'Me', email: 'me@x.io' },
      { id: 'a', name: 'Sam', email: 'sam@x.io' },
      { id: 'b', name: 'Tom', email: 'sa@x.io' },
    ];
    expect(filterMentionable(people, 'sa', 'me').map((p) => p.id)).toEqual(['a', 'b']);
    expect(filterMentionable(people, '', 'me', 1)).toHaveLength(1);
  });
  it('inserts the token over the typed prefix and wraps the arrow index', () => {
    expect(mentionToken({ id: 'u', name: 'A]\nB' })).toBe('@[A  B](u)');
    expect(insertMention('hi @sa', 3, 6, { id: 'u', name: 'Sam' })).toEqual({
      text: 'hi @[Sam](u) ',
      caret: 13,
    });
    expect(moveIndex(0, 3, -1)).toBe(2);
    expect(moveIndex(2, 3, 1)).toBe(0);
    expect(moveIndex(0, 0, 1)).toBe(0);
  });
});

describe('format', () => {
  it('initials, edit window, scroll follow, stamp', () => {
    expect(initials('  ada  lovelace ')).toBe('AL');
    expect(initials('')).toBe('?');
    const t = '2026-01-01T10:00:00Z';
    expect(canEditNow(t, Date.parse(t) + 15 * 60_000)).toBe(true);
    expect(canEditNow(t, Date.parse(t) + 15 * 60_000 + 1)).toBe(false);
    expect(nearBottom(1000, 850, 100)).toBe(true);
    expect(nearBottom(1000, 700, 100)).toBe(false);
    expect(formatStamp(t, new Date(t), 'en-US')).not.toContain(',');
    expect(formatStamp(t, new Date('2026-02-01T10:00:00Z'), 'en-US')).toContain(',');
  });
});

describe('thread', () => {
  it('merges by id keeping order, replacing known copies', () => {
    const a = msg('1');
    const out = mergeById([a, msg('2')], [{ ...a, body: 'x' } as never, msg('3')]);
    expect(out.map((m) => m.id)).toEqual(['1', '2', '3']);
    expect((out[0] as never as { body: string }).body).toBe('x');
  });
  it('a send becomes confirmed once; a failure keeps the draft for retry', () => {
    let s = threadReducer(
      { ...EMPTY_THREAD, loaded: true },
      { type: 'send', pending: pending('k') },
    );
    s = threadReducer(s, { type: 'failed', key: 'k', error: 'network' });
    expect(s.pending[0]).toMatchObject({ status: 'failed', error: 'network' });
    s = threadReducer(s, { type: 'retry', key: 'k' });
    expect(s.pending[0]!.status).toBe('sending');
    s = threadReducer(s, { type: 'sent', key: 'k', message: msg('9') });
    expect(s.pending).toEqual([]);
    expect(s.messages.map((m) => m.id)).toEqual(['9']);
  });
  it('groups by day', () => {
    const g = groupByDay(
      [
        msg('1', '2026-01-01T10:00:00Z'),
        msg('2', '2026-01-01T11:00:00Z'),
        msg('3', '2026-01-02T10:00:00Z'),
      ],
      (iso) => iso.slice(0, 10),
    );
    expect(g.map((x) => x.messages.length)).toEqual([2, 1]);
  });
});

describe('errors', () => {
  it('maps codes and falls back', () => {
    expect(errorKind('network')).toBe('network');
    expect(errorKind('SOMETHING_NEW')).toBe('unexpected');
  });
});
