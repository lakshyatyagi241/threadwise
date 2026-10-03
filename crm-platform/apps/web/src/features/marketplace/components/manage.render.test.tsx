import { describe, expect, it, vi } from 'vitest';
import { mktKeys } from '../api';
import { INSTALL, MANAGE, READ, onePage, renderMarket } from '../render-test-utils';
import { HOOK_URL, ID, SECRET, URL_KEY, detail, installation, scopes } from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => `/marketplace/installed/${ID(50)}`,
}));

import { ManagePage } from './manage-page';

/**
 * Static renders with the real English and Arabic messages and seeded query data. They prove the text is complete, that the state of
 * an installation and the person's permissions decide what is offered, and that no credential value is ever on the page. There is no
 * browser here: nothing below says how the page looks or behaves when clicked.
 */
const LOCALES = ['en', 'ar'] as const;
const WID = ID(50);

const event = (n: number, over: object = {}) => ({
  id: ID(200 + n),
  externalId: `lead-${n}`,
  status: 'accepted' as const,
  error: null,
  receivedAt: '2026-10-02T09:00:00.000Z',
  ...over,
});

const seed = (inst = installation(), opts: { app?: boolean; events?: object[] } = {}) =>
  [
    [mktKeys.installation(WID), inst],
    ...(opts.app === false ? [] : [[mktKeys.app('webhook'), detail()] as const]),
    [
      [...mktKeys.events(WID), { limit: 25 }],
      onePage(
        opts.events ?? [
          event(1),
          event(2, { status: 'rejected', error: 'Nothing could be mapped' }),
        ],
      ),
    ],
  ] as const;

const passwordInputs = (html: string) => html.match(/<input[^>]*type="password"[^>]*>/g) ?? [];

