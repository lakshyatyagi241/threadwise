import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, PLATFORM_PERMISSION_KEYS } from '@crm/contracts';
import { rbacKeys } from '@/features/roles-permissions/lib/api';
import { renderWithMessages } from '@/features/auth-registration-security/platform/render-test-utils';
import { PLANS_QUERY_KEY } from '@/features/auth-registration-security/platform/plans/plans-query';
import { ApiError } from '@/lib/api/errors';
import { marketKeys } from '../api';
import { draftFromPricing, PRICING_FIELDS } from '../lib/pricing';
import { marketAccess } from '../lib/permissions';
import { ID, app, category, detail, pricing, subscription, summaryRow } from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/admin/marketplace',
}));

import { CataloguePage } from './catalogue-page';
import { GrandfatherDialog } from './grandfather-dialog';
import { ListingDetailPage } from './listing-detail-page';
import { PricingFields } from './pricing-fields';
import { PricingPanel } from './pricing-panel';
import { CancelSubscriptionDialog, CompDialog } from './subscription-dialogs';
import { SubscriptionsPage } from './subscriptions-page';
import { ErrorLine } from './ui';

/**
 * Static renders of the paid-and-free screens with the real English and Arabic messages: the pricing panel (free, paid, read-only, the
 * granted-feature controls, field errors), the catalogue's Pricing column and filter, the subscriptions page and its two dialogs. There is
 * no browser: nothing here says how the screens behave when clicked, only what each state shows and offers.
 */

type Held = 'manage' | 'review' | 'pricing';
const KEY = {
  manage: 'platform.market.manage',
  review: 'platform.market.review',
  pricing: 'platform.market.pricing',
} as const;
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
const PRICING_ONLY = me(['pricing']);
const MANAGE = me(['manage']);
const BOTH = me(['manage', 'review']);
const ALL = me(['manage', 'review', 'pricing']);
const NONE = me([]);
const LOCALES = ['en', 'ar'] as const;

const page = { nextCursor: null as string | null, hasMore: false, limit: 50 };
const pages = (data: unknown[], p = page) => ({
  pages: [{ data, page: p }],
  pageParams: [undefined],
});
const plans = {
  data: [
    { slug: 'free', name: 'Free' },
    { slug: 'scale', name: 'Scale' },
  ],
};
const SUMMARY = {
  data: [
    summaryRow(),
    summaryRow({
      appId: ID(2),
      slug: 'old-free',
      name: 'Old Free',
      pricing: { model: 'free', amount: null, currency: null },
      counts: { active: 0, trialing: 0, comped: 0, canceling: 0, pastDue: 0, ended: 2, total: 2 },
      mrr: [],
    }),
  ],
  totals: [{ currency: 'USD', amount: '45.00' }],
};

