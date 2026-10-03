import {
  marketScopeSummaries,
  type MarketAppCard,
  type MarketAppDetail,
  type MarketInstallation,
  type MarketRequest,
} from '@crm/contracts';

/** Shared fixtures of this feature's tests: one card, one app page, one installation, one request, with overrides. Never imported by app code. */

export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The secret the install and rotate answers carry in the tests, and a public key inside an address: the render tests look for them. */
export const SECRET = 'whsec_TOPSECRETVALUE1234567890abcdef';
export const URL_KEY = '0123456789abcdef0123456789abcdef';
export const HOOK_URL = `https://api.example.test/v2/public/marketplace/hooks/${URL_KEY}`;

export const scopes = (...ids: string[]) => marketScopeSummaries(ids);

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
    pricing: { model: 'free' },
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
