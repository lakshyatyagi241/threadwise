import { describe, expect, it } from 'vitest';
import {
  neighbourKey,
  neighboursOf,
  quickViewIdOf,
  quickViewPanelOf,
  withQuickView,
} from './quick-view';

const ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
const OTHER = '11111111-1111-4111-8111-111111111111';
const key = (
  k: string,
  mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {},
) => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('quick view URL', () => {
  it('reads a contact id and ignores anything that is not one', () => {
    expect(quickViewIdOf(new URLSearchParams(`contact=${ID}`))).toBe(ID);
    expect(quickViewIdOf(new URLSearchParams(`contact=${ID.toUpperCase()}`))).toBe(ID);
    for (const bad of ['', 'abc', '1', `${ID}x`, 'a;b']) {
      expect(quickViewIdOf(new URLSearchParams({ contact: bad })), bad).toBe('');
    }
    expect(quickViewIdOf(new URLSearchParams(''))).toBe('');
  });

  it('reads the panel, the overview when absent or unknown', () => {
    expect(quickViewPanelOf(new URLSearchParams('panel=notes'))).toBe('notes');
    expect(quickViewPanelOf(new URLSearchParams('panel=nope'))).toBe('overview');
    expect(quickViewPanelOf(new URLSearchParams(''))).toBe('overview');
  });

  it('opens and closes without touching the list filters', () => {
    expect(withQuickView('?q=ana&page=3', ID)).toBe(`?q=ana&page=3&contact=${ID}`);
    expect(withQuickView('?q=ana', ID, 'notes')).toBe(`?q=ana&contact=${ID}&panel=notes`);
    expect(withQuickView(`?q=ana&contact=${ID}&panel=notes`, '')).toBe('?q=ana');
    expect(withQuickView(`?contact=${ID}`, '')).toBe('');
    // moving to another contact replaces the pair
    expect(withQuickView(`?contact=${ID}&panel=notes`, OTHER, 'overview')).toBe(
      `?contact=${OTHER}`,
    );
  });
});

describe('neighboursOf', () => {
  it('finds the contacts around one on the loaded page', () => {
    expect(neighboursOf(['a', 'b', 'c'], 'b')).toEqual({ index: 1, previous: 'a', next: 'c' });
    expect(neighboursOf(['a', 'b', 'c'], 'a')).toEqual({ index: 0, previous: null, next: 'b' });
    expect(neighboursOf(['a', 'b', 'c'], 'c')).toEqual({ index: 2, previous: 'b', next: null });
  });
  it('has no neighbours for a contact that is not on the page', () => {
    expect(neighboursOf(['a', 'b'], 'z')).toEqual({ index: -1, previous: null, next: null });
    expect(neighboursOf([], 'a')).toEqual({ index: -1, previous: null, next: null });
  });
});

describe('neighbourKey', () => {
  it('maps the arrow keys, mirrored in a right-to-left page', () => {
    expect(neighbourKey(key('ArrowLeft'), null)).toBe('previous');
    expect(neighbourKey(key('ArrowRight'), null)).toBe('next');
    expect(neighbourKey(key('ArrowUp'), null)).toBe('previous');
    expect(neighbourKey(key('ArrowDown'), null)).toBe('next');
    expect(neighbourKey(key('ArrowLeft'), null, true)).toBe('next');
    expect(neighbourKey(key('ArrowRight'), null, true)).toBe('previous');
    expect(neighbourKey(key('Enter'), null)).toBeNull();
  });

  it('leaves the arrows alone while the person types or uses a control that owns them', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(neighbourKey(key('ArrowRight'), { tagName }), tagName).toBeNull();
    }
    expect(neighbourKey(key('ArrowRight'), { tagName: 'DIV', isContentEditable: true })).toBeNull();
    for (const role of ['tab', 'menuitem', 'radio', 'option', 'slider']) {
      expect(
        neighbourKey(key('ArrowRight'), { tagName: 'BUTTON', getAttribute: () => role }),
        role,
      ).toBeNull();
    }
    expect(neighbourKey(key('ArrowRight'), { tagName: 'BUTTON', getAttribute: () => null })).toBe(
      'next',
    );
  });

  it('ignores a modified arrow (browser and OS shortcuts)', () => {
    for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(neighbourKey(key('ArrowLeft', { [mod]: true }), null), mod).toBeNull();
    }
  });
});