describe('manage page', () => {
  for (const locale of LOCALES) {
    it(`renders the header, permissions, credentials, connection, events and uninstall in ${locale}`, () => {
      const html = renderMarket(<ManagePage id={WID} />, { locale, seed: seed() });
      expect(html).toContain('data-testid="manage-page"');
      expect(html).toContain('Webhook');
      expect(html).toContain('data-testid="connection"');
      expect(html).toContain('data-testid="counters"');
      expect(html).toContain('data-testid="events"');
      expect(html).toContain('lead-1');
      expect(html).toContain('Nothing could be mapped');
      expect(html).toContain('data-testid="scope-leads.write"');
      expect(html).toContain('mkt-data-keep');
      expect(html).toContain('mkt-data-delete');
    });
  }

  it('shows status, health with the check time, and the last error', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(
        installation({
          health: {
            status: 'degraded',
            checkedAt: '2026-10-02T10:00:00.000Z',
            lastError: 'The portal answered 502.',
            lastErrorAt: '2026-10-02T09:59:00.000Z',
          },
        }),
      ),
    });
    expect(html).toContain('Installed');
    expect(html).toContain('Degraded');
    expect(html).toContain('Last checked');
    expect(html).toContain('The portal answered 502.');
    expect(html).toContain('Version 1.0.0');
  });

  it('shows what is stored for a credential without ever putting a value in a password field', () => {
    const html = renderMarket(<ManagePage id={WID} />, { seed: seed() });
    expect(html).toContain('Saved, ends in 9f2a');
    const inputs = passwordInputs(html);
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(input).not.toMatch(/value="[^"]+"/);
    // A plain text field shows its stored value; a secret never does.
    expect(html).toContain('value="acct-42"');
    expect(html).not.toContain(SECRET);
    expect(html).toContain('Leave blank to keep the saved value.');
  });

  it('offers Clear for an optional stored field only', () => {
    const html = renderMarket(<ManagePage id={WID} />, { seed: seed() });
    expect(html).toContain('Clear Account id');
    expect(html).not.toContain('Clear Portal key');
  });

  it('builds the form from the installation when the listing cannot be read', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(installation(), { app: false }),
    });
    expect(html).toContain('Portal key');
    expect(html).toContain('Saved, ends in 9f2a');
  });

  it('shows the connection: address, auth headers, secret tail (never the secret), counters', () => {
    const html = renderMarket(<ManagePage id={WID} />, { seed: seed() });
    expect(html).toContain(HOOK_URL);
    expect(html).toContain('X-Marketplace-Token');
    expect(html).toContain('X-Marketplace-Signature');
    expect(html).toContain('The secret ends in cdef.');
    expect(html).not.toContain(SECRET);
    expect(html).toMatch(/>12<[\s\S]*>10<[\s\S]*>1<[\s\S]*>1</);
  });

  it('has Test connection, Send sample lead, Rotate secret and Pause for someone who may manage', () => {
    const html = renderMarket(<ManagePage id={WID} />, { seed: seed() });
    expect(html).toContain('Test connection');
    expect(html).toContain('Send sample lead');
    expect(html).toContain('Rotate secret');
    expect(html).toContain('>Pause<');
    expect(html).toContain('Rotate the connection secret?');
    expect(html).toContain('the old one stops working immediately');
    expect(html).toContain('Save changes');
  });

  it('asks before pausing and before uninstalling, with the keep-or-delete choice and an honest note', () => {
    const html = renderMarket(<ManagePage id={WID} />, { seed: seed() });
    expect(html).toContain('Pause Webhook?');
    expect(html).toContain('Uninstall Webhook?');
    expect(html).toContain('Keep the data it created');
    expect(html).toContain('Delete the data it created');
    expect(html).toContain(
      'contacts that this app already created stay in your workspace whichever you choose',
    );
    expect(html).toMatch(/id="mkt-data-keep"[^>]*checked/);
    expect(html).not.toMatch(/id="mkt-data-delete"[^>]*checked/);
  });

  it('a killed installation shows the platform stop and its reason, and only uninstall is left', () => {
    const killed = installation({
      status: 'killed',
      killReason: 'Security issue in version 1.0.0',
      needsReconsent: true,
    });
    for (const locale of LOCALES) {
      const html = renderMarket(<ManagePage id={WID} />, { locale, seed: seed(killed) });
      expect(html).toContain('data-testid="killed-banner"');
    }
    const html = renderMarket(<ManagePage id={WID} />, { seed: seed(killed) });
    expect(html).toContain('Stopped by the platform');
    expect(html).toContain('Security issue in version 1.0.0');
    expect(html).not.toContain('Save changes');
    expect(html).not.toContain('Test connection');
    expect(html).not.toContain('Send sample lead');
    expect(html).not.toContain('Rotate secret');
    expect(html).not.toContain('>Pause<');
    expect(html).not.toContain('>Resume<');
    expect(html).not.toContain('data-testid="connection"');
    expect(html).not.toContain('data-testid="events"');
    expect(html).not.toContain('reconsent-banner');
    expect(html).not.toContain(HOOK_URL);
    expect(html).not.toContain(URL_KEY);
    expect(html).toContain('Uninstall');
    expect(html).toContain('mkt-data-keep');
  });

  it('a paused installation says so, offers Resume and cannot send a sample', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(installation({ status: 'disabled' })),
    });
    expect(html).toContain('data-testid="paused-banner"');
    expect(html).toContain('>Resume<');
    expect(html).not.toContain('>Pause<');
    expect(html).not.toContain('>Send sample lead<');
    expect(html).toContain('Resume the app to send a sample lead.');
    expect(html).toContain('Test connection');
  });

  describe('new permissions to accept', () => {
    const pending = installation({
      needsReconsent: true,
      pendingVersion: {
        version: '1.1.0',
        newScopes: scopes('messages.send'),
        scopes: scopes('leads.write', 'messages.send'),
      },
    });

    for (const locale of LOCALES) {
      it(`shows the banner with the new and the full list in ${locale}`, () => {
        const html = renderMarket(<ManagePage id={WID} />, { locale, seed: seed(pending) });
        expect(html).toContain('data-testid="reconsent-banner"');
      });
    }

    it('names the version, the new permission and the full pending list, and offers the accept button', () => {
      const html = renderMarket(<ManagePage id={WID} />, { seed: seed(pending) });
      expect(html).toContain('Version 1.1.0 asks for new permissions');
      expect(html).toContain('keeps running on version 1.0.0');
      expect(html).toContain('Send messages');
      expect(html).toContain('Add leads');
      expect(html).toContain('New permissions to review');
      expect(html).toContain('Accept new permissions');
    });

    it('hides the accept button from someone without market.apps.install and names the key', () => {
      const html = renderMarket(<ManagePage id={WID} />, {
        seed: seed(pending),
        permissions: [READ, MANAGE],
      });
      expect(html).not.toContain('Accept new permissions');
      expect(html).toContain('market.apps.install');
    });
  });

  it('hides what a person may not do and names the missing permission', () => {
    const readOnly = renderMarket(<ManagePage id={WID} />, { seed: seed(), permissions: [READ] });
    for (const hidden of [
      'Save changes',
      'Test connection',
      'Send sample lead',
      'Rotate secret',
      '>Pause<',
      'Rotate the connection secret?',
      'Pause Webhook?',
      'Uninstall Webhook?',
    ]) {
      expect(readOnly, hidden).not.toContain(hidden);
    }
    expect(readOnly).toContain('market.apps.manage');
    expect(readOnly).toContain('market.apps.install');
    // The credentials stay readable (as "saved"), never editable and never a value.
    expect(readOnly).toContain('ends in 9f2a');
    expect(passwordInputs(readOnly)).toHaveLength(0);

    const installOnly = renderMarket(<ManagePage id={WID} />, {
      seed: seed(),
      permissions: [READ, INSTALL],
    });
    expect(installOnly).toContain('Uninstall Webhook?');
    expect(installOnly).not.toContain('Test connection');
    expect(installOnly).not.toContain('Save changes');

    const manageOnly = renderMarket(<ManagePage id={WID} />, {
      seed: seed(),
      permissions: [READ, MANAGE],
    });
    expect(manageOnly).toContain('Test connection');
    expect(manageOnly).not.toContain('Uninstall Webhook?');
    expect(manageOnly).toContain('market.apps.install');
  });

  it('draws no connection or events for an installation without one', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(installation({ connection: null, credentials: [] }), { app: false }),
    });
    expect(html).not.toContain('data-testid="connection"');
    expect(html).not.toContain('data-testid="events"');
    expect(html).toContain('Permissions granted');
  });

  it('says there are no deliveries yet, and offers Load more only when there are more', () => {
    const empty = renderMarket(<ManagePage id={WID} />, {
      seed: seed(installation(), { events: [] }),
    });
    expect(empty).toContain('No deliveries yet');
    const more = renderMarket(<ManagePage id={WID} />, {
      seed: [
        [mktKeys.installation(WID), installation()],
        [mktKeys.app('webhook'), detail()],
        [[...mktKeys.events(WID), { limit: 25 }], onePage([event(1)], true)],
      ],
    });
    expect(more).toContain('Load more');
  });

  it('shows a loading state before the installation arrives', () => {
    expect(renderMarket(<ManagePage id={WID} />)).toContain('aria-label="Loading"');
  });

  it('never lets the one-time secret into the page', () => {
    for (const locale of LOCALES) {
      const html = renderMarket(<ManagePage id={WID} />, { locale, seed: seed() });
      expect(html).not.toContain(SECRET);
      expect(html).not.toContain('secret-reveal');
    }
  });
});
