import { describe, expect, it } from 'vitest';
import { withoutParams } from './url-params';

describe('withoutParams', () => {
  it('removes only the named parameters and keeps the rest', () => {
    expect(
      withoutParams('http://x.test/login?account_deleted=1&org=acme#top', ['account_deleted']),
    ).toBe('/login?org=acme#top');
    expect(withoutParams('/login?reset=1&org=acme', ['reset', 'expired'])).toBe('/login?org=acme');
  });
  it('ends with a clean path when nothing else is left', () => {
    expect(withoutParams('/login?account_deleted=1', ['account_deleted'])).toBe('/login');
  });
  it('returns null when there was nothing to remove', () => {
    expect(withoutParams('/login?org=acme', ['account_deleted'])).toBeNull();
  });
});
