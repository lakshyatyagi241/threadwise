import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/',
}));

import { FindWorkspaceForm } from './find-workspace-form';
import { ForgotForm } from './forgot-form';
import { LoginForm } from './login-form';
import { ResetForm } from './reset-form';
import { SignupForm } from './signup-form';
import { makeConfig, renderGuest } from './render-test-utils';
import { SocialCallback } from './social-callback';

const policy = (over: Record<string, unknown> = {}) => ({
  minLength: 8,
  requireMixedCase: false,
  requireNumber: false,
  requireSymbol: false,
  ...over,
});

const count = (html: string, needle: string) => html.split(needle).length - 1;

function login(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  return renderGuest(
    createElement(LoginForm, {
      config: makeConfig(over),
      defaultOrg: '',
      next: null,
      flash: null,
      loggedOut: false,
      ...props,
    }),
  );
}

function signup(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  return renderGuest(
    createElement(SignupForm, {
      config: makeConfig(over),
      referral: '',
      passwordPolicy: policy(),
      ...props,
    }),
  );
}

describe('sign-in form (TW-AUTH-001)', () => {
  it('has the show/hide eye on the password field, like every password field of the reference', () => {
    const html = login();
    expect(html).toContain('type="password"');
    expect(count(html, 'Show password')).toBe(1);
    expect(html).toContain('placeholder="********"');
  });

  it('lists email, password, remember-me and the sign-in button in that order, with the forgot link on the label row', () => {
    const html = login();
    const order = [
      'name="email"',
      'name="password"',
      'name="remember"',
      'Sign in',
      'Create an account',
    ];
    let last = -1;
    for (const needle of order) {
      const i = html.indexOf(needle, last + 1);
      expect(i, needle).toBeGreaterThan(last);
      last = i;
    }
    expect(html).toContain('Forgot password?');
  });

  it('hides the remember-me box when the platform turned it off, and the sign-up link when registration is closed', () => {
    const html = login({ rememberMeEnabled: false, registrationOpen: false });
    expect(html).not.toContain('name="remember"');
    expect(html).not.toContain('Create an account');
  });

  it('shows the two social buttons side by side with the "or with email" divider, only for live providers', () => {
    const both = login();
    expect(both).toContain('grid-cols-2');
    expect(both).toContain('>Google<');
    expect(both).toContain('>Facebook<');
    expect(both).toContain('or with email');
    const none = login({ social: { google: false, facebook: false } });
    expect(none).not.toContain('or with email');
    const one = login({ social: { google: true, facebook: false } });
    expect(one).toContain('grid-cols-1');
    expect(one).not.toContain('>Facebook<');
  });

  it('links Terms and Privacy, and Cookies only when a cookie policy is set', () => {
    expect(login()).not.toContain('Cookie policy');
    const html = login({ links: { terms: '/t', privacy: '/p', cookies: '/c' } });
    expect(html).toContain('href="/c"');
    expect(html).toContain('href="/t"');
  });

  it('shows the v3 notice with Google privacy and terms links, and nothing for v2 but the box', () => {
    const v3 = login({ captcha: { version: 'v3', siteKey: 'k' } });
    expect(v3).toContain('https://policies.google.com/privacy');
    expect(v3).toContain('https://policies.google.com/terms');
    expect(v3).toContain('reCAPTCHA');
    const v2 = login({ captcha: { version: 'v2', siteKey: 'k' } });
    expect(v2).toContain('data-testid="recaptcha-v2"');
    expect(v2).not.toContain('policies.google.com');
    expect(login()).not.toContain('reCAPTCHA');
  });

  it('shows the one-time notices', () => {
    expect(login({}, { flash: 'reset' })).toContain('Password reset');
    expect(login({}, { flash: 'expired' })).toContain('session expired');
    expect(login({}, { flash: 'deleted' })).toContain('account was deleted');
    expect(login({}, { loggedOut: true })).toContain('signed out');
  });
});

