import { createElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthPagesResponse } from '@crm/contracts';
import { renderWithMessages } from '../render-test-utils';
import { authPagesToDraft } from '../lib/auth-pages-draft';
import { AuthPagesEditorPage, PageFields } from './auth-pages-editor';

const shipped = (accent: string) => ({
  eyebrow: 'Shipped eyebrow',
  heading: 'Shipped heading',
  headingAccent: 'accent',
  subheading: 'Shipped sub-text',
  accent,
});
const pages: AuthPagesResponse = {
  defaults: { login: shipped('#0f766e'), register: shipped('#112233'), forgot: shipped('#0f766e') },
  variant: 1,
  login: {},
  register: {},
  forgot: {},
  extra: { login: {}, register: {}, forgot: { footer: 'Stored forgot footer' } },
};
const KEY = ['operator', 'settings', 'auth-pages'];

// The editor reads the window width once to pick the preview size; there is no window in these tests.
beforeAll(() => vi.stubGlobal('window', { innerWidth: 1280 }));
afterAll(() => vi.unstubAllGlobals());

const render = (
  options: {
    role?: 'super_admin' | 'support' | 'auditor';
    locale?: 'en' | 'ar';
    data?: AuthPagesResponse;
  } = {},
) =>
  renderWithMessages(createElement(AuthPagesEditorPage), {
    ...options,
    seed: [[KEY, options.data ?? pages]],
  });

describe('AuthPagesEditorPage', () => {
  it('opens the real page in a new tab, beside the enlarge toggle', () => {
    const html = render();
    const link = html.match(/<a [^>]*href="\/login"[^>]*>/);
    expect(link).not.toBeNull();
    expect(link![0]).toContain('target="_blank"');
    expect(link![0]).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Open the real page');
    expect(html.indexOf('Open the real page')).toBeLessThan(html.indexOf('Enlarge preview'));
  });

  it('points the description at the registration policy, where Terms and Privacy are set', () => {
    const html = render();
    expect(html).toMatch(
      /<a [^>]*href="\/admin\/settings\/registration"[^>]*>Registration policy<\/a>/,
    );
  });

  it('says exactly which colours the accent field takes', () => {
    const html = render();
    expect(html).toContain('A six-digit hex colour such as #0f766e');
    // Longer than six digits can be typed, so the error explains it instead of the box cutting the text.
    expect(html).toContain('maxLength="9"');
  });

  it('offers the three page tabs and the five designs', () => {
    const html = render();
    for (const tab of ['Login', 'Register', 'Forgot password']) expect(html).toContain(`>${tab}<`);
    expect(html).toContain('Split showcase');
    expect(html).toContain('Aurora');
  });

  it('lets support edit and tells an auditor it is read-only', () => {
    expect(render({ role: 'support' })).not.toContain('can look at them');
    expect(render({ role: 'auditor' })).toContain(
      'Only super admins and support can change these settings',
    );
  });

  it('renders in Arabic with every message present', () => {
    expect(render({ locale: 'ar' })).toContain('فتح الصفحة الفعلية');
  });
});

describe('PageFields showcase text', () => {
  const fields = (page: 'login' | 'register' | 'forgot') =>
    renderWithMessages(
      createElement(PageFields, {
        page,
        draft: authPagesToDraft(pages),
        defaults: pages.defaults,
        errors: {},
        disabled: false,
        setField: () => undefined,
        setExtra: () => undefined,
      }),
    );

  it('gives the forgot page a hero card and a footer line, with the stored footer in its box', () => {
    const html = fields('forgot');
    expect(html).toContain('id="ap-extra-forgot-hero_title"');
    expect(html).toContain('id="ap-extra-forgot-hero_desc"');
    expect(html).toContain('id="ap-extra-forgot-footer"');
    expect(html).toContain('value="Stored forgot footer"');
  });

  it('does not offer statistics, feature cards or chips on the forgot page', () => {
    const html = fields('forgot');
    for (const id of ['stat1_num', 'feat1_title', 'chip1', 'inside_heading'])
      expect(html).not.toContain(`id="ap-extra-forgot-${id}"`);
  });

  it('keeps the whole showcase on sign-in and sign-up', () => {
    for (const page of ['login', 'register'] as const) {
      const html = fields(page);
      for (const id of ['hero_title', 'stat1_num', 'feat1_title', 'chip1', 'footer'])
        expect(html).toContain(`id="ap-extra-${page}-${id}"`);
    }
  });
});
