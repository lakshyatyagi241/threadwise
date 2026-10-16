import { describe, expect, it, vi } from 'vitest';
import type {
  MailboxListResponse,
  MailboxResponse,
  MailProviderInfo,
  MailWorkspaceSettings,
} from '@crm/contracts';
import { KEYS } from '../api/mailboxes';
import { HubScreen } from './hub-screen';
import { render } from './render-utils';

const ME = '9a6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f99';
let search = '';
let manage = true;
let perms: Record<string, boolean> = {};
// The signatures panel (task 8) has its own render tests; the hub tests look at the hub.
vi.mock('./signatures-panel', () => ({ SignaturesPanel: () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined }),
  usePathname: () => '/email',
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (key: string) =>
    key in perms ? perms[key] : key === 'mail.mailboxes.manage' ? manage : false,
  useSession: () => ({ user: { id: ME } }),
}));

const box = (o: Partial<MailboxResponse> = {}): MailboxResponse => ({
  id: '0b6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f50',
  provider: 'google' as const,
  address: 'support@acme.com',
  displayName: 'Acme Support',
  status: 'connected' as const,
  scope: 'shared' as const,
  ownerUserId: null,
  ownerName: null,
  hasSignature: false,
  pushActive: false,
  sendLimitPerHour: null,
  imap: null,
  channelId: '5d2c7a10-1b2c-4e3d-8f4a-0a1b2c3d4e5f',
  connectedAt: '2026-10-01T08:00:00.000Z',
  lastSyncedAt: '2026-10-12T09:00:00.000Z',
  lastError: null,
  conversationCount: 12,
  rowVersion: 3,
  ...o,
});

const providers = (o: Partial<Record<MailProviderInfo['provider'], boolean>> = {}) => ({
  data: (['google', 'microsoft', 'imap'] as const).map((p) => ({
    provider: p,
    label: p,
    kind: p === 'imap' ? ('password' as const) : ('oauth' as const),
    ready: o[p] ?? true,
    notReadyReason: o[p] === false ? 'not set up' : null,
  })),
});

const policy = (o: Partial<MailWorkspaceSettings> = {}): MailWorkspaceSettings => ({
  personalMailboxesEnabled: false,
  whoMayConnectPersonal: 'admins',
  adminsCanReadPersonal: false,
  rowVersion: 1,
  ...o,
});

