import { describe, expect, it } from 'vitest';
import { ROLE_IDS, summary } from './fixtures';
import { grantableRoles, validateInvite } from './invite-form';

const valid = { fullName: 'Riya Shah', email: 'riya@company.com', roleId: ROLE_IDS.agent };

describe('grantableRoles', () => {
  it('lists WaDesk order, only what the caller may grant', () => {
    expect(grantableRoles(summary('owner').roles).map((r) => r.tier)).toEqual([
      'agent',
      'manager',
      'admin',
      'viewer',
      'owner',
    ]);
    expect(grantableRoles(summary('admin').roles).map((r) => r.tier)).toEqual([
      'agent',
      'manager',
      'viewer',
    ]);
  });
});

describe('validateInvite', () => {
  it('accepts a complete form and trims the email', () => {
    const r = validateInvite({ ...valid, email: ' riya@company.com ' });
    expect('input' in r && r.input.email).toBe('riya@company.com');
  });

  it('reports each broken field once', () => {
    expect(validateInvite({ ...valid, fullName: '  ' })).toEqual({
      errors: { fullName: 'required' },
    });
    expect(validateInvite({ ...valid, fullName: 'x'.repeat(192) })).toEqual({
      errors: { fullName: 'tooLong' },
    });
    expect(validateInvite({ ...valid, email: '' })).toEqual({ errors: { email: 'required' } });
    expect(validateInvite({ ...valid, email: 'riya@' })).toEqual({ errors: { email: 'invalid' } });
  });
});
