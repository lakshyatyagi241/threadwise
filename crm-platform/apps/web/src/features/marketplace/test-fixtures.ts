import {
  marketScopeSummaries,
  type MarketAppCard,
  type MarketAppDetail,
  type MarketCardPricing,
  type MarketInstallation,
  type MarketRequest,
  type MarketSubscription,
} from '@crm/contracts';

/** Shared fixtures of this feature's tests: one card, one app page, one installation, one request, with overrides. Never imported by app code. */

export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The secret the install and rotate answers carry in the tests, and a public key inside an address: the render tests look for them. */
export const SECRET = 'whsec_TOPSECRETVALUE1234567890abcdef';
export const URL_KEY = '0123456789abcdef0123456789abcdef';
export const HOOK_URL = `https://api.example.test/v2/public/marketplace/hooks/${URL_KEY}`;

export const scopes = (...ids: string[]) => marketScopeSummaries(ids);

/** A free app's pricing; pass fields to change it. */
export function pricing(over: Partial<MarketCardPricing> = {}): MarketCardPricing {
  return {
    model: 'free',
    amount: null,
    currency: null,
    trialDays: 0,
    trialAvailable: false,
    access: 'free',
    availability: 'open',
    includedBy: null,
    checkoutPath: null,
    ...over,
  };
}

export const PACK_PATH = '/billing/checkout/mkt_0123456789abcdef0123';

/** A paid app the workspace has no subscription to: $9 a month, with a 14-day trial on offer. */
export function paidPricing(over: Partial<MarketCardPricing> = {}): MarketCardPricing {
  const availability: MarketCardPricing['availability'] =
    over.access === 'entitled'
      ? 'purchased'
      : over.access === 'included' || over.access === 'free'
        ? 'open'
        : 'visible';
  return pricing({
    model: 'paid_monthly',
    amount: '9.00',
    currency: 'USD',
    trialDays: 14,
    trialAvailable: true,
    access: 'subscription_required',
    availability,
    checkoutPath: PACK_PATH,
    ...over,
  });
}

/** An active, paid subscription (paid until 31 October 2026); pass fields to make it a trial, a comp, canceling or ended. */
export function subscription(over: Partial<MarketSubscription> = {}): MarketSubscription {
  return {
    id: ID(90),
    status: 'active',
    source: 'purchase',
    amount: '9.00',
    currency: 'USD',
    period: 'monthly',
    startedAt: '2026-09-30T00:00:00.000Z',
    currentPeriodEnd: '2026-10-31T00:00:00.000Z',
    trialEndsAt: null,
    canceledAt: null,
    lapsedAt: null,
    renewals: 0,
    nextAmount: null,
    nextCurrency: null,
    autoRenew: false,
    priceLocked: false,
    paymentFailedAt: null,
    graceEndsAt: null,
    actions: { canCancel: true, canResume: false, canRenew: false },
    ...over,
  };
}

export function card(over: Partial<MarketAppCard> = {}): MarketAppCard {
  return {
    id: ID(1),
    slug: 'webhook',
    kind: 'integration',
    category: { slug: 'lead-sources', name: 'Lead sources' },
    name: 'Webhook',
    tagline: 'Receive leads from any tool that can send a web request.',
    logo: null,
    firstParty: true,
    featured: true,
    version: '1.0.0',
    pricing: pricing(),
    connectorType: 'webhook_relay',
    installCount: 3,
    publishedAt: '2026-10-01T00:00:00.000Z',
    install: null,
    locked: null,
    ...over,
  };
}

export function detail(over: Partial<MarketAppDetail> = {}): MarketAppDetail {
  return {
    ...card(),
    description: 'Send leads to your workspace from Zapier, Make or your own code.',
    listing: {
      logo: null,
      longDescription: 'First paragraph of the long text.\n\nSecond paragraph after a blank line.',
      highlights: ['Works with any sender', 'No code needed'],
      screenshots: [
        { url: 'https://img.example.test/one.png', caption: 'The setup screen' },
        { url: 'http://insecure.example.test/two.png' },
      ],
      dataProcessing: {
        summary: 'Stores the lead fields you send.',
        regions: ['India'],
        deletion: 'Delete the leads to remove the data.',
      },
    },
    scopes: scopes('leads.write', 'messages.send', 'contacts.read'),
    surfaces: [],
    support: {
      website: 'https://example.test/webhook',
      docs: 'https://example.test/webhook/docs',
      email: 'help@example.test',
    },
    developer: { name: 'Acme Labs', url: 'https://example.test' },
    changelog: [
      { version: '1.0.0', notes: 'First release.', publishedAt: '2026-10-01T00:00:00.000Z' },
    ],
    setup: {
      connectorType: 'webhook_relay',
      authFields: [
        {
          key: 'portalKey',
          label: 'Portal key',
          kind: 'secret',
          required: true,
          help: 'From the portal settings.',
          placeholder: null,
          options: null,
        },
        {
          key: 'account',
          label: 'Account id',
          kind: 'text',
          required: false,
          help: null,
          placeholder: null,
          options: null,
        },
      ],
      setupInstructions: [{ title: 'Copy the key', body: 'Open the portal.\n\nCopy the key.' }],
      hasTestPayload: true,
    },
    subscription: null,
    ...over,
  };
}

export function installation(over: Partial<MarketInstallation> = {}): MarketInstallation {
  return {
    id: ID(50),
    app: {
      id: ID(1),
      slug: 'webhook',
      name: 'Webhook',
      kind: 'integration',
      logo: null,
      category: { slug: 'lead-sources', name: 'Lead sources' },
      connectorType: 'webhook_relay',
    },
    status: 'active',
    health: {
      status: 'healthy',
      checkedAt: '2026-10-02T10:00:00.000Z',
      lastError: null,
      lastErrorAt: null,
    },
    version: '1.0.0',
    pendingVersion: null,
    needsReconsent: false,
    grantedScopes: scopes('leads.write'),
    config: {},
    credentials: [
      { key: 'portalKey', label: 'Portal key', kind: 'secret', isSet: true, hint: 'ends in 9f2a' },
      { key: 'account', label: 'Account id', kind: 'text', isSet: true, hint: 'acct-42' },
    ],
    connection: {
      id: ID(60),
      type: 'webhook_relay',
      status: 'active',
      inbound: {
        url: HOOK_URL,
        method: 'POST',
        auth: 'either',
        tokenHeader: 'X-Marketplace-Token',
        signatureHeader: 'X-Marketplace-Signature',
        secretHint: 'ends in cdef',
      },
      pollIntervalSeconds: null,
      lastEventAt: '2026-10-02T09:00:00.000Z',
      lastSuccessAt: '2026-10-02T09:00:00.000Z',
      lastError: null,
      counters: { received: 12, accepted: 10, duplicates: 1, failed: 1 },
    },
    killReason: null,
    pauseReason: null,
    pricing: pricing(),
    subscription: null,
    installedBy: { id: ID(7), name: 'Asha Rao' },
    installedAt: '2026-10-01T12:00:00.000Z',
    rowVersion: 4,
    ...over,
  };
}

export function request(over: Partial<MarketRequest> = {}): MarketRequest {
  return {
    id: ID(80),
    name: 'JustDial',
    kind: 'integration',
    categorySlug: 'lead-sources',
    status: 'open',
    voteCount: 7,
    hasVoted: false,
    createdAt: '2026-09-30T00:00:00.000Z',
    ...over,
  };
}
