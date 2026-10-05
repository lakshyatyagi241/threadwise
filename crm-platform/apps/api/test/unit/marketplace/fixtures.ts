import type { MarketManifestInput, MarketRecipeInput } from '@crm/contracts';

/** A valid mini-app manifest; a test changes one thing. */
export const miniAppManifest = (over: Record<string, unknown> = {}): MarketManifestInput =>
  ({
    manifestVersion: 1,
    id: 'quote-panel',
    name: 'Quote panel',
    kind: 'mini_app',
    category: 'sales-tools',
    version: '1.0.0',
    description: 'A panel on the deal page that builds a quote from your catalogue.',
    scopes: ['contacts.read', 'deals.read'],
    surfaces: [{ type: 'deal_panel', key: 'quote', label: 'Quote' }],
    pricing: { model: 'free' },
    support: { website: 'https://example.com/quote', email: 'help@example.com' },
    developer: { name: 'Acme Apps', url: 'https://example.com' },
    ...over,
  }) as MarketManifestInput;

export const integrationManifest = (over: Record<string, unknown> = {}): MarketManifestInput =>
  ({
    manifestVersion: 1,
    id: 'acme-leads',
    name: 'Acme Leads',
    kind: 'integration',
    category: 'lead-sources',
    version: '1.0.0',
    description: 'Receive Acme portal enquiries as leads in your workspace.',
    scopes: ['leads.write'],
    pricing: { model: 'free' },
    connector: { type: 'webhook_relay' },
    ...over,
  }) as MarketManifestInput;

/** A webhook relay recipe, the simplest valid one. */
export const relayRecipe = (over: Record<string, unknown> = {}): MarketRecipeInput =>
  ({
    schemaVersion: 1,
    key: 'acme-leads',
    name: 'Acme Leads',
    category: 'lead-sources',
    connector: { type: 'webhook_relay', auth: 'either' },
    mapping: { mode: 'auto' },
    testPayloads: [{ name: 'Sample', payload: { id: 'a-1', name: 'Asha', phone: '9876543210' } }],
    ...over,
  }) as MarketRecipeInput;

/** A push recipe with an explicit mapping and a credential the portal's key goes into. */
export const pushRecipe = (over: Record<string, unknown> = {}): MarketRecipeInput =>
  ({
    schemaVersion: 1,
    key: 'acme-leads',
    name: 'Acme Leads',
    category: 'lead-sources',
    connector: {
      type: 'push',
      auth: { scheme: 'header_token', header: 'X-Acme-Key', credentialField: 'portalKey' },
    },
    authFields: [
      { key: 'portalKey', label: 'Portal key', kind: 'secret', required: true },
      { key: 'account', label: 'Account id', kind: 'text', required: false },
    ],
    mapping: {
      mode: 'explicit',
      externalId: { from: 'query.id' },
      itemsPath: 'queries',
      fields: [
        { to: 'name', from: 'query.sender_name', required: true },
        { to: 'phone', from: 'query.sender_mobile', transform: ['phone'], required: true },
        { to: 'message', from: 'query.message' },
        { to: 'city', const: 'Unknown' },
      ],
      attribution: { platform: { const: 'acme' }, campaign: { from: 'query.campaign' } },
    },
    testPayloads: [
      {
        name: 'One lead',
        payload: {
          queries: [
            {
              query: {
                id: 'q-1',
                sender_name: 'Ravi',
                sender_mobile: '98765 43210',
                message: 'Need a quote',
                campaign: 'diwali',
              },
            },
          ],
        },
      },
    ],
    ...over,
  }) as MarketRecipeInput;

export const pullRecipe = (over: Record<string, unknown> = {}): MarketRecipeInput =>
  ({
    schemaVersion: 1,
    key: 'acme-leads',
    name: 'Acme Leads',
    category: 'lead-sources',
    connector: {
      type: 'pull',
      request: {
        method: 'GET',
        baseUrl: 'https://api.portal-example.com',
        path: '/v1/enquiries/{{cred.apiKey}}',
        query: { since: '{{since_iso}}', after: '{{cursor}}' },
        headers: { 'X-Account': '{{cred.account}}' },
      },
      response: { itemsPath: 'data.items' },
      cursor: { from: 'id' },
      pollIntervalSeconds: 300,
    },
    authFields: [
      { key: 'apiKey', label: 'API key', kind: 'secret', required: true },
      { key: 'account', label: 'Account', kind: 'text', required: false },
    ],
    mapping: {
      mode: 'explicit',
      externalId: { from: 'id' },
      fields: [
        { to: 'name', from: 'name', required: true },
        { to: 'phone', from: 'mobile', transform: ['phone'], required: true },
      ],
    },
    errorMapping: [
      {
        status: 401,
        code: 'bad_key',
        message: 'The API key was refused.',
        retry: false,
        health: 'needs_reauth',
      },
    ],
    ...over,
  }) as MarketRecipeInput;
