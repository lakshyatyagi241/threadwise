import { describe, expect, it } from 'vitest';
import { builderHotkey, listHotkey, moveActive } from './hotkeys';

describe('list keys', () => {
  it('maps the documented keys', () => {
    expect(listHotkey({ key: 'j' })).toBe('next');
    expect(listHotkey({ key: 'ArrowDown' })).toBe('next');
    expect(listHotkey({ key: 'k' })).toBe('prev');
    expect(listHotkey({ key: 'ArrowUp' })).toBe('prev');
    expect(listHotkey({ key: 'Enter' })).toBe('open');
    expect(listHotkey({ key: 'x' })).toBe('toggleSelect');
    expect(listHotkey({ key: 'n' })).toBe('newDoc');
    expect(listHotkey({ key: '/' })).toBe('focusSearch');
    expect(listHotkey({ key: 'Escape' })).toBe('clearSelection');
    expect(listHotkey({ key: '?' })).toBe('help');
    expect(listHotkey({ key: 'q' })).toBeNull();
  });

  it('stays out of the way while typing', () => {
    for (const targetTag of ['INPUT', 'TEXTAREA', 'SELECT'])
      expect(listHotkey({ key: 'j', targetTag }), targetTag).toBeNull();
    expect(listHotkey({ key: 'n', targetEditable: true })).toBeNull();
  });

  it('lets a focused button or link keep Enter and Space, but keeps the letters', () => {
    expect(listHotkey({ key: 'Enter', targetTag: 'BUTTON' })).toBeNull();
    expect(listHotkey({ key: ' ', targetTag: 'A' })).toBeNull();
    expect(listHotkey({ key: 'j', targetTag: 'BUTTON' })).toBe('next');
  });

  it('does nothing inside a dialog or menu, or with a modifier held', () => {
    expect(listHotkey({ key: 'j', inDialog: true })).toBeNull();
    expect(listHotkey({ key: 'n', ctrlKey: true })).toBeNull();
    expect(listHotkey({ key: 'n', metaKey: true })).toBeNull();
    expect(listHotkey({ key: 'n', altKey: true })).toBeNull();
  });
});

describe('moving the active row', () => {
  it('lands on an end first, then stays inside the loaded rows', () => {
    expect(moveActive(-1, 5, 'next')).toBe(0);
    expect(moveActive(-1, 5, 'prev')).toBe(4);
    expect(moveActive(2, 5, 'next')).toBe(3);
    expect(moveActive(4, 5, 'next')).toBe(4);
    expect(moveActive(0, 5, 'prev')).toBe(0);
    expect(moveActive(3, 0, 'next')).toBe(-1);
  });
});

describe('builder keys', () => {
  it('saves with Ctrl or Cmd+S, even from inside a field', () => {
    expect(builderHotkey({ key: 's', ctrlKey: true, targetTag: 'INPUT' })).toBe('save');
    expect(builderHotkey({ key: 'S', metaKey: true })).toBe('save');
    expect(builderHotkey({ key: 's' })).toBeNull();
  });
  it('opens Send with Ctrl or Cmd+Enter and adds a row with Alt+N', () => {
    expect(builderHotkey({ key: 'Enter', ctrlKey: true })).toBe('send');
    expect(builderHotkey({ key: 'Enter', metaKey: true })).toBe('send');
    expect(builderHotkey({ key: 'n', altKey: true })).toBe('addRow');
    expect(builderHotkey({ key: 'n' })).toBeNull();
  });
  it('is silent while a dialog is open', () => {
    expect(builderHotkey({ key: 's', ctrlKey: true, inDialog: true })).toBeNull();
  });
});
