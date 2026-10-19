import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/signup',
}));

import { SignupStartForm } from './signup-start-form';
import { makeConfig, renderGuest } from './render-test-utils';

describe('SignupStartForm', () => {
  it('has no workspace-name, password or terms field', () => {
    const html = renderGuest(createElement(SignupStartForm, { config: makeConfig() }));
    expect(html).not.toContain('Workspace name');
    expect(html).not.toContain('Confirm password');
    expect(html).not.toContain('acceptTerms');
    expect(html).toContain('Full name');
    expect(html).toContain('Work email');
  });

  it('shows the closed message instead of the form when registration is closed', () => {
    const html = renderGuest(
      createElement(SignupStartForm, { config: makeConfig({ registrationOpen: false }) }),
    );
    expect(html).not.toContain('Full name');
    expect(html).toContain('Registration is closed');
  });

  it('opens the phone picker on the platform default country, India when none is set', () => {
    const india = renderGuest(createElement(SignupStartForm, { config: makeConfig() }));
    expect(india).toContain('fi fi-in');
    expect(india).toContain('+91');
    const uae = renderGuest(
      createElement(SignupStartForm, { config: makeConfig({ defaultCountryIso: 'AE' }) }),
    );
    expect(uae).toContain('fi fi-ae');
    expect(uae).toContain('+971');
    // A value that is not a country falls back too.
    const unknown = renderGuest(
      createElement(SignupStartForm, { config: makeConfig({ defaultCountryIso: 'ZZ' }) }),
    );
    expect(unknown).toContain('fi fi-in');
  });

  // The server's real gate (`otpGate` in signup.service.ts) demands a phone whenever the OTP step is
  // active, regardless of `phoneRequired` (a separate flag, `requirePhoneVerification`, that only
  // matters while OTP is inactive). Letting someone through step 1 with no phone when OTP is active
  // strands them at step 3, which has no phone field to recover with.
  it('marks phone required (no "(optional)" label) when otp.enabled is true, even if phoneRequired is false', () => {
    const html = renderGuest(
      createElement(SignupStartForm, {
        config: makeConfig({ otp: { enabled: true }, phoneRequired: false }),
      }),
    );
    expect(html).not.toContain('(optional)');
  });

  it('keeps marking phone required when phoneRequired is true, same as before', () => {
    const html = renderGuest(
      createElement(SignupStartForm, {
        config: makeConfig({ otp: { enabled: false }, phoneRequired: true }),
      }),
    );
    expect(html).not.toContain('(optional)');
  });

  it('marks phone optional only when neither otp.enabled nor phoneRequired asks for it', () => {
    const html = renderGuest(
      createElement(SignupStartForm, {
        config: makeConfig({ otp: { enabled: false }, phoneRequired: false }),
      }),
    );
    expect(html).toContain('(optional)');
  });
});
