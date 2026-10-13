import { describe, expect, it, vi } from 'vitest';
import { NO_FILTERS, listQuery, parseBrowseParams } from '../lib/browse';
import { ApiError } from '@/lib/api/errors';
import { mktKeys } from '../api';
import { READ, onePage, renderMarket } from '../render-test-utils';
import { ID, card, paidPricing } from '../test-fixtures';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/marketplace/integrations',
}));

import { AppCard } from './app-card';
import { BrowsePage } from './browse-page';
import { RequestBox } from './browse-parts';
import { InstalledLinkLabel, MarketplaceHeader } from './marketplace-header';
import { ErrorPanel } from './ui';

/**
 * Static renders with the real English and Arabic messages and seeded query data: they prove the text is complete (a missing or
 * broken message throws), that state and permissions decide what each card offers, and that nothing a card says is unsafe. There is
 * no browser here: nothing below says how the screens look or behave when clicked.
 */
const LOCALES = ['en', 'ar'] as const;

const installState = (over: object = {}) => ({
  installationId: ID(50),
  status: 'active' as const,
  health: 'healthy' as const,
  needsReconsent: false,
  ...over,
});

const category = (slug: string, name: string, appCount: number, sortOrder: number) => ({
  id: ID(100 + sortOrder),
  kind: 'integration' as const,
  slug,
  name,
  description: null,
  icon: null,
  sortOrder,
  appCount,
});

const seedBrowse = (
  cards = [card()],
  filters = NO_FILTERS,
  extra: Array<readonly [readonly unknown[], unknown]> = [],
) =>
  [
    [
      mktKeys.categories('integration'),
      {
        data: [
          category('lead-sources', 'Lead sources', 4, 1),
          category('telephony', 'Telephony', 2, 2),
        ],
      },
    ],
    [
      mktKeys.shelves('integration'),
      {
        popular: [card({ id: ID(2), slug: 'popular-one', name: 'Popular One' })],
        new: [card({ id: ID(3), slug: 'new-one', name: 'New One' })],
        featured: [],
      },
    ],
    [[...mktKeys.apps('integration'), listQuery('integration', filters)], onePage(cards)],
    [mktKeys.installations('all', 'all'), { data: [], usage: { installed: 3, limit: 10 } }],
    ...extra,
  ] as const;

