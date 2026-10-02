import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { makeSession, renderAccount } from '../render-test-utils';

const nav = vi.hoisted(() => ({ pathname: '/account/profile' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
}));
// Another domain's pane, declared only in that domain's nav.ts.
vi.mock('@/features/_registry/nav.generated', () => ({
  NAV: [
    {
      id: 'wallet',
      group: 'settings',
      labelKey: 'auth-registration-security.account.hub.tabs.branding',
      href: '/account/wallet',
      order: 30,
    },
    { id: 'contacts', group: 'crm', labelKey: 'x', href: '/contacts' },
  ],
}));

const { AccountFrame } = await import('./account-frame');
const plans = {
  data: [{ name: 'Growth', current: true }],
  currentSlug: 'growth',
  trialEndsAt: null,
};
const page = createElement('p', { id: 'pane' }, 'PANE');

function render(path: string, overrides = {}, locale: 'en' | 'ar' = 'en') {
  nav.pathname = path;
  return renderAccount(createElement(AccountFrame, null, page), {
    locale,
    session: makeSession(overrides),
    seed: [[['plans'], plans]],
  });
}

describe('AccountFrame', () => {
  it('draws the rail, the breadcrumb, the heading of this domain’s pane and the pane itself', () => {
    const html = render('/account/profile');
    expect(html).toContain('Asha Rao');
    expect(html).toContain('asha@acme.test');
    expect(html).toContain('Growth plan');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toMatch(/aria-current="page"[^>]*>Profile</);
    expect(html).toContain('<h1');
    expect(html).toContain('id="pane"');
  });

  it('shows the initials of the first two words as the photo fallback', () => {
    expect(render('/account/profile')).toContain('>AR<');
  });

  it('lists the panes in Reference order, with another domain’s pane from its nav entry', () => {
    const html = render('/account/profile');
    const order = ['/account/profile', '/account/plans', '/account/wallet', '/account/branding'];
    const at = order.map((href) => html.indexOf(`href="${href}"`));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html.indexOf('href="/account/security"')).toBeGreaterThan(at[3] as number);
    expect(html.indexOf('href="/account/delete"')).toBeGreaterThan(
      html.indexOf('href="/account/security"'),
    );
    expect(html).not.toContain('href="/contacts"');
  });

  it('marks the pane the path is on, and lets another domain’s pane own its heading', () => {
    const html = render('/account/wallet');
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/account\/wallet"/);
    expect(html).not.toContain('<h1');
  });

  it('offers the plan teaser and links the upgrade card to the plans', () => {
    const html = render('/account/profile');
    expect(html).toContain('Need more room?');
    expect(html).toMatch(/href="\/account\/plans"[^>]*>\s*<span[^>]*>Need more room\?/);
  });

  it('while a security step is forced, only the security pane stays a link', () => {
    const html = render('/account/security', {
      flags: {
        suspended: false,
        emailUnverified: false,
        emailBlocked: false,
        mfaEnrolmentRequired: true,
        passwordChangeRequired: false,
      },
    });
    expect(html).toContain('href="/account/security"');
    expect(html).not.toContain('href="/account/profile"');
    expect(html).not.toContain('href="/account/delete"');
    expect(html).toContain('aria-disabled="true"');
  });

  it('renders in Arabic with every message present', () => {
    const html = render('/account/profile', {}, 'ar');
    expect(html).toContain('الملف الشخصي');
    expect(html).toContain('باقة Growth');
  });
});
