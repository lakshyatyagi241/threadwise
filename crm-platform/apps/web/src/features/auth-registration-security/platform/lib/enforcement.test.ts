import { describe, expect, it } from 'vitest';
import { enforcementFor, enforcementTone, type EnforcementRow } from './enforcement';

const matrix: EnforcementRow[] = [
  {
    key: 'Two-factor requirements',
    controls: ['requireMfaForAll', 'requireMfaForAdmins', 'requireMfaForOwners'],
    consumer: 'Account gate',
    status: 'enforced',
  },
  {
    key: 'Allowed methods',
    controls: ['allowedMfaMethods'],
    consumer: 'Only authenticator apps exist',
    status: 'reserved',
  },
  {
    key: 'Password rules',
    controls: [
      'passwordMinLength',
      'passwordRequireUpper',
      'passwordRequireNumber',
      'passwordRequireSymbol',
    ],
    consumer: 'Sign-up',
    status: 'enforced',
  },
];

describe('enforcementFor', () => {
  it('finds the row that lists the control', () => {
    expect(enforcementFor(matrix, 'allowedMfaMethods')?.status).toBe('reserved');
    expect(enforcementFor(matrix, 'requireMfaForOwners')?.consumer).toBe('Account gate');
    expect(enforcementFor(matrix, 'passwordRequireSymbol')?.consumer).toBe('Sign-up');
  });
  it('returns null for a control the API does not list instead of guessing', () => {
    expect(enforcementFor(matrix, 'apiRateLimitPerMinute')).toBeNull();
    expect(enforcementFor([], 'allowedMfaMethods')).toBeNull();
  });
  it('does not match on a label', () => {
    expect(enforcementFor(matrix, 'passwordMaxAgeDays')).toBeNull();
  });
});

describe('enforcementTone', () => {
  it('maps status to a badge tone', () => {
    expect(enforcementTone('enforced')).toBe('success');
    expect(enforcementTone('partial')).toBe('warning');
    expect(enforcementTone('reserved')).toBe('neutral');
  });
});
