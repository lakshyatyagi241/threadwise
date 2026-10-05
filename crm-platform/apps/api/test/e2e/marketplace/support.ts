import request from 'supertest';
import { expect } from 'vitest';
import type { MarketManifestInput, MarketRecipeInput } from '@crm/contracts';
import { LeadPipelineGateway } from '../../../src/modules/marketplace/lead-pipeline.gateway';
import type { LeadIngestPort, NormalisedLead } from '../../../src/modules/leads/lead-ingest.port';
import type { LeadSourceDirectoryPort } from '../../../src/modules/leads/lead-source-directory.port';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { Api, bearer, type Tenant } from '../contacts-attributes-tags/support';

export { Api, bearer, startHarness, type Harness, type Tenant };

// Recipes in these tests point at made-up public host names: skip the DNS check (development only, never honoured in production).
process.env.MARKETPLACE_ALLOW_PRIVATE_HOSTS = 'true';

/** The stable error code of a problem+json answer. */
export const code = (res: { body: { code?: string } }): string | undefined => res.body.code;

export async function operatorLogin(h: Harness, email = OPERATOR_EMAIL): Promise<string> {
  const res = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/login')
    .send({ email, password: OPERATOR_PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.tokens.accessToken as string;
}

/** The super admin operator, signed in and with two-factor enrolled (the console refuses a super admin without it). */
export async function superOperator(h: Harness): Promise<string> {
  const token = await operatorLogin(h, OPERATOR_EMAIL);
  const setup = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/mfa/setup')
    .set(bearer(token));
  expect(setup.status, JSON.stringify(setup.body)).toBe(201);
  const enabled = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: hotp(base32Decode(setup.body.secret as string), totpStep(Date.now())) });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(201);
  return token;
}

/** The marketplace API as one actor. `mp(token).get('/apps')`. */
export const marketApi = (h: Harness, token: string) => {
  const base = '/v2/marketplace';
  const http = () => request(h.app.getHttpServer());
  return {
    get: (p: string) => http().get(`${base}${p}`).set(bearer(token)),
    post: (p: string, body: unknown = {}) =>
      http()
        .post(`${base}${p}`)
        .set(bearer(token))
        .send(body as object),
    patch: (p: string, body: unknown = {}) =>
      http()
        .patch(`${base}${p}`)
        .set(bearer(token))
        .send(body as object),
    delete: (p: string) => http().delete(`${base}${p}`).set(bearer(token)),
    /** For the routes that require an Idempotency-Key. */
    postKeyed: (p: string, body: unknown = {}) =>
      http()
        .post(`${base}${p}`)
        .set(bearer(token))
        .set('Idempotency-Key', crypto.randomUUID())
        .send(body as object),
  };
};

export const platformApi = (h: Harness, token: string) => {
  const base = '/v2/platform/marketplace';
  const http = () => request(h.app.getHttpServer());
  return {
    get: (p: string) => http().get(`${base}${p}`).set(bearer(token)),
    post: (p: string, body: unknown = {}) =>
      http()
        .post(`${base}${p}`)
        .set(bearer(token))
        .send(body as object),
    put: (p: string, body: unknown = {}) =>
      http()
        .put(`${base}${p}`)
        .set(bearer(token))
        .send(body as object),
    patch: (p: string, body: unknown = {}) =>
      http()
        .patch(`${base}${p}`)
        .set(bearer(token))
        .send(body as object),
    delete: (p: string) => http().delete(`${base}${p}`).set(bearer(token)),
  };
};

/** A recording stand-in for the lead pipeline's two ports. */
export class LeadPipelineStub {
  ingested: Array<{ orgId: number; sourceId: number; lead: NormalisedLead }> = [];
  ensured: Array<{ orgId: number; providerKey: string; externalRef: string; name: string }> = [];
  released: Array<{ orgId: number; externalRef: string }> = [];
  private seen = new Set<string>();
  private sources = new Map<string, number>();
  private nextSource = 9000;

  readonly ingest: LeadIngestPort = {
    ingest: async (orgId, sourceId, lead) => {
      this.ingested.push({ orgId, sourceId, lead });
      const key = `${orgId}:${sourceId}:${lead.externalId}`;
      if (this.seen.has(key)) return { status: 'duplicate' as const };
      this.seen.add(key);
      return { status: 'created' as const };
    },
  };

