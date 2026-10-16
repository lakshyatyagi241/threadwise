import {
  FREE_PRICING,
  marketManifestSchema,
  recipeSchema,
  type MarketOperatorApp,
  type MarketOperatorAppDetail,
  type MarketOperatorCategory,
  type MarketOperatorRequest,
  type MarketOperatorSubscription,
  type MarketOperatorVersion,
  type MarketPricingView,
  type MarketSubscriptionSummaryRow,
  type MarketUsageRow,
} from '@crm/contracts';
import { starterManifest, starterRecipe } from './lib/starters';

/** Shared fixtures of this feature's tests: one listing, its versions and the other screens' rows, with overrides. Never imported by app code. */

export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-02T10:00:00.000Z';

export function app(over: Partial<MarketOperatorApp> = {}): MarketOperatorApp {
  return {
    id: ID(1),
    slug: 'acme-leads',
    kind: 'integration',
    category: { slug: 'lead-sources', name: 'Lead sources' },
    name: 'Acme Leads',
    tagline: 'Bring Acme enquiries in as leads.',
    status: 'published',
    firstParty: false,
    featured: false,
    planFeature: null,
    pricing: FREE_PRICING,
    activeSubscriptions: 0,
    sortOrder: 100,
    connectorType: 'push',
    publishedVersion: '1.0.0',
    latestVersion: '1.0.0',
    installCount: 3,
    killReason: null,
    killedAt: null,
    publishedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    rowVersion: 4,
    ...over,
  };
}

export function version(over: Partial<MarketOperatorVersion> = {}): MarketOperatorVersion {
  return {
    id: ID(11),
    version: '1.0.0',
    status: 'published',
    changelog: 'First version.',
    scopes: ['leads.write'],
    reviewNote: null,
    submittedAt: NOW,
    reviewedAt: NOW,
    publishedAt: NOW,
    createdAt: NOW,
    ...over,
  };
}

export const manifest = () =>
  marketManifestSchema.parse(
    starterManifest('push', { slug: 'acme-leads', name: 'Acme Leads', version: '1.0.0' }),
  );
export const recipe = () =>
  recipeSchema.parse(starterRecipe('push', { slug: 'acme-leads', name: 'Acme Leads' }));

/** A listing as the detail screen gets it: `status` is the listing's, `versionStatus` the viewed version's. */
export function detail(
  over: Partial<MarketOperatorAppDetail> & { versionStatus?: MarketOperatorVersion['status'] } = {},
): MarketOperatorAppDetail {
  const versionStatus = over.versionStatus ?? 'published';
  return {
    ...app(),
    listing: {
      logo: null,
      longDescription: 'Receive Acme portal enquiries as leads.',
      highlights: ['Fast', 'Safe'],
      screenshots: [{ url: 'https://example.com/shot.png', caption: 'The setup screen' }],
      dataProcessing: {
        summary: 'Leads are stored as contacts.',
        regions: ['India'],
        deletion: '',
      },
    },
    versions: [version({ status: versionStatus })],
    manifest: manifest(),
    recipe: recipe(),
    versionId: ID(11),
    versionStatus,
    ...over,
  };
}

export function category(over: Partial<MarketOperatorCategory> = {}): MarketOperatorCategory {
  return {
    id: ID(21),
    kind: 'integration',
    slug: 'lead-sources',
    name: 'Lead sources',
    description: 'Bring leads from portals into your workspace.',
    icon: 'target',
    sortOrder: 10,
    isActive: true,
    appCount: 2,
    rowVersion: 1,
    ...over,
  };
}

export function request(over: Partial<MarketOperatorRequest> = {}): MarketOperatorRequest {
  return {
    id: ID(31),
    name: 'Just Dial',
    kind: 'integration',
    categorySlug: 'lead-sources',
    website: 'https://www.justdial.com',
    status: 'open',
    voteCount: 12,
    notes: ['We get 40 enquiries a day there', 'Please add it'],
    firstWorkspace: { id: ID(50), name: 'Acme Retail' },
    operatorNote: null,
    createdAt: NOW,
    rowVersion: 2,
    ...over,
  };
}

const counts = (accepted = 0, duplicate = 0, rejected = 0, failed = 0) => ({
  accepted,
  duplicate,
  rejected,
  failed,
});

export function usageRow(over: Partial<MarketUsageRow> = {}): MarketUsageRow {
  return {
    appId: ID(1),
    slug: 'acme-leads',
    name: 'Acme Leads',
    kind: 'integration',
    status: 'published',
    installs: { active: 3, disabled: 1, killed: 0, total: 4 },
    health: { healthy: 3, degraded: 0, error: 0, needsReauth: 0, unknown: 1 },
    events: { last24h: counts(10, 1, 0, 0), last7d: counts(70, 5, 2, 0) },
    ...over,
  };
}

/** A paid listing's pricing as the operator API answers it: 9.00 USD a month, a 14-day trial, on sale. */
export function pricing(over: Partial<MarketPricingView> = {}): MarketPricingView {
  return {
    model: 'paid_monthly',
    amount: '9.00',
    currency: 'USD',
    annualAmount: null,
    billingMode: 'one_time',
    priceLock: false,
    trialDays: 14,
    purchasable: true,
    includedPlanFeature: null,
    includedMinPlan: null,
    priceChangedAt: NOW,
    grantsPlanFeatures: [],
    grandfatherExisting: false,
    packSlug: 'mkt_00000000000040008000',
    ...over,
  };
}

/** One workspace's subscription as the operator list shows it (a paying one by default). */
export function subscription(
  over: Partial<MarketOperatorSubscription> = {},
): MarketOperatorSubscription {
  return {
    id: ID(41),
    app: { id: ID(1), slug: 'acme-leads', name: 'Acme Leads' },
    workspace: { id: ID(50), name: 'Acme Retail' },
    status: 'active',
    source: 'purchase',
    amount: '9.00',
    currency: 'USD',
    startedAt: '2026-09-01T10:00:00.000Z',
    currentPeriodEnd: '2026-11-01T10:00:00.000Z',
    trialEndsAt: null,
    canceledAt: null,
    lapsedAt: null,
    renewals: 1,
    period: 'monthly',
    cancelAtPeriodEnd: false,
    autoRenew: false,
    priceLocked: false,
    paymentFailedAt: null,
    graceEndsAt: null,
    compNote: null,
    compBy: null,
    ...over,
  };
}

/** One app's row of the subscriptions summary. */
export function summaryRow(
  over: Partial<MarketSubscriptionSummaryRow> = {},
): MarketSubscriptionSummaryRow {
  return {
    appId: ID(1),
    slug: 'acme-leads',
    name: 'Acme Leads',
    pricing: { model: 'paid_monthly', amount: '9.00', currency: 'USD' },
    counts: { active: 5, trialing: 2, comped: 1, canceling: 1, pastDue: 0, ended: 3, total: 12 },
    mrr: [{ currency: 'USD', amount: '45.00' }],
    ...over,
  };
}
