import { describe, expect, it } from 'vitest';
import type { SavedReply } from '@crm/contracts';
import { insertReply, moveActive, rankReplies, slashTrigger } from './saved-replies';
import {
  EMPTY_DRAFT,
  draftProblems,
  insertAtSelection,
  previewOf,
  toCreateInput,
  toUpdateInput,
} from './saved-reply-form';

const reply = (over: Partial<SavedReply>): SavedReply => ({
  id: over.shortcut ?? 'x',
  shortcut: 'x',
  title: 'T',
  body: 'B',
  category: null,
  language: null,
  channelKinds: [],
  scope: 'shared',
  usedCount: 0,
  lastUsedAt: null,
  createdByName: null,
  canEdit: true,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('slashTrigger', () => {
  it('finds a /query at the start, after a space and after a new line', () => {
    expect(slashTrigger('/', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(slashTrigger('/tha', 4)).toEqual({ start: 0, end: 4, query: 'tha' });
    expect(slashTrigger('hello /th', 9)).toEqual({ start: 6, end: 9, query: 'th' });
    expect(slashTrigger('line\n/x', 7)).toEqual({ start: 5, end: 7, query: 'x' });
  });
  it('ignores a slash inside a word, a URL, a closed word and a caret at the start', () => {
    expect(slashTrigger('a/b', 3)).toBeNull();
    expect(slashTrigger('https://x', 9)).toBeNull();
    expect(slashTrigger('//x', 3)).toBeNull();
    expect(slashTrigger('/thanks and more', 16)).toBeNull();
    expect(slashTrigger('/abc', 0)).toBeNull();
    expect(slashTrigger('', 0)).toBeNull();
  });
  it('follows the caret in the middle of the text', () => {
    expect(slashTrigger('/thanks and more', 3)).toEqual({ start: 0, end: 3, query: 'th' });
  });
});

describe('rankReplies', () => {
  const list = [
    reply({
      shortcut: 'refund_policy',
      title: 'Refunds',
      body: 'We refund in 5 days',
      usedCount: 9,
    }),
    reply({ shortcut: 'thanks', title: 'Thank you', body: 'Thanks!', usedCount: 1 }),
    reply({ shortcut: 'thanks', title: 'My thanks', body: 'Cheers', scope: 'mine', usedCount: 0 }),
    reply({ shortcut: 'hello', title: 'Greeting', body: 'Say thanks for waiting', usedCount: 5 }),
  ];
  it('puts exact shortcut first, then prefix, title, then anything containing it', () => {
    const r = rankReplies(list, 'thanks');
    expect(r.map((x) => x.title)).toEqual(['My thanks', 'Thank you', 'Greeting']);
  });
  it('without a query keeps the most used first', () => {
    expect(rankReplies(list, '').map((x) => x.shortcut)[0]).toBe('refund_policy');
  });
  it('ignores a leading slash, case and accents; no match is empty', () => {
    expect(rankReplies([reply({ shortcut: 'café', title: 'Café' })], '/CAFE')).toHaveLength(1);
    expect(rankReplies(list, 'zzz')).toEqual([]);
  });
});

describe('insertReply', () => {
  it('replaces the typed /query and puts the caret after the reply', () => {
    expect(insertReply('hi /th', { start: 3, end: 6 }, 'Thanks, Amira!', 100)).toEqual({
      text: 'hi Thanks, Amira!',
      caret: 17,
    });
  });
  it('replaces a selection or inserts at the caret', () => {
    expect(insertReply('abcdef', { start: 2, end: 4 }, 'XY', 100)).toEqual({
      text: 'abXYef',
      caret: 4,
    });
    expect(insertReply('ab', { start: 2, end: 2 }, 'Z', 100)).toEqual({ text: 'abZ', caret: 3 });
  });
  it('refuses a result longer than the channel allows, and takes exactly the limit', () => {
    expect(insertReply('', { start: 0, end: 0 }, 'x'.repeat(11), 10)).toBeNull();
    expect(insertReply('', { start: 0, end: 0 }, 'x'.repeat(10), 10)?.text).toHaveLength(10);
  });
});

describe('moveActive', () => {
  it('wraps both ways and survives an empty list', () => {
    expect(moveActive(0, 3, 'ArrowDown')).toBe(1);
    expect(moveActive(2, 3, 'ArrowDown')).toBe(0);
    expect(moveActive(0, 3, 'ArrowUp')).toBe(2);
    expect(moveActive(0, 0, 'ArrowDown')).toBe(0);
  });
});

describe('form model', () => {
  it('flags what is missing before saving', () => {
    expect(draftProblems(EMPTY_DRAFT)).toEqual({
      shortcut: 'shortcutEmpty',
      title: 'titleEmpty',
      body: 'bodyEmpty',
    });
    expect(
      draftProblems({ ...EMPTY_DRAFT, shortcut: 'a', title: 'b', body: 'c', language: 'english!' }),
    ).toEqual({ language: 'languageFormat' });
    expect(
      draftProblems({ ...EMPTY_DRAFT, shortcut: 'a', title: 'b', body: 'x'.repeat(4001) }).body,
    ).toBe('bodyLong');
  });
  it('builds the API body: shortcut normalised, empty optional fields null', () => {
    const d = {
      ...EMPTY_DRAFT,
      shortcut: '/Thank You',
      title: ' T ',
      body: ' B ',
      scope: 'mine' as const,
    };
    expect(toCreateInput(d)).toMatchObject({
      shortcut: 'thank_you',
      title: 'T',
      body: 'B',
      category: null,
      language: null,
      scope: 'mine',
    });
    expect(toUpdateInput(d, 4)).toMatchObject({ rowVersion: 4, shortcut: 'thank_you' });
  });
  it('previews with sample data and leaves other variables visible', () => {
    const p = previewOf('Hi {{first_name}} {{city}}');
    expect(p.text).toBe('Hi Amira {{city}}');
    expect(p.issues).toHaveLength(1);
  });
  it('inserts a variable at the selection', () => {
    expect(insertAtSelection('Hi !', { start: 3, end: 3 }, '{{name}}')).toEqual({
      value: 'Hi {{name}}!',
      caret: 11,
    });
  });
});
