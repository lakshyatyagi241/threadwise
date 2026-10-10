import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/login',
}));

import { MfaStep } from './mfa-step';
import { renderGuest } from './render-test-utils';

function step(props: Record<string, unknown> = {}, locale: 'en' | 'ar' = 'en') {
  return renderGuest(
    createElement(MfaStep, {
      challengeToken: 'challenge',
      expiresAt: Date.now() + 5 * 60 * 1000,
      remember: false,
      onBack: () => undefined,
      ...props,
    }),
    { locale },
  );
}

describe('second-factor step of sign-in (TW-AUTH-010)', () => {
  it('asks for the authenticator code and offers the recovery code, as before', () => {
    const html = step();
    expect(html).toContain('Two-step verification');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('Use a recovery code instead');
    expect(html).toContain('Back to sign in');
  });

  it('offers no passkey button when the sign-in answer did not say the person has one', () => {
    expect(step()).not.toContain('Use a passkey');
    expect(step({ passkey: false })).not.toContain('Use a passkey');
  });

  it('offers "Use a passkey" next to the code when the person has one', () => {
    const html = step({ passkey: true });
    expect(html).toContain('Use a passkey');
    // The code field and its button stay: a passkey is an alternative, not a replacement.
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('>Verify');
    // It must not submit the code form.
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>(?:(?!<\/button>)[\s\S])*Use a passkey/);
  });

  it('shows no passkey warning before anything was tried', () => {
    const html = step({ passkey: true });
    expect(html).not.toContain('cancelled or timed out');
    expect(html).not.toContain('could not provide the passkey');
  });

  it('renders the passkey button in Arabic', () => {
    const html = step({ passkey: true }, 'ar');
    expect(html).not.toContain('Use a passkey');
    expect(html).toContain('type="button"');
  });
});
