import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithMessages } from '../render-test-utils';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
  usePathname: () => '/admin/account/security',
}));

const { OperatorPasskeys } = await import('./operator-passkeys');
const { OperatorMfaEnrolment } = await import('./operator-mfa-enrolment');

const KEY = ['operator', 'passkeys'] as const;
const yubikey = {
  id: '0b9f5f1e-6f25-4e3b-bd8e-2b3a0a8f6c01',
  name: 'Desk security key',
  createdAt: '2026-09-02T08:30:00.000Z',
  lastUsedAt: '2026-10-01T09:00:00.000Z',
  deviceType: 'singleDevice' as const,
  backedUp: false,
  transports: ['usb'],
};

describe('OperatorPasskeys', () => {
  it('lists the operator’s passkeys with the add and remove actions', () => {
    const html = renderWithMessages(createElement(OperatorPasskeys), {
      seed: [[KEY, { data: [yubikey] }]],
    });
    expect(html).toContain('id="passkeys"');
    expect(html).toContain('Desk security key');
    expect(html).toContain('Added Sep 2, 2026');
    expect(html).toContain('Add a passkey');
    expect(html).toContain('>Remove<');
  });

  it('invites the first passkey when there is none', () => {
    const html = renderWithMessages(createElement(OperatorPasskeys), {
      seed: [[KEY, { data: [] }]],
    });
    expect(html).toContain('You have no passkeys yet');
  });

  it('never claims two-factor is off: the card is only shown once it is on', () => {
    const html = renderWithMessages(createElement(OperatorPasskeys), {
      seed: [[KEY, { data: [] }]],
    });
    expect(html).not.toContain('Turn on two-factor authentication first');
  });
});

describe('the operator security screen', () => {
  it('shows the passkeys card under the authenticator status once two-factor is on', () => {
    const html = renderWithMessages(createElement(OperatorMfaEnrolment), {
      seed: [[KEY, { data: [yubikey] }]],
    });
    expect(html).toContain('Authenticator app');
    expect(html).toContain('id="passkeys"');
    expect(html.indexOf('id="passkeys"')).toBeGreaterThan(html.indexOf('Authenticator app'));
  });
});
