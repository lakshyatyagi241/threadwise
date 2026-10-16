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
const media = { mediaUrl: 'https://cdn.example.com/hero.jpg', mediaType: 'image' as const };
const header = {
  eyebrow: 'Sign in',
  title: 'Welcome',
  accent: 'back',
  subtitle: 'Enter your details',
};

function shell(variant: number, over: Record<string, unknown> = {}, locale: 'en' | 'ar' = 'en') {
  return renderGuest(
    createElement(AuthShell, {
      variant,
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

describe('the six guest designs', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'design %i carries the form title inside the form column or card',
    (v) => {
      const html = shell(v);
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
    },
  );

  it('design 1 is the split showcase: a 540 px form column, the marketing copy on the left', () => {
    const html = shell(1);
    expect(html).toContain('lg:grid-cols-[1fr_540px]');
    expect(html).toContain('MARKETING EYEBROW');
    expect(html).toContain('Marketing heading');
    expect(html).toContain('Marketing sub copy');
    // Hero card, stats, features and the checklist.
    expect(html).toContain('auth-stat-pill');
    expect(html).toContain('Shared inbox');
  });

  it('design 1 closes the panel with year, product and country by default, and the admin text when set', () => {
    const year = String(new Date().getFullYear());
    expect(shell(1, { countryIso: 'IN' })).toContain(`${year} Acme / India`);
    expect(shell(1)).toContain(`${year} Acme`);
    expect(shell(1, { extra: { footer: 'Custom closing line' } })).toContain('Custom closing line');
  });

  it('design 1 on the forgot page shows the hero card and footer but no stats, features or checklist', () => {
    const html = renderGuest(
      createElement(AuthShell, {
        variant: 1,
        page: 'forgot',
        content,
        appName: 'Acme',
        header,
        children: createElement('form'),
      }),
    );
    expect(html).toContain('A fresh link, used once');
    expect(html).not.toContain('auth-stat-pill');
    expect(html).not.toContain('Shared inbox');
  });

  it('design 2 puts the eyebrow and heading above the card but leaves the sub copy out', () => {
    const html = shell(2);
    expect(html).toContain('MARKETING EYEBROW');
    expect(html).toContain('Marketing heading');
    expect(html).not.toContain('Marketing sub copy');
    expect(at(html, 'Marketing heading')).toBeLessThan(at(html, '<h2'));
    expect(html).toContain('rounded-3xl');
  });

  it('design 3 shows only the sub copy, small, under the card, with the accent bar on top', () => {
    const html = shell(3);
    expect(html).not.toContain('MARKETING EYEBROW');
    expect(html).not.toContain('Marketing heading');
    expect(html).toContain('Marketing sub copy');
    expect(at(html, 'Marketing sub copy')).toBeGreaterThan(at(html, 'FORM BODY'));
    expect(html).toContain('h-1.5');
    // The logo sits inside the card, above the title.
    expect(at(html, 'Acme')).toBeLessThan(at(html, '<h2'));
  });

  it('design 4 is a 1:1 grid with an accent-to-near-black gradient and full-bleed media', () => {
    const html = shell(4, { content: { ...content, ...media } });
    expect(html).toContain('lg:grid-cols-2');
    expect(html).toContain('linear-gradient(150deg');
    expect(html).toMatch(/<img[^>]*class="absolute inset-0 size-full object-cover"/);
    expect(html).toContain('Marketing heading');
    expect(html).toContain('Marketing sub copy');
    expect(html).toContain(`© ${new Date().getFullYear()} Acme`);
  });

  it('design 5 shows the brand and eyebrow above a frosted card, and no heading or sub copy', () => {
    const html = shell(5);
    expect(html).toContain('auth-aurora');
    expect(html).toContain('MARKETING EYEBROW');
    expect(html).not.toContain('Marketing heading');
    expect(html).not.toContain('Marketing sub copy');
    expect(html).toContain('backdrop-blur-xl');
  });

  it('design 6 is the Geta split: a half-width form column on the left, the pitch and stats on an ink panel on the right', () => {
    const html = shell(6);
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

  it('design 6 shows the three stat rows on sign-in but not on forgot password', () => {
    const login = shell(6);
    expect(login).toContain('auth-geta-shape');
    expect(login).toContain('10K+');

    const forgot = renderGuest(
      createElement(AuthShell, {
        variant: 6,
        page: 'forgot',
        content,
        appName: 'Acme',
        header,
        children: createElement('form'),
      }),
    );
    expect(forgot).not.toContain('10K+');
  });

  it('an unknown design number renders the split showcase', () => {
    expect(shell(0)).toContain('lg:grid-cols-[1fr_540px]');
    expect(shell(9)).toContain('lg:grid-cols-[1fr_540px]');
  });

  it('a fixed panel (reset password, link landings) ignores the chosen design', () => {
    const panel = {
      heroTitle: 'Hero line',
      heroDesc: 'Hero detail',
      eyebrow: 'PANEL EYEBROW',
      heading: 'Panel heading',
      accent: 'accent',
      subheading: 'Panel sub',
    };
    for (const v of [1, 2, 3, 4, 5, 6]) {
      const html = shell(v, { fixedPanel: panel });
      expect(html, `design ${v}`).toContain('lg:grid-cols-[1fr_540px]');
      expect(html).toContain('Panel heading');
      expect(html).toContain('Hero line');
      expect(html).not.toContain('Marketing heading');
    }
  });

  it('draws no title block when the content brings its own (setup steps)', () => {
    const html = shell(1, { header: null });
    expect(html).not.toContain('<h2');
    expect(html).toContain('FORM BODY');
  });

  it('keeps the accent word readable on the dark panel even for a dark brand colour', () => {
    const html = shell(1, { content: { ...content, accent: '#0f766e' } });
    const m = /--auth-accent-dark:(#[0-9a-f]{6})/.exec(html);
    expect(m).toBeTruthy();
    expect(m![1]).not.toBe('#0f766e');
    expect(html).toContain('--auth-accent:#0f766e');
  });

  it('renders right-to-left languages without italic accent words', () => {
    const html = shell(1, {}, 'ar');
    expect(html).toContain('rtl:not-italic');
  });
});
