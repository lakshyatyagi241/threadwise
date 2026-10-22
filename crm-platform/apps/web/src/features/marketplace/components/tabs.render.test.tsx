import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceAddonsResponse } from '@crm/contracts';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import { KEYS as ADDON_KEYS } from '@/features/addons-extension-registry/api';
import { KEYS as GOOGLE_KEYS } from '@/features/google-account/api/google-account';
import { KEYS as ECOM_KEYS } from '@/features/shopify-woocommerce/api/ecom';
import { SettingsTilesProvider } from '@/features/settings-hub/settings-context';
import { mktKeys } from '../api';
import { NO_FILTERS, listQuery, parseBrowseParams } from '../lib/browse';
import { onePage, renderMarket } from '../render-test-utils';
import { ID, card, paidPricing } from '../test-fixtures';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/marketplace/integrations',
}));

import { AddonsPage } from './addons-page';
import { BrowsePage } from './browse-page';
import { DeveloperPage } from './developer-page';
import { MarketplaceHeader } from './marketplace-header';

/**
 * Static renders (no browser) of the four Marketplace tabs with the real English and Arabic messages: what each tab is made of, that
 * the two listing tabs share one card grid and one sort, that connectors take part in the Integrations list, and that a tile the person
 * does not have is absent. Nothing here says how the screens look or behave when clicked.
 */
const LOCALES = ['en', 'ar'] as const;

const tile = (id: string, over: Partial<ResolvedSettingsTile> = {}): ResolvedSettingsTile => ({
  id,
  section: 'integrations',
  labelKey: `settings.tiles.${id}.label`,
  descriptionKey: `settings.tiles.${id}.description`,
  href: `/${id}`,
  icon: 'store',
  locked: false,
  comingSoon: false,
  ...over,
});

const CONNECTORS = [
  tile('shopify'),
  tile('woocommerce', { locked: true }),
  tile('google-sheets', { href: '/google-account', icon: 'google-sheets' }),
  tile('video-meetings', { icon: 'calendar' }),
];
const DEV = [
  tile('rest-api', { icon: 'code' }),
  tile('webhooks'),
  tile('addons', { href: '/addons' }),
];

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
          category('e-commerce', 'E-commerce', 1, 1),
          category('productivity', 'Productivity', 0, 2),
          category('calendar-and-meetings', 'Calendar and meetings', 0, 3),
        ],
      },
    ],
    [
      mktKeys.shelves('integration'),
      {
        popular: [card({ id: ID(2), slug: 'popular-one', name: 'Popular One' })],
        new: [],
        featured: [],
      },
    ],
    [[...mktKeys.apps('integration'), listQuery('integration', filters)], onePage(cards)],
    [mktKeys.installations('all', 'all'), { data: [], usage: { installed: 3, limit: 10 } }],
    ...extra,
  ] as const;

const withTiles = (tiles: ResolvedSettingsTile[], child: React.ReactNode) => (
  <SettingsTilesProvider tiles={tiles}>{child}</SettingsTilesProvider>
);

const count = (html: string, needle: RegExp) => (html.match(needle) ?? []).length;

