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
});
