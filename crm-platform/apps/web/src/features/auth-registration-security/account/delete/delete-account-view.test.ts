import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderAccount } from '../render-test-utils';

vi.mock('next/navigation', () => ({
  usePathname: () => '/account/delete',
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
}));

const { DeleteAccountView } = await import('./delete-account-view');

describe('DeleteAccountView', () => {
  const html = renderAccount(createElement(DeleteAccountView));

  it('asks for the exact phrase and the password, with a destructive submit', () => {
    expect(html).toContain('Type DELETE my account to confirm');
    expect(html).toContain('placeholder="DELETE my account"');
    expect(html).toContain('Permanently delete account');
  });

  it('offers the optional "why are you leaving" note: two rows, optional, not part of the request', () => {
    expect(html).toContain('Why are you leaving? (optional)');
    expect(html).toMatch(/<textarea[^>]*rows="2"/);
    expect(html).toContain('It is not sent anywhere');
  });

  it('points to the plans and to support before the person deletes', () => {
    expect(html).toContain('Before you delete, consider');
    expect(html).toMatch(/href="\/account\/plans"[^>]*>Downgrading to the free plan/);
    expect(html).toMatch(/href="\/support"[^>]*>Contacting support/);
  });

  it('renders in Arabic', () => {
    expect(renderAccount(createElement(DeleteAccountView), { locale: 'ar' })).toContain(
      'لماذا ترحل؟',
    );
  });
});
