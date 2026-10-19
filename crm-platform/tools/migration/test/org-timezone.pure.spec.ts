import { describe, expect, it } from 'vitest';
import {
  ADDITIONAL_OWNER_EMAIL,
  DEFAULT_TIMEZONE,
  resolveAdditionalOwner,
  resolveTimezone,
} from '../load/org';

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

describe('resolveAdditionalOwner', () => {
  it('adds lakshya.tyagi@geta.ai by default', () => {
    expect(resolveAdditionalOwner({})).toBe('lakshya.tyagi@geta.ai');
    expect(ADDITIONAL_OWNER_EMAIL).toBe('lakshya.tyagi@geta.ai');
  });

  it('can be replaced, lower-cased, or turned off', () => {
    expect(resolveAdditionalOwner({ additionalOwnerEmail: ' Ops@Geta.AI ' })).toBe('ops@geta.ai');
    expect(resolveAdditionalOwner({ additionalOwnerEmail: null })).toBeNull();
    expect(resolveAdditionalOwner({ additionalOwnerEmail: '  ' })).toBeNull();
  });

  it('adds nobody when it is already the customer owner', () => {
    expect(resolveAdditionalOwner({ ownerEmail: 'Lakshya.Tyagi@geta.ai' })).toBeNull();
  });
});
