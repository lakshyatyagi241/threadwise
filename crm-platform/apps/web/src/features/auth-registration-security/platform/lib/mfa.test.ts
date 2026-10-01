import { describe, expect, it } from 'vitest';
import { formatSecret, recoveryCodesFile } from './mfa';

describe('formatSecret', () => {
  it('groups the secret in fours', () => {
    expect(formatSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(formatSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
  });
  it('is idempotent and tolerates spaces', () => {
    expect(formatSecret('JBSW Y3DP')).toBe('JBSW Y3DP');
    expect(formatSecret('')).toBe('');
  });
});

describe('recoveryCodesFile', () => {
  it('puts a header, a blank line and one code per line', () => {
    expect(recoveryCodesFile('Codes', ['a-1', 'b-2'])).toBe('Codes\n\na-1\nb-2\n');
  });
});
