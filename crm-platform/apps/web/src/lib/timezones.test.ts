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

  it('shows a saved legacy name once, without its modern id beside it', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Asia/Calcutta', 'Asia/Colombo']);
    const z = timezoneList('Asia/Calcutta');
    expect(z.filter((x) => x === 'Asia/Calcutta')).toHaveLength(1);
    expect(z).not.toContain('Asia/Kolkata');
  });

  it('lists Asia/Kolkata once when the browser lists both spellings', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue([
      'Asia/Calcutta',
      'Asia/Kolkata',
      'Europe/London',
    ]);
    expect(timezoneList().filter((x) => x === 'Asia/Kolkata')).toHaveLength(1);
  });

  it('puts UTC first when the browser list leaves it out', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Asia/Colombo', 'Europe/London']);
    expect(timezoneList()).toEqual(['UTC', 'Asia/Colombo', 'Asia/Kolkata', 'Europe/London']);
  });

  it('still lists UTC and Asia/Kolkata when the browser cannot list zones', () => {
    const intl = Intl as unknown as { supportedValuesOf?: unknown };
    const original = intl.supportedValuesOf;
    delete intl.supportedValuesOf;
    try {
      expect(timezoneList()).toEqual(['UTC', 'Asia/Kolkata']);
    } finally {
      intl.supportedValuesOf = original;
    }
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
