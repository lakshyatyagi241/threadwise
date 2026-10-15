import { describe, expect, it } from 'vitest';
import { checkEmailDomain, emailDomain } from '../../../src/modules/auth/support/email-policy';

const on = { businessEmailOnly: true, blockDisposableEmail: true, blockedEmailDomains: [] as string[] };

describe('email policy', () => {
  it('accepts a company address', () => {
    expect(checkEmailDomain('ana@acme-corp.io', on)).toEqual({ ok: true });
  });

  it.each(['a@gmail.com', 'a@Outlook.com', 'a@mail.yahoo.com'])('refuses free provider %s', (e) => {
    expect(checkEmailDomain(e, on)).toEqual({ ok: false, reason: 'free' });
  });

  it.each(['a@mailinator.com', 'a@x.guerrillamail.com', 'a@10minutemail.net', 'a@my-tempmail.xyz'])(
    'refuses disposable %s',
    (e) => {
      expect(checkEmailDomain(e, on)).toEqual({ ok: false, reason: 'disposable' });
    },
  );

  it('refuses operator-blocked domains and their subdomains', () => {
    const p = { ...on, blockedEmailDomains: ['rival.com'] };
    expect(checkEmailDomain('a@mail.rival.com', p)).toEqual({ ok: false, reason: 'blocked' });
  });

  it('lets free providers through when businessEmailOnly is off', () => {
    expect(checkEmailDomain('a@gmail.com', { ...on, businessEmailOnly: false })).toEqual({ ok: true });
  });

  it('rejects malformed addresses', () => {
    expect(emailDomain('nodomain')).toBeNull();
    expect(checkEmailDomain('a@localhost', on)).toEqual({ ok: false, reason: 'invalid' });
  });
});
