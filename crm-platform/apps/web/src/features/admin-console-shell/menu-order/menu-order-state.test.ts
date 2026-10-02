import { describe, expect, it } from 'vitest';
import type { NavLayoutKey } from '@crm/contracts';
import { addToBar, moveInBar, removeFromBar } from './menu-order-state';

const bar: NavLayoutKey[] = ['dashboard', 'flows', 'more'];

describe('menu order edits', () => {
  it('moves an entry and stops at the ends', () => {
    expect(moveInBar(bar, 'flows', -1)).toEqual(['flows', 'dashboard', 'more']);
    expect(moveInBar(bar, 'dashboard', -1)).toEqual(bar);
  });
  it('never moves past or moves the locked More entry', () => {
    expect(moveInBar(bar, 'flows', 1)).toEqual(bar);
    expect(moveInBar(bar, 'more', -1)).toEqual(bar);
  });
  it('adds before More and removes, but More cannot be removed', () => {
    expect(addToBar(bar, 'broadcasts')).toEqual(['dashboard', 'flows', 'broadcasts', 'more']);
    expect(removeFromBar(bar, 'flows')).toEqual(['dashboard', 'more']);
    expect(removeFromBar(bar, 'more')).toEqual(bar);
  });
});