describe('sign-up form (TW-AUTH-005)', () => {
  it('shows the live policy minimum in the hint and the placeholder, not a number baked into the page', () => {
    const six = signup({}, { passwordPolicy: policy({ minLength: 6 }) });
    expect(six).toContain('At least 6 characters.');
    expect(six).toContain('placeholder="At least 6 characters"');
    const twelve = signup({}, { passwordPolicy: policy({ minLength: 12 }) });
    expect(twelve).toContain('At least 12 characters.');
    expect(twelve).not.toContain('At least 8 characters');
  });

  it('lists the extra rules the policy asks for', () => {
    const html = signup(
      {},
      {
        passwordPolicy: policy({
          requireMixedCase: true,
          requireNumber: true,
          requireSymbol: true,
        }),
      },
    );
    expect(html).toContain('Mix upper and lower case letters.');
    expect(html).toContain('Include a number.');
    expect(html).toContain('Include a symbol.');
  });

  it('falls back to the default minimum when the policy could not be read', () => {
    expect(signup({}, { passwordPolicy: null })).toContain('At least 8 characters.');
  });

  it('has the show/hide eye on both password fields', () => {
    expect(count(signup(), 'Show password')).toBe(2);
  });

  it('prefills the referral box from the link or cookie', () => {
    expect(signup({}, { referral: 'GOT123' })).toContain('value="GOT123"');
    expect(signup()).not.toContain('value="GOT123"');
  });

  it('opens the phone picker on the platform default country, India when none is set', () => {
    const india = signup();
    expect(india).toContain('fi fi-in');
    expect(india).toContain('+91');
    const uae = signup({ defaultCountryIso: 'AE' });
    expect(uae).toContain('fi fi-ae');
    expect(uae).toContain('+971');
    // A value that is not a country falls back too.
    expect(signup({ defaultCountryIso: 'ZZ' })).toContain('fi fi-in');
  });

  it('shows the step list, the step-1 title line and the sign-in link', () => {
    const html = signup();
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Already have an account?');
  });

  it('shows the closed-registration notice instead of the form', () => {
    const html = signup({ registrationOpen: false });
    expect(html).toContain('Registration is closed');
    expect(html).not.toContain('name="email"');
  });

  it('opens the workspace address field with a note when the address was taken meanwhile', () => {
    const html = signup({}, { slugConflict: true });
    expect(html).toContain('name="orgSlug"');
    expect(html).toContain('That workspace address is already taken.');
  });
});

describe('reset-password form (TW-AUTH-014)', () => {
  it('has the show/hide eye on both fields and the live minimum in the hint', () => {
    const html = renderGuest(
      createElement(ResetForm, {
        org: 'acme',
        token: 'x'.repeat(24),
        passwordPolicy: policy({ minLength: 10 }),
      }),
    );
    expect(count(html, 'Show password')).toBe(2);
    expect(html).toContain('At least 10 characters.');
    expect(html).toContain('Save new password');
  });
});

describe('forgot-password and find-workspace forms', () => {
  it('forgot-password links to "Find my workspace" under the workspace field', () => {
    const html = renderGuest(createElement(ForgotForm, { config: makeConfig(), defaultOrg: '' }));
    expect(html).toContain('href="/find-workspace"');
    expect(html).toContain('Email reset link');
  });

  it('find-workspace asks for the email only', () => {
    const html = renderGuest(createElement(FindWorkspaceForm, { config: makeConfig() }));
    expect(html).toContain('name="email"');
    expect(html).not.toContain('name="orgSlug"');
  });
});

describe('social callback page (TW-AUTH-004)', () => {
  const callback = (props: Record<string, unknown>) =>
    renderGuest(
      createElement(SocialCallback, {
        provider: 'google',
        code: '',
        state: '',
        providerError: '',
        rememberMeEnabled: true,
        ...props,
      }),
    );

  it('shows the working state while it finishes the sign-in', () => {
    const html = callback({ code: 'c', state: 's' });
    expect(html).toContain('Finishing your sign-in');
    expect(html).not.toContain('Sign-in did not finish');
  });

  it('says the sign-in was cancelled when the provider reports an error', () => {
    const html = callback({ providerError: 'access_denied' });
    expect(html).toContain('Sign-in was cancelled.');
    expect(html).toContain('Back to sign in');
    expect(html).toContain('Create an account instead');
  });

  it('says the sign-in expired when the code or state is missing', () => {
    expect(callback({ code: '', state: '' })).toContain('Sign-in expired. Please try again.');
    expect(callback({ code: 'c', state: '' })).toContain('Sign-in expired');
  });
});

describe('Arabic', () => {
  it('renders the sign-in form without a missing message', () => {
    const html = renderGuest(
      createElement(LoginForm, {
        config: makeConfig(),
        defaultOrg: '',
        next: null,
        flash: null,
        loggedOut: false,
      }),
      { locale: 'ar' },
    );
    expect(html).toContain('تسجيل الدخول');
    expect(html).not.toContain('[[');
  });

  it('renders sign-up with the live minimum in Arabic', () => {
    const html = renderGuest(
      createElement(SignupForm, {
        config: makeConfig(),
        referral: '',
        passwordPolicy: policy({ minLength: 10 }),
      }),
      { locale: 'ar' },
    );
    expect(html).toContain('10');
    expect(html).not.toContain('[[');
  });
});