const page = (
  list: Partial<MailboxListResponse> & { data: MailboxResponse[] },
  locale = 'en',
  extra: { providers?: ReturnType<typeof providers>; settings?: MailWorkspaceSettings } = {},
) =>
  render(<HubScreen />, {
    locale,
    seed: [
      [KEYS.mailboxes, { limit: 3, used: list.data.length, providerReady: true, ...list }],
      [KEYS.providers, extra.providers ?? providers()],
      [KEYS.settings, extra.settings ?? policy()],
    ],
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

  it('offers Reconnect but not Remove once a mailbox is already disconnected', () => {
    search = '';
    manage = true;
    // Disconnect keeps the row (so its history stays attached on reconnect); Remove would just call the same
    // no-op disconnect again, so the button is hidden rather than offered and silently doing nothing.
    const html = page({ data: [box({ status: 'disconnected' })] });
    expect(html).toContain('>Disconnected<');
    expect(html).toContain('>Reconnect<');
    expect(html).not.toContain('>Remove<');
  });

  it('says to ask the platform administrator while Google is not set up, and offers no working button', () => {
    search = '';
    manage = true;
    const html = page({ data: [] }, 'en', { providers: providers({ google: false }) });
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

  it('offers Google, Microsoft 365 and IMAP/SMTP as working cards (no Soon cards)', () => {
    search = '';
    manage = true;
    const html = page({ data: [] });
    for (const id of ['google', 'microsoft', 'imap']) {
      expect(html).toContain(`data-testid="email-provider-${id}"`);
      expect(html).toContain(`data-testid="email-provider-${id}" data-state="ready"`);
    }
    expect(html).toContain('Connect Gmail</button>');
    expect(html).toContain('Connect Microsoft 365</button>');
    expect(html).toContain('Connect IMAP / SMTP</button>');
    expect(html).not.toContain('>Soon<');
  });

  it('explains which provider the platform has not set up, per card', () => {
    search = '';
    manage = true;
    const html = page({ data: [] }, 'en', { providers: providers({ microsoft: false }) });
    expect(html).toMatch(/data-testid="email-provider-microsoft" data-state="not_ready"/);
    expect(html).toMatch(/data-testid="email-provider-imap" data-state="ready"/);
    expect(html).toContain('Microsoft 365 / Outlook is not set up for this platform yet');
  });

  it('shows the provider and scope badges, push, signature and the send limit on a card', () => {
    search = '';
    manage = true;
    const html = page({
      data: [
        box({
          provider: 'microsoft',
          pushActive: true,
          hasSignature: true,
          sendLimitPerHour: 40,
        }),
        box({ id: '4c6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f54', provider: 'imap', address: 'a@b.co' }),
      ],
    });
    expect(html).toContain('data-testid="email-provider-badge">Microsoft 365<');
    expect(html).toContain('data-testid="email-provider-badge">IMAP / SMTP<');
    expect(html).toContain('data-scope="shared"');
    expect(html).toContain('data-testid="email-push"');
    expect(html).toContain('data-testid="email-signature-chip"');
    expect(html).toContain('40 emails per hour');
    expect(html).toContain('Platform default');
  });

  it('shows my personal mailbox with its owner and actions, and only a summary of someone else', () => {
    search = '';
    manage = true;
    const html = page({
      data: [
        box({
          scope: 'personal',
          ownerUserId: ME,
          ownerName: 'Asha Rao',
          address: 'asha@acme.com',
        }),
        box({
          id: '5c6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f55',
          scope: 'personal',
          ownerUserId: '7c6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f77',
          ownerName: 'Ben Ortiz',
          address: 'ben@acme.com',
          conversationCount: 41,
          lastError: 'secret problem',
          status: 'error',
        }),
      ],
    });
    expect(html).toContain('Personal · Asha Rao');
    expect(html).toContain('Personal · Ben Ortiz');
    expect(html).toContain('data-testid="email-summary-note"');
    // exactly one summary row, and nothing of its content or actions leaks
    expect(html.match(/data-testid="email-summary-note"/g)).toHaveLength(1);
    expect(html).not.toContain('secret problem');
    expect(html).not.toContain('>41<');
    // my own row keeps Open in inbox and Sync now; the summary row has no actions of its own
    expect(html.match(/>Sync now</g)).toHaveLength(1);
    expect(html.match(/data-testid="email-open-inbox"/g)).toHaveLength(1);
  });

  it("lets admins open another person's personal mailbox only when the policy allows it", () => {
    search = '';
    manage = true;
    const other = box({
      scope: 'personal',
      ownerUserId: '7c6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f77',
      ownerName: 'Ben Ortiz',
    });
    const off = page({ data: [other] });
    expect(off).not.toContain('data-testid="email-open-inbox"');
    const on = page({ data: [other] }, 'en', { settings: policy({ adminsCanReadPersonal: true }) });
    expect(on).toContain('data-testid="email-open-inbox"');
    expect(on).not.toContain('>Remove<');
  });

  it('asks shared or personal only when the workspace allows personal mailboxes and the viewer may use both', () => {
    search = '';
    manage = true;
    perms = { 'mail.mailboxes.manage_personal': true, 'mail.settings.manage': true };
    const allowed = page({ data: [] }, 'en', {
      settings: policy({ personalMailboxesEnabled: true }),
    });
    expect(allowed).toContain('data-testid="email-scope"');
    expect(allowed).toContain('name="email-scope"');
    const disabled = page({ data: [] });
    expect(disabled).not.toContain('data-testid="email-scope"');
    perms = {};
  });

  it('lets an agent without manage rights connect only a personal mailbox when allowed', () => {
    search = '';
    manage = false;
    perms = { 'mail.mailboxes.manage_personal': true };
    const html = page({ data: [] }, 'en', {
      settings: policy({ personalMailboxesEnabled: true, whoMayConnectPersonal: 'agents' }),
    });
    expect(html).toContain('data-testid="email-scope-personal-only"');
    expect(html).toContain('data-testid="email-provider-google" data-state="ready"');
    // an agent is not offered personal when only admins may connect one
    const adminsOnly = page({ data: [] }, 'en', {
      settings: policy({ personalMailboxesEnabled: true, whoMayConnectPersonal: 'admins' }),
    });
    expect(adminsOnly).not.toContain('data-testid="email-scope-personal-only"');
    expect(adminsOnly).toContain('data-state="no_permission"');
    perms = {};
    manage = true;
  });

  it('shows the Email sharing panel only to people who manage the policy', () => {
    search = '';
    manage = true;
    expect(page({ data: [] })).not.toContain('data-testid="email-sharing"');
    perms = { 'mail.settings.manage': true };
    const html = page({ data: [] }, 'en', { settings: policy({ personalMailboxesEnabled: true }) });
    expect(html).toContain('data-testid="email-sharing"');
    expect(html).toContain('>Email sharing<');
    expect(html).toContain('Personal mailboxes');
    expect(html).toContain('Admins can read personal mailboxes');
    perms = {};
  });

  it('reconnects an IMAP mailbox with Reconnect and the password hint', () => {
    search = '';
    manage = true;
    const html = page({ data: [box({ provider: 'imap', status: 'needs_reauth' })] });
    expect(html).toContain('>Reconnect<');
  });

  it('offers Test connection on an IMAP mailbox (also one that needs reconnecting), not on Gmail, a disconnected one or to a reader', () => {
    search = '';
    manage = true;
    const imap = (o: Partial<MailboxResponse>) => page({ data: [box({ provider: 'imap', ...o })] });
    expect(imap({})).toContain('data-testid="email-test-connection"');
    expect(imap({ status: 'needs_reauth' })).toContain('>Test connection<');
    expect(imap({ status: 'disconnected' })).not.toContain('email-test-connection');
    expect(page({ data: [box()] })).not.toContain('email-test-connection');
    manage = false;
    expect(imap({})).not.toContain('email-test-connection');
    manage = true;
  });

  it('shows how far behind a connected mailbox is, in minutes or hours, and warns when it is far behind', () => {
    search = '';
    manage = true;
    const lag = (seconds: number | null) => page({ data: [box({ syncLagSeconds: seconds })] });
    expect(lag(20)).toContain('Under a minute');
    expect(lag(300)).toContain('5 minutes');
    expect(lag(300)).not.toContain('text-warning"');
    expect(lag(7_300)).toContain('2 hours');
    expect(lag(7_300)).toContain('data-testid="email-lag"');
    expect(lag(900)).toMatch(/text-warning[^>]*data-testid="email-lag"/);
    expect(lag(null)).not.toContain('email-lag');
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
      ['denied', 'The sign-in was cancelled'],
      ['limit', 'mailbox limit is reached, so this mailbox was not connected'],
      ['wrong_account', 'different account than the mailbox'],
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
