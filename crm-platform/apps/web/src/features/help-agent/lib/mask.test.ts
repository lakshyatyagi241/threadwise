import { describe, expect, it } from 'vitest';
import { MASK, maskPageContent } from './mask';

describe('help agent mask: free text', () => {
  it('hides e-mail addresses', () => {
    const out = maskPageContent('Contact maria.lopez+crm@example.co.uk wrote to sales@x.io');
    expect(out).not.toMatch(/@/);
    expect(out).toBe(`Contact ${MASK} wrote to ${MASK}`);
  });

  it('hides phone numbers in the usual spellings', () => {
    for (const phone of [
      '+91 98765 43210',
      '+44 20 7946 0958',
      '(415) 555-2671',
      '415-555-2671',
      '9876543210',
      '+971501234567',
      '0044 20 7946 0958',
      '+1.415.555.2671',
    ]) {
      const out = maskPageContent(`Call ${phone} today`);
      expect(out, phone).toBe(`Call ${MASK} today`);
    }
  });

  it('keeps dates, times, money, counts and the page info the library prints', () => {
    for (const keep of [
      'Created 2026-10-12 at 14:30',
      'Due 12/10/2026',
      'Total ₹1,250,000.00',
      'Order 1234567',
      '25 contacts selected',
      'Page info: 1280x720px viewport, 1280x2400px total page size, 0.0 pages above, 1.3 pages below',
      '[12]<button>Save />',
    ]) {
      expect(maskPageContent(keep), keep).toBe(keep);
    }
  });

  it('hides long numeric ids and card-like numbers', () => {
    expect(maskPageContent('id 123456789012345')).toBe(`id ${MASK}`);
    expect(maskPageContent('card 4242 4242 4242 4242 ok')).toBe(`card ${MASK} ok`);
  });

  it('hides keys, tokens and long hashes', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
    for (const secret of [
      'sk-proj-abcdefghijklmnopqrstuvwx123456',
      jwt,
      'whsec_abcdefghijklmnopqrstuvwxyz0123',
      'a3f5c8e1b2d4a6f8c0e2b4d6a8f0c2e4a6b8d0f2',
      'AKIAIOSFODNN7EXAMPLE12',
    ]) {
      const out = maskPageContent(`secret ${secret} end`);
      expect(out, secret).toBe(`secret ${MASK} end`);
    }
  });

  it('leaves an ordinary sentence and a long word alone', () => {
    const text = 'Connect your WhatsApp Business number under Settings > Channels';
    expect(maskPageContent(text)).toBe(text);
    expect(maskPageContent('internationalization-configuration-management')).toBe(
      'internationalization-configuration-management',
    );
  });

  it('never throws, whatever it is given', () => {
    expect(maskPageContent('')).toBe('');
    expect(() => maskPageContent('\u0000'.repeat(10_000))).not.toThrow();
  });
});

describe('help agent mask: the value of a personal field', () => {
  it('hides the value of a phone, e-mail or address input, keeping the rest of the line', () => {
    expect(
      maskPageContent(
        '*[1]<input type=tel name=phone value=+91 98765 43210 placeholder=Phone number id=p />',
      ),
    ).toBe(`*[1]<input type=tel name=phone value=${MASK} placeholder=Phone number id=p />`);
    expect(maskPageContent('[2]<input type=email value=maria@example.com id=e />')).toBe(
      `[2]<input type=email value=${MASK} id=e />`,
    );
    expect(maskPageContent('[3]<input name=street_address value=12 Palm Street, Dubai />')).toBe(
      `[3]<input name=street_address value=${MASK} />`,
    );
    expect(
      maskPageContent('[4]<textarea placeholder=Customer address value=Flat 4, Building 9 />'),
    ).toBe(`[4]<textarea placeholder=Customer address value=${MASK} />`);
  });

  it('hides a person name field but not a template name', () => {
    expect(maskPageContent('[5]<input name=first_name value=Maria />')).toBe(
      `[5]<input name=first_name value=${MASK} />`,
    );
    expect(maskPageContent('[5]<input aria-label=Full name value=Maria Lopez />')).toBe(
      `[5]<input aria-label=Full name value=${MASK} />`,
    );
    const template = '[6]<input name=template_name value=Order confirmation />';
    expect(maskPageContent(template)).toBe(template);
  });

  it('keeps an empty personal field empty (nothing to hide) and a button label that mentions a phone', () => {
    expect(maskPageContent('[7]<input type=tel name=phone value= placeholder=Phone />')).toBe(
      '[7]<input type=tel name=phone value= placeholder=Phone />',
    );
    expect(maskPageContent('[8]<button type=button>Add phone />')).toBe(
      '[8]<button type=button>Add phone />',
    );
  });
});
