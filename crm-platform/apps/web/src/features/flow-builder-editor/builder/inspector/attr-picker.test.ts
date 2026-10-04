import { describe, expect, it } from 'vitest';
import {
  attrEntries,
  filterAttrs,
  findSlashQuery,
  insertAttrToken,
  SLASH_QUERY_MAX,
  stepActive,
} from './attr-picker';

describe('findSlashQuery', () => {
  it('opens on a slash at the start of the text', () => {
    expect(findSlashQuery('/', 1)).toEqual({ start: 0, query: '' });
    expect(findSlashQuery('/na', 3)).toEqual({ start: 0, query: 'na' });
  });

  it('opens on a slash after whitespace', () => {
    expect(findSlashQuery('Hi /fi', 6)).toEqual({ start: 3, query: 'fi' });
    expect(findSlashQuery('Hi\n/', 4)).toEqual({ start: 3, query: '' });
  });

  it('ignores a slash inside a word or a URL', () => {
    expect(findSlashQuery('https://x.com', 13)).toBeNull();
    expect(findSlashQuery('a/b', 3)).toBeNull();
  });

  it('closes once a space follows the slash token', () => {
    expect(findSlashQuery('/name ', 6)).toBeNull();
    expect(findSlashQuery('/name\nrest', 10)).toBeNull();
  });

  it('closes on a query longer than 24 characters', () => {
    expect(findSlashQuery('/' + 'a'.repeat(SLASH_QUERY_MAX), SLASH_QUERY_MAX + 1)).not.toBeNull();
    expect(findSlashQuery('/' + 'a'.repeat(SLASH_QUERY_MAX + 1), SLASH_QUERY_MAX + 2)).toBeNull();
  });

  it('only looks at the text before the caret', () => {
    expect(findSlashQuery('/name rest', 3)).toEqual({ start: 0, query: 'na' });
    expect(findSlashQuery('hello', 5)).toBeNull();
  });
});

describe('insertAttrToken', () => {
  it('swaps the slash token for the {{key}} token and moves the caret after it', () => {
    expect(insertAttrToken('Hi /fi', 3, 6, 'first_name')).toEqual({
      text: 'Hi {{first_name}}',
      caret: 17,
    });
  });

  it('keeps the text after the caret', () => {
    expect(insertAttrToken('/ there', 0, 1, 'name')).toEqual({
      text: '{{name}} there',
      caret: 8,
    });
  });
});

describe('filterAttrs / attrEntries', () => {
  const entries = attrEntries({
    system: [{ key: 'first_name', name: 'First name', description: 'The first name' }],
    custom: [{ key: 'plan', name: 'Plan', description: null }],
  });

  it('maps the feed to system then custom entries', () => {
    expect(entries.map((e) => `${e.kind}:${e.key}`)).toEqual(['system:first_name', 'custom:plan']);
    expect(entries[1]?.description).toBe('');
  });

  it('falls back to the built-in tokens before the feed arrives', () => {
    const fallback = attrEntries(undefined);
    expect(fallback.length).toBeGreaterThan(5);
    expect(fallback.every((e) => e.kind === 'system')).toBe(true);
    expect(fallback.some((e) => e.key === 'name')).toBe(true);
  });

  it('matches key, name and description case-insensitively', () => {
    expect(filterAttrs(entries, '')).toHaveLength(2);
    expect(filterAttrs(entries, 'FIRST').map((e) => e.key)).toEqual(['first_name']);
    expect(filterAttrs(entries, 'pla').map((e) => e.key)).toEqual(['plan']);
    expect(filterAttrs(entries, 'zzz')).toEqual([]);
  });
});

describe('stepActive', () => {
  it('wraps in both directions and survives an empty list', () => {
    expect(stepActive(0, 3, -1)).toBe(2);
    expect(stepActive(2, 3, 1)).toBe(0);
    expect(stepActive(1, 3, 1)).toBe(2);
    expect(stepActive(0, 0, 1)).toBe(0);
  });
});
