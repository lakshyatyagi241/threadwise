import { describe, expect, it } from 'vitest';
import { marketListingSchema } from '@crm/contracts';
import {
  ConnectorRegistry,
  PullConnector,
  PushConnector,
  WebhookRelayConnector,
  mapDelivery,
  recipeUrls,
} from '../../../src/infra/providers/marketplace';
import {
  EmailParseConnector,
  OAuthConnector,
} from '../../../src/infra/providers/marketplace/framework.connectors';
import { portalSql, seededPortal, seededPortals } from './portal-seed';

const registry = new ConnectorRegistry(
  new OAuthConnector(),
  new PushConnector(),
  new PullConnector(),
  new EmailParseConnector(),
  new WebhookRelayConnector(),
);

const SLUGS = [
  'indiamart',
  'justdial',
  'acres99',
  'magicbricks',
  'housing-com',
  'shiksha',
  'sulekha',
  'tradeindia',
];

describe('the Indian lead portals seed', () => {
  const portals = seededPortals();

  it('has exactly the eight portals the research supports, each a valid manifest, recipe and listing that agree with each other', () => {
    expect(portals.map((p) => p.slug).sort()).toEqual([...SLUGS].sort());
    for (const p of portals) {
      expect(p.manifest.kind).toBe('integration');
      expect(p.manifest.category).toBe('lead-sources');
      expect(p.manifest.scopes).toEqual(['leads.write']);
      expect(p.recipe.key).toBe(p.manifest.id);
      expect(p.recipe.category).toBe(p.manifest.category);
      expect(p.recipe.connector.type).toBe(p.manifest.connector!.type);
      expect(marketListingSchema.safeParse(p.listing).success, p.slug).toBe(true);
      // Publishable: its connector type works end to end.
      expect(registry.isImplemented(p.recipe.connector.type), p.slug).toBe(true);
      // Its own checks (the ones the operator API runs when a version is saved).
      expect(registry.get(p.recipe.connector.type).checkRecipe(p.recipe), p.slug).toEqual([]);
    }
  });

  it('builds nothing the research did not find a way to build', () => {
    const sql = portalSql();
    for (const none of ['collegedunia', 'nobroker', 'quikr', 'cardekho', 'naukri']) {
      expect(sql.toLowerCase(), none).not.toContain(`'${none}'`);
    }
    // No email parsing (the Email channel does not exist) and no OAuth.
    for (const p of portals) expect(['push', 'pull']).toContain(p.recipe.connector.type);
    // Never a portal username or password.
    for (const p of portals) {
      for (const f of p.recipe.authFields) {
        expect(`${f.key} ${f.label}`.toLowerCase(), `${p.slug}.${f.key}`).not.toMatch(
          /user ?name|password|passwd|login/,
        );
      }
    }
    expect(seededPortal('acres99').listing.longDescription).toContain(
      'never ask for your 99acres username or password',
    );
  });

  it("every address a pull recipe calls is the portal's own, https, on its default port", () => {
    const hosts: Record<string, string> = {
      indiamart: 'mapi.indiamart.com',
      'housing-com': 'leads.housing.com',
      tradeindia: 'www.tradeindia.com',
    };
    for (const [slug, host] of Object.entries(hosts)) {
      const urls = recipeUrls(seededPortal(slug).recipe);
      expect(urls, slug).toHaveLength(1);
      const u = new URL(urls[0]!);
      expect(u.protocol).toBe('https:');
      expect(u.hostname).toBe(host);
      expect(u.port).toBe('');
    }
  });

  it("says plainly how far each can be trusted: IndiaMART stable, TradeIndia beta, the rest need the portal's own team", () => {
    const maturity = (slug: string) => seededPortal(slug).listing.maturity;
    expect(maturity('indiamart')).toBe('stable');
    expect(maturity('tradeindia')).toBe('beta');
    for (const slug of ['justdial', 'acres99', 'magicbricks', 'shiksha', 'sulekha', 'housing-com'])
      expect(maturity(slug), slug).toBe('needs_portal_setup');
    for (const p of portals) {
      const notice = p.listing.notice as string;
      expect(notice.length, p.slug).toBeGreaterThan(40);
    }
    for (const slug of ['justdial', 'acres99', 'magicbricks', 'shiksha', 'sulekha']) {
      expect(seededPortal(slug).listing.notice as string, slug).toMatch(/account manager/);
    }
  });

  it("the push portals set up by the portal's team: the secret is in the address, nothing to paste, every sample says the fields are proposed", () => {
    for (const slug of ['justdial', 'acres99', 'magicbricks', 'shiksha', 'sulekha']) {
      const { recipe } = seededPortal(slug);
      expect(recipe.connector).toMatchObject({
        type: 'push',
        auth: { scheme: 'path_token' },
        delivery: { mode: 'async' },
      });
      expect(recipe.authFields).toEqual([]);
      expect(recipe.mapping.mode, slug).toBe('auto');
      const text = recipe.setupInstructions.map((s) => `${s.title} ${s.body}`).join(' ');
      expect(text, slug).toMatch(/account manager/);
      expect(text, slug).toMatch(/sample/i);
      expect(text, slug).toMatch(/private (web )?address/);
      expect(recipe.testPayloads[0]!.name).toContain('proposed');
    }
  });

  it('JustDial is delivered with GET and a query string, as the integrators document; the others take what their senders are known to', () => {
    expect(seededPortal('justdial').recipe.connector).toMatchObject({
      delivery: { methods: ['GET', 'POST'], formats: ['query', 'form', 'json'] },
    });
    expect(seededPortal('acres99').recipe.connector).toMatchObject({
      delivery: { formats: ['json', 'form', 'xml'] },
    });
    expect(seededPortal('shiksha').recipe.connector).toMatchObject({
      delivery: { methods: ['POST'] },
    });
    expect(
      seededPortal('justdial')
        .recipe.setupInstructions.map((s) => s.body)
        .join(' '),
    ).toMatch(/GET/);
  });

  it("IndiaMART: push and pull on one listing, with IndiaMART's documented limits and warnings", () => {
    const { recipe } = seededPortal('indiamart');
    const c = recipe.connector;
    if (c.type !== 'pull') throw new Error('indiamart is a pull recipe');
    expect(c.request.baseUrl).toBe('https://mapi.indiamart.com');
    expect(c.request.path).toBe('/wservce/crm/crmListing/v2/');
    expect(c.request.query).toEqual({
      glusr_crm_key: '{{cred.crmKey}}',
      start_time: '{{window_start}}',
      end_time: '{{window_end}}',
    });
    // Documented limits: 7-day window (6 days used), 5 minutes between calls, 5 calls a minute, 365 days of history, IST.
    expect(c.window).toMatchObject({
      maxSeconds: 518_400,
      utcOffsetMinutes: 330,
      maxLookbackSeconds: 31_536_000,
      format: 'DD-MM-YYYYHH:mm:ss',
    });
    expect(c.window!.maxSeconds).toBeLessThanOrEqual(7 * 86_400);
    expect(c.limits).toEqual({ minIntervalSeconds: 300, requestsPerMinute: 5 });
    expect(c.pollIntervalSeconds).toBeGreaterThanOrEqual(600);
    expect(c.pollIntervalSeconds).toBeLessThanOrEqual(900);
    expect(c.response).toMatchObject({
      itemsPath: 'RESPONSE',
      statusPath: 'CODE',
      emptyStatuses: [204],
    });
    expect(c.push).toEqual({ delivery: { methods: ['POST'], formats: ['json'], mode: 'async' } });
    // The 15 minute block is honoured.
    expect(recipe.errorMapping.find((e) => e.code === 'key_blocked')).toMatchObject({
      status: 429,
      retry: true,
      retryAfterSeconds: 900,
    });
    expect(recipe.errorMapping.find((e) => e.code === 'key_rejected')).toMatchObject({
      status: 401,
      retry: false,
      health: 'needs_reauth',
    });
    // The secret, and the warnings a customer needs, are in plain words.
    expect(recipe.authFields).toEqual([
      expect.objectContaining({ key: 'crmKey', kind: 'secret', required: true }),
    ]);
    const text = recipe.setupInstructions.map((s) => `${s.title} ${s.body}`).join(' ');
    expect(text).toMatch(/48 hours/);
    expect(text).toMatch(/Push API/);
    expect(text).toMatch(/OTP/);
    expect(text).toMatch(/generating a new key/i);
    expect(text).toMatch(/7 days/);
  });

  it('Housing.com: signed, a derived lead id, epoch windows; TradeIndia: three keys and an honest beta', () => {
    const h = seededPortal('housing-com').recipe;
    expect(h.connector).toMatchObject({
      type: 'pull',
      request: {
        sign: {
          algorithm: 'hmac_sha256',
          keyField: 'secretKey',
          timestampParam: 'current_time',
          signatureParam: 'hash',
        },
      },
      window: { format: 'epoch' },
    });
    expect(h.mapping).toMatchObject({ mode: 'explicit', externalIdDerive: { prefix: 'hs' } });
    expect(h.authFields.map((f) => [f.key, f.kind])).toEqual([
      ['housingId', 'text'],
      ['secretKey', 'secret'],
    ]);
    const t = seededPortal('tradeindia').recipe;
    expect(t.authFields.map((f) => f.key)).toEqual(['userId', 'profileId', 'apiKey']);
    expect(t.authFields.find((f) => f.key === 'apiKey')!.kind).toBe('secret');
    expect(seededPortal('tradeindia').listing.notice).toMatch(/Beta/);
    expect(t.setupInstructions.map((s) => s.body).join(' ')).toMatch(/send support/);
  });

  it('every sample payload maps to a lead through its own recipe, with the right label', () => {
    for (const p of portals) {
      expect(p.recipe.testPayloads.length, p.slug).toBeGreaterThan(0);
      for (const sample of p.recipe.testPayloads) {
        const out = mapDelivery(p.recipe, sample.payload);
        expect(out.rejected, `${p.slug}/${sample.name}`).toEqual([]);
        expect(out.leads.length, `${p.slug}/${sample.name}`).toBeGreaterThan(0);
        for (const lead of out.leads) {
          expect(lead.externalId.length).toBeGreaterThan(0);
          expect(lead.attribution?.platform, p.slug).toBe(
            {
              indiamart: 'indiamart',
              justdial: 'justdial',
              acres99: '99acres',
              magicbricks: 'magicbricks',
              'housing-com': 'housing',
              shiksha: 'shiksha',
              sulekha: 'sulekha',
              tradeindia: 'tradeindia',
            }[p.slug],
          );
        }
      }
    }
  });

  it('the proposed samples read the way the feasibility mapping tables say they should', () => {
    const lead = (slug: string, i = 0) =>
      mapDelivery(seededPortal(slug).recipe, seededPortal(slug).recipe.testPayloads[i]!.payload)
        .leads[0]!;
    expect(lead('justdial')).toMatchObject({
      externalId: 'JD-SAMPLE-1',
      fields: {
        name: 'Meera Nair',
        phone: '+919876543210',
        email: 'meera.nair@example.com',
        category: 'Interior Designers',
        city: 'Kochi',
      },
    });
    expect(lead('justdial').receivedAt).toBeUndefined();
    expect(lead('justdial').fields.received_at_approximate).toBe(true);
    expect(lead('acres99').fields).toMatchObject({
      phone: '+919876543210',
      message: 'Looking for a 3 BHK, please call',
      project_name: 'Sample Residency',
      project_id: 'P-1001',
    });
    expect(lead('magicbricks').fields).toMatchObject({
      name: 'Sneha Iyer',
      phone: '+919876543210',
      message: 'Interested in this flat, please call back',
      project: 'Sample Towers',
      pid: 'MB-5001',
    });
    expect(lead('shiksha').fields).toMatchObject({
      name: 'Rahul Verma',
      course: 'MBA',
      city: 'Delhi',
    });
    expect(lead('sulekha').fields).toMatchObject({
      name: 'Divya Menon',
      message: 'Two day wedding in March',
      service: 'Wedding photographer',
    });
  });

  it('the IndiaMART push sample, and a buyer with no name, map as the feasibility table says', () => {
    const first = mapDelivery(
      seededPortal('indiamart').recipe,
      seededPortal('indiamart').recipe.testPayloads[0]!.payload,
    ).leads[0]!;
    expect(first).toMatchObject({
      externalId: '2000000001',
      // 11:17:14 IST.
      receivedAt: '2026-10-04T05:47:14.000Z',
      fields: {
        name: 'Rohit Sharma',
        phone: '+919876543210',
        email: 'rohit.sharma@example.com',
        subject: 'Requirement for Stainless Steel Pipes',
        company: 'Sharma Fabricators',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411026',
        country: 'IN',
        product: 'Stainless Steel Pipes',
        category: 'Steel Pipes',
        lead_type: 'Direct enquiry',
      },
      attribution: { platform: 'indiamart', campaign: 'Direct enquiry', form: 'Steel Pipes' },
    });
    expect(first.fields.message).toBe(
      'I need 500 pieces of 2 inch pipe.\nPlease send your best price.',
    );
    const call = mapDelivery(
      seededPortal('indiamart').recipe,
      seededPortal('indiamart').recipe.testPayloads[1]!.payload,
    ).leads[0]!;
    expect(call.fields.name).toBeUndefined();
    expect(call.fields.phone).toBe('+919123456780');
    expect(call.fields).toMatchObject({
      lead_type: 'Call (PNS)',
      call_duration: '48',
      receiver_mobile: '+91-9000000000',
    });
  });

  it('the migration only ever publishes an untouched draft, and is written to be run twice', () => {
    const sql = portalSql();
    expect(sql).toContain("a.status = 'draft' AND a.current_version_id IS NULL");
    expect(sql).toContain('ON CONFLICT (slug) DO NOTHING');
    expect(sql).toContain('ON CONFLICT (app_id, version) DO NOTHING');
    expect(sql).toContain('ON COMMIT DROP');
    // Only the version it inserts is ever set published, and the stub it supersedes is retired, never deleted.
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).toMatch(/SET status = 'retired'/);
    expect(sql.match(/status = 'published'/g)!.length).toBeGreaterThanOrEqual(2);
  });
});
