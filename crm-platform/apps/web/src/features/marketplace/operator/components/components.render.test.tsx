import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  PLATFORM_PERMISSION_KEYS,
  type MarketAppStatus,
  type MarketVersionStatus,
} from '@crm/contracts';
import { rbacKeys } from '@/features/roles-permissions/lib/api';
import { renderWithMessages } from '@/features/auth-registration-security/platform/render-test-utils';
import { ApiError } from '@/lib/api/errors';
import { marketKeys } from '../api';
import { prettyJson } from '../lib/json-docs';
import { ID, app, category, detail, manifest, request, usageRow, version } from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/admin/marketplace',
}));

import { KillDialog } from './app-actions';
import { CataloguePage, CatalogueTable } from './catalogue-page';
import { CategoriesPage, CategoryFormDialog, DeleteCategoryDialog } from './categories-page';
import { ListingDetailPage } from './listing-detail-page';
import { ListingNewPage } from './listing-new-page';
import { RequestsPage, TriageDialog } from './requests-page';
import { UsagePage } from './usage-page';
import { ApproveDialog, PublishDialog, RejectDialog } from './version-dialogs';
import { VersionEditor } from './version-editor';
import { ErrorLine, Failure, MarketGate } from './ui';

/**
 * These render each screen to static HTML with the real English and Arabic messages. They prove the text is complete (a missing or
 * broken message throws), that the two permission keys decide what is offered, and that every state the lifecycle table allows shows
 * exactly its actions. There is no browser here: nothing below says how the screens look or behave when clicked.
 */

const KEY = { manage: 'platform.market.manage', review: 'platform.market.review' } as const;
type Held = 'manage' | 'review';
const me = (held: Held[]) =>
  [
    rbacKeys.me,
    {
      permissions: Object.fromEntries(
        PLATFORM_PERMISSION_KEYS.map((k) => [k, held.some((h) => KEY[h] === k)]),
      ),
      roles: ['Admin'],
      isSuperAdmin: false,
    },
  ] as const;
const MANAGE = me(['manage']);
const REVIEW = me(['review']);
const BOTH = me(['manage', 'review']);
const NONE = me([]);
const LOCALES = ['en', 'ar'] as const;
const page = { nextCursor: null as string | null, hasMore: false, limit: 50 };
const pages = (data: unknown[], p = page) => ({
  pages: [{ data, page: p }],
  pageParams: [undefined],
});