const buttons = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
    m[1]!
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
const buttonAttrs = (html: string, label: string) =>
  [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(
    (m) =>
      m[2]!
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim() === label,
  )?.[1];

/** The first <input> whose value is `value` (attribute order differs between a checked and an unchecked one). */
const inputTag = (html: string, value: string): string =>
  [...html.matchAll(/<input\b[^>]*>/g)]
    .map((m) => m[0])
    .find((t) => t.includes(`value="${value}"`)) ?? '';

const access = (...held: Held[]) =>
  marketAccess(Object.fromEntries(held.map((h) => [KEY[h], true])));

describe('the pricing panel', () => {
  const paidApp = (over: Parameters<typeof detail>[0] = {}) =>
    detail({
      pricing: pricing({ includedMinPlan: 'scale', annualAmount: '90.00' }),
      activeSubscriptions: 3,
      ...over,
    });
  const render = (
    d: ReturnType<typeof detail>,
    held: ReturnType<typeof access>,
    locale: 'en' | 'ar' = 'en',
  ) =>
    renderWithMessages(<PricingPanel app={d} access={held} />, {
      locale,
      seed: [[PLANS_QUERY_KEY, plans]],
    });

  for (const locale of LOCALES) {
    it(`a paid app shows its price, currency, trial, yearly price, sale switch and plan rule in ${locale}`, () => {
      const html = render(paidApp(), access('pricing'), locale);
      expect(html).toContain('id="pricing"');
      expect(inputTag(html, 'paid_monthly')).toContain('checked=""');
      expect(inputTag(html, 'free')).not.toContain('checked=""');
      expect(html).toContain('value="9.00"');
      expect(html).toContain('value="USD"');
      expect(html).toContain('value="14"');
      expect(html).toContain('value="90.00"');
      expect(html).toMatch(
        /role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/,
      );
      expect(html).toMatch(/<option value="scale" selected/);
      expect(html).toContain('data-testid="pricing-proposal"');
      expect(html).toContain('<datalist');
      expect(html).not.toContain('data-testid="pricing-read-only"');
    });
  }

  it('says how many subscriptions are in force and links to them, and shows the listing status beside the price', () => {
    const html = render(paidApp(), access('pricing'));
    expect(html).toContain('3 active subscriptions');
    expect(html).toContain('href="/admin/marketplace/subscriptions?app=acme-leads"');
    expect(html).toContain('Published');
    expect(html).toContain('Hide, show again or kill the listing under Operate above');
  });

  it('explains the billing model: monthly prepaid by default, the card renewal as a choice, a price change reaches the next payment only', () => {
    const html = render(paidApp(), access('pricing'));
    expect(html).toContain('monthly prepaid term');
    expect(html).toContain('The card renews it');
    expect(html).toContain('a period already paid for is never touched');
    expect(html).toContain('Leave it empty to sell the app monthly only');
  });

  it('shows the developer proposal read-only, with its model and note', () => {
    const d = paidApp();
    const withProposal = {
      ...d,
      manifest: { ...d.manifest, pricing: { model: 'addon' as const, note: 'About 9 a month' } },
    };
    const html = render(withProposal, access('pricing'));
    expect(html).toContain('Paid add-on');
    expect(html).toContain('About 9 a month');
    expect(html).toContain('From the manifest of version 1.0.0');
  });

  it('a free app shows the choice but no price fields, and still offers Save', () => {
    const html = render(detail(), access('pricing'));
    expect(inputTag(html, 'free')).toContain('checked=""');
    expect(inputTag(html, 'paid_monthly')).not.toContain('checked=""');
    expect(html).not.toContain('Monthly price');
    expect(html).not.toContain('Free trial (days)');
    expect(buttons(html)).toContain('Save pricing');
    expect(html).toContain('0 active subscriptions');
  });

  it('an app that is not on sale shows the switch off', () => {
    const html = render(paidApp({ pricing: pricing({ purchasable: false }) }), access('pricing'));
    expect(html).toMatch(/aria-checked="false"/);
  });

  it('Save starts off (nothing changed), and Discard with it', () => {
    const html = render(paidApp(), access('pricing'));
    expect(buttonAttrs(html, 'Save pricing')).toContain('disabled');
    expect(buttonAttrs(html, 'Discard changes')).toContain('disabled');
    expect(html).toContain('No changes yet.');
  });

  it('without platform.market.pricing it is read-only, names the key, and has no Save', () => {
    const html = render(paidApp(), access('manage', 'review'));
    expect(html).toContain('data-testid="pricing-read-only"');
    expect(html).toContain(
      'Changing the pricing needs the platform permission platform.market.pricing',
    );
    expect(buttons(html)).not.toContain('Save pricing');
    expect(buttons(html)).not.toContain('Discard changes');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain('value="9.00"');
  });

  it('read-only in Arabic names the key too', () => {
    const html = render(paidApp(), access('manage'), 'ar');
    expect(html).toContain('platform.market.pricing');
    expect(html).toContain('للقراءة فقط');
  });

  it('types the plan id when the plan list could not be loaded', () => {
    const html = renderWithMessages(<PricingPanel app={paidApp()} access={access('pricing')} />);
    expect(html).toContain('Type a plan id.');
    expect(html).toContain('value="scale"');
  });

  describe('plan features an app grants', () => {
    const grantingApp = (firstParty: boolean) =>
      paidApp({
        firstParty,
        pricing: pricing({ grantsPlanFeatures: ['calling'], grandfatherExisting: true }),
      });

    it('a first-party listing offers the features whose default is off, with the saved ones ticked', () => {
      const html = render(grantingApp(true), access('pricing'));
      expect(html).toContain('data-testid="pricing-grants"');
      expect(html).not.toContain('data-testid="grants-third-party"');
      expect(html).not.toMatch(/<fieldset[^>]*disabled=""[^>]*data-testid="pricing-grants"/);
      expect(html).toContain('WhatsApp calling');
      expect(html).toContain('Automation');
      // on by default for every plan: an app cannot own it (it is still a suggestion for the "included with" rule)
      expect(html).not.toMatch(/id="[^"]*grant-sales_pipeline"/);
      expect(html).toMatch(/id="[^"]*grant-automation"/);
      expect(html).toMatch(/<input[^>]*id="[^"]*grant-calling"[^>]*checked/);
      expect(html).not.toMatch(/<input[^>]*id="[^"]*grant-automation"[^>]*checked/);
      expect(html).toContain('Grandfather existing users');
      expect(html).toMatch(/<input[^>]*id="[^"]*-grandfather"[^>]*checked/);
    });

    it('a third-party listing shows the controls disabled with the reason', () => {
      const html = render(grantingApp(false), access('pricing'));
      expect(html).toContain('data-testid="grants-third-party"');
      expect(html).toContain('Only first-party apps can grant plan features');
      expect(html).toMatch(/<fieldset[^>]*disabled=""[^>]*data-testid="pricing-grants"/);
    });

    it('the grandfather switch is off and unavailable until a feature is granted', () => {
      const html = render(paidApp({ firstParty: true }), access('pricing'));
      expect(html).toMatch(/<input[^>]*id="[^"]*-grandfather"[^>]*disabled/);
    });

    it('Comp existing users is offered only when it is saved on, to someone holding the pricing key', () => {
      const saved = grantingApp(true);
      const withKey = render(saved, access('pricing'));
      expect(withKey).toContain('data-testid="pricing-grandfather"');
      expect(buttons(withKey)).toContain('Comp existing users...');
      const noKey = render(saved, access('manage'));
      expect(noKey).not.toContain('data-testid="pricing-grandfather"');
      const notSaved = render(
        paidApp({
          firstParty: true,
          pricing: pricing({ grantsPlanFeatures: ['calling'], grandfatherExisting: false }),
        }),
        access('pricing'),
      );
      expect(notSaved).not.toContain('data-testid="pricing-grandfather"');
      const free = render(
        detail({ pricing: { ...pricing(), model: 'free', grandfatherExisting: true } }),
        access('pricing'),
      );
      expect(free).not.toContain('data-testid="pricing-grandfather"');
    });

    it('the Comp existing users dialog starts with the form and asks to check who qualifies first', () => {
      for (const locale of LOCALES) {
        const html = renderWithMessages(
          <GrandfatherDialog
            app={{ slug: 'acme-leads', name: 'Acme Leads' }}
            onClose={() => undefined}
          />,
          { locale },
        );
        expect(html).toContain('Acme Leads');
        expect(html).toContain('<dialog');
      }
      const en = renderWithMessages(
        <GrandfatherDialog
          app={{ slug: 'acme-leads', name: 'Acme Leads' }}
          onClose={() => undefined}
        />,
      );
      expect(en).toContain('Comp existing users of Acme Leads');
      expect(en).toContain('Until I end it');
      expect(en).toContain('Do this before the feature is switched off on plans');
      expect(buttons(en)).toContain('Check who qualifies');
      expect(buttonAttrs(en, 'Check who qualifies')).toContain('disabled');
      expect(buttons(en)).not.toContain('Comp 0 workspaces');
    });
  });

  describe('the fields show what is wrong beside each one', () => {
    const fieldsHtml = (
      errors: Parameters<typeof PricingFields>[0]['errors'],
      locale: 'en' | 'ar' = 'en',
    ) =>
      renderWithMessages(
        <PricingFields
          idBase="t"
          draft={draftFromPricing(pricing({ grantsPlanFeatures: ['calling'] }))}
          errors={errors}
          disabled={false}
          canGrant
          planList={null}
          onChange={() => undefined}
        />,
        { locale },
      );

    it('marks each refused field invalid and shows its text', () => {
      const html = fieldsHtml({
        amount: 'Set a monthly price above zero.',
        currency: 'This currency is not enabled on the platform.',
        trialDays: 'Use whole days from 0 to 90.',
        includedMinPlan: 'There is no such plan.',
        includedPlanFeature: 'This is not a plan feature.',
        grantsPlanFeatures: 'Only a first-party app can grant plan features.',
        grandfatherExisting: 'Name the plan features the app grants.',
      });
      for (const text of [
        'Set a monthly price above zero.',
        'This currency is not enabled on the platform.',
        'Use whole days from 0 to 90.',
        'There is no such plan.',
        'This is not a plan feature.',
        'Only a first-party app can grant plan features.',
        'Name the plan features the app grants.',
      ])
        expect(html, text).toContain(text);
      expect(html.match(/aria-invalid="true"/g)?.length).toBeGreaterThanOrEqual(5);
      expect(html).toContain('role="alert"');
    });

    it('shows nothing wrong when there is nothing wrong', () => {
      const html = fieldsHtml({});
      expect(html).not.toContain('aria-invalid');
      expect(html).not.toContain('role="alert"');
    });

    it('is complete in Arabic', () => {
      const html = fieldsHtml({ amount: 'x', currency: 'y' }, 'ar');
      expect(html).toContain('السعر الشهري');
      expect(html).toContain('الحد الأدنى للباقة');
    });

    it('the error line does not list again a problem a field already shows', () => {
      const error = new ApiError(422, ERROR_CODES.VALIDATION_FAILED, 'never read', 'req-9', [
        { path: 'currency', message: 'This currency is not enabled on the platform.' },
        { path: 'grantsPlanFeatures.1', message: 'automation is on by default.' },
        { path: 'rowVersion', message: 'Expected a positive number.' },
      ]);
      const html = renderWithMessages(<ErrorLine error={error} shownAtFields={PRICING_FIELDS} />);
      expect(html).toContain('Expected a positive number.');
      expect(html).not.toContain('This currency is not enabled');
      expect(html).not.toContain('automation is on by default');
      expect(html).not.toContain('req-9');
      expect(html).toContain('Some fields are not valid');
    });
  });
});

describe('the pricing panel on the listing page', () => {
  it('appears between the actions and the tabs, and a manage-and-review operator without the pricing key sees it read-only', () => {
    const html = renderWithMessages(<ListingDetailPage appRef="acme-leads" />, {
      seed: [BOTH, [marketKeys.app('acme-leads'), detail({ pricing: pricing() })]],
    });
    expect(html.indexOf('id="operate"')).toBeLessThan(html.indexOf('id="pricing"'));
    expect(html).toContain('data-testid="pricing-read-only"');
    expect(html).toContain('platform.market.pricing');
    expect(html).not.toContain('Save pricing');
  });

  it('an operator with the pricing key can save the pricing from the listing page', () => {
    const html = renderWithMessages(<ListingDetailPage appRef="acme-leads" />, {
      seed: [ALL, [marketKeys.app('acme-leads'), detail({ pricing: pricing() })]],
    });
    expect(buttons(html)).toContain('Save pricing');
    expect(html).not.toContain('data-testid="pricing-read-only"');
  });
});

describe('the catalogue: pricing column and filter', () => {
  const rows = [
    app({ id: ID(1), slug: 'acme-leads', name: 'Acme Leads' }),
    app({
      id: ID(2),
      slug: 'paid-one',
      name: 'Paid One',
      pricing: pricing({ amount: '9.00', trialDays: 14 }),
      activeSubscriptions: 5,
    }),
    app({
      id: ID(3),
      slug: 'paid-off',
      name: 'Paid Off',
      pricing: pricing({ amount: '19.50', currency: 'EUR', trialDays: 0, purchasable: false }),
      activeSubscriptions: 2,
    }),
  ];
  const seed = (held = ALL) =>
    [
      held,
      [marketKeys.apps({}), pages(rows)],
      [marketKeys.categories, { data: [category()] }],
    ] as const;

  it('shows Free, or the monthly price with the trial and a not-on-sale marker', () => {
    const html = renderWithMessages(<CataloguePage />, { seed: [...seed()] });
    expect(html).toContain('Pricing');
    expect(html).toContain('Active subscriptions');
    expect(html).toContain('data-testid="price-free"');
    expect(html).toContain('$9.00');
    expect(html).toContain('/ month');
    expect(html).toContain('14 days trial');
    expect(html).toContain('€19.50');
    expect(html.match(/Not on sale/g)).toHaveLength(1);
    expect(html.match(/data-testid="price-paid"/g)).toHaveLength(2);
  });

  it('shows the number of active subscriptions, linked to them, and a dash for a free app with none', () => {
    const html = renderWithMessages(<CataloguePage />, { seed: [...seed()] });
    expect(html).toContain('href="/admin/marketplace/subscriptions?app=paid-one"');
    expect(html).toContain('Subscriptions to Paid One');
    expect(html).not.toContain('href="/admin/marketplace/subscriptions?app=acme-leads"');
  });

  it('offers a Free and Paid filter beside the other filters', () => {
    const html = renderWithMessages(<CataloguePage />, { seed: [...seed()] });
    expect(html).toContain('id="catalogue-pricing"');
    const select = /<select[^>]*id="catalogue-pricing"[\s\S]*?<\/select>/.exec(html)![0];
    expect(select).toContain('All pricing');
    expect(select).toContain('>Free<');
    expect(select).toContain('>Paid<');
    expect(select).toMatch(/<option value="all" selected/);
  });

  for (const locale of LOCALES) {
    it(`is complete in ${locale}`, () => {
      const html = renderWithMessages(<CataloguePage />, { locale, seed: [...seed()] });
      expect(html).toContain('data-testid="price-paid"');
      expect(html).toContain('id="catalogue-pricing"');
    });
  }

  it('Arabic writes the price with its words, in its own left-to-right run', () => {
    const html = renderWithMessages(<CataloguePage />, { locale: 'ar', seed: [...seed()] });
    expect(html).toContain('شهريًا');
    expect(html).toContain('غير معروض للبيع');
    expect(html).toContain('<bdi dir="ltr"');
  });

  it('an operator holding only the pricing key still reaches the page (the server decides what it may read)', () => {
    const html = renderWithMessages(<CataloguePage />, { seed: [...seed(PRICING_ONLY)] });
    expect(html).toContain('Paid One');
  });
});

describe('the subscriptions page', () => {
  const rows = [
    subscription({ id: ID(41), workspace: { id: ID(50), name: 'Acme Retail' } }),
    subscription({
      id: ID(42),
      workspace: { id: ID(51), name: 'Globex' },
      status: 'trialing',
      source: 'trial',
      amount: null,
      currency: null,
      trialEndsAt: '2026-10-20T00:00:00.000Z',
    }),
    subscription({
      id: ID(43),
      workspace: { id: ID(52), name: 'Initech' },
      status: 'comped',
      source: 'comp',
      amount: null,
      currency: null,
      currentPeriodEnd: null,
      compNote: 'Partner pilot',
      compBy: 'Sam Ops',
    }),
    subscription({
      id: ID(44),
      workspace: { id: ID(53), name: 'Umbrella' },
      status: 'canceling',
      cancelAtPeriodEnd: true,
    }),
    subscription({
      id: ID(45),
      workspace: { id: ID(54), name: 'Hooli' },
      status: 'ended',
      lapsedAt: '2026-09-15T00:00:00.000Z',
    }),
  ];
  const seed = (held = ALL, over: Partial<{ summary: unknown; list: unknown }> = {}) =>
    [
      held,
      [marketKeys.subscriptionSummary, over.summary ?? SUMMARY],
      [marketKeys.subscriptions({}), over.list ?? pages(rows)],
    ] as const;

  for (const locale of LOCALES) {
    it(`shows the summary per app, the totals and the table in ${locale}`, () => {
      const html = renderWithMessages(<SubscriptionsPage />, { locale, seed: [...seed()] });
      expect(html).toContain('data-testid="summary-acme-leads"');
      expect(html).toContain('data-testid="summary-old-free"');
      expect(html).toContain('data-testid="summary-totals"');
      for (const w of ['Acme Retail', 'Globex', 'Initech', 'Umbrella', 'Hooli'])
        expect(html).toContain(w);
      if (locale === 'en') expect(html).toContain('$45.00');
      else expect(html).toContain('<bdi dir="ltr"');
    });
  }

  it('the summary counts each state per app and adds them up, with revenue per currency', () => {
    const html = renderWithMessages(<SubscriptionsPage />, { seed: [...seed()] });
    const totals = /<tr data-testid="summary-totals">([\s\S]*?)<\/tr>/.exec(html)![1]!;
    const cells = [...totals.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      m[1]!.replace(/<[^>]+>/g, '').trim(),
    );
    expect(cells).toEqual(['5', '2', '1', '1', '0', '5', '14', '$45.00']);
    expect(html).toContain('Monthly revenue, USD');
    expect(html).toContain('currencies are never added together');
  });

  it('two currencies are two figures, never one', () => {
    const html = renderWithMessages(<SubscriptionsPage />, {
      seed: [
        ...seed(ALL, {
          summary: {
            data: [
              summaryRow({
                mrr: [
                  { currency: 'USD', amount: '45.00' },
                  { currency: 'EUR', amount: '30.00' },
                ],
              }),
            ],
            totals: [
              { currency: 'EUR', amount: '30.00' },
              { currency: 'USD', amount: '45.00' },
            ],
          },
        }),
      ],
    });
    expect(html).toContain('Monthly revenue, EUR');
    expect(html).toContain('€30.00');
    expect(html).toContain('Monthly revenue, USD');
  });

  it('each row has its state badge, source, start, renewal or end date and amount', () => {
    const html = renderWithMessages(<SubscriptionsPage />, { seed: [...seed()] });
    for (const label of ['Paying', 'On trial', 'Comped', 'Ending', 'Ended'])
      expect(html, label).toContain(`>${label}<`);
    expect(html).toContain('Paid until Nov 1, 2026');
    expect(html).toContain('Trial ends Oct 20, 2026');
    expect(html).toContain('Comp until you end it');
    expect(html).toContain('Ends Nov 1, 2026');
    expect(html).toContain('Ended Sep 15, 2026');
    expect(html).toContain('Started');
    expect(html).toContain('Sep 1, 2026');
    expect(html).toContain('No charge');
    expect(html).toContain('Comped by Sam Ops: Partner pilot');
    expect(html).toContain('href="/admin/marketplace/acme-leads"');
  });

  it('Cancel is offered on every row that can still be cancelled, and not on an ended one', () => {
    const html = renderWithMessages(<SubscriptionsPage />, { seed: [...seed()] });
    const cancels = buttons(html).filter((b) => b.startsWith('Cancel...'));
    expect(cancels).toHaveLength(4);
    expect(cancels.join('|')).not.toContain('Hooli');
    expect(cancels.join('|')).toContain('Acme Retail, Acme Leads');
  });

  it('the money actions need platform.market.pricing: without it there is no Cancel, no Comp, and a note names the key', () => {
    const html = renderWithMessages(<SubscriptionsPage />, { seed: [...seed(MANAGE)] });
    expect(buttons(html).filter((b) => b.startsWith('Cancel...'))).toEqual([]);
    expect(buttons(html)).not.toContain('Comp a workspace');
    expect(html).toContain('need the platform permission platform.market.pricing');
    expect(html).toContain('Acme Retail');
    const withKey = renderWithMessages(<SubscriptionsPage />, { seed: [...seed()] });
    expect(buttons(withKey)).toContain('Comp a workspace');
    expect(withKey).not.toContain('need the platform permission');
  });

  it('a pricing-only operator reads it and acts on it', () => {
    const html = renderWithMessages(<SubscriptionsPage />, { seed: [...seed(PRICING_ONLY)] });
    expect(html).toContain('Acme Retail');
    expect(buttons(html)).toContain('Comp a workspace');
  });

  it('names all three keys to someone with none, and shows no subscriptions', () => {
    const html = renderWithMessages(<SubscriptionsPage />, { seed: [...seed(NONE)] });
    for (const key of Object.values(KEY)) expect(html).toContain(key);
    expect(html).not.toContain('Acme Retail');
  });

  it('has the four filters: app, state, source and workspace name', () => {
    const html = renderWithMessages(<SubscriptionsPage />, { seed: [...seed()] });
    expect(html).toContain('role="search"');
    for (const id of ['subs-app', 'subs-status', 'subs-source', 'subs-search'])
      expect(html).toContain(`id="${id}"`);
    const status = /<select[^>]*id="subs-status"[\s\S]*?<\/select>/.exec(html)![0];
    for (const s of ['Paying', 'On trial', 'Comped', 'Ending', 'Ended'])
      expect(status).toContain(s);
    const source = /<select[^>]*id="subs-source"[\s\S]*?<\/select>/.exec(html)![0];
    for (const s of ['Purchase', 'Trial', 'Comp']) expect(source).toContain(`>${s}<`);
    const app = /<select[^>]*id="subs-app"[\s\S]*?<\/select>/.exec(html)![0];
    expect(app).toContain('Acme Leads');
    expect(app).toContain('Old Free');
  });

  it('opens on one app when the address names it', () => {
    const html = renderWithMessages(<SubscriptionsPage initialApp="acme-leads" />, {
      seed: [
        ALL,
        [marketKeys.subscriptionSummary, SUMMARY],
        [marketKeys.subscriptions({ app: 'acme-leads' }), pages([rows[0]])],
      ],
    });
    expect(html).toMatch(/<option value="acme-leads" selected/);
    expect(html).toContain('Acme Retail');
    expect(html).not.toContain('Globex');
  });

  it('pages by cursor: Load more only when the API says there is more', () => {
    const more = renderWithMessages(<SubscriptionsPage />, {
      seed: [...seed(ALL, { list: pages(rows, { nextCursor: 'c', hasMore: true, limit: 50 }) })],
    });
    expect(buttons(more)).toContain('Load more');
    expect(buttons(renderWithMessages(<SubscriptionsPage />, { seed: [...seed()] }))).not.toContain(
      'Load more',
    );
  });

  it('shows the empty states: no subscriptions, and no paid apps', () => {
    const html = renderWithMessages(<SubscriptionsPage />, {
      seed: [...seed(ALL, { summary: { data: [], totals: [] }, list: pages([]) })],
    });
    expect(html).toContain('No subscriptions yet');
    expect(html).toContain('No paid apps yet');
    expect(html).toContain('No paying subscribers yet');
  });

  it('shows the loading state before anything arrives', () => {
    expect(renderWithMessages(<SubscriptionsPage />, { seed: [ALL] })).toContain('Loading...');
  });
});

describe('the cancel dialog', () => {
  const render = (s: ReturnType<typeof subscription>, locale: 'en' | 'ar' = 'en') =>
    renderWithMessages(<CancelSubscriptionDialog subscription={s} onClose={() => undefined} />, {
      locale,
    });

  for (const locale of LOCALES) {
    it(`offers the end of the period or right now, with what each means, in ${locale}`, () => {
      const html = render(subscription(), locale);
      expect(html).toContain('<dialog');
      expect(html.match(/name="cancel-when"/g)).toHaveLength(2);
      expect(html).toContain('<textarea');
    });
  }

  it('says what each choice does to the workspace', () => {
    const html = render(subscription());
    expect(html).toContain('Cancel the subscription of Acme Retail?');
    expect(html).toContain('Acme Retail holds Acme Leads.');
    expect(html).toContain('At the end of the paid period');
    expect(html).toContain('Renewal stops. Acme Retail keeps Acme Leads until Nov 1, 2026');
    expect(html).toContain('the installation is paused and its data is kept');
    expect(html).toContain('Right now');
    expect(html).toContain('Access ends at once');
    expect(html).toContain('not refunded');
  });

  it('starts on the gentle option and asks for a reason before it can be confirmed', () => {
    const html = render(subscription());
    expect(inputTag(html, 'periodEnd')).toContain('checked=""');
    expect(inputTag(html, 'now')).not.toContain('checked=""');
    expect(html).toContain('Reason');
    expect(html).toContain('Between 5 and 300 characters');
    expect(buttons(html)).toContain('Stop renewal');
    expect(buttonAttrs(html, 'Stop renewal')).toContain('disabled');
    expect(buttons(html)).toContain('Keep it');
  });

  it('a subscription that is already ending can only be ended now', () => {
    const html = render(subscription({ status: 'canceling', cancelAtPeriodEnd: true }));
    expect(html.match(/name="cancel-when"/g)).toHaveLength(1);
    expect(html).toContain('already set to end on Nov 1, 2026');
    expect(buttons(html)).toContain('End it now');
  });

  it('a subscription with no end date can only be ended now, and says why', () => {
    const html = render(subscription({ status: 'comped', source: 'comp', currentPeriodEnd: null }));
    expect(html.match(/name="cancel-when"/g)).toHaveLength(1);
    expect(html).toContain('no end date, so it can only be ended right now');
  });
});

describe('the comp dialog', () => {
  const workspaces = {
    data: [
      {
        workspaceId: ID(50),
        name: 'Acme Retail',
        slug: 'acme-retail',
        planName: 'Scale',
        planSlug: 'scale',
      },
      { workspaceId: ID(51), name: 'Globex', slug: 'globex', planName: null, planSlug: 'free' },
    ],
    nextCursor: null,
  };
  const render = (initialApp?: string, locale: 'en' | 'ar' = 'en', summary: unknown = SUMMARY) =>
    renderWithMessages(<CompDialog initialApp={initialApp} onClose={() => undefined} />, {
      locale,
      seed: [
        [marketKeys.subscriptionSummary, summary],
        [marketKeys.workspaces(''), workspaces],
      ],
    });

  for (const locale of LOCALES) {
    it(`has the app, the workspace picker, the length and the note in ${locale}`, () => {
      const html = render(undefined, locale);
      expect(html).toContain('<dialog');
      expect(html).toContain('id="comp-app"');
      expect(html).toContain('id="comp-workspace-search"');
      expect(html).toContain('name="comp-workspace"');
      expect(html).toContain('id="comp-note"');
      expect(html).toContain('type="number"');
    });
  }

  it('offers only paid apps', () => {
    const html = render();
    const select = /<select[^>]*id="comp-app"[\s\S]*?<\/select>/.exec(html)![0];
    expect(select).toContain('Acme Leads');
    expect(select).not.toContain('Old Free');
    expect(select).toContain('Choose a paid app');
  });

  it('preselects the app the page was filtered to', () => {
    expect(render('acme-leads')).toMatch(/<option value="acme-leads" selected/);
  });

  it('lists matching workspaces with their plan, as radios', () => {
    const html = render();
    expect(html.match(/name="comp-workspace"/g)).toHaveLength(2);
    expect(html).toContain('Acme Retail');
    expect(html).toContain('acme-retail');
    expect(html).toContain('Plan: Scale');
    expect(html).toContain('Plan: free');
    expect(html).toContain('Showing up to 8 matches');
  });

  it('asks how long (months or until ended) and says what it will do', () => {
    const html = render();
    expect(html).toContain('For a number of months');
    expect(html).toContain('Until I end it');
    expect(html).toContain('Whole months, 1 to 36.');
    expect(html).toContain('The workspace gets the app free for 3 months.');
    expect(html).toContain('It is refused while the workspace pays for the app');
  });

  it('cannot be submitted until an app, a workspace and a note are given', () => {
    const html = render();
    expect(buttons(html)).toContain('Comp workspace');
    expect(buttonAttrs(html, 'Comp workspace')).toContain('disabled');
  });

  it('says so when there is no paid app to comp', () => {
    const html = render(undefined, 'en', {
      data: [summaryRow({ pricing: { model: 'free', amount: null, currency: null } })],
      totals: [],
    });
    expect(html).toContain('There is no paid app to comp yet');
  });
});
