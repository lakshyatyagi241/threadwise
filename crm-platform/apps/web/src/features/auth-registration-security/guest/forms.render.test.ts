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
});
