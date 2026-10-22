import { afterEach, describe, expect, it, vi } from 'vitest';
import { isInside } from './row-menu';

describe('row menu scroll guard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is false with no panel or no target (the page moved)', () => {
    expect(isInside(null, null)).toBe(false);
    expect(isInside({ contains: () => true }, null)).toBe(false);
  });

  it('is false for a target that is not a DOM node (a window resize)', () => {
    expect(isInside({ contains: () => true }, {} as EventTarget)).toBe(false);
  });

  it('is true when the scroll comes from a node inside the panel (the column list), false for one outside it', () => {
    class FakeNode {}
    vi.stubGlobal('Node', FakeNode);
    const inside = new FakeNode();
    const outside = new FakeNode();
    const panel = { contains: (n: unknown) => n === inside };
    expect(isInside(panel, inside as unknown as EventTarget)).toBe(true);
    expect(isInside(panel, outside as unknown as EventTarget)).toBe(false);
  });
});