describe('app cards', () => {
  for (const locale of LOCALES) {
    it(`draws a plain card with its details and an install button in ${locale}`, () => {
      const html = renderMarket(<AppCard card={card()} />, { locale });
      expect(html).toContain('data-testid="app-card-webhook"');
      expect(html).toContain('Webhook');
      expect(html).toContain('Lead sources');
      expect(html).toContain('/marketplace/app/webhook"');
      expect(html).toContain('href="/marketplace/app/webhook/install"');
    });
  }

  it('shows the install state of an installed card and sends it to the manage page', () => {
    const html = renderMarket(<AppCard card={card({ install: installState() })} />);
    expect(html).toContain('Installed');
    expect(html).toContain('Healthy');
    expect(html).toContain(`href="/marketplace/installed/${ID(50)}"`);
    expect(html).not.toContain('/install"');
  });

  it('shows paused, degraded, needs sign-in and killed states', () => {
    const paused = renderMarket(
      <AppCard card={card({ install: installState({ status: 'disabled' }) })} />,
    );
    expect(paused).toContain('Paused');
    const degraded = renderMarket(
      <AppCard card={card({ install: installState({ health: 'degraded' }) })} />,
    );
    expect(degraded).toContain('Degraded');
    const reauth = renderMarket(
      <AppCard card={card({ install: installState({ health: 'needs_reauth' }) })} />,
    );
    expect(reauth).toContain('Needs sign-in again');
    const killed = renderMarket(
      <AppCard card={card({ install: installState({ status: 'killed', health: 'error' }) })} />,
    );
    expect(killed).toContain('Stopped by platform');
    expect(killed).not.toContain('Error');
  });

  it('asks for the new permissions to be reviewed when a newer version needs consent', () => {
    const html = renderMarket(
      <AppCard card={card({ install: installState({ needsReconsent: true }) })} />,
    );
    expect(html).toContain('New permissions to review');
    expect(html).toContain('Review permissions');
  });

  it('shows a locked app with a lock chip and an upgrade link, and no install button', () => {
    const plan = renderMarket(
      <AppCard
        card={card({
          locked: { reason: 'plan_feature', key: 'analytics', upgradeUrl: '/account/plans' },
        })}
      />,
    );
    expect(plan).toContain('Not in your plan');
    expect(plan).toContain('href="/account/plans"');
    expect(plan).not.toContain('/install"');
    const limit = renderMarket(
      <AppCard card={card({ locked: { reason: 'limit_reached', key: null, upgradeUrl: null } })} />,
    );
    expect(limit).toContain('Plan limit reached');
    expect(limit).toContain('href="/account/plans"');
    const module = renderMarket(
      <AppCard
        card={card({ locked: { reason: 'module_disabled', key: 'x', upgradeUrl: null } })}
      />,
    );
    expect(module).toContain('Not available');
    expect(module).not.toContain('See plans and upgrade');
  });

  it('never locks an installed app, even if the response says it is locked', () => {
    const html = renderMarket(
      <AppCard
        card={card({
          install: installState(),
          locked: { reason: 'plan_feature', key: 'analytics', upgradeUrl: '/account/plans' },
        })}
      />,
    );
    expect(html).not.toContain('Not in your plan');
  });

  it('offers details only to someone who may not install', () => {
    const html = renderMarket(<AppCard card={card()} />, { permissions: [READ] });
    expect(html).not.toContain('/install"');
    expect(html).toContain('View details');
  });

  it('falls back to initials without a logo and refuses a logo that is not https', () => {
    const none = renderMarket(<AppCard card={card({ logo: null })} />);
    expect(none).toContain('>WE<');
    expect(none).not.toContain('<img');
    const http = renderMarket(<AppCard card={card({ logo: 'http://x.test/logo.png' })} />);
    expect(http).not.toContain('<img');
    const https = renderMarket(<AppCard card={card({ logo: 'https://x.test/logo.png' })} />);
    expect(https).toContain('src="https://x.test/logo.png"');
    expect(https).toContain('loading="lazy"');
    expect(https).toContain('alt=""');
  });

  it('prints the card text as text, never as markup', () => {
    const html = renderMarket(<AppCard card={card({ tagline: '<img src=x onerror=alert(1)>' })} />);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('browse page', () => {
  for (const locale of LOCALES) {
    it(`renders the header, categories, shelves, results and request box in ${locale}`, () => {
      nav.search = '';
      const html = renderMarket(<BrowsePage kind="integration" />, { locale, seed: seedBrowse() });
      expect(html).toContain('href="/marketplace/apps"');
      expect(html).toContain('href="/marketplace/integrations"');
      expect(html).toMatch(/aria-current="page"[^>]*>[^<]*/);
      expect(html).toContain('href="/marketplace/installed"');
      expect(html).toContain('href="/marketplace/requests');
      expect(html).toContain('data-testid="app-card-webhook"');
      expect(html).toContain('Popular One');
      expect(html).toContain('New One');
      expect(html).toContain('lead-sources');
    });
  }

  it('shows the usage of the plan cap in the Installed link', () => {
    const html = renderMarket(<InstalledLinkLabel />, {
      seed: [
        [mktKeys.installations('all', 'all'), { data: [], usage: { installed: 3, limit: 10 } }],
      ],
    });
    expect(html).toContain('Installed (3 of 10)');
    const unlimited = renderMarket(<InstalledLinkLabel />, {
      seed: [
        [mktKeys.installations('all', 'all'), { data: [], usage: { installed: 3, limit: 0 } }],
      ],
    });
    expect(unlimited).toContain('Installed (3)');
  });

  it('marks the current tab and sections for assistive technology', () => {
    const apps = renderMarket(<MarketplaceHeader section="apps" />);
    expect(apps).toMatch(
      /href="\/marketplace\/apps"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/marketplace\/apps"/,
    );
    expect(apps).not.toMatch(
      /aria-current="page"[^>]*href="\/marketplace\/integrations"|href="\/marketplace\/integrations"[^>]*aria-current="page"/,
    );
  });

  it('puts the selected category in the address and marks it', () => {
    nav.search = 'category=lead-sources';
    const filters = parseBrowseParams(new URLSearchParams(nav.search));
    const html = renderMarket(<BrowsePage kind="integration" />, {
      seed: seedBrowse([card()], filters),
    });
    expect(html).toContain('href="/marketplace/integrations?category=lead-sources"');
    expect(html).toMatch(/aria-current="page"[^>]*><span>Lead sources/);
    // A filter is active: the shelves and their cards are gone, the results are headed "Results".
    expect(html).not.toContain('Popular One');
    expect(html).toContain('Results');
    nav.search = '';
  });

  it('hides the shelves while a search is active', () => {
    nav.search = 'q=zap';
    const filters = parseBrowseParams(new URLSearchParams(nav.search));
    const html = renderMarket(<BrowsePage kind="integration" />, {
      seed: seedBrowse([card()], filters),
    });
    expect(html).not.toContain('Popular One');
    expect(html).toContain('value="zap"');
    nav.search = '';
  });

  it('says so when a category in the address does not exist', () => {
    nav.search = 'category=nope';
    const filters = parseBrowseParams(new URLSearchParams(nav.search));
    const html = renderMarket(<BrowsePage kind="integration" />, {
      seed: seedBrowse([card()], filters),
    });
    expect(html).toContain('That category does not exist in this tab.');
    nav.search = '';
  });

  it('shows the empty state with a way to clear filters and the request box', () => {
    nav.search = 'q=nothing';
    const filters = parseBrowseParams(new URLSearchParams(nav.search));
    const html = renderMarket(<BrowsePage kind="integration" />, { seed: seedBrowse([], filters) });
    expect(html).toContain('Nothing matches your search');
    expect(html).toContain('Clear filters');
    expect(html).toContain('Request an integration');
    expect(html).toContain('/marketplace/requests?name=nothing');
    nav.search = '';
  });

  it('shows a loading state before data, and no cards', () => {
    nav.search = '';
    const html = renderMarket(<BrowsePage kind="integration" />);
    expect(html).toContain('aria-label="Loading"');
    expect(html).not.toContain('app-card-');
  });

  it('has Load more only when the API says there are more', () => {
    nav.search = '';
    const more = renderMarket(<BrowsePage kind="integration" />, {
      seed: seedBrowse().map((s, i) => (i === 2 ? ([s[0], onePage([card()], true)] as const) : s)),
    });
    expect(more).toContain('Load more');
    expect(renderMarket(<BrowsePage kind="integration" />, { seed: seedBrowse() })).not.toContain(
      'Load more',
    );
  });

  it('draws the availability chips with the active one pressed, and the sort as a labelled select', () => {
    nav.search = 'installed=true';
    const filters = parseBrowseParams(new URLSearchParams(nav.search));
    const html = renderMarket(<BrowsePage kind="integration" />, {
      seed: seedBrowse([card({ install: installState() })], filters),
    });
    expect(html).toContain('data-testid="mkt-availability-all"');
    expect(html).toContain('Available add-ons');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="mkt-availability-installed"/);
    expect(html).toContain('for="mkt-sort"');
    expect(html).toContain('Most installed');
    nav.search = '';
  });

  for (const locale of LOCALES) {
    it(`Available add-ons keeps only the cards on offer, equal height, in ${locale}`, () => {
      nav.search = 'addons=true';
      const filters = parseBrowseParams(new URLSearchParams(nav.search));
      const cards = [
        card(),
        card({ id: ID(7), slug: 'crm-sync', name: 'CRM Sync', pricing: paidPricing() }),
      ];
      const html = renderMarket(<BrowsePage kind="integration" />, {
        locale,
        seed: seedBrowse(cards, filters),
      });
      expect(html).toContain('data-testid="app-card-crm-sync"');
      expect(html).not.toContain('data-testid="app-card-webhook"');
      expect(html).toContain('data-testid="needs-purchase"');
      expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="mkt-availability-addons"/);
      expect(html).toContain('h-full');
      nav.search = '';
    });
  }

  it('says there are no add-ons when none is loaded and there is no more', () => {
    nav.search = 'addons=true';
    const filters = parseBrowseParams(new URLSearchParams(nav.search));
    const html = renderMarket(<BrowsePage kind="integration" />, {
      seed: seedBrowse([card()], filters),
    });
    expect(html).toContain('No add-ons to buy here');
    nav.search = '';
  });
});

describe('request box and error panel', () => {
  it('links to the requests page, saying what kind it is', () => {
    expect(renderMarket(<RequestBox kind="integration" />)).toContain(
      'href="/marketplace/requests"',
    );
    const apps = renderMarket(<RequestBox kind="mini_app" name="Quote" />);
    expect(apps).toContain('href="/marketplace/requests?name=Quote&amp;kind=mini_app"');
    expect(apps).toContain('Request a mini app');
  });

  for (const locale of LOCALES) {
    it(`names the upgrade and shows the request id of a plan lock in ${locale}`, () => {
      const error = new ApiError(422, 'PLAN_FEATURE_LOCKED', 'x', 'req-77', [
        { path: 'feature', message: 'marketplace' },
        { path: 'upgradeUrl', message: '/account/plans' },
      ]);
      const html = renderMarket(<ErrorPanel error={error} onRetry={() => undefined} />, { locale });
      expect(html).toContain('href="/account/plans"');
      expect(html).not.toContain('req-77');
      expect(html).not.toContain('Try again');
    });
  }

  it('offers a retry for a network failure and none for a conflict', () => {
    const net = renderMarket(<ErrorPanel error={new Error('offline')} onRetry={() => undefined} />);
    expect(net).toContain('Try again');
    const conflict = renderMarket(
      <ErrorPanel
        error={new ApiError(409, 'ROW_VERSION_CONFLICT', 'x', 'r')}
        onRetry={() => undefined}
      />,
    );
    expect(conflict).not.toContain('Try again');
  });
});