describe('the header', () => {
  for (const locale of LOCALES) {
    it(`has the four tabs in order, and Installed and Requests in the more menu, in ${locale}`, () => {
      const html = renderMarket(<MarketplaceHeader section="developer" />, { locale });
      const order = [
        '/marketplace/apps"',
        '/marketplace/integrations"',
        '/marketplace/addons"',
        '/marketplace/developer"',
      ].map((h) => html.indexOf(`href="${h}`));
      expect(order.every((i) => i > -1)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(html).toContain('href="/marketplace/installed"');
      expect(html).toContain('href="/marketplace/requests"');
      // exactly one tab is the current page
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(html).toMatch(
        /href="\/marketplace\/developer"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/marketplace\/developer"/,
      );
    });
  }

  it('names the tabs in English', () => {
    const html = renderMarket(<MarketplaceHeader section="addons" />);
    for (const label of ['Mini apps', 'Integrations', 'Add-ons', 'Developer']) {
      expect(html).toContain(`>${label}</a>`);
    }
  });

  it('keeps the tabs in a scrolling row, in document order, so the keyboard visits them left to right and on a phone', () => {
    const html = renderMarket(<MarketplaceHeader section="apps" />);
    expect(html).toContain('overflow-x-auto');
  });
});

describe('the Integrations tab: listings and connectors in one list', () => {
  for (const locale of LOCALES) {
    it(`draws connectors as cards of the same grid as the listings, with no separate block, in ${locale}`, () => {
      nav.search = '';
      const html = renderMarket(withTiles(CONNECTORS, <BrowsePage kind="integration" />), {
        locale,
        seed: seedBrowse([card()], NO_FILTERS, [
          [
            ECOM_KEYS.overview('shopify'),
            { appEnabled: true, scopes: '', eventTopics: [], store: { connected: true } },
          ],
        ]),
      });
      expect(html).not.toContain('data-testid="mkt-tools-integrations"');
      expect(html).toContain('data-testid="connector-card-shopify"');
      expect(html).toContain('data-testid="connector-card-google-sheets"');
      expect(html).toContain('data-testid="connector-card-video-meetings"');
      expect(html).toContain('data-testid="app-card-webhook"');
      // one grid: the listing card and the connector cards share the same parent element
      const grid = html.slice(html.indexOf('id="mkt-results"'));
      expect(grid.indexOf('connector-card-shopify')).toBeGreaterThan(-1);
      expect(count(grid, /<div class="grid auto-rows-fr/g)).toBe(1);
      // the frame is the same as an app card's
      const frame = /data-testid="connector-card-shopify"[^>]*class="([^"]*)"/.exec(html)?.[1];
      const appFrame = /data-testid="app-card-webhook"[^>]*class="([^"]*)"/.exec(html)?.[1];
      expect(frame).toBe(appFrame);
    });
  }

  it('shows each connector once: the shelves hold listings only', () => {
    nav.search = '';
    const html = renderMarket(withTiles(CONNECTORS, <BrowsePage kind="integration" />), {
      seed: seedBrowse(),
    });
    expect(count(html, /data-testid="connector-card-shopify"/g)).toBe(1);
    expect(html).toContain('Popular One');
  });

  it('says only what it knows: Connected from a read, Upgrade for a locked plan, nothing for an unread connection', () => {
    nav.search = '';
    const html = renderMarket(withTiles(CONNECTORS, <BrowsePage kind="integration" />), {
      seed: seedBrowse([card()], NO_FILTERS, [
        [
          ECOM_KEYS.overview('shopify'),
          { appEnabled: true, scopes: '', eventTopics: [], store: { connected: true } },
        ],
        [
          GOOGLE_KEYS.account,
          { status: 'connected', capabilities: [{ key: 'sheets', granted: false }] },
        ],
      ]),
    });
    expect(html).toMatch(/data-testid="connector-card-shopify"[^>]*data-status="connected"/);
    expect(html).toMatch(/data-testid="connector-card-woocommerce"[^>]*data-status="upgrade"/);
    expect(html).toMatch(
      /data-testid="connector-card-google-sheets"[^>]*data-status="not_connected"/,
    );
    expect(html).toMatch(/data-testid="connector-card-video-meetings"[^>]*data-status="unknown"/);
    expect(html).toContain('Connected');
    expect(html).toContain('Upgrade');
    expect(html).toContain('Not connected');
    // the unread one carries no claim
    const meet = html.slice(html.indexOf('connector-card-video-meetings'));
    expect(meet.slice(0, meet.indexOf('</article>'))).not.toContain(
      'data-testid="connector-status"',
    );
  });

  it('opens each connector on its own screen, with Manage / Connect / Open by state', () => {
    nav.search = '';
    const html = renderMarket(withTiles(CONNECTORS, <BrowsePage kind="integration" />), {
      seed: seedBrowse([card()], NO_FILTERS, [
        [
          ECOM_KEYS.overview('shopify'),
          { appEnabled: true, scopes: '', eventTopics: [], store: { connected: true } },
        ],
        [GOOGLE_KEYS.account, { status: 'disconnected', capabilities: [] }],
      ]),
    });
    expect(html).toContain('href="/shopify"');
    expect(html).toContain('href="/google-account"');
    const slice = (id: string) => {
      const from = html.indexOf(`connector-card-${id}`);
      return html.slice(from, html.indexOf('</article>', from));
    };
    expect(slice('shopify')).toContain('>Manage<');
    expect(slice('google-sheets')).toContain('>Connect<');
    expect(slice('woocommerce')).toContain('>Open<');
  });

  it('a search keeps the matching connectors and hides the others, with the shelves gone', () => {
    nav.search = 'q=shop';
    const filters = parseBrowseParams(new URLSearchParams(nav.search));
    const html = renderMarket(withTiles(CONNECTORS, <BrowsePage kind="integration" />), {
      seed: seedBrowse([], filters),
    });
    expect(html).toContain('data-testid="connector-card-shopify"');
    expect(html).not.toContain('data-testid="connector-card-video-meetings"');
    expect(html).not.toContain('Popular One');
    expect(html).not.toContain('Nothing matches your search');
    nav.search = '';
  });

  it('a category keeps the connectors mapped to it, and the category list counts them', () => {
    nav.search = 'category=e-commerce';
    const filters = parseBrowseParams(new URLSearchParams(nav.search));
    const html = renderMarket(withTiles(CONNECTORS, <BrowsePage kind="integration" />), {
      seed: seedBrowse([card()], filters),
    });
    expect(html).toContain('data-testid="connector-card-shopify"');
    expect(html).toContain('data-testid="connector-card-woocommerce"');
    expect(html).not.toContain('data-testid="connector-card-video-meetings"');
    expect(html).not.toContain('data-testid="connector-card-google-sheets"');
    // E-commerce: 1 listing + Shopify + WooCommerce
    expect(html).toMatch(/E-commerce<\/span><span[^>]*>3</);
    nav.search = '';
  });

  it('the Installed filter keeps only the connected connectors', () => {
    nav.search = 'installed=true';
    const filters = parseBrowseParams(new URLSearchParams(nav.search));
    const html = renderMarket(withTiles(CONNECTORS, <BrowsePage kind="integration" />), {
      seed: seedBrowse([], filters, [
        [
          ECOM_KEYS.overview('shopify'),
          { appEnabled: true, scopes: '', eventTopics: [], store: { connected: true } },
        ],
      ]),
    });
    expect(html).toContain('data-testid="connector-card-shopify"');
    expect(html).not.toContain('data-testid="connector-card-woocommerce"');
    expect(html).not.toContain('data-testid="connector-card-video-meetings"');
    nav.search = '';
  });

  it('Available add-ons shows no connector', () => {
    nav.search = 'addons=true';
    const filters = parseBrowseParams(new URLSearchParams(nav.search));
    const html = renderMarket(withTiles(CONNECTORS, <BrowsePage kind="integration" />), {
      seed: seedBrowse(
        [card({ id: ID(7), slug: 'crm-sync', name: 'CRM Sync', pricing: paidPricing() })],
        filters,
      ),
    });
    expect(html).not.toContain('connector-card-');
    expect(html).toContain('data-testid="app-card-crm-sync"');
    nav.search = '';
  });

  it('shows the empty state only when there is neither a listing nor a connector', () => {
    nav.search = '';
    const onlyConnectors = renderMarket(withTiles(CONNECTORS, <BrowsePage kind="integration" />), {
      seed: seedBrowse([]),
    });
    expect(onlyConnectors).toContain('data-testid="connector-card-shopify"');
    expect(onlyConnectors).not.toContain('Nothing is listed here yet');
    const nothing = renderMarket(withTiles([], <BrowsePage kind="integration" />), {
      seed: seedBrowse([]),
    });
    expect(nothing).toContain('Nothing is listed here yet');
  });

  it('a role or plan without a tile has no card for it (absent, not an empty card)', () => {
    nav.search = '';
    const html = renderMarket(withTiles([tile('shopify')], <BrowsePage kind="integration" />), {
      seed: seedBrowse(),
    });
    expect(html).toContain('connector-card-shopify');
    for (const id of ['woocommerce', 'google-sheets', 'email']) {
      expect(html).not.toContain(`connector-card-${id}`);
    }
  });

  it('a persona-hidden connector is not in the tile list, so it never shows', () => {
    // resolveSettings drops a persona-hidden tile before the context is filled; the page draws what the context holds.
    nav.search = '';
    const html = renderMarket(
      withTiles([tile('video-meetings', { icon: 'calendar' })], <BrowsePage kind="integration" />),
      {
        seed: seedBrowse(),
      },
    );
    expect(html).not.toContain('connector-card-shopify');
  });

  it('does not draw connectors on the Mini apps tab', () => {
    nav.search = '';
    const html = renderMarket(withTiles(CONNECTORS, <BrowsePage kind="mini_app" />), {
      seed: [
        [mktKeys.categories('mini_app'), { data: [] }],
        [mktKeys.shelves('mini_app'), { popular: [], new: [], featured: [] }],
        [[...mktKeys.apps('mini_app'), listQuery('mini_app', NO_FILTERS)], onePage([card()])],
      ],
    });
    expect(html).not.toContain('connector-card-');
    expect(html).toContain('data-testid="app-card-webhook"');
  });
});