  readonly directory: LeadSourceDirectoryPort = {
    ensureConnectorSource: async (orgId, input) => {
      this.ensured.push({ orgId, ...input });
      const key = `${orgId}:${input.externalRef}`;
      if (!this.sources.has(key)) this.sources.set(key, this.nextSource++);
      return { sourceId: this.sources.get(key)!, sourceUuid: `src-${key}` };
    },
    releaseConnectorSource: async (orgId, externalRef) => {
      this.released.push({ orgId, externalRef });
      this.sources.delete(`${orgId}:${externalRef}`);
    },
  };

  install(h: Harness): this {
    h.app.get(LeadPipelineGateway).use({ ingest: this.ingest, directory: this.directory });
    return this;
  }

  forOrg(orgId: number) {
    return this.ingested.filter((i) => i.orgId === orgId);
  }
  reset(): void {
    this.ingested = [];
  }
}

export const pipelineDown = (h: Harness) => h.app.get(LeadPipelineGateway).use({ ingest: null });
export const pipelineUp = (h: Harness, stub: LeadPipelineStub) =>
  h.app.get(LeadPipelineGateway).use({ ingest: stub.ingest });

// --- documents ----------------------------------------------------------------------------------------------------------------------

export const miniManifest = (over: Record<string, unknown> = {}): MarketManifestInput =>
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
    support: { website: 'https://example.com/quote' },
    developer: { name: 'Acme Apps' },
    ...over,
  }) as MarketManifestInput;

export const PUSH_RECIPE: MarketRecipeInput = {
  schemaVersion: 1,
  key: 'acme-push',
  name: 'Acme Push',
  category: 'lead-sources',
  connector: {
    type: 'push',
    auth: { scheme: 'header_token', header: 'X-Acme-Key', credentialField: 'portalKey' },
  },
  authFields: [
    {
      key: 'portalKey',
      label: 'Portal key',
      kind: 'secret',
      required: true,
      help: 'Paste the key from the portal.',
    },
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
} as MarketRecipeInput;

export const pushManifest = (over: Record<string, unknown> = {}): MarketManifestInput =>
  ({
    manifestVersion: 1,
    id: 'acme-push',
    name: 'Acme Push',
    kind: 'integration',
    category: 'lead-sources',
    version: '1.0.0',
    description: 'Receive Acme portal enquiries as leads in your workspace.',
    scopes: ['leads.write'],
    pricing: { model: 'free' },
    connector: { type: 'push' },
    ...over,
  }) as MarketManifestInput;

/** Creates a listing, approves its first version and publishes it, as the operators the caller passes. */
export async function publishListing(
  h: Harness,
  tokens: { manage: string; review: string },
  body: {
    manifest: MarketManifestInput;
    recipe?: MarketRecipeInput;
    tagline?: string;
    planFeature?: string | null;
    firstParty?: boolean;
    featured?: boolean;
  },
): Promise<{ id: string; slug: string; versionId: string }> {
  const manage = platformApi(h, tokens.manage);
  const review = platformApi(h, tokens.review);
  const created = await manage.post('/apps', { tagline: 'A short line about the app.', ...body });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const slug = created.body.slug as string;
  const versionId = created.body.versionId as string;
  const approved = await review.post(`/apps/${slug}/versions/${versionId}/approve`, {});
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const published = await review.post(`/apps/${slug}/publish`, {});
  expect(published.status, JSON.stringify(published.body)).toBe(200);
  return { id: created.body.id as string, slug, versionId };
}

/** Adds a version to a listing and publishes it. Returns the publish result. */
export async function publishVersion(
  h: Harness,
  tokens: { manage: string; review: string },
  slug: string,
  body: { manifest: MarketManifestInput; recipe?: MarketRecipeInput; changelog?: string },
) {
  const manage = platformApi(h, tokens.manage);
  const review = platformApi(h, tokens.review);
  const saved = await manage.post(`/apps/${slug}/versions`, { changelog: 'Changes.', ...body });
  expect(saved.status, JSON.stringify(saved.body)).toBe(201);
  const versionId = (saved.body.versions as Array<{ id: string; version: string }>).find(
    (v) => v.version === (body.manifest as { version: string }).version,
  )!.id;
  expect((await review.post(`/apps/${slug}/versions/${versionId}/approve`, {})).status).toBe(200);
  const published = await review.post(`/apps/${slug}/publish`, { versionId });
  expect(published.status, JSON.stringify(published.body)).toBe(200);
  return published.body as {
    app: { publishedVersion: string };
    upgraded: number;
    awaitingConsent: number;
  };
}

/** The path of a hook address (the origin is the test server's own). */
export const hookPath = (url: string): string => new URL(url).pathname;
