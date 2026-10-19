import { describe, expect, it } from 'vitest';
import { ROLE_IDS, summary } from './fixtures';
import { blankInvite, grantableRoles, validateInvite } from './invite-form';

const valid = {
  fullName: 'Riya Shah',
  email: 'riya@company.com',
  roleId: ROLE_IDS.agent,
  phone: '',
  chatLimit: '4',
};

describe('grantableRoles', () => {
  it('lists Reference order, only what the caller may grant', () => {
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

  it("starts the chat limit at 4, as Waboo's Add User form does", () => {
    expect(blankInvite(ROLE_IDS.agent).chatLimit).toBe('4');
  });

  it('sends the phone as E.164 and the chat limit as a number', () => {
    const r = validateInvite({ ...valid, phone: '+91 98765-43210', chatLimit: '7' });
    expect('input' in r && r.input).toMatchObject({ phone: '+919876543210', chatLimit: 7 });
  });

  it('sends no limit when the field is empty and no phone when it is empty', () => {
    const r = validateInvite({ ...valid, phone: '  ', chatLimit: '' });
    expect('input' in r && r.input).toMatchObject({ phone: null, chatLimit: null });
  });

  it('rejects a phone without a country code and a limit outside 1 to 1000', () => {
    expect(validateInvite({ ...valid, phone: '98765 43210' })).toEqual({
      errors: { phone: 'invalid' },
    });
    expect(validateInvite({ ...valid, chatLimit: '0' })).toEqual({
      errors: { chatLimit: 'invalid' },
    });
    expect(validateInvite({ ...valid, chatLimit: '1001' })).toEqual({
      errors: { chatLimit: 'invalid' },
    });
    expect(validateInvite({ ...valid, chatLimit: '2.5' })).toEqual({
      errors: { chatLimit: 'invalid' },
    });
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
