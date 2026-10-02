import { describe, expect, it } from 'vitest';
import { rememberForAction } from './remember';

const base = { requested: undefined, cookie: undefined, platformAllows: true };

describe('rememberForAction', () => {
  it('trusts what the API says it opened, over every request-side rule', () => {
    // The checkbox said yes, the API opened a short session (the platform turned remembering off).
    expect(rememberForAction({ ...base, action: 'login', requested: true, fromApi: false })).toBe(
      false,
    );
    // No checkbox on a social sign-in, the API opened a long session.
    expect(
      rememberForAction({
        ...base,
        action: 'social-callback',
        platformAllows: false,
        fromApi: true,
      }),
    ).toBe(true);
    // A switch or the code step of a switch: the API kept (or dropped) the choice of the session it replaced.
    expect(rememberForAction({ ...base, action: 'switch', cookie: '0', fromApi: true })).toBe(true);
    expect(rememberForAction({ ...base, action: 'mfa', cookie: '1', fromApi: false })).toBe(false);
    expect(rememberForAction({ ...base, action: 'signup-otp', fromApi: true })).toBe(true);
  });

  it('falls back to the request-side rules when the answer has no usable value', () => {
    for (const fromApi of [undefined, null, 'true', 1]) {
      expect(rememberForAction({ ...base, action: 'login', requested: true, fromApi })).toBe(true);
      expect(rememberForAction({ ...base, action: 'login', requested: false, fromApi })).toBe(
        false,
      );
    }
  });

  it('uses the checkbox for password and code sign-ins', () => {
    expect(rememberForAction({ ...base, action: 'login', requested: true })).toBe(true);
    expect(rememberForAction({ ...base, action: 'login', requested: false })).toBe(false);
    expect(rememberForAction({ ...base, action: 'mfa', requested: true })).toBe(true);
    expect(rememberForAction({ ...base, action: 'mfa', requested: false })).toBe(false);
    // Anything but a real boolean true is not a request to be remembered.
    expect(rememberForAction({ ...base, action: 'login', requested: 'true' })).toBe(false);
  });

  it('keeps the long session across a workspace switch', () => {
    // The switch request never carries `remember`: the cookie is what remembers the choice.
    expect(rememberForAction({ ...base, action: 'switch', cookie: '1' })).toBe(true);
    expect(rememberForAction({ ...base, action: 'switch', cookie: '0' })).toBe(false);
    expect(rememberForAction({ ...base, action: 'switch' })).toBe(false);
  });

  it('keeps the long session through the code step of a switch, which carries no checkbox', () => {
    expect(rememberForAction({ ...base, action: 'mfa', cookie: '1' })).toBe(true);
    expect(rememberForAction({ ...base, action: 'mfa', cookie: '0' })).toBe(false);
    // The sign-in form always says what it wants, and that wins over the cookie.
    expect(rememberForAction({ ...base, action: 'mfa', requested: false, cookie: '1' })).toBe(
      false,
    );
  });

  it('remembers a social sign-in unless the platform turned remembering off', () => {
    expect(rememberForAction({ ...base, action: 'social-callback' })).toBe(true);
    expect(rememberForAction({ ...base, action: 'social-callback', platformAllows: false })).toBe(
      false,
    );
  });

  it('does not remember a new sign-up', () => {
    expect(rememberForAction({ ...base, action: 'signup' })).toBe(false);
    expect(rememberForAction({ ...base, action: 'signup-otp' })).toBe(false);
  });
});
