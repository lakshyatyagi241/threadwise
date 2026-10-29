import { describe, expect, it } from 'vitest';
import { webLinkUrl } from './carousel';

describe('webLinkUrl (a website chat button address, as the runtime and the test chat both write it)', () => {
  it('writes a phone number as tel: with its digits only, and refuses a value of the wrong length', () => {
    expect(webLinkUrl('phone', '+91 98765 43210')).toBe('tel:+919876543210');
    expect(webLinkUrl('call_now', 'tel:+1 (555) 010-2030')).toBe('tel:+15550102030');
    expect(webLinkUrl('phone', '12')).toBeNull();
  });

  it('writes an email as mailto: and refuses a value that is not an address', () => {
    expect(webLinkUrl('email', 'mailto:help@example.com')).toBe('mailto:help@example.com');
    expect(webLinkUrl('email', 'not an address')).toBeNull();
  });

  it('opens only http and https pages', () => {
    expect(webLinkUrl('url', ' https://example.com/a ')).toBe('https://example.com/a');
    expect(webLinkUrl('url', 'ftp://x/y')).toBeNull();
    expect(webLinkUrl('url', 'javascript:alert(1)')).toBeNull();
    expect(webLinkUrl('url', '')).toBeNull();
  });

  it('takes an address typed without its scheme as an https page, and nothing that is not an address', () => {
    expect(webLinkUrl('url', 'www.shop.in')).toBe('https://www.shop.in');
    expect(webLinkUrl('url', ' shop.in/offers?x=1 ')).toBe('https://shop.in/offers?x=1');
    expect(webLinkUrl('visit', 'Example.COM')).toBe('https://Example.COM');
    expect(webLinkUrl('url', 'localhost:3000')).toBeNull();
    expect(webLinkUrl('url', 'report.pdf')).toBeNull();
    expect(webLinkUrl('url', 'call me on monday')).toBeNull();
    expect(webLinkUrl('url', 'www.')).toBeNull();
    expect(webLinkUrl('url', 'data:text/html,hi.com')).toBeNull();
  });
});
