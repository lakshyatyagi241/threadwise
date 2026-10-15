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
});