describe('the two listing tabs look and sort the same', () => {
  it('offer the same sort options in the same order, defaulting to Most installed', () => {
    nav.search = '';
    const seeds = {
      integration: seedBrowse(),
      mini_app: [
        [mktKeys.categories('mini_app'), { data: [] }],
        [mktKeys.shelves('mini_app'), { popular: [], new: [], featured: [] }],
        [[...mktKeys.apps('mini_app'), listQuery('mini_app', NO_FILTERS)], onePage([card()])],
      ],
    } as const;
    const options = (kind: 'integration' | 'mini_app') => {
      const html = renderMarket(<BrowsePage kind={kind} />, { seed: seeds[kind] as never });
      return /<select[^>]*id="mkt-sort"[\s\S]*?<\/select>/
        .exec(html)?.[0]
        .replace(/ selected=""/g, '');
    };
    expect(options('integration')).toBeTruthy();
    expect(options('integration')).toBe(options('mini_app'));
    const html = renderMarket(<BrowsePage kind="mini_app" />, { seed: seeds.mini_app as never });
    expect(html).toMatch(/<option value="popular" selected="">Most installed<\/option>/);
    const values = [...html.matchAll(/<option value="(\w+)"/g)].map((m) => m[1]);
    expect(values).toEqual(['popular', 'featured', 'new', 'name']);
  });

  it('a paid app says Included in your plan / Subscribed / the price, the same words as the Add-ons list', () => {
    nav.search = '';
    const cards = [
      card({ id: ID(11), slug: 'inc', name: 'Inc', pricing: paidPricing({ access: 'included' }) }),
      card({ id: ID(12), slug: 'sub', name: 'Sub', pricing: paidPricing({ access: 'entitled' }) }),
      card({
        id: ID(13),
        slug: 'buy',
        name: 'Buy',
        pricing: paidPricing({ access: 'subscription_required' }),
      }),
    ];
    const html = renderMarket(<BrowsePage kind="integration" />, { seed: seedBrowse(cards) });
    expect(html).toMatch(/data-ownership="included"[^>]*>[\s\S]*?Included in your plan/);
    expect(html).toContain('data-ownership="owned"');
    expect(html).toContain('Subscribed');
    expect(html).toContain('data-ownership="buyable"');
  });
});

