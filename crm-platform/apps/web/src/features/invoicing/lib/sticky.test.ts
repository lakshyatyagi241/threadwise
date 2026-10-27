import { describe, expect, it } from 'vitest';
import { STICKY_FIRST, STICKY_ONLY, STICKY_SELECT, STICKY_FIRST_HEAD } from './sticky';

describe('frozen cells', () => {
  // The row menu sits in the first cell, whose z-10 is its own stacking context. Without a higher z-index while the menu is open,
  // the sticky header (z-20, z-30) is drawn over the menu's panel and hides its middle items.
  it.each([
    ['STICKY_SELECT', STICKY_SELECT],
    ['STICKY_FIRST', STICKY_FIRST],
    ['STICKY_ONLY', STICKY_ONLY],
  ])('%s rises above the sticky header while a menu is open', (_name, cls) => {
    expect(cls).toContain('has-[[role=menu]]:z-40');
  });

  it('keeps the header below an open menu', () => {
    expect(STICKY_FIRST_HEAD).toContain('z-30');
  });
});
