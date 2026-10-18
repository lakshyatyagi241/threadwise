import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE, resolveTimezone } from '../load/org';

describe('resolveTimezone', () => {
  it('defaults to IST when none is given', () => {
    for (const none of [undefined, null, '', '   ']) {
      expect(resolveTimezone(none)).toEqual({ timezone: 'Asia/Kolkata', defaulted: true });
    }
    expect(DEFAULT_TIMEZONE).toBe('Asia/Kolkata');
  });

  it('keeps a valid zone that is given', () => {
    expect(resolveTimezone(' Europe/London ')).toEqual({ timezone: 'Europe/London', defaulted: false });
  });

  it('refuses a zone that is not an IANA zone', () => {
    expect(() => resolveTimezone('Not/AZone')).toThrow(/not an IANA time zone/);
  });
});
