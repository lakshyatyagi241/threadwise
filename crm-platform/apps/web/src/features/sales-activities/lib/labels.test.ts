import { describe, expect, it } from 'vitest';
import { humanKey } from './labels';

describe('humanKey', () => {
  it('turns a stable key into a readable fallback', () => {
    expect(humanKey('follow_up')).toBe('Follow up');
    expect(humanKey('custom_site_visit')).toBe('Site visit');
    expect(humanKey('')).toBe('');
  });
});
