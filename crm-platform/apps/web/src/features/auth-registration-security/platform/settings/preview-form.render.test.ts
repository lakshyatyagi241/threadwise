import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { AuthPageName, RegistrationConfigResponse } from '@crm/contracts';
import { renderWithMessages } from '../render-test-utils';
import { PreviewForm } from './preview-form';

const config = (over: Partial<RegistrationConfigResponse> = {}): RegistrationConfigResponse => ({
  appName: 'Acme',
  registrationOpen: true,
  emailVerification: 'off',
  trialDays: 14,
  rememberMeEnabled: true,
  otp: { enabled: false },
  businessEmailOnly: true,
  phoneRequired: true,
  captcha: null,
  social: { google: false, facebook: false },
  defaultCountryIso: null,
  authPages: {
    variant: 1,
    login: {},
    register: {},
    forgot: {},
    defaulted: { login: [], register: [], forgot: [] },
    extra: { login: {}, register: {}, forgot: {} },
  },
  links: {
    terms: 'https://example.com/terms',
    privacy: 'https://example.com/privacy',
    cookies: null,
  },
  ...over,
});

const render = (
  page: AuthPageName,
  c: RegistrationConfigResponse | undefined,
  locale?: 'en' | 'ar',
) => renderWithMessages(createElement(PreviewForm, { page, config: c }), { locale });

describe('PreviewForm', () => {
  it('cannot be focused or clicked: the whole form is inert', () => {
    for (const page of ['login', 'register', 'forgot'] as const)
      expect(render(page, config())).toMatch(/^<div inert="" aria-hidden="true"/);
  });

  it('shows the provider buttons that are live, and none when no provider is', () => {
    const none = render('login', config());
    expect(none).not.toContain('Google');
    const both = render('login', config({ social: { google: true, facebook: true } }));
    expect(both).toContain('Google');
    expect(both).toContain('Facebook');
    const one = render('login', config({ social: { google: true, facebook: false } }));
    expect(one).toContain('Google');
    expect(one).not.toContain('Facebook');
  });

  it('keeps the provider buttons off the forgot-password page, as visitors see it', () => {
    expect(render('forgot', config({ social: { google: true, facebook: true } }))).not.toContain(
      'Google',
    );
  });

  it('shows the keep-me-signed-in row on sign-in only, and only while the policy allows it', () => {
    expect(render('login', config())).toContain('Keep me signed in');
    expect(render('login', config({ rememberMeEnabled: false }))).not.toContain(
      'Keep me signed in',
    );
    expect(render('register', config())).not.toContain('Keep me signed in');
    expect(render('forgot', config())).not.toContain('Keep me signed in');
  });

  it('shows a tick box for reCAPTCHA v2, a one-line notice for v3 and nothing when it is off', () => {
    expect(render('login', config())).not.toContain('reCAPTCHA');
    const v2 = render('login', config({ captcha: { version: 'v2', siteKey: 'k' } }));
    expect(v2).toContain('I am not a robot');
    const v3 = render('register', config({ captcha: { version: 'v3', siteKey: 'k' } }));
    expect(v3).toContain('protected by reCAPTCHA');
    expect(v3).not.toContain('I am not a robot');
  });

  it('never loads anything from the captcha provider', () => {
    const html = render('login', config({ captcha: { version: 'v2', siteKey: 'k' } }));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('google.com/recaptcha');
  });

  it('prints the legal line with the configured links on sign-in, and the agree row on sign-up', () => {
    const login = render('login', config());
    expect(login).toContain('href="https://example.com/terms"');
    expect(login).toContain('href="https://example.com/privacy"');
    const register = render('register', config());
    expect(register).toContain('href="https://example.com/terms"');
    expect(register).toContain('I agree to the');
  });

  it('links to create an account only while registration is open', () => {
    expect(render('login', config())).toContain('Create a workspace');
    expect(render('login', config({ registrationOpen: false }))).not.toContain(
      'Create a workspace',
    );
  });

  it('puts the right button on each page', () => {
    expect(render('login', config())).toContain('Sign in');
    expect(render('register', config())).toContain('Create workspace');
    expect(render('forgot', config())).toContain('Send reset link');
  });

  it('still draws the bare form while the configuration loads', () => {
    for (const page of ['login', 'register', 'forgot'] as const) {
      const html = render(page, undefined);
      expect(html).toContain('Email');
    }
  });

  it('renders in Arabic with every message present', () => {
    const c = config({
      social: { google: true, facebook: true },
      captcha: { version: 'v2', siteKey: 'k' },
    });
    for (const page of ['login', 'register', 'forgot'] as const)
      expect(render(page, c, 'ar')).toContain('reCAPTCHA');
  });
});
