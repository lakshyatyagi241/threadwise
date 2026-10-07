import { describe, expect, it } from 'vitest';
import { timezoneList } from './timezones';

describe('timezoneList', () => {
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
