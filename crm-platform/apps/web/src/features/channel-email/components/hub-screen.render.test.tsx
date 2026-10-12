import { describe, expect, it, vi } from 'vitest';
import type { MailboxListResponse, MailboxResponse } from '@crm/contracts';
import { KEYS } from '../api/mailboxes';
import { HubScreen } from './hub-screen';
import { render } from './render-utils';

let search = '';
let manage = true;
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined }),
  usePathname: () => '/email',
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => manage,
}));

const box = (o: Partial<MailboxResponse> = {}): MailboxResponse => ({
  id: '0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50',
  provider: 'google' as const,
  address: 'support@acme.com',
  displayName: 'Acme Support',
  status: 'connected' as const,
  channelId: '5d2c7a10-1b2c-4e3d-8f4a-0a1b2c3d4e5f',
  connectedAt: '2026-10-01T08:00:00.000Z',
  lastSyncedAt: '2026-10-12T09:00:00.000Z',
  lastError: null,
  conversationCount: 12,
  rowVersion: 3,
  ...o,
});

const page = (list: Partial<MailboxListResponse> & { data: MailboxResponse[] }, locale = 'en') =>
  render(<HubScreen />, {
    locale,
    seed: [[KEYS.mailboxes, { limit: 3, used: list.data.length, providerReady: true, ...list }]],
  });

describe('email hub', () => {
  it('lists a connected mailbox with its health, counts and actions', () => {
    search = '';
    manage = true;
    const html = page({ data: [box()] });
    expect(html).toContain('support@acme.com');
    expect(html).toContain('Acme Support');
    expect(html).toContain('data-status="connected"');
    expect(html).toContain('>Connected<');
    expect(html).toContain('href="/inbox?channel=5d2c7a10-1b2c-4e3d-8f4a-0a1b2c3d4e5f"');
    expect(html).toContain('>Sync now<');
    expect(html).toContain('>Remove<');
    expect(html).toContain('1 of 3 mailboxes');
    expect(html).toContain('Connect Gmail');
  });

  it('shows a mailbox that needs reconnecting with Reconnect, and an error with its last problem', () => {
    search = '';
    manage = true;
    const html = page({
      data: [
        box({ status: 'needs_reauth' }),
        box({
          id: '1c6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f51',
          address: 'sales@acme.com',
          status: 'error',
          lastError: 'Quota exceeded',
        }),
      ],
    });
    expect(html).toContain('>Needs reconnect<');
    expect(html).toContain('>Reconnect<');
    expect(html).toContain('Last problem: Quota exceeded');
  });

  it('says to ask the platform administrator while Google is not set up, and offers no working button', () => {
    search = '';
    manage = true;
    const html = page({ data: [], providerReady: false });
    expect(html).toContain('data-testid="email-not-ready"');
    expect(html).toContain('Ask your platform administrator');
  });

  it('explains the limit and disables Connect when the plan is used up', () => {
    search = '';
    manage = true;
    const html = page({
      data: [
        box(),
        box({ id: '2c6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f52' }),
        box({ id: '3c6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f53' }),
      ],
      limit: 3,
    });
    expect(html).toContain('data-testid="email-limit"');
    expect(html).toContain('3 of 3 mailboxes');
  });

  it('shows IMAP and Microsoft as disabled Soon cards', () => {
    search = '';
    const html = page({ data: [] });
    for (const id of ['imap', 'microsoft']) {
      expect(html).toMatch(
        new RegExp(`data-testid="email-provider-${id}"[^>]*aria-disabled="true"`),
      );
    }
    expect(html).toContain('>Soon<');
  });

  it('hides the manage actions from someone who can only read', () => {
    search = '';
    manage = false;
    const html = page({ data: [box()] });
    expect(html).not.toContain('>Sync now<');
    expect(html).not.toContain('>Remove<');
    expect(html).toContain('href="/inbox?channel=');
    manage = true;
  });

  it('answers the ?email= outcome with its own message', () => {
    manage = true;
    for (const [outcome, text] of [
      ['connected', 'Mailbox connected.'],
      ['denied', 'Google sign-in was cancelled'],
      ['limit', 'mailbox limit is reached, so this mailbox was not connected'],
      ['wrong_account', 'different Google account'],
    ] as const) {
      search = `email=${outcome}`;
      const html = page({ data: [] });
      expect(html).toContain(`data-outcome="${outcome}"`);
      expect(html).toContain(text);
    }
    search = 'email=bogus';
    expect(page({ data: [] })).not.toContain('data-testid="email-outcome"');
    search = '';
  });

  it('renders in Arabic without a missing message', () => {
    search = '';
    expect(() => page({ data: [box()] }, 'ar')).not.toThrow();
  });
});
