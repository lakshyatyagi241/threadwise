import { describe, expect, it } from 'vitest';
import { groupSecret } from './mfa-format';

describe('groupSecret', () => {
  it('groups in fours', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
  });
  it('keeps a short tail and ignores existing spaces', () => {
    expect(groupSecret('ABCDEFG')).toBe('ABCD EFG');
    expect(groupSecret('ABCD EFGH')).toBe('ABCD EFGH');
  });
  it('handles empty', () => {
    expect(groupSecret('')).toBe('');
  });
});
