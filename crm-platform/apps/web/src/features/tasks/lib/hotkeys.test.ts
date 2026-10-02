import { describe, expect, it } from 'vitest';
import { hotkeyAction, moveActive } from './hotkeys';

describe('hotkeyAction', () => {
  it('maps the list shortcuts', () => {
    expect(hotkeyAction({ key: 'j' })).toBe('next');
    expect(hotkeyAction({ key: 'ArrowDown' })).toBe('next');
    expect(hotkeyAction({ key: 'k' })).toBe('prev');
    expect(hotkeyAction({ key: 'Enter' })).toBe('open');
    expect(hotkeyAction({ key: 'e' })).toBe('toggleComplete');
    expect(hotkeyAction({ key: 'x' })).toBe('toggleSelect');
    expect(hotkeyAction({ key: 'n' })).toBe('newTask');
    expect(hotkeyAction({ key: '/' })).toBe('focusSearch');
    expect(hotkeyAction({ key: 'Escape' })).toBe('clearSelection');
    expect(hotkeyAction({ key: '?' })).toBe('help');
    expect(hotkeyAction({ key: 'q' })).toBeNull();
  });
  it('stays out of the way while typing', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(hotkeyAction({ key: 'n', targetTag: tag })).toBeNull();
    }
    expect(hotkeyAction({ key: 'n', targetEditable: true })).toBeNull();
  });
  it('lets a focused button or link keep Enter', () => {
    expect(hotkeyAction({ key: 'Enter', targetTag: 'BUTTON' })).toBeNull();
    expect(hotkeyAction({ key: 'Enter', targetTag: 'A' })).toBeNull();
    expect(hotkeyAction({ key: 'j', targetTag: 'BUTTON' })).toBe('next');
  });
  it('is silent in a dialog or with a modifier held', () => {
    expect(hotkeyAction({ key: 'n', inDialog: true })).toBeNull();
    expect(hotkeyAction({ key: 'n', ctrlKey: true })).toBeNull();
    expect(hotkeyAction({ key: 'n', metaKey: true })).toBeNull();
    expect(hotkeyAction({ key: 'n', altKey: true })).toBeNull();
  });
});

describe('moveActive', () => {
  it('lands on an end for the first move and then steps within bounds', () => {
    expect(moveActive(-1, 5, 'next')).toBe(0);
    expect(moveActive(-1, 5, 'prev')).toBe(4);
    expect(moveActive(0, 5, 'prev')).toBe(0);
    expect(moveActive(4, 5, 'next')).toBe(4);
    expect(moveActive(2, 5, 'next')).toBe(3);
  });
  it('has nowhere to go in an empty list', () => {
    expect(moveActive(-1, 0, 'next')).toBe(-1);
  });
});
