import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { SocialCaptchaSettingsResponse } from '@crm/contracts';
import { renderWithMessages } from '../render-test-utils';
import { SocialCaptchaSettingsPage } from './social-captcha-settings';

const KEY = ['operator', 'settings', 'social-captcha'];
const settings: SocialCaptchaSettingsResponse = {
  google: {
    enabled: true,
    clientId: 'abc.apps.googleusercontent.com',
    hasSecret: true,
    live: true,
  },
  facebook: { enabled: false, clientId: '', hasSecret: false, live: false },
  recaptcha: {
    enabled: true,
    version: 'v3',
    siteKey: '6Lsite',
    hasSecret: true,
    v3Threshold: 0.5,
    live: true,
  },
};
const render = (
  options: { role?: 'super_admin' | 'support' | 'auditor'; locale?: 'en' | 'ar' } = {},
) =>
  renderWithMessages(createElement(SocialCaptchaSettingsPage), {
    ...options,
    seed: [[KEY, settings]],
  });

describe('SocialCaptchaSettingsPage', () => {
  it('lists the four official guides as plain external links', () => {
    const html = render();
    expect(html).toContain('Official documentation');
    for (const [href, text] of [
      ['https://developers.google.com/identity/protocols/oauth2/web-server', 'Google OAuth setup'],
      [
        'https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow',
        'Facebook Login setup',
      ],
      ['https://www.google.com/recaptcha/admin', 'reCAPTCHA admin console'],
      ['https://developers.google.com/recaptcha', 'reCAPTCHA documentation'],
    ] as const) {
      const link = html.match(new RegExp(`<a [^>]*href="${href}"[^>]*>`));
      expect(link, href).not.toBeNull();
      expect(link![0]).toContain('target="_blank"');
      expect(link![0]).toContain('rel="noopener noreferrer"');
      expect(html).toContain(text);
    }
  });

  it('keeps the no-SDK note and the two quick-setup guides in the side rail', () => {
    const html = render();
    const rail = html.slice(html.indexOf('<aside'));
    expect(rail).toContain('Official documentation');
    expect(rail).toContain('Google in four steps');
    expect(rail).toContain('Facebook in four steps');
    expect(rail).toContain('there is nothing to install');
  });

  it('shows what is live in the main column, after the provider cards and before the side rail', () => {
    const html = render();
    const live = html.indexOf('What is live right now');
    expect(live).toBeGreaterThan(html.indexOf('reCAPTCHA</h2>'));
    expect(live).toBeLessThan(html.indexOf('<aside'));
  });

  it('gives each provider a read-only redirect address with a copy button', () => {
    const html = render();
    expect(html).toContain('id="social-google-redirect"');
    expect(html).toContain('id="social-facebook-redirect"');
    expect(html.match(/<span aria-live="polite">Copy<\/span>/g)?.length).toBe(2);
  });

  it('tells support and auditors that only super admins can change it', () => {
    for (const role of ['support', 'auditor'] as const)
      expect(render({ role })).toContain('Only super admins can change these settings');
    expect(render()).not.toContain('Only super admins can change these settings');
  });

  it('renders in Arabic with every message present', () => {
    expect(render({ locale: 'ar' })).toContain('التوثيق الرسمي');
  });
});
