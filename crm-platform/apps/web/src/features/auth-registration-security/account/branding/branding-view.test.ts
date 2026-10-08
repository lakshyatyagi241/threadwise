import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { keys } from '../api';
import { makeSession, renderAccount } from '../render-test-utils';

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings/message-footer',
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
}));

const { BrandingView } = await import('./branding-view');

const base = {
  messageFooter: null,
  platformDefault: 'Sent via Acme Cloud',
  canEdit: false,
  effective: 'Sent via Acme Cloud',
};
const render = (data: object, opts: Parameters<typeof renderAccount>[1] = {}) =>
  renderAccount(createElement(BrandingView), { ...opts, seed: [[keys.branding, data]] });

describe('BrandingView on the Settings page (no heading of its own)', () => {
  it('leaves the title and description to the page', () => {
    const quiet = renderAccount(createElement(BrandingView, { showHeading: false }), {
      seed: [[keys.branding, { ...base, canEdit: true, effective: null }]],
    });
    expect(quiet).not.toContain('<h2');
    expect(quiet).toContain('<textarea');
    expect(render({ ...base, canEdit: true, effective: null })).toContain('<h2');
  });
});

describe('BrandingView, plan without remove_branding', () => {
  const html = render(base);

  it('is read-only: no box, no save', () => {
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('Save footer');
  });

  it('shows the platform footer wrapped in underscores, labelled as the platform default', () => {
    expect(html).toContain('Current footer (platform default)');
    expect(html).toContain('_Sent via Acme Cloud_');
  });

  it('says why and links to the plans', () => {
    expect(html).toContain('Upgrade to remove the platform footer.');
    expect(html).toMatch(/href="\/account\/plans"[^>]*>See plans/);
  });
});

describe('BrandingView, plan that removes branding', () => {
  const editable = { ...base, canEdit: true, effective: null };

  it('is a two-row box with a 60-character counter and a live preview', () => {
    const html = render(editable);
    expect(html).toContain('<textarea');
    expect(html).toMatch(/<textarea[^>]*rows="2"/);
    expect(html).toContain('Custom footer (60 characters at most)');
    expect(html).toContain('0/60');
    expect(html).toContain('(no footer)');
    expect(html).toContain('Leave blank to send messages with no footer at all.');
  });

  it('offers Save footer and Remove my footer, and no reset-to-default (the platform footer never applies here)', () => {
    const html = render(editable);
    expect(html).toContain('Save footer');
    expect(html).toContain('Remove my footer');
    expect(html).not.toContain('>Clear<');
    expect(html).not.toContain('platform default');
    expect(html).not.toContain('Reset to');
  });

  it('has nothing to remove while no footer is saved, and offers it once there is one', () => {
    expect(render(editable)).toMatch(/<button[^>]*\sdisabled=""[^>]*>Remove my footer/);
    const withFooter = render({
      ...editable,
      messageFooter: 'Acme Bakery',
      effective: 'Acme Bakery',
    });
    expect(withFooter).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Remove my footer/);
    expect(withFooter).toContain('Remove my footer');
  });

  it('is translated', () => {
    expect(render(editable, { locale: 'ar' })).toContain('إزالة تذييلي');
  });

  it('starts from what the workspace saved and previews it in underscores', () => {
    const html = render({ ...editable, messageFooter: 'Acme Bakery', effective: 'Acme Bakery' });
    expect(html).toContain('>Acme Bakery</textarea>');
    expect(html).toContain('11/60');
    expect(html).toContain('_Acme Bakery_');
  });

  it('counts an emoji as one character, like the server', () => {
    const html = render({ ...editable, messageFooter: '😀😀', effective: '😀😀' });
    expect(html).toContain('2/60');
  });

  it('is read-only for a member who may not change it, with the footer that goes out', () => {
    const html = render(
      { ...editable, messageFooter: 'Acme Bakery', effective: 'Acme Bakery' },
      { session: makeSession({ permissions: {} }) },
    );
    expect(html).not.toContain('<textarea');
    expect(html).toContain('Current footer');
    expect(html).toContain('_Acme Bakery_');
    expect(html).toContain('Only workspace administrators can change the footer');
  });
});

describe('BrandingView in Arabic', () => {
  it('renders both states with every message present', () => {
    expect(render(base, { locale: 'ar' })).toContain('_Sent via Acme Cloud_');
    expect(render({ ...base, canEdit: true, effective: null }, { locale: 'ar' })).toContain(
      '<textarea',
    );
  });
});
