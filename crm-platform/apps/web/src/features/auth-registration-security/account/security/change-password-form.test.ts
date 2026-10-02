import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { keys } from '../api';
import { renderAccount } from '../render-test-utils';

vi.mock('next/navigation', () => ({
  usePathname: () => '/account/security',
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
}));

const { ChangePasswordForm } = await import('./change-password-form');

const policy = (over = {}) => ({
  minLength: 8,
  requireMixedCase: true,
  requireNumber: true,
  requireSymbol: false,
  ...over,
});
const render = (over = {}, forced = false, locale: 'en' | 'ar' = 'en') =>
  renderAccount(createElement(ChangePasswordForm, { forced }), {
    locale,
    seed: [[keys.passwordPolicy, policy(over)]],
  });

describe('ChangePasswordForm', () => {
  it('has the three boxes with placeholders, required, and the minimum as minlength', () => {
    const html = render({ minLength: 12 });
    expect(html).toContain('placeholder="Enter your current password"');
    expect(html).toContain('placeholder="At least 12 characters"');
    expect(html).toContain('placeholder="Type it again"');
    expect(html.match(/ required=""/g)?.length).toBe(3);
    expect(html.match(/minLength="12"/g)?.length).toBe(2);
  });

  it('writes the hint from the live policy: the minimum and what it must include', () => {
    const html = render({ minLength: 10, requireSymbol: true });
    expect(html).toContain('At least 10 characters.');
    expect(html).toContain('upper and lower case letters, a number, and a symbol');
  });

  it('a length-only policy adds no requirements sentence', () => {
    const html = render({ requireMixedCase: false, requireNumber: false });
    expect(html).toContain('At least 8 characters.');
    expect(html).not.toContain('It must include');
  });

  it('the eye buttons carry a tooltip that names their action', () => {
    const html = render();
    expect(html.match(/title="Show password"/g)?.length).toBe(3);
  });

  it('shows the password tips and a Reset button next to Update password', () => {
    const html = render();
    expect(html).toContain('Password tips');
    expect(html).toContain('Do not reuse passwords from other sites.');
    expect(html).toContain('>Reset<');
    expect(html).toContain('Update password');
  });

  it('the forced mode says so', () => {
    expect(render({}, true)).toContain('You need to set a new password before you can continue');
    expect(render({}, false)).not.toContain('You need to set a new password');
  });

  it('renders in Arabic', () => {
    expect(render({}, false, 'ar')).toContain('نصائح لكلمة المرور');
  });
});

describe('ChangePasswordForm on the password-expired lock screen', () => {
  const seedConfig = (captcha: unknown = null) => [
    keys.registrationConfig,
    {
      appName: 'Acme',
      registrationOpen: true,
      emailVerification: 'off',
      trialDays: 14,
      rememberMeEnabled: true,
      otp: { enabled: false },
      captcha,
      social: { google: false, facebook: false },
      defaultCountryIso: null,
      links: { terms: '/legal/terms', privacy: '/legal/privacy', cookies: null },
      authPages: {},
    },
  ];

  it('offers the e-mail reset link, naming the address, when a new password is required', () => {
    const html = render({}, true);
    expect(html).toContain('No current password to type?');
    expect(html).toContain('asha@acme.test');
    expect(html).toContain('Email me a reset link');
    // Above the form, not inside it: pressing it must not submit the password form.
    expect(html.indexOf('Email me a reset link')).toBeLessThan(html.indexOf('<form'));
  });

  it('does not clutter the ordinary change-password pane', () => {
    const html = render({}, false);
    expect(html).not.toContain('Email me a reset link');
  });

  it('is translated', () => {
    expect(render({}, true, 'ar')).toContain('أرسل لي رابط إعادة التعيين');
  });

  it('shows the captcha notice the platform configured for this action', () => {
    const html = renderAccount(createElement(ChangePasswordForm, { forced: true }), {
      seed: [
        [keys.passwordPolicy, policy()],
        seedConfig({ version: 'v3', siteKey: 'key-1', threshold: 0.5 }) as never,
      ],
    });
    expect(html).toContain('data-testid="recaptcha-v3"');
  });
});