describe('the Developer tab', () => {
  for (const locale of LOCALES) {
    it(`has a card for each developer tool the person has, and none for the Add-ons screen, in ${locale}`, () => {
      const html = renderMarket(withTiles([...CONNECTORS, ...DEV], <DeveloperPage />), { locale });
      expect(html).toContain('data-testid="mkt-tools-developer"');
      expect(html).toContain('data-testid="tool-card-rest-api"');
      expect(html).toContain('data-testid="tool-card-webhooks"');
      expect(html).not.toContain('tool-card-addons');
      expect(html).not.toContain('tool-card-shopify');
      expect(html).not.toContain('connector-card-');
    });
  }

  it('shows a plan-locked tool with an Upgrade badge, and leaves out a tool the role lacks', () => {
    const html = renderMarket(
      withTiles([tile('rest-api', { locked: true, icon: 'code' })], <DeveloperPage />),
    );
    expect(html).toContain('data-testid="tool-card-rest-api"');
    expect(html).toContain('Upgrade');
    expect(html).not.toContain('tool-card-webhooks');
  });

  it('says so when nothing is available', () => {
    const html = renderMarket(withTiles([], <DeveloperPage />));
    expect(html).toContain('No developer tools available');
    expect(html).not.toContain('tool-card-');
  });
});

