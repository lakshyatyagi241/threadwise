import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { keys } from '../api';
import { renderAccount } from '../render-test-utils';

vi.mock('next/navigation', () => ({
  usePathname: () => '/account/security',
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
}));

const { AccountPasskeys } = await import('./passkeys-card');

const mfaOn = {
  enabled: true,
  confirmedAt: '2026-09-01T10:00:00.000Z',
  recoveryCodesRemaining: 8,
  required: false,
};
const mfaOff = { enabled: false, confirmedAt: null, recoveryCodesRemaining: 0, required: false };

const laptop = {
  id: '0b9f5f1e-6f25-4e3b-bd8e-2b3a0a8f6c01',
  name: 'Work laptop',
  createdAt: '2026-09-02T08:30:00.000Z',
  lastUsedAt: null,
  deviceType: 'singleDevice' as const,
  backedUp: false,
  transports: ['internal'],
};
const phone = {
  id: '5d3c2a77-1e0b-4a8e-9c52-7a1f6b3d4e02',
  name: 'Asha phone',
  createdAt: '2026-09-10T12:00:00.000Z',
  lastUsedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  deviceType: 'multiDevice' as const,
  backedUp: true,
  transports: ['hybrid'],
};

const render = (seed: Parameters<typeof renderAccount>[1]) =>
  renderAccount(createElement(AccountPasskeys), seed);

describe('AccountPasskeys with two-factor on', () => {
  const html = render({
    seed: [
      [keys.mfa, mfaOn],
      [keys.passkeys, { data: [laptop, phone] }],
    ],
  });

  it('shows the title, the explanation and the add button', () => {
    expect(html).toContain('id="passkeys"');
    expect(html).toContain('>Passkeys<');
    expect(html).toContain('instead of typing a code');
    expect(html).toContain('Add a passkey');
  });

  it('lists each passkey with its name, when it was added and when it was last used', () => {
    expect(html).toContain('Work laptop');
    expect(html).toContain('Added Sep 2, 2026');
    expect(html).toContain('Never used');
    expect(html).toContain('Asha phone');
    expect(html).toContain('Added Sep 10, 2026');
    expect(html).toContain('Last used 3 days ago');
  });

  it('tells a synced passkey from a device-bound one', () => {
    expect(html).toContain('>Synced<');
    expect(html).toContain('>This device only<');
  });

  it('has a remove button per passkey that names the passkey for screen readers', () => {
    expect(html.split('>Remove<').length - 1).toBe(2);
    expect(html).toContain('<span class="sr-only"> Work laptop</span>');
    expect(html).toContain('<span class="sr-only"> Asha phone</span>');
  });

  it('does not show the needs-two-factor notice', () => {
    expect(html).not.toContain('Turn on two-factor authentication first');
  });
});

describe('AccountPasskeys states', () => {
  it('invites the first passkey when the list is empty', () => {
    const html = render({
      seed: [
        [keys.mfa, mfaOn],
        [keys.passkeys, { data: [] }],
      ],
    });
    expect(html).toContain('You have no passkeys yet');
    expect(html).toContain('Add a passkey');
  });

  it('with two-factor off, explains and links to the authenticator setup instead of offering a button that cannot work', () => {
    const html = render({
      seed: [
        [keys.mfa, mfaOff],
        [keys.passkeys, { data: [] }],
      ],
    });
    expect(html).toContain('Turn on two-factor authentication first');
    expect(html).toContain('href="#two-factor"');
    expect(html).toContain('Go to two-factor authentication');
    expect(html).not.toContain('Add a passkey');
    expect(html).not.toContain('You have no passkeys yet');
  });

  it('says it is loading while the list has not arrived', () => {
    const html = render({ seed: [[keys.mfa, mfaOn]] });
    expect(html).toContain('Loading');
    expect(html).not.toContain('You have no passkeys yet');
  });

  it('renders in Arabic with the same structure', () => {
    const html = render({
      locale: 'ar',
      seed: [
        [keys.mfa, mfaOn],
        [keys.passkeys, { data: [laptop] }],
      ],
    });
    expect(html).toContain('Work laptop');
    expect(html).not.toContain('Add a passkey');
    expect(html).not.toContain('Never used');
  });
});
