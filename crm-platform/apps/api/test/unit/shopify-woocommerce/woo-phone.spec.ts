import { describe, expect, it } from 'vitest';
import { COUNTRY_DIAL } from '../../../src/modules/shopify-woocommerce/country-dial';
import { e164, wooPhoneOf } from '../../../src/modules/shopify-woocommerce/woo-phone';

describe('a WooCommerce phone number in E.164 (WD-ECOM-028)', () => {
  it('has the dialing codes of the countries WaDesk lists', () => {
    expect(Object.keys(COUNTRY_DIAL).length).toBeGreaterThan(200);
    expect(COUNTRY_DIAL.in).toBe('91');
    expect(COUNTRY_DIAL.ng).toBe('234');
    expect(COUNTRY_DIAL.us).toBe('1');
  });

  it('trusts a number that starts with + or 00, minus the symbols', () => {
    expect(e164('+91 98765-43210', 'NG')).toBe('919876543210');
    expect(e164('0091 9876543210', 'NG')).toBe('919876543210');
    expect(e164('00 234 801 234 5678')).toBe('2348012345678');
  });

  it('puts the country code in front of a local number and drops the trunk zero', () => {
    expect(e164('08012345678', 'NG')).toBe('2348012345678');
    expect(e164('9876543210', 'in')).toBe('919876543210');
    expect(e164('(555) 010-9999', 'US')).toBe('15550109999');
    expect(e164('0 801', 'NG')).toBe('234801');
    // A leading 00 is an international prefix, so 000801 is read as 801, not as a local number.
    expect(e164('000801', 'NG')).toBe('801');
  });

  it('keeps a number that already carries the code and is long enough to be international', () => {
    expect(e164('919876543210', 'IN')).toBe('919876543210');
    expect(e164('2348012345678', 'NG')).toBe('2348012345678');
  });

  it('does not mistake a local number that merely starts with the same digits for an international one', () => {
    // 91 followed by only 5 more digits is a short local number, so it gets the code in front.
    expect(e164('9112345', 'IN')).toBe('919112345');
  });

  it('returns the digits as they are with no country and no +, and null for nothing usable', () => {
    expect(e164('987-654-3210')).toBe('9876543210');
    expect(e164('987', 'ZZ')).toBe('987');
    expect(e164('987', 'xyz')).toBe('987');
    expect(e164('')).toBeNull();
    expect(e164('   ')).toBeNull();
    expect(e164(null)).toBeNull();
    expect(e164('abc')).toBeNull();
  });

  it('reads an order: billing phone and country first, then shipping, then the top-level and customer fields', () => {
    expect(wooPhoneOf({ billing: { phone: '08012345678', country: 'NG' } })).toBe('2348012345678');
    expect(
      wooPhoneOf({
        billing: { phone: '', country: '' },
        shipping: { phone: '9876543210', country: 'IN' },
      }),
    ).toBe('919876543210');
    expect(wooPhoneOf({ phone: '+15550109999' })).toBe('15550109999');
    expect(wooPhoneOf({ customer: { phone: '9876543210', billing: { country: 'IN' } } })).toBe(
      '919876543210',
    );
    expect(wooPhoneOf({ billing: { phone: 5551234567, country: 'US' } })).toBe('15551234567');
    expect(wooPhoneOf({})).toBeNull();
  });
});
