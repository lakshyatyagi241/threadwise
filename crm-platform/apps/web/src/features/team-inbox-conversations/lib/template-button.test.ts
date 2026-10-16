import { describe, expect, it } from 'vitest';
import { templateButtonHref } from './template-button';

describe('templateButtonHref', () => {
  it('opens a fixed web address', () => {
    expect(templateButtonHref({ type: 'url', url: 'https://example.com/track?id=1' })).toBe(
      'https://example.com/track?id=1',
    );
    expect(templateButtonHref({ type: 'url', url: 'http://example.com' })).toBe(
      'http://example.com/',
    );
  });

  it('never links a scheme other than http or https', () => {
    expect(templateButtonHref({ type: 'url', url: 'javascript:alert(1)' })).toBeNull();
    expect(
      templateButtonHref({ type: 'url', url: 'data:text/html,<script>x</script>' }),
    ).toBeNull();
    expect(templateButtonHref({ type: 'url', url: 'ftp://example.com' })).toBeNull();
  });

  it('gives no link for a URL with an unfilled {{n}} placeholder', () => {
    expect(templateButtonHref({ type: 'url', url: 'https://example.com/{{1}}' })).toBeNull();
  });

  it('gives no link for a URL that is missing or not a URL', () => {
    expect(templateButtonHref({ type: 'url' })).toBeNull();
    expect(templateButtonHref({ type: 'url', url: 'not a url' })).toBeNull();
  });

  it('dials a call button number, digits with an optional leading plus', () => {
    expect(templateButtonHref({ type: 'phone', phone: '+91 95606-44394' })).toBe(
      'tel:+919560644394',
    );
    expect(templateButtonHref({ type: 'phone', phone: '(022) 1234 5678' })).toBe('tel:02212345678');
  });

  it('refuses a call button with anything but a number', () => {
    expect(templateButtonHref({ type: 'phone', phone: 'tel:+1; drop' })).toBeNull();
    expect(templateButtonHref({ type: 'phone', phone: '12' })).toBeNull();
    expect(templateButtonHref({ type: 'phone' })).toBeNull();
  });

  it('gives no link to any other kind of button', () => {
    expect(templateButtonHref({ type: 'quick_reply', url: 'https://example.com' })).toBeNull();
    expect(templateButtonHref({ type: 'copy_code', phone: '+15550100100' })).toBeNull();
  });
});
