import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/signup/password',
}));

import { PasswordEntry, SignupPasswordForm } from './signup-password-form';
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
});
