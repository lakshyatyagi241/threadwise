import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { marketListingSchema, validateMarketManifest, validateMarketRecipe } from '@crm/contracts';
import {
  EmailParseConnector,
  OAuthConnector,
} from '../../../src/infra/providers/marketplace/framework.connectors';
import {
  ConnectorRegistry,
  PullConnector,
  PushConnector,
  WebhookRelayConnector,
} from '../../../src/infra/providers/marketplace';
import { mapDelivery } from '../../../src/infra/providers/marketplace';

const SQL = readFileSync(
  resolve(__dirname, '../../../../../packages/db/migrations/20261021090300_mkt_seed.sql'),
  'utf8',
);
const blocks = [...SQL.matchAll(/\$j\$(.*?)\$j\$::jsonb/gs)].map(
  (m) => JSON.parse(m[1]!) as Record<string, unknown>,
);

describe('the seeded catalogue', () => {
  const manifest = blocks.find((b) => 'manifestVersion' in b)!;
  const recipe = blocks.find((b) => 'schemaVersion' in b)!;
  const listing = blocks.find((b) => 'longDescription' in b)!;

  it('seeds one published listing: the generic Webhook lead source, as a manifest, a recipe and a listing that all validate', () => {
    expect(blocks).toHaveLength(3);
    const m = validateMarketManifest(manifest);
    expect(m.ok, JSON.stringify(m)).toBe(true);
    const r = validateMarketRecipe(recipe);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(marketListingSchema.safeParse(listing).success).toBe(true);
    if (m.ok && r.ok) {
      expect(m.manifest).toMatchObject({
        id: 'webhook',
        kind: 'integration',
        category: 'lead-sources',
        scopes: ['leads.write'],
        connector: { type: 'webhook_relay' },
      });
      expect(r.recipe.key).toBe(m.manifest.id);
      expect(r.recipe.category).toBe(m.manifest.category);
      expect(r.recipe.connector.type).toBe(m.manifest.connector!.type);
    }
  });

  it('the seeded connector type is one that works end to end, and its own sample maps to a lead', () => {
    const registry = new ConnectorRegistry(
      new OAuthConnector(),
      new PushConnector(),
      new PullConnector(),
      new EmailParseConnector(),
      new WebhookRelayConnector(),
    );
    const r = validateMarketRecipe(recipe);
    if (!r.ok) throw new Error('recipe');
    expect(registry.isImplemented(r.recipe.connector.type)).toBe(true);
    const out = mapDelivery(r.recipe, r.recipe.testPayloads[0]!.payload);
    expect(out.rejected).toEqual([]);
    expect(out.leads[0]).toMatchObject({
      externalId: 'sample-1',
      fields: { name: 'Asha Verma', phone: '+919876543210', email: 'asha@example.com' },
    });
  });

  it('the planned portals are drafts only, and every category of both tabs is seeded', () => {
    for (const portal of [
      'indiamart',
      'justdial',
      'acres99',
      'magicbricks',
      'housing-com',
      'shiksha',
    ]) {
      expect(SQL).toContain(`('${portal}',`);
    }
    // Only the Webhook is ever set to published by this file; the portals are inserted as 'draft'.
    expect(SQL.match(/status = 'published'/g)).toHaveLength(1);
    expect(SQL).toMatch(/SELECT apps\.id, '0\.1\.0', 'draft'/);
    const mini = [
      'sales-tools',
      'contacts-and-data',
      'inbox-and-chat',
      'automation',
      'reporting',
      'booking-and-payments',
      'industry-packs',
      'utilities',
    ];
    const integrations = [
      'lead-sources',
      'ads-and-social',
      'telephony',
      'messaging-and-email',
      'payments',
      'accounting-and-finance',
      'e-commerce',
      'calendar-and-meetings',
      'productivity',
      'marketing',
      'support',
      'automation',
      'developer-tools',
    ];
    for (const slug of mini) expect(SQL).toMatch(new RegExp(`'mini_app',\\s+'${slug}'`));
    for (const slug of integrations) expect(SQL).toMatch(new RegExp(`'integration',\\s+'${slug}'`));
  });
});