describe('the Add-ons tab', () => {
  const data = (over: Partial<WorkspaceAddonsResponse> = {}): WorkspaceAddonsResponse => ({
    eligible: true,
    unavailableReason: null,
    canBuy: true,
    owned: [],
    catalog: [
      {
        id: ID(1),
        slug: 'pack_1',
        name: 'Pack One',
        subtitle: null,
        amount: '9.00',
        offerAmount: null,
        currency: 'USD',
        isFree: false,
        isLifetime: false,
        billingUnit: 'months',
        billingDuration: 1,
        billingMode: 'recurring',
        grantBullets: [],
        ownedCount: 0,
        ownedEndsAt: null,
        ownedRenews: false,
        state: 'buy',
        includedVia: null,
      },
      {
        id: ID(2),
        slug: 'pack_2',
        name: 'Pack Two',
        subtitle: null,
        amount: '5.00',
        offerAmount: null,
        currency: 'USD',
        isFree: false,
        isLifetime: false,
        billingUnit: 'months',
        billingDuration: 1,
        billingMode: 'recurring',
        grantBullets: [],
        ownedCount: 0,
        ownedEndsAt: null,
        ownedRenews: false,
        state: 'included',
        includedVia: 'plan',
      },
    ],
    ...over,
  });

  for (const locale of LOCALES) {
    it(`mounts the shared add-ons list, with its wallet note and no tool cards, in ${locale}`, () => {
      const html = renderMarket(withTiles([...CONNECTORS, ...DEV], <AddonsPage />), {
        locale,
        seed: [[ADDON_KEYS.workspace, data()]],
      });
      expect(html).toContain('data-testid="addons-list"');
      expect(html).toContain('data-testid="addon-pack_1"');
      expect(html).toContain('data-state="buy"');
      expect(html).toContain('data-state="included"');
      expect(html).toContain('href="/billing/wallet"');
      expect(html).not.toContain('tool-card-');
      expect(html).not.toContain('connector-card-');
      expect(html).toContain('href="/marketplace/developer"');
    });
  }

  it('keeps wallet top-ups out of the tabs: only the one link to the wallet page, no wallet card', () => {
    const html = renderMarket(<AddonsPage />, { seed: [[ADDON_KEYS.workspace, data()]] });
    expect(count(html, /\/billing\/wallet/g)).toBe(1);
    const dev = renderMarket(withTiles(DEV, <DeveloperPage />));
    expect(dev).not.toContain('wallet');
    nav.search = '';
    const browse = renderMarket(<BrowsePage kind="integration" />, { seed: seedBrowse() });
    expect(browse.toLowerCase()).not.toContain('wallet');
  });

  it('tells a workspace on a free plan why nothing can be bought, with a link to the plans', () => {
    const html = renderMarket(<AddonsPage />, {
      seed: [
        [
          ADDON_KEYS.workspace,
          data({ eligible: false, unavailableReason: 'free_plan', canBuy: false }),
        ],
      ],
    });
    expect(html).toContain('data-testid="addons-unavailable"');
    expect(html).toContain('href="/account/plans"');
  });
});
