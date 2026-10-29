import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AuthShell } from './auth-shell';
import { renderGuest } from './render-test-utils';

const content = {
  eyebrow: 'MARKETING EYEBROW',
  heading: 'Marketing heading',
  headingAccent: 'accent word',
  subheading: 'Marketing sub copy',
  accent: '#25d366',
};
const header = {
  eyebrow: 'Sign in',
  title: 'Welcome',
  accent: 'back',
  subtitle: 'Enter your details',
};

function shell(over: Record<string, unknown> = {}, locale: 'en' | 'ar' = 'en') {
  return renderGuest(
    createElement(AuthShell, {
      page: 'login',
      content,
      appName: 'Acme',
      header,
      ...over,
      children: createElement('form', { id: 'the-form' }, 'FORM BODY'),
    }),
    { locale },
  );
}

const at = (html: string, needle: string) => html.indexOf(needle);

describe('the guest design (the Geta split)', () => {
  it('carries the form title inside the form column', () => {
    const html = shell();
    const title = at(html, '<h2');
    const form = at(html, 'FORM BODY');
    expect(title).toBeGreaterThan(-1);
    expect(form).toBeGreaterThan(title);
    // The eyebrow, title with its accent word, the closing period and the help line.
    expect(html).toContain('Sign in');
    expect(html).toContain('Welcome');
    expect(html).toContain('>back</span>.');
    // A tight line height on the title (merging the font size must not drop it).
    expect(html).toMatch(/<h2 class="[^"]*leading-tight/);
    expect(html).toContain('Enter your details');
  });

  it('is a half-width form column on the left, the pitch and stats on an ink panel on the right', () => {
    const html = shell();
    expect(html).toContain('sm:w-1/2');
    expect(html).toContain('bg-(--auth-geta-ink)');
    expect(html).toContain('auth-geta');
    expect(html).toContain('MARKETING EYEBROW');
    expect(html).toContain('Marketing heading');
    expect(html).toContain('Marketing sub copy');
    // The brand mark sits in the form column, not gated to small screens only.
    expect(at(html, 'Acme')).toBeLessThan(at(html, 'FORM BODY'));
    expect(at(html, 'FORM BODY')).toBeLessThan(at(html, 'MARKETING EYEBROW'));
    expect(html).not.toContain('lg:hidden');
  });

  it('shows the Geta logo picture, named by the product, with no referrer sent', () => {
    const html = shell();
    expect(html).toContain('src="https://ci3.googleusercontent.com/mail-sig/');
    expect(html).toMatch(
      /<img[^>]*referrerPolicy="no-referrer"|<img[^>]*referrerpolicy="no-referrer"/i,
    );
  });

  it('closes the panel with year, product and country by default, and the admin text when set', () => {
    const year = String(new Date().getFullYear());
    expect(shell({ countryIso: 'IN' })).toContain(`${year} Acme / India`);
    expect(shell()).toContain(`${year} Acme`);
    expect(shell({ extra: { footer: 'Custom closing line' } })).toContain('Custom closing line');
  });

  it('shows the three stat rows on sign-in but not on forgot password', () => {
    const login = shell();
    expect(login).toContain('auth-geta-shape');
    expect(login).toContain('10K+');

    const forgot = renderGuest(
      createElement(AuthShell, {
        page: 'forgot',
        content,
        appName: 'Acme',
        header,
        children: createElement('form'),
      }),
    );
    expect(forgot).not.toContain('10K+');
  });

  it('a fixed panel (reset password, link landings) says its own words on the dark side', () => {
    const panel = {
      heroTitle: 'Hero line',
      heroDesc: 'Hero detail',
      eyebrow: 'PANEL EYEBROW',
      heading: 'Panel heading',
      accent: 'accent',
      subheading: 'Panel sub',
    };
    const html = shell({ fixedPanel: panel });
    expect(html).toContain('PANEL EYEBROW');
    expect(html).toContain('Panel heading');
    expect(html).toContain('Panel sub');
    expect(html).not.toContain('Marketing heading');
  });

  it('draws no title block when the content brings its own (setup steps)', () => {
    const html = shell({ header: null });
    expect(html).not.toContain('<h2');
    expect(html).toContain('FORM BODY');
  });

  it('keeps the accent word readable on the dark panel even for a dark brand colour', () => {
    const html = shell({ content: { ...content, accent: '#0f766e' } });
    const m = /--auth-accent-dark:(#[0-9a-f]{6})/.exec(html);
    expect(m).toBeTruthy();
    expect(m![1]).not.toBe('#0f766e');
    expect(html).toContain('--auth-accent:#0f766e');
  });

  it('draws no accent word in italics, in any direction', () => {
    expect(shell({}, 'ar')).not.toMatch(/\bitalic\b/);
    expect(shell({}, 'en')).not.toMatch(/\bitalic\b/);
  });
});
