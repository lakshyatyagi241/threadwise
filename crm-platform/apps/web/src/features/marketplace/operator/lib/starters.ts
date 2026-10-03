import { CONNECTOR_TYPES, type ConnectorKind } from '@crm/contracts';
import { parseJsonText, prettyJson } from './json-docs';

/**
 * Starting points for the two JSON editors, from docs/runbooks/marketplace-publish-listing.md. Each one is a valid document that
 * passes the contract's schemas as it stands (a test proves it), with placeholder names the operator replaces. The recipe starter's
 * key, category and connector type already equal the manifest starter's.
 */

export const STARTER_TEMPLATES = ['mini_app', 'webhook_relay', 'push'] as const;
export type StarterTemplate = (typeof STARTER_TEMPLATES)[number];

export interface StarterOptions {
  /** The slug to use instead of the placeholder. */
  slug?: string;
  name?: string;
  category?: string;
  version?: string;
}

const PLACEHOLDER_SLUG = 'my-app';

export function starterManifest(template: StarterTemplate, o: StarterOptions = {}): unknown {
  const id = o.slug ?? PLACEHOLDER_SLUG;
  const name = o.name ?? 'My app';
  const version = o.version ?? '1.0.0';
  if (template === 'mini_app') {
    return {
      manifestVersion: 1,
      id,
      name,
      kind: 'mini_app',
      category: o.category ?? 'utilities',
      version,
      description: 'Describe in one or two sentences what this app does for a workspace.',
      scopes: ['contacts.read'],
      pricing: { model: 'free' },
      support: { website: 'https://example.com/support' },
    };
  }
  return {
    manifestVersion: 1,
    id,
    name,
    kind: 'integration',
    category: o.category ?? 'lead-sources',
    version,
    description: 'Receive enquiries from this service as leads in your workspace.',
    scopes: ['leads.write'],
    pricing: { model: 'free' },
    support: { website: 'https://example.com/support', docs: 'https://example.com/docs' },
    connector: { type: template },
  };
}

const SETUP = [
  {
    title: 'Copy the address',
    body: 'Paste the webhook address shown after you install into the sending tool.',
  },
];

