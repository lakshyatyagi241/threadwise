import { describe, expect, it } from 'vitest';
import { fingerprint, stableUsageId } from '../../../src/common/stable-usage-id';

describe('stableUsageId', () => {
  it('joins the parts with a colon and keeps a short id readable', () => {
    expect(stableUsageId('flow', 'abc', 12, 'node-1', 'turn')).toBe('flow:abc:12:node-1:turn');
  });

  it('gives the same id for the same parts and another id for another part', () => {
    expect(stableUsageId('kb', 'x', 1)).toBe(stableUsageId('kb', 'x', 1));
    expect(stableUsageId('kb', 'x', 1)).not.toBe(stableUsageId('kb', 'x', 2));
  });

  it('replaces an id that is too long by a fingerprint of it, still stable and still distinct', () => {
    const long = 'n'.repeat(400);
    const a = stableUsageId('flow', 'run', 1, long);
    expect(a.length).toBeLessThanOrEqual(150);
    expect(a).toBe(stableUsageId('flow', 'run', 1, long));
    expect(a).not.toBe(stableUsageId('flow', 'run', 2, long));
  });
});

describe('fingerprint', () => {
  it('is 32 hex characters and depends on the whole text', () => {
    expect(fingerprint('hello')).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprint('hello')).toBe(fingerprint('hello'));
    expect(fingerprint('hello')).not.toBe(fingerprint('hello '));
  });
});
