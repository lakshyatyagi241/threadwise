import { describe, expect, it } from 'vitest';
import {
  allIndexPath,
  childPath,
  chosenPath,
  hasIndex,
  insertAt,
  isUsablePath,
  leavesOf,
  removeTokenBefore,
} from './paths';

describe('paths', () => {
  it('builds the paths the API reads', () => {
    expect(childPath('', 'data')).toBe('data');
    expect(childPath('data.items', 0)).toBe('data.items[0]');
    expect(childPath('data.items[0]', 'name')).toBe('data.items[0].name');
  });

  it('turns an item path into the every-item path', () => {
    expect(allIndexPath('data.items[2].tags[0]')).toBe('data.items[].tags[]');
    expect(hasIndex('data.items[2].name')).toBe(true);
    expect(hasIndex('data.name')).toBe(false);
  });

  it('accepts only paths the API accepts', () => {
    expect(isUsablePath('data.items[].name')).toBe(true);
    expect(isUsablePath('a b')).toBe(false);
    expect(isUsablePath('a.[0]')).toBe(false);
  });

  it('lists every value with its path, and stops at the cap', () => {
    const json = { data: { id: 7, items: [{ name: 'a' }, { name: null }] }, ok: true };
    expect(leavesOf(json)).toEqual([
      { path: 'data.id', value: '7' },
      { path: 'data.items[0].name', value: 'a' },
      { path: 'data.items[1].name', value: 'null' },
      { path: 'ok', value: 'true' },
    ]);
    expect(
      leavesOf(
        Array.from({ length: 50 }, (_, i) => i),
        10,
      ),
    ).toHaveLength(10);
  });

  it('knows a chosen path by its exact or its every-item form', () => {
    expect(chosenPath('a.b[1].c', ['a.b[].c'])).toBe('a.b[].c');
    expect(chosenPath('a.b[1].c', ['a.b[1].c'])).toBe('a.b[1].c');
    expect(chosenPath('a.b', ['a.c'])).toBeNull();
  });
});

describe('variable chips in a text', () => {
  it('Backspace right after a token removes it whole', () => {
    expect(removeTokenBefore('a {{phone}} b', 11)).toEqual({ text: 'a  b', caret: 2 });
    expect(removeTokenBefore('{{a}}{{b}}', 10)).toEqual({ text: '{{a}}', caret: 5 });
  });
  it('leaves other Backspaces to the browser', () => {
    expect(removeTokenBefore('abc', 3)).toBeNull();
    expect(removeTokenBefore('{{a}} x', 7)).toBeNull();
    expect(removeTokenBefore('{{a}', 4)).toBeNull();
  });
  it('inserts at the caret or over the selection', () => {
    expect(insertAt('ab', 1, 1, '{{x}}')).toEqual({ text: 'a{{x}}b', caret: 6 });
    expect(insertAt('abc', 0, 2, 'Z')).toEqual({ text: 'Zc', caret: 1 });
  });
});
