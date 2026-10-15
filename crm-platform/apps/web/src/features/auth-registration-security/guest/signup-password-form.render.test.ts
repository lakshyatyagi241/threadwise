import { ERROR_CODES } from '@crm/contracts';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/signup/password',
}));

import { mapAuthError } from './errors';
import { FormError } from './form-error';
import { fieldMessageFor, PasswordEntry, SignupPasswordForm } from './signup-password-form';
import { makeConfig, renderGuest } from './render-test-utils';

function stage(over: Record<string, unknown> = {}) {
  return {
    token: 'tok_abc123',
    maskedEmail: 'a••••a@example.com',
    codeLength: 6,
    expiresAt: Date.now() + 5 * 60 * 1000,
    resendAt: Date.now() - 1000,
    ...over,
  };
}

const policy = (over: Record<string, unknown> = {}) => ({
  minLength: 8,
  requireMixedCase: false,
  requireNumber: false,
  requireSymbol: false,
  ...over,
});

describe('SignupPasswordForm', () => {
  it('does not crash and shows a loading state when there is no pending stage', () => {
    // The outer component only ever sees the server snapshot (no window) before hydration, so this also
    // covers the "opened directly, nothing to verify" path that otherwise redirects to /signup.
    const html = renderGuest(
      createElement(SignupPasswordForm, { config: makeConfig(), passwordPolicy: policy() }),
    );
    expect(html).not.toContain('name="password"');
  });
});

describe('PasswordEntry (the signed-in-stage part of step 3)', () => {
  it('requires acceptTerms before submit is enabled: the checkbox starts unchecked', () => {
    const html = renderGuest(
      createElement(PasswordEntry, {
        initial: stage(),
        config: makeConfig(),
        passwordPolicy: policy(),
      }),
    );
    expect(html).toContain('name="acceptTerms"');
    expect(html).not.toMatch(/name="acceptTerms"[^>]*checked/);
  });

  it('has both password fields, with the show/hide eye on each', () => {
    const html = renderGuest(
      createElement(PasswordEntry, {
        initial: stage(),
        config: makeConfig(),
        passwordPolicy: policy(),
      }),
    );
    expect(html).toContain('name="password"');
    expect(html).toContain('name="confirmPassword"');
    expect(html.split('Show password').length - 1).toBe(2);
  });

  it('shows the live policy minimum in the hint and the placeholder, not a number baked into the page', () => {
    const six = renderGuest(
      createElement(PasswordEntry, {
        initial: stage(),
        config: makeConfig(),
        passwordPolicy: policy({ minLength: 6 }),
      }),
    );
    expect(six).toContain('At least 6 characters.');
    expect(six).toContain('placeholder="At least 6 characters"');
  });

  it('falls back to the default minimum when the policy could not be read', () => {
    const html = renderGuest(
      createElement(PasswordEntry, { initial: stage(), config: makeConfig(), passwordPolicy: null }),
    );
    expect(html).toContain('At least 8 characters.');
  });

  it('links Terms and Privacy from the platform config', () => {
    const html = renderGuest(
      createElement(PasswordEntry, {
        initial: stage(),
        config: makeConfig({ links: { terms: '/t', privacy: '/p', cookies: null } }),
        passwordPolicy: policy(),
      }),
    );
    expect(html).toContain('href="/t"');
    expect(html).toContain('href="/p"');
  });

  it('has an optional referral-code field, reusing the signup.referral copy', () => {
    const html = renderGuest(
      createElement(PasswordEntry, {
        initial: stage(),
        config: makeConfig(),
        passwordPolicy: policy(),
      }),
    );
    expect(html).toContain('name="referralCode"');
    expect(html).toContain('Referral code');
    expect(html).toContain('(optional)');
    // react-dom/server HTML-escapes the placeholder's apostrophe.
    expect(html).toContain('placeholder="Got a friend&#x27;s code?"');
  });
});

describe('a duplicate-identity rejection at the password step (AUTH_IDENTITY_EXISTS)', () => {
  // This step has no email field (email was collected at step 1): `setPassword`'s re-check can still
  // hit AUTH_IDENTITY_EXISTS (a real race — someone else claimed the same email/phone, e.g. via social
  // sign-up in another tab, in the minutes between step 1 and step 3). The server's error names
  // `field: 'email'`, which does not exist on this page: `skipFieldMessage`'s normal "does fieldErrors
  // have this field" check must not swallow the message the way it would for a page that actually has
  // the field.
  it('maps to a field this page does not have, so fieldMessageFor finds nowhere to put it', () => {
    const err = new ApiError(409, ERROR_CODES.AUTH_IDENTITY_EXISTS, 'msg', undefined, [
      { path: 'email', message: 'An account with this email already exists.' },
    ]);
    const mapped = mapAuthError(err);
    expect(mapped.field).toBe('email');
    expect(fieldMessageFor(mapped)).toBeNull();
  });

  it('renders a visible, generic (not email-only) alert instead of being silently dropped', () => {
    const err = new ApiError(409, ERROR_CODES.AUTH_IDENTITY_EXISTS, 'msg', undefined, [
      { path: 'email', message: 'An account with this email already exists.' },
    ]);
    const mapped = mapAuthError(err);
    // The real component's skipFieldMessage expression, reproduced here: with no field on this page to
    // match, it must stay false so FormError actually renders.
    const skipFieldMessage = Boolean(
      mapped.key === 'passwordPolicy' ||
        (fieldMessageFor(mapped) && mapped.fieldErrors[fieldMessageFor(mapped) as string]),
    );
    expect(skipFieldMessage).toBe(false);
    const html = renderGuest(createElement(FormError, { error: mapped, skipFieldMessage }));
    expect(html).toContain('An account with this email or phone already exists.');
  });
});
