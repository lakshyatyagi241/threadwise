import { afterEach, describe, expect, it, vi } from 'vitest';
import { timezoneList } from './timezones';

describe('timezoneList', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers Asia/Kolkata after the saved value moves off it, even when the browser lists only Asia/Calcutta', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue([
      'Asia/Calcutta',
      'Asia/Colombo',
      'Europe/London',
    ]);
    const z = timezoneList('Asia/Colombo');
    expect(z).toContain('Asia/Kolkata');
    expect(z).not.toContain('Asia/Calcutta');
    expect(z.filter((x) => x === 'Asia/Colombo')).toHaveLength(1);
  });

  it('lists real zones with UTC present', () => {
    const z = timezoneList();
    expect(z).toContain('UTC');
    expect(z.some((x) => x.startsWith('Asia/'))).toBe(true);
  });
  it('keeps a saved value that is not on the browser list, first', () => {
    expect(timezoneList('Mars/Olympus')[0]).toBe('Mars/Olympus');
    expect(timezoneList('Europe/London').filter((x) => x === 'Europe/London')).toHaveLength(1);
  });
});
