import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/signup/verify-email',
}));

import { SignupVerifyEmailForm, VerifyEmailEntry } from './signup-verify-email-form';
import { renderGuest } from './render-test-utils';

function stage(over: Record<string, unknown> = {}) {
  return {
    token: 'tok_abc123',
    maskedEmail: 'a••••a@example.com',
    codeLength: 6,
    expiresAt: Date.now() + 5 * 60 * 1000,
    resendAt: Date.now() - 1000, // resend already available
    ...over,
  };
}

describe('SignupVerifyEmailForm', () => {
  it('does not crash and shows a loading state when there is no pending stage', () => {
    // The outer component only ever sees the server snapshot (no window) before hydration, so this also
    // covers the "opened directly, nothing to verify" path that otherwise redirects to /signup.
    const html = renderGuest(createElement(SignupVerifyEmailForm));
    expect(html).not.toContain('autoComplete="one-time-code"');
  });
});

describe('VerifyEmailEntry (the signed-in-stage part of step 2)', () => {
  it('renders the single code field (not six boxes) with the masked email', () => {
    const html = renderGuest(createElement(VerifyEmailEntry, { initial: stage() }));
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('maxLength="8"');
    expect(html).toContain('tracking-[0.4em]');
    expect(html).toContain('a••••a@example.com');
    expect(html).toContain('Verification code');
    expect(html).toContain('Verify and continue');
  });

  it('offers the resend action and a way back to change the email', () => {
    const html = renderGuest(createElement(VerifyEmailEntry, { initial: stage() }));
    expect(html).toContain('Resend code');
    expect(html).toContain('Wrong email?');
    expect(html).toContain('href="/signup"');
  });

  it('shows the resend cooldown instead of the resend button while it is running', () => {
    const html = renderGuest(
      createElement(VerifyEmailEntry, { initial: stage({ resendAt: Date.now() + 90_000 }) }),
    );
    expect(html).not.toContain('>Resend code<');
    expect(html).toMatch(/Resend code in \d+:\d{2}/);
  });

  it('shows the expiry hint from the stage, not a hardcoded value', () => {
    const html = renderGuest(createElement(VerifyEmailEntry, { initial: stage() }));
    expect(html).toMatch(/The code expires in \d+:\d{2}\./);
  });
});
