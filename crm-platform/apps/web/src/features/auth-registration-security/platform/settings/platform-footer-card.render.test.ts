import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithMessages } from '../render-test-utils';
import { PlatformFooterCard } from './platform-footer-card';
import { BRANDING_FOOTER_KEY } from './query-keys';

const render = (
  data: { footer: string; isDefault: boolean },
  options: { role?: 'super_admin' | 'support' | 'auditor'; locale?: 'en' | 'ar' } = {},
) =>
  renderWithMessages(createElement(PlatformFooterCard), {
    ...options,
    seed: [[BRANDING_FOOTER_KEY, data]],
  });

describe('PlatformFooterCard', () => {
  it('edits the footer in a two-row box with a counter and a preview wrapped in underscores', () => {
    const html = render({ footer: 'Sent via Acme', isDefault: false });
    expect(html).toMatch(/<textarea[^>]*rows="2"/);
    expect(html).toContain('Sent via Acme</textarea>');
    expect(html).toContain('13/60');
    expect(html).toContain('_Sent via Acme_');
  });

  it('counts characters, so sixty emoji fill the box without overflowing it', () => {
    const html = render({ footer: '😀'.repeat(60), isDefault: false });
    expect(html).toContain('60/60');
  });

  it('says there is no footer when it is blank, and what blank means', () => {
    const html = render({ footer: '', isDefault: false });
    expect(html).toContain('(no footer)');
    expect(html).toContain('Leave it empty to send no footer at all');
    expect(html).toContain('0/60');
  });

  it('marks the built-in text until an operator chooses one', () => {
    expect(render({ footer: 'Sent via Acme', isDefault: true })).toContain('Built-in text');
    expect(render({ footer: 'Sent via Acme', isDefault: false })).not.toContain('Built-in text');
  });

  it('offers Save and Clear to a super admin and neither to anyone else', () => {
    const admin = render({ footer: 'x', isDefault: false });
    expect(admin).toContain('Save footer');
    expect(admin).toContain('>Clear<');
    for (const role of ['support', 'auditor'] as const) {
      const html = render({ footer: 'x', isDefault: false }, { role });
      expect(html).not.toContain('Save footer');
      expect(html).toMatch(/<textarea[^>]*readOnly/);
    }
  });

  it('starts with Save off because nothing has changed', () => {
    expect(render({ footer: 'x', isDefault: false })).toMatch(
      /<button[^>]*\sdisabled=""[^>]*>Save footer/,
    );
  });

  it('renders in Arabic with every message present', () => {
    expect(render({ footer: 'x', isDefault: false }, { locale: 'ar' })).toContain(
      'تذييل رسائل المنصة',
    );
  });
});