export function starterRecipe(type: ConnectorKind, o: StarterOptions = {}): unknown {
  const key = o.slug ?? PLACEHOLDER_SLUG;
  const name = o.name ?? 'My app';
  const category = o.category ?? 'lead-sources';
  const head = { schemaVersion: 1, key, name, category, logo: null };
  switch (type) {
    case 'webhook_relay':
      return {
        ...head,
        connector: { type: 'webhook_relay', auth: 'either' },
        authFields: [],
        mapping: { mode: 'auto' },
        rateLimits: { perMinute: 120 },
        errorMapping: [],
        setupInstructions: SETUP,
        testPayloads: [
          {
            name: 'Sample lead',
            payload: {
              id: 'sample-1',
              name: 'Asha Verma',
              phone: '+919876543210',
              message: 'Interested, please call',
            },
          },
        ],
      };
    case 'push':
      return {
        ...head,
        connector: {
          type: 'push',
          auth: { scheme: 'header_token', header: 'X-Portal-Key', credentialField: 'portalKey' },
        },
        authFields: [
          {
            key: 'portalKey',
            label: 'Portal key',
            kind: 'secret',
            required: true,
            help: 'Where the customer finds the key in the portal.',
          },
        ],
        mapping: {
          mode: 'explicit',
          itemsPath: 'queries',
          externalId: { from: 'query.id' },
          receivedAt: { from: 'query.time' },
          fields: [
            { to: 'name', from: 'query.sender_name', required: true },
            { to: 'phone', from: 'query.sender_mobile', transform: ['phone'], required: true },
            { to: 'email', from: 'query.sender_email', transform: ['trim', 'lower'] },
            { to: 'message', from: 'query.message' },
          ],
          attribution: { platform: { const: 'my-portal' }, campaign: { from: 'query.campaign' } },
        },
        rateLimits: { perMinute: 120 },
        errorMapping: [],
        setupInstructions: [
          ...SETUP,
          {
            title: 'Paste the key',
            body: 'Enter the portal key above. The portal sends it with every lead.',
          },
        ],
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
                  },
                },
              ],
            },
          },
        ],
      };
    case 'pull':
      return {
        ...head,
        connector: {
          type: 'pull',
          request: {
            method: 'GET',
            baseUrl: 'https://api.example.com',
            path: '/v1/leads',
            query: { since: '{{since_iso}}' },
            headers: { 'X-Api-Key': '{{cred.apiKey}}' },
          },
          response: { itemsPath: 'data' },
          cursor: { from: 'id' },
          pollIntervalSeconds: 300,
          maxItemsPerPoll: 100,
        },
        authFields: [{ key: 'apiKey', label: 'API key', kind: 'secret', required: true }],
        mapping: {
          mode: 'explicit',
          externalId: { from: 'id' },
          fields: [
            { to: 'name', from: 'name', required: true },
            { to: 'phone', from: 'mobile', transform: ['phone'], required: true },
          ],
        },
        rateLimits: { perMinute: 60 },
        errorMapping: [
          {
            status: 401,
            code: 'bad_key',
            message: 'The portal refused the key.',
            retry: false,
            health: 'needs_reauth',
          },
        ],
        setupInstructions: [{ title: 'Paste the key', body: 'Enter the API key from the portal.' }],
        testPayloads: [
          { name: 'One lead', payload: { id: 'l-1', name: 'Ravi', mobile: '98765 43210' } },
        ],
      };
    case 'oauth':
      return {
        ...head,
        connector: {
          type: 'oauth',
          authorizeUrl: 'https://auth.example.com/authorize',
          tokenUrl: 'https://auth.example.com/token',
          scopes: ['leads.read'],
          pkce: true,
          clientSettingKey: 'exampleOauth',
        },
        authFields: [],
        mapping: { mode: 'auto' },
        rateLimits: { perMinute: 60 },
        errorMapping: [],
        setupInstructions: [{ title: 'Sign in', body: 'Sign in to the service to connect it.' }],
        testPayloads: [],
      };
    case 'email_parse':
      return {
        ...head,
        connector: {
          type: 'email_parse',
          senders: ['alerts@example.com'],
          subjectContains: 'New enquiry',
          rules: [
            { to: 'name', pattern: 'Name:\\s*(.+)', required: true },
            { to: 'phone', pattern: 'Phone:\\s*(\\+?[0-9 ]+)', required: true },
          ],
        },
        authFields: [],
        mapping: { mode: 'auto' },
        rateLimits: { perMinute: 60 },
        errorMapping: [],
        setupInstructions: [
          {
            title: 'Forward alerts',
            body: 'Forward the alert emails to the address shown after you install.',
          },
        ],
        testPayloads: [],
      };
  }
}

export interface StarterDocs {
  manifestText: string;
  /** Empty for a mini app. */
  recipeText: string;
}

/** A manifest and (for an integration) the recipe that goes with it, as editor text. */
export function starterDocs(template: StarterTemplate, o: StarterOptions = {}): StarterDocs {
  return {
    manifestText: prettyJson(starterManifest(template, o)),
    recipeText: template === 'mini_app' ? '' : prettyJson(starterRecipe(template, o)),
  };
}

/**
 * A recipe starter that already agrees with the manifest typed beside it: same id, category and connector type (webhook relay when the
 * manifest names none yet). Text that is not a JSON object leaves the placeholders.
 */
export function recipeStarterFor(manifestText: string): string {
  const parsed = parseJsonText(manifestText);
  const m =
    parsed.ok &&
    typeof parsed.value === 'object' &&
    parsed.value !== null &&
    !Array.isArray(parsed.value)
      ? (parsed.value as Record<string, unknown>)
      : {};
  const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  const connector =
    typeof m.connector === 'object' && m.connector !== null
      ? text((m.connector as Record<string, unknown>).type)
      : undefined;
  const type = (CONNECTOR_TYPES as readonly string[]).includes(connector ?? '')
    ? (connector as ConnectorKind)
    : 'webhook_relay';
  return prettyJson(
    starterRecipe(type, { slug: text(m.id), name: text(m.name), category: text(m.category) }),
  );
}
