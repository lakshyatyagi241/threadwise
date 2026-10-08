import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissFlash, flash, FLASH_EXPIRES_MS, resetFlashForTests, getFlash } from './flash-store';

afterEach(() => {
  vi.useRealTimers();
  resetFlashForTests();
});

describe('shell flash (TW-ASHELL-007)', () => {
  it('carries a warning with its values to the page that is landed on', () => {
    expect(getFlash()).toBeNull();
    flash('roleDenied', 'warning', { role: 'Agent' });
    expect(getFlash()).toMatchObject({
      key: 'roleDenied',
      tone: 'warning',
      values: { role: 'Agent' },
    });
    dismissFlash();
    expect(getFlash()).toBeNull();
  });

  it('a newer flash replaces the older one and the older timer cannot clear it', () => {
    vi.useFakeTimers();
    flash('a');
    vi.advanceTimersByTime(FLASH_EXPIRES_MS - 1000);
    flash('b', 'danger');
    vi.advanceTimersByTime(1500);
    expect(getFlash()?.key).toBe('b');
  });

  it('a flash nobody saw expires', () => {
    vi.useFakeTimers();
    flash('a');
    vi.advanceTimersByTime(FLASH_EXPIRES_MS + 1);
    expect(getFlash()).toBeNull();
  });
});
