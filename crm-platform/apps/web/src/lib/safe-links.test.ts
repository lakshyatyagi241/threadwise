import { describe, expect, it } from 'vitest';
import { safeHttpHref, telHref } from './safe-links';

describe('safeHttpHref', () => {
  it('opens http and https addresses', () => {
    expect(safeHttpHref('https://example.com/track?id=1')).toBe('https://example.com/track?id=1');
    expect(safeHttpHref('http://example.com')).toBe('http://example.com/');
  });
  it('refuses every other scheme, a placeholder, and a non-address', () => {
    expect(safeHttpHref('javascript:alert(1)')).toBeNull();
    expect(safeHttpHref('data:text/html,x')).toBeNull();
    expect(safeHttpHref('ftp://example.com')).toBeNull();
    expect(safeHttpHref('https://example.com/{{1}}')).toBeNull();
    expect(safeHttpHref('not a url')).toBeNull();
    expect(safeHttpHref(null)).toBeNull();
  });
});

describe('telHref', () => {
  it('dials digits with an optional leading plus', () => {
    expect(telHref('+91 95606-44394')).toBe('tel:+919560644394');
    expect(telHref('(022) 1234 5678')).toBe('tel:02212345678');
  });
  it('refuses anything that is not a number', () => {
    expect(telHref('tel:+1; drop')).toBeNull();
    expect(telHref('12')).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});
