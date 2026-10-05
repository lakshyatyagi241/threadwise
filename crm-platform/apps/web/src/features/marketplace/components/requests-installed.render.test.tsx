import { describe, expect, it, vi } from 'vitest';
import { mktKeys } from '../api';
import { usageView } from '../lib/manage';
import { READ, onePage, renderMarket } from '../render-test-utils';
import { ID, installation, request, scopes } from '../test-fixtures';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/marketplace/requests',
}));

import { InstalledPage, UsagePanel } from './installed-page';
import { AskResult, RequestsPage } from './requests-page';

/**
 * Static renders with the real English and Arabic messages and seeded query data. They prove the text is complete, that the usage and
 * request states are worded as specified, and that permissions decide what is offered. There is no browser here: nothing below says
 * how the screens look or behave when clicked.
 */
const LOCALES = ['en', 'ar'] as const;

describe('installed page', () => {
  const list = (data = [installation()], usage = { installed: 3, limit: 10 }) =>
    [[mktKeys.installations('all', 'all'), { data, usage }]] as const;

  for (const locale of LOCALES) {
    it(`lists the installed apps with state and the usage in ${locale}`, () => {
      const html = renderMarket(<InstalledPage />, { locale, seed: list() });
      expect(html).toContain('data-testid="installation-webhook"');
      expect(html).toContain('data-testid="usage"');
      expect(html).toContain(`href="/marketplace/installed/${ID(50)}"`);
    });
  }

  it('says "x of limit installed", and unlimited for limit 0', () => {
    expect(renderMarket(<InstalledPage />, { seed: list() })).toContain('3 of 10 installed');
    const unlimited = renderMarket(<InstalledPage />, {
      seed: list([installation()], { installed: 3, limit: 0 }),
    });
    expect(unlimited).toContain('3 installed. Your plan has no limit.');
    expect(unlimited).not.toContain('of 0');
    expect(unlimited).not.toContain('role="progressbar"');
  });

  it('draws the cap in the warning style near the limit and prompts an upgrade at it', () => {
    const near = renderMarket(<UsagePanel usage={usageView({ installed: 9, limit: 10 })} />);
    expect(near).toContain('data-tone="near"');
    expect(near).toContain('You are close to');
    expect(near).not.toContain('See plans and upgrade');
    const full = renderMarket(<UsagePanel usage={usageView({ installed: 10, limit: 10 })} />);
    expect(full).toContain('data-tone="full"');
    expect(full).toContain('You have reached your plan');
    expect(full).toContain('href="/account/plans"');
    for (const locale of LOCALES) {
      renderMarket(<UsagePanel usage={usageView({ installed: 10, limit: 10 })} />, { locale });
      renderMarket(<UsagePanel usage={usageView({ installed: 0, limit: 0 })} />, { locale });
    }
    expect(renderMarket(<UsagePanel usage={usageView({ installed: 2, limit: 10 })} />)).toContain(
      'data-tone="normal"',
    );
  });

  it('shows paused, killed and needs-consent rows, with the reason and the pending version', () => {
    const html = renderMarket(<InstalledPage />, {
      seed: list([
        installation({
          id: ID(51),
          app: { ...installation().app, slug: 'a', name: 'Alpha' },
          status: 'disabled',
        }),
        installation({
          id: ID(52),
          app: { ...installation().app, slug: 'b', name: 'Bravo' },
          status: 'killed',
          killReason: 'Unsafe release',
        }),
        installation({
          id: ID(53),
          app: { ...installation().app, slug: 'c', name: 'Charlie' },
          needsReconsent: true,
          pendingVersion: {
            version: '2.0.0',
            newScopes: scopes('messages.send'),
            scopes: scopes('messages.send'),
          },
        }),
        installation({
          id: ID(54),
          app: { ...installation().app, slug: 'd', name: 'Delta' },
          health: { status: 'error', checkedAt: null, lastError: 'Wrong key', lastErrorAt: null },
        }),
      ]),
    });
    expect(html).toContain('Paused');
    expect(html).toContain('Stopped by platform');
    expect(html).toContain('Reason: Unsafe release');
    expect(html).toContain('Version 2.0.0 waits for you to accept its new permissions.');
    expect(html).toContain('New permissions to review');
    expect(html).toContain('Last error: Wrong key');
    expect(html).toContain('>Review');
  });

  it('has an empty state with links into both tabs, and a loading state', () => {
    const empty = renderMarket(<InstalledPage />, { seed: list([]) });
    expect(empty).toContain('Nothing installed yet');
    expect(empty).toContain('href="/marketplace/integrations"');
    expect(empty).toContain('href="/marketplace/apps"');
    expect(renderMarket(<InstalledPage />)).toContain('aria-label="Loading"');
  });
});