/** The visible text of every button on the page. */
const buttons = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
    m[1]!
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
/** The attributes of the first button with this text. */
const buttonAttrs = (html: string, label: string) =>
  [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(
    (m) =>
      m[2]!
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim() === label,
  )?.[1];

describe('catalogue list', () => {
  const rows = [
    app({
      id: ID(1),
      slug: 'acme-leads',
      name: 'Acme Leads',
      status: 'published',
      firstParty: true,
      featured: true,
      installCount: 7,
      planFeature: 'analytics',
    }),
    app({
      id: ID(2),
      slug: 'justdial',
      name: 'JustDial',
      status: 'draft',
      publishedVersion: null,
      latestVersion: '0.1.0',
      installCount: 0,
      publishedAt: null,
      connectorType: 'push',
    }),
    app({
      id: ID(3),
      slug: 'leaky',
      name: 'Leaky',
      status: 'killed',
      killReason: 'Leaked contact data',
      kind: 'mini_app',
      connectorType: null,
      category: { slug: 'utilities', name: 'Utilities' },
    }),
  ];
  const seed = (held = BOTH) =>
    [
      held,
      [marketKeys.apps({}), pages(rows)],
      [marketKeys.categories, { data: [category()] }],
    ] as const;

  for (const locale of LOCALES) {
    it(`lists every listing with its status, badges, versions and installs in ${locale}`, () => {
      const html = renderWithMessages(<CataloguePage />, { locale, seed: [...seed()] });
      for (const name of ['Acme Leads', 'JustDial', 'Leaky']) expect(html).toContain(name);
      expect(html).toContain('data-testid="app-acme-leads"');
      expect(html).toContain('href="/admin/marketplace/acme-leads"');
      expect(html).toContain('Leaked contact data');
      expect(html).toContain('analytics');
      expect(html).toContain('href="/admin/marketplace/new"');
      expect(html).toContain('role="search"');
    });
  }

  it('says the KPI counts cover the loaded listings only', () => {
    const html = renderWithMessages(<CataloguePage />, { seed: [...seed()] });
    expect(html).toContain('Counts cover the 3 listings loaded so far');
    const more = renderWithMessages(<CataloguePage />, {
      seed: [
        BOTH,
        [marketKeys.apps({}), pages(rows, { nextCursor: 'c', hasMore: true, limit: 50 })],
      ],
    });
    expect(more).toContain('More are available: use Load more.');
    expect(buttons(more)).toContain('Load more');
    expect(buttons(html_noMore(rows))).not.toContain('Load more');
  });

  it('offers New listing to manage only', () => {
    expect(renderWithMessages(<CataloguePage />, { seed: [...seed(MANAGE)] })).toContain(
      '/admin/marketplace/new',
    );
    expect(renderWithMessages(<CataloguePage />, { seed: [...seed(REVIEW)] })).not.toContain(
      '/admin/marketplace/new',
    );
  });

  it('reads with either key and shows the no-access page naming both when neither is held', () => {
    expect(renderWithMessages(<CataloguePage />, { seed: [...seed(REVIEW)] })).toContain(
      'Acme Leads',
    );
    const html = renderWithMessages(<CataloguePage />, { seed: [...seed(NONE)] });
    expect(html).toContain(KEY.manage);
    expect(html).toContain(KEY.review);
    expect(html).not.toContain('Acme Leads');
  });

  it('shows the empty state with a New listing button', () => {
    const html = renderWithMessages(<CataloguePage />, {
      seed: [BOTH, [marketKeys.apps({}), pages([])]],
    });
    expect(html).toContain('No listings yet');
    expect(html).toContain('New listing');
  });

  it('shows a loading state while the list is on its way', () => {
    expect(renderWithMessages(<CataloguePage />, { seed: [BOTH] })).toContain('Loading...');
    expect(renderWithMessages(<CataloguePage />)).toContain('Loading...');
  });

  it('a listing whose slug is a console word is linked by uuid', () => {
    const html = renderWithMessages(<CatalogueTable apps={[app({ id: ID(9), slug: 'usage' })]} />);
    expect(html).toContain(`href="/admin/marketplace/${ID(9)}"`);
  });

  it('scrolls the table inside its own box', () => {
    const html = renderWithMessages(<CatalogueTable apps={rows} />);
    expect(html).toContain('overflow-x-auto');
  });
});

function html_noMore(rows: unknown[]) {
  return renderWithMessages(<CataloguePage />, {
    seed: [BOTH, [marketKeys.apps({}), pages(rows)]],
  });
}

describe('listing detail: exactly the actions the lifecycle allows', () => {
  const ALL = [
    'Hide',
    'Show again',
    'Restore',
    'Delete',
    'Kill switch',
    'Edit',
    'New version',
    'New version from this one',
    'Submit for review',
    'Approve',
    'Reject',
    'Publish',
  ];
  interface Case {
    name: string;
    app: MarketAppStatus;
    version: MarketVersionStatus;
    published?: boolean;
    manage: string[];
    review: string[];
  }
  const NEW = ['New version', 'New version from this one'];
  const cases: Case[] = [
    {
      name: 'a draft listing with a draft version',
      app: 'draft',
      version: 'draft',
      manage: [...NEW, 'Edit', 'Submit for review', 'Delete', 'Kill switch'],
      review: ['Approve', 'Reject'],
    },
    {
      name: 'a listing in review with a version in review',
      app: 'in_review',
      version: 'in_review',
      manage: [...NEW, 'Delete', 'Kill switch'],
      review: ['Approve', 'Reject'],
    },
    {
      name: 'a listing with an approved version',
      app: 'in_review',
      version: 'approved',
      manage: [...NEW, 'Delete', 'Kill switch'],
      review: ['Publish'],
    },
    {
      name: 'a published listing with its published version',
      app: 'published',
      version: 'published',
      published: true,
      manage: [...NEW, 'Hide', 'Kill switch'],
      review: [],
    },
    {
      name: 'a published listing with a rejected newer version',
      app: 'published',
      version: 'rejected',
      published: true,
      manage: [...NEW, 'Edit', 'Submit for review', 'Hide', 'Kill switch'],
      review: [],
    },
    {
      name: 'a hidden listing with an approved version',
      app: 'hidden',
      version: 'approved',
      published: true,
      manage: [...NEW, 'Show again', 'Kill switch'],
      review: ['Publish'],
    },
    {
      name: 'a killed listing with an approved version',
      app: 'killed',
      version: 'approved',
      published: true,
      manage: [...NEW, 'Restore'],
      review: [],
    },
  ];

  const render = (c: Case, held: typeof BOTH, locale: 'en' | 'ar' = 'en') => {
    const d = detail({
      status: c.app,
      versionStatus: c.version,
      publishedVersion: c.published ? '1.0.0' : null,
      publishedAt: c.published ? '2026-10-01T00:00:00.000Z' : null,
      installCount: c.published ? 3 : 0,
      killReason: c.app === 'killed' ? 'Leaked contact data' : null,
      killedAt: c.app === 'killed' ? '2026-10-02T09:00:00.000Z' : null,
    });
    return renderWithMessages(<ListingDetailPage appRef="acme-leads" initialTab="versions" />, {
      locale,
      seed: [held, [marketKeys.app('acme-leads'), d]],
    });
  };
  const offered = (html: string) => ALL.filter((l) => buttons(html).includes(l));

  for (const c of cases) {
    it(`${c.name}: manage-only, review-only and both see exactly their actions`, () => {
      expect(offered(render(c, MANAGE)).sort()).toEqual([...c.manage].sort());
      expect(offered(render(c, REVIEW)).sort()).toEqual([...c.review].sort());
      expect(offered(render(c, BOTH)).sort()).toEqual(
        [...new Set([...c.manage, ...c.review])].sort(),
      );
    });
  }

  it('names the missing key when an action is hidden for lack of it', () => {
    const c = cases[1]!;
    const reviewOnly = render(c, REVIEW);
    expect(reviewOnly).toContain('data-testid="lacks-manage"');
    expect(reviewOnly).toContain('your roles do not include platform.market.manage');
    expect(reviewOnly).not.toContain('data-testid="lacks-review"');
    const manageOnly = render(c, MANAGE);
    expect(manageOnly).toContain('data-testid="lacks-review"');
    expect(manageOnly).toContain('platform.market.review');
    const both = render(c, BOTH);
    expect(both).not.toContain('data-testid="lacks-');
  });

  it('shows the no-access page naming both keys to someone with neither', () => {
    const html = renderWithMessages(<ListingDetailPage appRef="acme-leads" />, {
      seed: [NONE, [marketKeys.app('acme-leads'), detail()]],
    });
    expect(html).toContain(KEY.manage);
    expect(html).toContain(KEY.review);
    expect(html).not.toContain('Acme Leads');
  });

  for (const locale of LOCALES) {
    it(`renders the header, the versions table, the permissions and the stored documents in ${locale}`, () => {
      const html = renderWithMessages(
        <ListingDetailPage appRef="acme-leads" initialTab="versions" />,
        {
          locale,
          seed: [BOTH, [marketKeys.app('acme-leads'), detail({ versionStatus: 'draft' })]],
        },
      );
      expect(html).toContain('Acme Leads');
      expect(html).toContain('data-testid="version-1.0.0"');
      expect(html).toContain('Add leads');
      expect(html).toContain('leads.write');
      expect(html).toContain('&quot;connector&quot;');
      expect(html).toContain('dir="ltr"');
    });
  }

  it('the versions table lists every version with its review note', () => {
    const d = detail({
      versionStatus: 'rejected',
      versions: [
        version({
          id: ID(12),
          version: '1.1.0',
          status: 'rejected',
          reviewNote: 'The mapping drops the phone',
          changelog: 'Maps campaign',
        }),
        version({ id: ID(11), version: '1.0.0', status: 'published' }),
      ],
      versionId: ID(12),
    });
    const html = renderWithMessages(
      <ListingDetailPage appRef="acme-leads" initialTab="versions" />,
      {
        seed: [MANAGE, [marketKeys.app('acme-leads'), d]],
      },
    );
    expect(html).toContain('data-testid="version-1.1.0"');
    expect(html).toContain('data-testid="version-1.0.0"');
    // the table cell and the reviewer's reason panel of the selected version
    expect(html.match(/The mapping drops the phone/g)).toHaveLength(2);
    expect(html).toContain('Maps campaign');
  });

  it('a killed listing says why and what it means', () => {
    const html = render(cases[6]!, MANAGE);
    expect(html).toContain('This listing is killed');
    expect(html).toContain('Leaked contact data');
    expect(html).toContain('Workspaces can only uninstall');
  });

  it('an integration version without a recipe says so', () => {
    const html = renderWithMessages(
      <ListingDetailPage appRef="acme-leads" initialTab="versions" />,
      {
        seed: [
          MANAGE,
          [marketKeys.app('acme-leads'), detail({ versionStatus: 'draft', recipe: null })],
        ],
      },
    );
    expect(html).toContain('This integration has no recipe yet');
  });

  it('the listing tab edits in place for manage and is read-only, naming the key, for review', () => {
    const edit = renderWithMessages(<ListingDetailPage appRef="acme-leads" />, {
      seed: [MANAGE, [marketKeys.app('acme-leads'), detail()]],
    });
    expect(edit).toContain('Save changes');
    expect(edit).toContain('Receive Acme portal enquiries as leads.');
    const readOnly = renderWithMessages(<ListingDetailPage appRef="acme-leads" />, {
      seed: [REVIEW, [marketKeys.app('acme-leads'), detail()]],
    });
    expect(readOnly).toContain(
      'Read only. Editing the listing needs the platform permission platform.market.manage',
    );
    expect(readOnly).not.toContain('Save changes');
  });

  it('shows the loading state before the listing arrives', () => {
    expect(
      renderWithMessages(<ListingDetailPage appRef="acme-leads" />, { seed: [BOTH] }),
    ).toContain('Loading...');
  });
});

describe('the kill switch confirmation', () => {
  const target = { slug: 'acme-leads', name: 'Acme Leads', installCount: 3 };

  for (const locale of LOCALES) {
    it(`names the app and the installations and says what happens, in ${locale}`, () => {
      const html = renderWithMessages(
        <KillDialog app={target} onConfirm={() => undefined} onClose={() => undefined} />,
        { locale },
      );
      expect(html).toContain('Acme Leads');
      expect(html).toContain('acme-leads');
      expect(html).toContain(locale === 'en' ? 'installed in 3 workspaces' : '3 مساحات عمل');
      expect(html).toContain(locale === 'en' ? 'answers 410 Gone' : '410');
      expect(html).toContain('<textarea');
    });
  }

  it('says every installation stops, every connection is disabled, the address answers 410 and workspaces can only uninstall', () => {
    const html = renderWithMessages(
      <KillDialog app={target} onConfirm={() => undefined} onClose={() => undefined} />,
    );
    expect(html).toContain('Every installation stops working at once.');
    expect(html).toContain('Every connection is disabled.');
    expect(html).toContain('The delivery address answers 410 Gone');
    expect(html).toContain('Workspaces can only uninstall it.');
    expect(html).toContain('Type acme-leads to confirm');
  });

  it('keeps the red button off until the reason and the slug are typed', () => {
    const html = renderWithMessages(
      <KillDialog app={target} onConfirm={() => undefined} onClose={() => undefined} />,
    );
    expect(buttonAttrs(html, 'Kill Acme Leads')).toContain('disabled=""');
    expect(html).toContain('0 of 300 characters (at least 5).');
  });

  it('says one workspace in the singular', () => {
    const html = renderWithMessages(
      <KillDialog
        app={{ ...target, installCount: 1 }}
        onConfirm={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('installed in 1 workspace.');
  });
});

describe('review dialogs', () => {
  const v = { id: ID(11), version: '1.1.0', scopes: ['leads.write', 'messages.send'] };
  const target = { name: 'Acme Leads' };

  it('reject needs a reason: live count and a disabled button', () => {
    const html = renderWithMessages(
      <RejectDialog
        app={target}
        version={v}
        onConfirm={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('Reject Acme Leads 1.1.0?');
    expect(html).toContain('0 of 500 characters (at least 5).');
    expect(html).toContain('shown to the developer');
    expect(buttonAttrs(html, 'Reject version')).toContain('disabled=""');
    expect(html).toContain('required=""');
  });

  it('approve takes an optional note and is not disabled', () => {
    const html = renderWithMessages(
      <ApproveDialog
        app={target}
        version={v}
        onConfirm={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('Approve Acme Leads 1.1.0?');
    expect(html).toContain('Note (optional)');
    expect(buttonAttrs(html, 'Approve')).not.toContain('disabled=""');
  });

  it('publish explains what happens to installations and names the permissions the version adds', () => {
    const html = renderWithMessages(
      <PublishDialog
        app={{ name: 'Acme Leads', installCount: 3, status: 'published' }}
        version={v}
        published={{ version: '1.0.0', scopes: ['leads.write'] }}
        onConfirm={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('Publish Acme Leads 1.1.0?');
    expect(html).toContain('move to it at once');
    expect(html).toContain('keep running on their current version until their admin accepts');
    expect(html).toContain('3 installations are affected.');
    expect(html).toContain('It asks for 1 permission the published version does not:');
    expect(html).toContain('Send messages');
    expect(html).not.toContain('Add leads');
  });

  it('publish of a first version says so and adds no permission warning', () => {
    const html = renderWithMessages(
      <PublishDialog
        app={{ name: 'Acme Leads', installCount: 0, status: 'in_review' }}
        version={v}
        published={null}
        onConfirm={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('This is the first published version.');
    expect(html).not.toContain('does not:');
  });

  for (const locale of LOCALES) {
    it(`renders the three dialogs in ${locale}`, () => {
      const noop = () => undefined;
      for (const el of [
        <RejectDialog key="r" app={target} version={v} onConfirm={noop} onClose={noop} />,
        <ApproveDialog key="a" app={target} version={v} onConfirm={noop} onClose={noop} />,
        <PublishDialog
          key="p"
          app={{ name: 'A', installCount: 2, status: 'published' }}
          version={v}
          published={null}
          onConfirm={noop}
          onClose={noop}
        />,
      ]) {
        expect(renderWithMessages(el, { locale }).length).toBeGreaterThan(100);
      }
    });
  }
});

describe('new listing', () => {
  for (const locale of LOCALES) {
    it(`shows the template starters, both JSON editors and the listing fields in ${locale}`, () => {
      const html = renderWithMessages(<ListingNewPage />, { locale, seed: [MANAGE] });
      expect(html).toContain('id="new-manifest"');
      expect(html).toContain('id="new-recipe"');
      expect(buttons(html).filter((b) => b === 'Format' || b === 'تنسيق')).toHaveLength(2);
      expect(html).toMatch(/spellcheck="false"/i);
      expect(html).toContain('type="url"');
      expect(html).not.toContain('type="password"');
    });
  }

  it('keeps the JSON editors left-to-right in Arabic', () => {
    const html = renderWithMessages(<ListingNewPage />, { locale: 'ar', seed: [MANAGE] });
    const editors = [...html.matchAll(/<textarea\b[^>]*id="new-(?:manifest|recipe)"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(editors).toHaveLength(2);
    for (const tag of editors) {
      expect(tag).toContain('dir="ltr"');
      expect(tag).toMatch(/spellcheck="false"/i);
      expect(tag).toContain('wrap="off"');
    }
  });

  it('offers the three starters', () => {
    const labels = buttons(renderWithMessages(<ListingNewPage />, { seed: [MANAGE] }));
    for (const l of ['Mini app', 'Integration: webhook relay', 'Integration: push'])
      expect(labels).toContain(l);
    expect(labels).toContain('Insert starter recipe');
  });

  it('is for manage only and names the key to someone who can only review', () => {
    const html = renderWithMessages(<ListingNewPage />, { seed: [REVIEW] });
    expect(html).toContain(KEY.manage);
    expect(html).not.toContain('id="new-manifest"');
  });
});

describe('version editor', () => {
  const versions = [{ id: ID(11), version: '1.0.0' }];
  const initial = (m: unknown) => ({ manifestText: prettyJson(m), recipeText: '', changelog: '' });

  it('lists the manifest problems as path: message, tied to the editor', () => {
    const bad = { ...manifest(), version: '1.0.1', scopes: ['nope'] };
    const html = renderWithMessages(
      <VersionEditor
        app={{ slug: 'acme-leads', kind: 'integration' }}
        versions={versions}
        mode={{ kind: 'new' }}
        initial={initial(bad)}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('manifest.scopes.0');
    expect(html).toContain('Unknown scope &quot;nope&quot;.');
    expect(html).toMatch(/aria-invalid="true"/i);
    expect(html).toContain('aria-describedby="ver-manifest-hint ver-manifest-problems"');
    expect(html).toContain('1 problem to fix');
  });

  for (const locale of LOCALES) {
    it(`asks for a version above the highest one in ${locale}`, () => {
      const html = renderWithMessages(
        <VersionEditor
          app={{ slug: 'acme-leads', kind: 'integration' }}
          versions={versions}
          mode={{ kind: 'new' }}
          initial={initial(manifest())}
          onSaved={() => undefined}
          onCancel={() => undefined}
        />,
        { locale },
      );
      expect(html).toContain(locale === 'en' ? 'must be higher than 1.0.0' : 'أعلى من 1.0.0');
    });
  }

  it('lists the cross-document mismatches of the recipe', () => {
    const html = renderWithMessages(
      <VersionEditor
        app={{ slug: 'acme-leads', kind: 'integration' }}
        versions={versions}
        mode={{ kind: 'new' }}
        initial={{
          manifestText: prettyJson({ ...manifest(), version: '1.0.1' }),
          recipeText: prettyJson({ key: 'other' }),
          changelog: '',
        }}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('recipe.key');
    expect(html).toContain('Must equal the manifest id: acme-leads.');
  });

  it('a clean new version shows the valid confirmation and the permissions it asks for', () => {
    const html = renderWithMessages(
      <VersionEditor
        app={{ slug: 'acme-leads', kind: 'integration' }}
        versions={versions}
        mode={{ kind: 'new' }}
        initial={{
          manifestText: prettyJson({ ...manifest(), version: '1.0.1' }),
          recipeText: '',
          changelog: 'Adds a field',
        }}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('Valid manifest v1.');
    expect(html).toContain('Add leads');
    // No recipe yet for an integration: a warning, not a block.
    expect(html).toContain('An integration needs a recipe before it can be submitted for review.');
  });
});

describe('categories', () => {
  const list = {
    data: [
      category({
        id: ID(21),
        kind: 'integration',
        slug: 'lead-sources',
        name: 'Lead sources',
        appCount: 2,
      }),
      category({
        id: ID(22),
        kind: 'integration',
        slug: 'payments',
        name: 'Payments',
        appCount: 0,
        isActive: false,
        description: null,
        icon: null,
      }),
      category({ id: ID(23), kind: 'mini_app', slug: 'utilities', name: 'Utilities', appCount: 0 }),
    ],
  };
  const seed = (held = BOTH) => [held, [marketKeys.categories, list]] as const;

  for (const locale of LOCALES) {
    it(`groups the categories by kind with counts and state in ${locale}`, () => {
      const html = renderWithMessages(<CategoriesPage />, { locale, seed: [...seed()] });
      expect(html).toContain('data-testid="category-integration-lead-sources"');
      expect(html).toContain('data-testid="category-integration-payments"');
      expect(html).toContain('data-testid="category-mini_app-utilities"');
      expect(html).toContain('id="kind-mini_app"');
      expect(html).toContain('id="kind-integration"');
    });
  }

  it('offers create, edit and delete to manage; delete only for an empty category', () => {
    const labels = buttons(renderWithMessages(<CategoriesPage />, { seed: [...seed(MANAGE)] }));
    expect(labels).toContain('New category');
    expect(labels.filter((l) => l.startsWith('Edit'))).toHaveLength(3);
    // two empty categories can be deleted; the one with apps says it is in use
    expect(labels.filter((l) => l.startsWith('Delete'))).toHaveLength(2);
    expect(renderWithMessages(<CategoriesPage />, { seed: [...seed(MANAGE)] })).toContain(
      'Has apps',
    );
    expect(renderWithMessages(<CategoriesPage />, { seed: [...seed(MANAGE)] })).toContain(
      'Hidden from workspaces',
    );
  });

  it('review-only reads the list and gets no buttons', () => {
    const html = renderWithMessages(<CategoriesPage />, { seed: [...seed(REVIEW)] });
    expect(html).toContain('Lead sources');
    expect(buttons(html).filter((l) => /^(New category|Edit|Delete)/.test(l))).toEqual([]);
  });

  it('shows the no-access page without a key and the empty state without categories', () => {
    expect(renderWithMessages(<CategoriesPage />, { seed: [...seed(NONE)] })).toContain(KEY.manage);
    const empty = renderWithMessages(<CategoriesPage />, {
      seed: [BOTH, [marketKeys.categories, { data: [] }]],
    });
    expect(empty).toContain('No categories');
  });

  it('the edit form locks the id and the kind and explains switching a category off', () => {
    const html = renderWithMessages(
      <CategoryFormDialog mode="edit" category={list.data[0]!} onClose={() => undefined} />,
    );
    expect(html).toContain('The id cannot be changed after creation.');
    expect(html).toMatch(/readonly=""/i);
    expect(html).toContain('hidden from workspaces');
    expect(html).toContain('role="switch"');
  });

  it('the create form asks for kind, id, name, description, icon and order', () => {
    const html = renderWithMessages(<CategoryFormDialog mode="create" onClose={() => undefined} />);
    for (const t of ['Kind', 'Id (slug)', 'Name', 'Description', 'Icon', 'Sort order'])
      expect(html).toContain(t);
    expect(html).not.toContain('role="switch"');
  });

  it('the delete confirmation names the category', () => {
    const html = renderWithMessages(
      <DeleteCategoryDialog category={list.data[1]!} onClose={() => undefined} />,
    );
    expect(html).toContain('Delete Payments?');
  });
});

describe('requests report', () => {
  const rows = [
    request({ id: ID(31), name: 'Just Dial', voteCount: 12 }),
    request({
      id: ID(32),
      name: 'Evil Portal',
      voteCount: 3,
      website: 'javascript:alert(1)',
      notes: ['<img src=x onerror=alert(1)>'],
      status: 'planned',
      operatorNote: 'Waiting on their API',
      firstWorkspace: null,
    }),
  ];
  const seed = (held = BOTH) => [held, [marketKeys.requests({}), pages(rows)]] as const;

  for (const locale of LOCALES) {
    it(`lists the requests with votes, notes, the first workspace and status in ${locale}`, () => {
      const html = renderWithMessages(<RequestsPage />, { locale, seed: [...seed()] });
      expect(html).toContain('Just Dial');
      expect(html).toContain('We get 40 enquiries a day there');
      expect(html).toContain('Acme Retail');
      expect(html).toContain('>12<');
    });
  }

  it('links an https website with noopener noreferrer and shows anything else as plain text', () => {
    const html = renderWithMessages(<RequestsPage />, { seed: [...seed()] });
    expect(html).toContain('href="https://www.justdial.com/"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('javascript:alert(1)');
  });

  it('shows workspace notes as text, never as markup', () => {
    const html = renderWithMessages(<RequestsPage />, { seed: [...seed()] });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('triage is for manage; review-only reads, with a note naming the key', () => {
    const manage = renderWithMessages(<RequestsPage />, { seed: [...seed(MANAGE)] });
    expect(buttons(manage).filter((l) => l.startsWith('Triage'))).toHaveLength(2);
    const review = renderWithMessages(<RequestsPage />, { seed: [...seed(REVIEW)] });
    expect(buttons(review).filter((l) => l.startsWith('Triage'))).toEqual([]);
    expect(review).toContain('Triage needs the platform permission platform.market.manage');
    expect(review).toContain('Waiting on their API');
  });

  it('the triage dialog has the five statuses and the operator note', () => {
    const html = renderWithMessages(<TriageDialog request={rows[0]!} onClose={() => undefined} />);
    for (const s of ['Open', 'Planned', 'Building', 'Shipped', 'Declined'])
      expect(html).toContain(`>${s}<`);
    expect(html).toContain('Operator note');
    // Nothing changed yet: Save is off.
    expect(buttonAttrs(html, 'Save')).toContain('disabled=""');
  });

  it('shows the empty state, the no-access page and the loading state', () => {
    expect(
      renderWithMessages(<RequestsPage />, { seed: [BOTH, [marketKeys.requests({}), pages([])]] }),
    ).toContain('No requests yet');
    expect(renderWithMessages(<RequestsPage />, { seed: [...seed(NONE)] })).toContain(KEY.review);
    expect(renderWithMessages(<RequestsPage />, { seed: [BOTH] })).toContain('Loading...');
  });
});

describe('usage', () => {
  const rows = [
    usageRow({ appId: ID(1), slug: 'acme-leads', name: 'Acme Leads' }),
    usageRow({
      appId: ID(2),
      slug: 'justdial',
      name: 'JustDial',
      health: { healthy: 1, degraded: 0, error: 2, needsReauth: 1, unknown: 0 },
      events: {
        last24h: { accepted: 1, duplicate: 0, rejected: 0, failed: 4 },
        last7d: { accepted: 9, duplicate: 0, rejected: 0, failed: 11 },
      },
    }),
  ];
  const seed = (held = BOTH) => [held, [marketKeys.usage, { data: rows }]] as const;

  for (const locale of LOCALES) {
    it(`shows installs, health and deliveries per app in ${locale}`, () => {
      const html = renderWithMessages(<UsagePage />, { locale, seed: [...seed()] });
      expect(html).toContain('data-testid="usage-acme-leads"');
      expect(html).toContain('data-testid="usage-justdial"');
      expect(html).toContain('href="/admin/marketplace/justdial"');
    });
  }

  it('flags the app with failing installs or deliveries and gives the recipe hint, and leaves the quiet one alone', () => {
    const html = renderWithMessages(<UsagePage />, { seed: [...seed()] });
    expect(html.match(/Needs a look/g)).toHaveLength(1);
    expect(html).toContain('2 in error');
    expect(html).toContain('1 need to sign in again');
    expect(html).toContain('Failed deliveries in the last 24 hours');
    expect(html).toContain('The recipe may be breaking');
    expect(html).toContain('No problems seen');
  });

  it('sorts by the most failed deliveries first and offers the three sorts', () => {
    const html = renderWithMessages(<UsagePage />, { seed: [...seed()] });
    expect(html.indexOf('data-testid="usage-justdial"')).toBeLessThan(
      html.indexOf('data-testid="usage-acme-leads"'),
    );
    for (const s of ['Most failed deliveries', 'Most installations', 'Name'])
      expect(html).toContain(`>${s}<`);
  });

  it('reads with either key, shows the empty state and the no-access page', () => {
    expect(renderWithMessages(<UsagePage />, { seed: [...seed(REVIEW)] })).toContain('Acme Leads');
    expect(
      renderWithMessages(<UsagePage />, { seed: [BOTH, [marketKeys.usage, { data: [] }]] }),
    ).toContain('No usage yet');
    expect(renderWithMessages(<UsagePage />, { seed: [...seed(NONE)] })).toContain(KEY.manage);
  });
});

describe('failures', () => {
  const err = (
    status: number,
    code: string,
    fieldErrors: Array<{ path: string; message: string }> = [],
  ) => new ApiError(status, code, 'English text that is never read', 'req-42', fieldErrors);

  for (const locale of LOCALES) {
    it(`a failed save shows the sentence, the request id and every path the API named in ${locale}`, () => {
      const html = renderWithMessages(
        <ErrorLine
          error={err(422, ERROR_CODES.MKT_MANIFEST_INVALID, [
            { path: 'manifest.scopes.0', message: 'Unknown scope "x".' },
            { path: 'recipe.key', message: 'must equal the manifest id "acme"' },
          ])}
        />,
        { locale },
      );
      expect(html).toContain('manifest.scopes.0');
      expect(html).toContain('recipe.key');
      expect(html).toContain('req-42');
      expect(html).toContain('role="alert"');
    });
  }

  it('a connector that is not implemented gets a clear sentence', () => {
    const html = renderWithMessages(
      <ErrorLine
        error={err(409, ERROR_CODES.MKT_CONNECTOR_NOT_AVAILABLE, [
          { path: 'manifest.connector.type', message: 'pull' },
        ])}
      />,
    );
    expect(html).toContain('The pull connector type is not implemented yet');
    expect(html).toContain('Nothing that does not work reaches a workspace.');
  });

  it('a stale edit offers a reload, a taken id and a used category say what to do', () => {
    expect(
      renderWithMessages(<ErrorLine error={err(409, ERROR_CODES.ROW_VERSION_CONFLICT)} />),
    ).toContain('Reload to see their version');
    expect(
      renderWithMessages(<ErrorLine error={err(409, ERROR_CODES.MKT_SLUG_TAKEN)} />),
    ).toContain('already uses that id');
    expect(
      renderWithMessages(<ErrorLine error={err(409, ERROR_CODES.MKT_CATEGORY_IN_USE)} />),
    ).toContain('Move them to another category first');
    expect(
      renderWithMessages(
        <ErrorLine
          error={err(409, ERROR_CODES.MKT_VERSION_EXISTS, [
            { path: 'manifest.version', message: 'higher_than:1.2.0' },
          ])}
        />,
      ),
    ).toContain('higher than 1.2.0');
  });

  it('a read failure shows the request id and a retry button; a permission refusal shows the no-access page', () => {
    const failed = renderWithMessages(
      <Failure error={err(500, 'INTERNAL')} onRetry={() => undefined} />,
    );
    expect(failed).toContain('req-42');
    expect(buttons(failed)).toContain('Try again');
    const denied = renderWithMessages(
      <Failure
        error={err(403, ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED, [
          { path: 'permission', message: KEY.review },
        ])}
      />,
    );
    expect(denied).toContain(KEY.review);
    expect(denied).not.toContain('Try again');
  });

  it('the gate asks for the manage key when a screen needs it', () => {
    const html = renderWithMessages(<MarketGate need="manage">{() => <p>inside</p>}</MarketGate>, {
      seed: [REVIEW],
    });
    expect(html).toContain(KEY.manage);
    expect(html).not.toContain('inside');
    expect(
      renderWithMessages(<MarketGate need="manage">{() => <p>inside</p>}</MarketGate>, {
        seed: [MANAGE],
      }),
    ).toContain('inside');
  });
});

describe('nothing secret is ever on these pages', () => {
  it('has no password field or token anywhere', () => {
    const pagesHtml = [
      renderWithMessages(<ListingNewPage />, { seed: [MANAGE] }),
      renderWithMessages(<ListingDetailPage appRef="acme-leads" initialTab="versions" />, {
        seed: [BOTH, [marketKeys.app('acme-leads'), detail()]],
      }),
      renderWithMessages(<CategoriesPage />, {
        seed: [BOTH, [marketKeys.categories, { data: [category()] }]],
      }),
    ];
    for (const html of pagesHtml) {
      expect(html).not.toContain('type="password"');
      expect(html).not.toMatch(/Bearer |secret_|sk_live/);
    }
  });
});