describe('requests page', () => {
  const REQ_KEY = [...mktKeys.requests, { sort: 'votes', limit: 25 }];
  const seed = (
    data = [
      request(),
      request({ id: ID(81), name: 'IndiaMART', hasVoted: true, voteCount: 12, status: 'planned' }),
    ],
  ) =>
    [
      [REQ_KEY, onePage(data)],
      [
        mktKeys.categories('integration'),
        {
          data: [
            {
              id: ID(9),
              kind: 'integration',
              slug: 'lead-sources',
              name: 'Lead sources',
              description: null,
              icon: null,
              sortOrder: 1,
              appCount: 2,
            },
          ],
        },
      ],
      [mktKeys.installations('all', 'all'), { data: [], usage: { installed: 0, limit: 0 } }],
    ] as const;

  for (const locale of LOCALES) {
    it(`renders the form and the list with votes and statuses in ${locale}`, () => {
      nav.search = '';
      const html = renderMarket(<RequestsPage />, { locale, seed: seed() });
      expect(html).toContain('data-testid="requests"');
      expect(html).toContain('JustDial');
      expect(html).toContain('IndiaMART');
      expect(html).toContain('for="mkt-req-name"');
      expect(html).toContain('for="mkt-req-note"');
    });
  }

  it('labels every form control and says the note is for the platform team only', () => {
    nav.search = '';
    const html = renderMarket(<RequestsPage />, { seed: seed() });
    for (const id of [
      'mkt-req-name',
      'mkt-req-kind',
      'mkt-req-category',
      'mkt-req-website',
      'mkt-req-note',
    ]) {
      expect(html, id).toContain(`for="${id}"`);
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toContain('Visible to the platform team only');
    expect(html).toContain('maxLength="80"');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('Lead sources');
    // The default kind is integration.
    expect(html).toMatch(/<option value="integration" selected/);
  });

  it('prefills the form from the address', () => {
    nav.search = 'name=Zoho%20Books&kind=mini_app';
    const html = renderMarket(<RequestsPage />, { seed: seed() });
    expect(html).toContain('value="Zoho Books"');
    expect(html).toMatch(/<option value="mini_app" selected/);
    nav.search = '';
  });

  it('shows the vote count, the status and a toggle that says whether you voted', () => {
    nav.search = '';
    const html = renderMarket(<RequestsPage />, { seed: seed() });
    expect(html).toContain('7 votes');
    expect(html).toContain('12 votes');
    expect(html).toContain('Planned');
    expect(html).toContain('Open');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Voted');
    expect(html).toMatch(/>Vote</);
    expect(renderMarket(<RequestsPage />, { seed: seed([request({ voteCount: 1 })]) })).toContain(
      '1 vote<',
    );
  });

  it('says a request that already existed was counted as a vote, apart from a new one', () => {
    const created = renderMarket(<AskResult result={{ request: request(), created: true }} />);
    expect(created).toContain('Request added: JustDial');
    expect(created).not.toContain('counted as a vote');
    const counted = renderMarket(<AskResult result={{ request: request(), created: false }} />);
    expect(counted).toContain('Someone already asked for JustDial');
    expect(counted).toContain('Your request was counted as a vote for it.');
    for (const locale of LOCALES) {
      renderMarket(<AskResult result={{ request: request(), created: false }} />, { locale });
      renderMarket(<AskResult result={{ request: request(), created: true }} />, { locale });
    }
  });

  it('has an empty state and a loading state', () => {
    nav.search = '';
    expect(renderMarket(<RequestsPage />, { seed: seed([]) })).toContain('No requests yet');
    expect(renderMarket(<RequestsPage />)).toContain('aria-label="Loading"');
  });

  it('only needs market.apps.read to ask and to vote', () => {
    nav.search = '';
    const html = renderMarket(<RequestsPage />, { seed: seed(), permissions: [READ] });
    expect(html).toContain('Send request');
    expect(html).toContain('Vote');
    expect(html).not.toContain('market.apps.install');
  });
});
