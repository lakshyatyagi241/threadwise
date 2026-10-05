import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  marketAppDetailSchema,
  marketAppListSchema,
  marketHookResultSchema,
  marketInstallationSchema,
  marketInstallResultSchema,
  marketSyncResultSchema,
  type MarketInstallation,
} from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { PullConnector, type FetchLike } from '../../../src/infra/providers/marketplace';
import { InboundSweepService } from '../../../src/modules/marketplace/inbound.worker';
import { PullRunService } from '../../../src/modules/marketplace/pull-run.service';
import { PullStateRepository } from '../../../src/modules/marketplace/pull-state.repository';
import {
  FakeHousing,
  FakeIndiaMart,
  indiaMartTimeOf,
  type IndiaMartLead,
} from '../../unit/marketplace/fake-portals';
import {
  Api,
  code,
  hookPath,
  LeadPipelineStub,
  marketApi,
  pipelineDown,
  pipelineUp,
  publishListing,
  startHarness,
  superOperator,
  type Harness,
  type Tenant,
} from './support';

/**
 * The Indian lead portals end to end: the push door in every format the portals' own teams may use (JSON, a form, XML, GET with a query
 * string, the secret in the address path), the delivery stored first and processed by the worker, the pull engine against fake portals
 * that follow IndiaMART's and Housing.com's own rules (windows, the high-water mark, the minimum interval, the 15 minute penalty, a
 * signed request), "Sync now", and the seeded listings. Nothing here talks to a real portal: every portal is a function.
 */
let h: Harness;
let api: Api;
let stub: LeadPipelineStub;
let superToken = '';
let A: Tenant;
let B: Tenant;
let C: Tenant;
const mp = (t: Tenant | string) => marketApi(h, typeof t === 'string' ? t : t.admin);

const rows = async <T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> => (await h.owner.query(query, params)).rows as T[];

async function until<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false>,
  ms = 20_000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const installOf = async (t: Tenant, id: string): Promise<MarketInstallation> => {
  const res = await mp(t).get(`/installations/${id}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return marketInstallationSchema.parse(res.body);
};

async function install(
  t: Tenant,
  slug: string,
  credentials: Record<string, string> = {},
): Promise<{ installation: MarketInstallation; secret: string | null; hook: string }> {
  const res = await mp(t).post(`/apps/${slug}/install`, {
    acceptedScopes: ['leads.write'],
    credentials,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const out = marketInstallResultSchema.parse(res.body);
  const inbound = out.installation.connection!.inbound;
  const base = inbound ? hookPath(inbound.url) : '';
  // A secret in the path is the last segment of the address; any other secret goes in a header.
  return {
    installation: out.installation,
    secret: out.inboundSecret,
    hook: inbound?.auth === 'path' ? `${base}/${out.inboundSecret}` : base,
  };
}

const http = () => request(h.app.getHttpServer());

interface InboxRow {
  id: string;
  status: string;
  body: string | null;
  error: string | null;
  attempts: number;
  format: string;
  method: string;
  leads_accepted: number;
  leads_duplicate: number;
  leads_rejected: number;
}
const inbox = (orgId: number) =>
  rows<InboxRow>(
    `SELECT id, status, body, error, attempts, format, method, leads_accepted, leads_duplicate, leads_rejected
       FROM marketplace_inbound_events WHERE org_id = $1 ORDER BY id`,
    [orgId],
  );
const settled = (orgId: number, n: number) =>
  until(`${n} stored deliveries to settle`, async () => {
    const all = await inbox(orgId);
    return all.length >= n && all.every((r) => r.status !== 'received' && r.status !== 'processing')
      ? all
      : null;
  });

const numbers = (...v: Array<string | number | null | undefined>) => v.map((x) => Number(x));

const connectionOf = async (installationUuid: string) =>
  (
    await rows<{
      id: string;
      status: string;
      poll_cursor: string | null;
      next_poll_at: Date | null;
      last_poll_at: Date | null;
      last_error: string | null;
      consecutive_failures: number;
      received_count: string;
      accepted_count: string;
      duplicate_count: string;
      failed_count: string;
      poll_window_seconds: number | null;
      last_poll_leads: number | null;
      last_success_at: Date | null;
    }>(
      `SELECT c.id, c.status, c.poll_cursor, c.next_poll_at, c.last_poll_at, c.last_error, c.consecutive_failures, c.received_count,
              c.accepted_count, c.duplicate_count, c.failed_count, c.poll_window_seconds, c.last_poll_leads, c.last_success_at
         FROM marketplace_connections c JOIN workspace_app_installations i ON i.org_id = c.org_id AND i.id = c.installation_id
        WHERE i.uuid = $1`,
      [installationUuid],
    )
  )[0]!;

/** Lets the next poll through: the portal's minimum interval has passed and the schedule says now. */
const makeDue = (connectionId: string) =>
  h.owner.query(
    `UPDATE marketplace_connections SET last_poll_at = now() - interval '1 hour', next_poll_at = now() - interval '1 second' WHERE id = $1`,
    [connectionId],
  );

const pullInternals = () =>
  h.app.get(PullConnector) as unknown as {
    fetchImpl: FetchLike;
    guard: (u: string) => Promise<void>;
  };

beforeAll(async () => {
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/marketplace')).MarketplaceWorkerModule,
    ],
  });
  api = new Api(h);
  stub = new LeadPipelineStub().install(h);
  superToken = await superOperator(h);
  A = await api.signup('portalA');
  B = await api.signup('portalB');
  C = await api.signup('portalC');
  // Every portal below is a function: the address guard has nothing to resolve.
  pullInternals().guard = async () => undefined;
}, 400_000);

afterAll(async () => {
  await h?.stop();
});

// --- the listings ------------------------------------------------------------------------------------------------------------------------

describe('the seeded portal listings', () => {
  it('are published, with a maturity and a notice, and the portals the research found no way to build are not there', async () => {
    const res = await mp(A).get('/apps?kind=integration&category=lead-sources&limit=50');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cards = marketAppListSchema.parse(res.body).data;
    const bySlug = new Map(cards.map((c) => [c.slug, c]));
    for (const slug of [
      'indiamart',
      'justdial',
      'acres99',
      'magicbricks',
      'housing-com',
      'shiksha',
      'sulekha',
      'tradeindia',
      'webhook',
    ]) {
      expect(bySlug.has(slug), slug).toBe(true);
    }
    for (const slug of ['collegedunia', 'nobroker', 'quikr', 'cardekho', 'naukri'])
      expect(bySlug.has(slug), slug).toBe(false);
    expect(bySlug.get('indiamart')).toMatchObject({
      maturity: 'stable',
      connectorType: 'pull',
      version: '1.0.0',
    });
    expect(bySlug.get('tradeindia')).toMatchObject({ maturity: 'beta', connectorType: 'pull' });
    expect(bySlug.get('justdial')).toMatchObject({
      maturity: 'needs_portal_setup',
      connectorType: 'push',
    });
    expect(bySlug.get('housing-com')).toMatchObject({
      maturity: 'needs_portal_setup',
      connectorType: 'pull',
    });
    expect(bySlug.get('webhook')).toMatchObject({ maturity: 'stable' });
    expect(bySlug.get('justdial')!.notice).toMatch(/account manager/);
  });

  it("an app page shows the admin's fields and the setup in plain words, and never an endpoint, a mapping or a secret", async () => {
    const res = await mp(A).get('/apps/indiamart');
    expect(res.status).toBe(200);
    const detail = marketAppDetailSchema.parse(res.body);
    expect(detail.setup!.connectorType).toBe('pull');
    expect(detail.setup!.authFields).toEqual([
      expect.objectContaining({ key: 'crmKey', label: 'CRM key', kind: 'secret', required: true }),
    ]);
    expect(detail.setup!.setupInstructions.map((s) => s.title)).toContain(
      'Turn on real-time delivery (recommended)',
    );
    expect(detail.setup!.hasTestPayload).toBe(true);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('mapi.indiamart.com');
    expect(text).not.toContain('glusr_crm_key');
    expect(text).not.toContain('UNIQUE_QUERY_ID');
    expect(detail.listing.maturity).toBe('stable');
  });

  it('a pull portal cannot be installed without its key', async () => {
    const res = await mp(A).post('/apps/indiamart/install', { acceptedScopes: ['leads.write'] });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('MKT_CREDENTIAL_MISSING');
  });
});

// --- the push door -----------------------------------------------------------------------------------------------------------------------

describe('the push door: formats, the secret in the path, stored first and processed by the worker (JustDial, 99acres, Shiksha)', () => {
  let jd: { installation: MarketInstallation; secret: string | null; hook: string };
  let acres: typeof jd;
  let shiksha: typeof jd;

  it("installing a portal set up by the portal's team needs nothing pasted, and shows the address once: the secret is its last segment", async () => {
    jd = await install(A, 'justdial');
    expect(jd.secret).toMatch(/^mkt_[A-Za-z0-9_-]{40,}$/);
    expect(jd.installation.connection).toMatchObject({
      type: 'push',
      inbound: {
        method: 'GET',
        auth: 'path',
        methods: ['GET', 'POST'],
        formats: ['query', 'form', 'json'],
        delivery: 'async',
        tokenHeader: '',
        signatureHeader: '',
        secretHint: `ends in ${jd.secret!.slice(-4)}`,
      },
    });
    expect(jd.hook).toMatch(/^\/v2\/public\/marketplace\/hooks\/[0-9a-f]{32}\/mkt_/);
    // The secret is not on the page again.
    expect(
      JSON.stringify((await mp(A).get(`/installations/${jd.installation.id}`)).body),
    ).not.toContain(jd.secret!);
    acres = await install(A, 'acres99');
    shiksha = await install(A, 'shiksha');
  });

  it("GET with a query string (how JustDial's sender delivers): answered 200 at once, stored whole, then read and handed to the pipeline", async () => {
    const res = await http().get(
      `${jd.hook}?leadid=JD-1&name=Meera%20Nair&mobile=98765%2043210&email=Meera%40Example.com&category=Interior%20Designers&city=Kochi`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = marketHookResultSchema.parse(res.body);
    expect(body).toMatchObject({ status: 'queued', received: 0, accepted: 0 });
    expect(body.event).toMatch(/^[0-9a-f-]{36}$/);

    const [event] = await settled(A.orgId, 1);
    expect(event).toMatchObject({
      status: 'processed',
      method: 'GET',
      format: 'query',
      leads_accepted: 1,
      leads_duplicate: 0,
    });
    // Once processed the raw copy is gone: it held a person's name and number.
    expect(event!.body).toBeNull();
    const lead = stub.forOrg(A.orgId).find((i) => i.lead.externalId === 'JD-1')!;
    expect(lead.lead.fields).toMatchObject({
      name: 'Meera Nair',
      phone: '+919876543210',
      email: 'meera@example.com',
      category: 'Interior Designers',
      city: 'Kochi',
      received_at_approximate: true,
    });
    expect(lead.lead.attribution).toEqual({ platform: 'justdial' });
    expect(lead.lead.receivedAt).toBeUndefined();
    const conn = await connectionOf(jd.installation.id);
    expect(
      numbers(conn.received_count, conn.accepted_count, conn.duplicate_count, conn.failed_count),
    ).toEqual([1, 1, 0, 0]);
    expect((await installOf(A, jd.installation.id)).health.status).toBe('healthy');
  });

  it('the same lead again is recognised on the connection and not handed over twice (a sender retries)', async () => {
    const before = stub.forOrg(A.orgId).length;
    const res = await http().get(`${jd.hook}?leadid=JD-1&name=Meera%20Nair&mobile=98765%2043210`);
    expect(res.status).toBe(200);
    const all = await settled(A.orgId, 2);
    expect(all[1]).toMatchObject({ status: 'processed', leads_accepted: 0, leads_duplicate: 1 });
    expect(stub.forOrg(A.orgId)).toHaveLength(before);
    expect(Number((await connectionOf(jd.installation.id)).duplicate_count)).toBe(1);
  });

  it('POST as a form (nested keys too) and as JSON', async () => {
    const form = await http()
      .post(jd.hook)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('leadid=JD-2&name=Asha&mobile=9876543211&lead[extra]=nested');
    expect(form.status, JSON.stringify(form.body)).toBe(200);
    const json = await http()
      .post(jd.hook)
      .send({ leadid: 'JD-3', name: 'Ravi', mobile: '9876543212', lead: { city: 'Pune' } });
    expect(json.status, JSON.stringify(json.body)).toBe(200);
    const all = await settled(A.orgId, 4);
    expect(all.slice(2).map((r) => [r.format, r.status])).toEqual([
      ['form', 'processed'],
      ['json', 'processed'],
    ]);
    const ids = stub.forOrg(A.orgId).map((i) => i.lead.externalId);
    expect(ids).toContain('JD-2');
    expect(ids).toContain('JD-3');
    expect(
      stub.forOrg(A.orgId).find((i) => i.lead.externalId === 'JD-2')!.lead.fields,
    ).toMatchObject({ lead_extra: 'nested' });
    expect(
      stub.forOrg(A.orgId).find((i) => i.lead.externalId === 'JD-3')!.lead.fields,
    ).toMatchObject({ lead_city: 'Pune' });
  });

  it('XML where the recipe says so (99acres): read into a lead with the country code joined to the number', async () => {
    const xml =
      '<?xml version="1.0"?><lead><name>Karan Mehta</name><phone>9876543210</phone><country_code>91</country_code><email>Karan@Example.com</email><project_id>P-1001</project_id><project_name>Sample Residency</project_name><remarks>Call after 6 pm</remarks></lead>';
    const res = await http().post(acres.hook).set('Content-Type', 'application/xml').send(xml);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const all = await settled(A.orgId, 5);
    expect(all[4]).toMatchObject({ status: 'processed', format: 'xml' });
    const lead = stub.forOrg(A.orgId).slice(-1)[0]!.lead;
    expect(lead.fields).toMatchObject({
      name: 'Karan Mehta',
      phone: '+919876543210',
      email: 'karan@example.com',
      message: 'Call after 6 pm',
      project_name: 'Sample Residency',
    });
    expect(lead.attribution).toEqual({ platform: '99acres' });
  });

  it('an XML document that declares a DOCTYPE is stored, answered 200, and rejected for good: counted, the body kept for support', async () => {
    const before = Number((await connectionOf(acres.installation.id)).failed_count);
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaa">]><lead><name>&a;&a;&a;</name></lead>';
    const res = await http().post(acres.hook).set('Content-Type', 'text/xml').send(bomb);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const all = await settled(A.orgId, 6);
    expect(all[5]).toMatchObject({ status: 'rejected', format: 'xml', leads_rejected: 1 });
    expect(all[5]!.error).toBe('The body is not valid XML.');
    expect(all[5]!.body).toContain('DOCTYPE');
    expect(Number((await connectionOf(acres.installation.id)).failed_count)).toBe(before + 1);
    expect((await connectionOf(acres.installation.id)).last_error).toMatch(/unreadable/);
  });

  it("the secret is checked in the path: wrong, missing or another connection's is 401, and nothing is stored", async () => {
    const stored = (await inbox(A.orgId)).length;
    const key = hookPath(jd.installation.connection!.inbound!.url);
    for (const path of [
      `${key}/mkt_wrong`,
      key,
      `${hookPath(acres.installation.connection!.inbound!.url)}/${jd.secret}`,
    ]) {
      const res = await http().get(`${path}?leadid=X&name=Z&mobile=9876543210`);
      expect(res.status, path).toBe(401);
      expect(code(res)).toBe('MKT_WEBHOOK_UNAUTHORIZED');
    }
    expect((await inbox(A.orgId)).length).toBe(stored);
    // A header is no substitute for the path secret on a path recipe.
    const viaHeader = await http()
      .get(`${key}?leadid=X&name=Z&mobile=9876543210`)
      .set('x-marketplace-token', jd.secret!);
    expect(viaHeader.status).toBe(401);
  });

  it('a method or a format the recipe does not take is refused before anything is stored (405, 415)', async () => {
    const stored = (await inbox(A.orgId)).length;
    // 99acres takes POST only; Shiksha takes JSON and forms, not XML or multipart.
    const get = await http().get(`${acres.hook}?name=A&phone=9876543210`);
    expect(get.status).toBe(405);
    expect(code(get)).toBe('MKT_WEBHOOK_BAD_PAYLOAD');
    const xml = await http()
      .post(shiksha.hook)
      .set('Content-Type', 'application/xml')
      .send('<lead><name>A</name></lead>');
    expect(xml.status).toBe(415);
    const multi = await http().post(jd.hook).field('leadid', 'JD-9').field('name', 'A');
    expect(multi.status).toBe(415);
    expect((await inbox(A.orgId)).length).toBe(stored);
  });

  it('a request that carries nothing (a portal checking the address answers) is acknowledged and not counted; an oversize one is 413', async () => {
    const stored = (await inbox(A.orgId)).length;
    const failed = Number((await connectionOf(jd.installation.id)).failed_count);
    const ping = await http().get(jd.hook);
    expect(ping.status).toBe(200);
    expect(marketHookResultSchema.parse(ping.body)).toMatchObject({
      status: 'accepted',
      received: 0,
    });
    expect((await inbox(A.orgId)).length).toBe(stored);
    expect(Number((await connectionOf(jd.installation.id)).failed_count)).toBe(failed);
    const big = await http()
      .post(acres.hook)
      .set('Content-Type', 'application/xml')
      .send(`<lead><name>${'x'.repeat(300 * 1024)}</name></lead>`);
    expect(big.status).toBe(413);
    expect(code(big)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('the pipeline being down never reaches the sender: 200, kept, retried from the stored copy, and in the pipeline once it is back', async () => {
    pipelineDown(h);
    try {
      const res = await http().get(`${jd.hook}?leadid=JD-DOWN&name=Late%20Lead&mobile=9876543299`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ev = await until('the delivery to be retried later', async () => {
        const all = await inbox(A.orgId);
        const last = all[all.length - 1]!;
        return last.status === 'failed' ? last : null;
      });
      expect(ev.attempts).toBe(1);
      // The raw copy is still there: nothing is lost.
      expect(ev.body).toContain('JD-DOWN');
      expect(ev.error).toBeTruthy();
    } finally {
      pipelineUp(h, stub);
    }
    await h.owner.query(
      `UPDATE marketplace_inbound_events SET next_attempt_at = now() - interval '1 second' WHERE org_id = $1 AND status = 'failed'`,
      [A.orgId],
    );
    expect(await h.app.get(InboundSweepService, { strict: false }).run()).toBeGreaterThanOrEqual(1);
    await until('the retried delivery to be processed', async () => {
      const all = await inbox(A.orgId);
      return all[all.length - 1]!.status === 'processed' ? all : null;
    });
    expect(stub.forOrg(A.orgId).some((i) => i.lead.externalId === 'JD-DOWN')).toBe(true);
    const last = (await inbox(A.orgId)).slice(-1)[0]!;
    expect(last.attempts).toBe(2);
    expect(last.body).toBeNull();
  });

  it('a delivery stored before the admin paused the connection is not handed over: rejected, body kept', async () => {
    pipelineDown(h);
    try {
      expect(
        (await http().get(`${jd.hook}?leadid=JD-PAUSED&name=P&mobile=9876543277`)).status,
      ).toBe(200);
      await until(
        'the delivery to wait for a retry',
        async () => (await inbox(A.orgId)).slice(-1)[0]!.status === 'failed',
      );
    } finally {
      pipelineUp(h, stub);
    }
    const current = await installOf(A, jd.installation.id);
    const paused = await mp(A).post(`/installations/${jd.installation.id}/disable`, {
      rowVersion: current.rowVersion,
    });
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);
    // A paused connection answers deliveries 409, as before.
    expect((await http().get(`${jd.hook}?leadid=JD-NEW&name=N&mobile=9876543266`)).status).toBe(
      409,
    );
    await h.owner.query(
      `UPDATE marketplace_inbound_events SET next_attempt_at = now() - interval '1 second' WHERE org_id = $1 AND status = 'failed'`,
      [A.orgId],
    );
    await h.app.get(InboundSweepService, { strict: false }).run();
    const last = await until('the paused delivery to be rejected', async () => {
      const r = (await inbox(A.orgId)).slice(-1)[0]!;
      return r.status === 'rejected' ? r : null;
    });
    expect(last.error).toBe('connection_inactive');
    expect(last.body).toContain('JD-PAUSED');
    expect(stub.forOrg(A.orgId).some((i) => i.lead.externalId === 'JD-PAUSED')).toBe(false);
    const fresh = await installOf(A, jd.installation.id);
    expect(
      (
        await mp(A).post(`/installations/${jd.installation.id}/enable`, {
          rowVersion: fresh.rowVersion,
        })
      ).status,
    ).toBe(200);
  });

  it('the connection page lists the leads that arrived, whatever the format', async () => {
    const res = await mp(A).get(`/installations/${jd.installation.id}/events?limit=50`);
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ externalId: string; status: string }>)
      .filter((e) => e.status === 'accepted')
      .map((e) => e.externalId);
    expect(ids).toEqual(expect.arrayContaining(['JD-1', 'JD-2', 'JD-3', 'JD-DOWN']));
  });

  it('the generic Webhook is as it was: JSON in, acknowledged only after the lead reached the pipeline; a form is refused 415 as it takes none', async () => {
    const w = await install(B, 'webhook');
    const secret = w.secret!;
    const ok = await http()
      .post(w.hook)
      .set('x-marketplace-token', secret)
      .send({ id: 'w-1', name: 'Wendy', phone: '9876543210' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(marketHookResultSchema.parse(ok.body)).toMatchObject({
      status: 'accepted',
      received: 1,
      accepted: 1,
    });
    expect(stub.forOrg(B.orgId).map((i) => i.lead.externalId)).toContain('w-1');
    const form = await http()
      .post(w.hook)
      .set('x-marketplace-token', secret)
      .type('form')
      .send({ id: 'w-2', name: 'Wendy' });
    expect(form.status).toBe(415);
    const nothing = await http()
      .post(w.hook)
      .set('x-marketplace-token', secret)
      .set('Content-Type', 'application/json')
      .send('');
    expect(nothing.status).toBe(422);
    expect((await inbox(B.orgId)).length).toBe(0);
    await mp(B).post(`/installations/${w.installation.id}/uninstall`, { dataChoice: 'keep' });
  });
});

// --- IndiaMART: push and pull on one connection -----------------------------------------------------------------------------------------

describe("IndiaMART: real-time push and the scheduled pull on one connection, kept to IndiaMART's limits", () => {
  const KEY = 'gIhfk7cDWoxdqBeFv+sb7kevHW7O1Axy';
  let skewMs = 0;
  const portalClock = () => new Date(Date.now() + skewMs);
  let portal: FakeIndiaMart;
  let im: { installation: MarketInstallation; secret: string | null; hook: string };
  let connectionId = '';
  const imLead = (
    id: string,
    minutesAgo: number,
    over: Partial<IndiaMartLead> = {},
  ): IndiaMartLead => ({
    UNIQUE_QUERY_ID: id,
    QUERY_TYPE: 'W',
    QUERY_TIME: indiaMartTimeOf(new Date(Date.now() - minutesAgo * 60_000)),
    SENDER_NAME: 'Rohit Sharma',
    SENDER_MOBILE: '+91-9876543210',
    SENDER_EMAIL: 'rohit@example.com',
    SENDER_COUNTRY_ISO: 'IN',
    QUERY_MESSAGE: 'Need a quote',
    ...over,
  });
  const runner = () => h.app.get(PullRunService);
  const polls = () => portal.requests.length;

  beforeAll(() => {
    portal = new FakeIndiaMart(KEY, portalClock);
    pullInternals().fetchImpl = (u, i) => portal.fetch(u, i);
  });

  it("installs with the CRM key (sealed, never returned) and shows the address for IndiaMART's Push API once", async () => {
    im = await install(B, 'indiamart', { crmKey: KEY });
    const c = im.installation.connection!;
    expect(c).toMatchObject({
      type: 'pull',
      status: 'active',
      pollIntervalSeconds: 900,
      minSyncIntervalSeconds: 300,
      inbound: {
        auth: 'path',
        methods: ['POST'],
        formats: ['json'],
        delivery: 'async',
        method: 'POST',
      },
    });
    expect(im.secret).toMatch(/^mkt_/);
    expect(im.installation.credentials).toEqual([
      expect.objectContaining({
        key: 'crmKey',
        kind: 'secret',
        isSet: true,
        hint: `ends in ${KEY.slice(-4)}`,
      }),
    ]);
    const stored = await rows<{ credentials_enc: string }>(
      `SELECT credentials_enc FROM workspace_app_installations WHERE uuid = $1`,
      [im.installation.id],
    );
    expect(stored[0]!.credentials_enc).not.toContain(KEY);
    expect(
      JSON.stringify((await mp(B).get(`/installations/${im.installation.id}`)).body),
    ).not.toContain(KEY);
    connectionId = (await connectionOf(im.installation.id)).id;
    // Due at once.
    const db = h.app.get(DatabaseService);
    expect(await db.privileged((tx) => h.app.get(PullStateRepository).due(tx, 100))).toContainEqual(
      { orgId: B.orgId, connectionId: Number(connectionId) },
    );
  });

  it("PUSH: IndiaMART's own payload (a wrapper with one RESPONSE object) is stored, answered 200 and becomes a lead with the time read as IST", async () => {
    const payload = {
      CODE: 200,
      STATUS: 'SUCCESS',
      RESPONSE: {
        UNIQUE_QUERY_ID: 'IM-P1',
        QUERY_TYPE: 'W',
        QUERY_TIME: '2026-10-04 11:17:14',
        SENDER_NAME: 'Rohit Sharma',
        SENDER_MOBILE: '+91-9876543210',
        SENDER_EMAIL: 'Rohit.Sharma@example.com',
        SUBJECT: 'Requirement for Pipes',
        QUERY_MESSAGE: 'Need 500 pcs.\\nBest price please.',
        SENDER_CITY: 'Pune',
        QUERY_PRODUCT_NAME: 'Stainless Steel Pipes',
        QUERY_MCAT_NAME: 'Steel Pipes',
        SENDER_COUNTRY_ISO: 'IN',
      },
    };
    const res = await http().post(im.hook).send(payload);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(marketHookResultSchema.parse(res.body).status).toBe('queued');
    await settled(B.orgId, 1);
    const lead = stub.forOrg(B.orgId).find((i) => i.lead.externalId === 'IM-P1')!;
    expect(lead.lead.receivedAt).toBe('2026-10-04T05:47:14.000Z');
    expect(lead.lead.fields).toMatchObject({
      name: 'Rohit Sharma',
      phone: '+919876543210',
      email: 'rohit.sharma@example.com',
      message: 'Need 500 pcs.\nBest price please.',
      city: 'Pune',
      product: 'Stainless Steel Pipes',
      lead_type: 'Direct enquiry',
    });
    expect(lead.lead.attribution).toEqual({
      platform: 'indiamart',
      campaign: 'Direct enquiry',
      form: 'Steel Pipes',
    });
    // A GET is not how IndiaMART delivers: this address takes POST.
    expect((await http().get(`${im.hook}?UNIQUE_QUERY_ID=x`)).status).toBe(405);
  });

  it('PULL: the first poll asks for the last day, hands over what push has not, and a lead that came by both doors is one lead and is not counted again', async () => {
    portal.leads = [imLead('IM-P1', 20), imLead('IM-L2', 10)];
    const before = stub.forOrg(B.orgId).length;
    const out = await runner().run(B.orgId, Number(connectionId));
    expect(out).toEqual({ status: 'ok', accepted: 1, duplicates: 0, failed: 0 });
    expect(stub.forOrg(B.orgId).length).toBe(before + 1);
    const q = portal.requests[0]!.url.searchParams;
    expect(q.get('glusr_crm_key')).toBe(KEY);
    expect(q.get('start_time')).toMatch(/^\d{2}-\d{2}-\d{4}\d{2}:\d{2}:\d{2}$/);
    const conn = await connectionOf(im.installation.id);
    // Push brought one lead, the poll one more; the repeat of the first is not a delivery.
    expect(numbers(conn.received_count, conn.accepted_count, conn.duplicate_count)).toEqual([
      2, 2, 0,
    ]);
    expect(conn.last_poll_leads).toBe(2);
    expect(conn.status).toBe('active');
    expect(Math.abs(new Date(conn.poll_cursor!).getTime() - Date.now())).toBeLessThan(60_000);
    expect(conn.next_poll_at!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    const view = await installOf(B, im.installation.id);
    expect(view.health.status).toBe('healthy');
    expect(view.connection!.lastSuccessAt).not.toBeNull();
    expect(Math.abs(new Date(view.connection!.syncedThrough!).getTime() - Date.now())).toBeLessThan(
      60_000,
    );
    expect(new Date(view.connection!.nextPollAt!).getTime()).toBeGreaterThan(
      Date.now() + 14 * 60_000,
    );
  });

  it("IndiaMART's five-minute rule is kept here, whoever asks: a poll too soon is not made, and the schedule moves to when it may be", async () => {
    const n = polls();
    const out = await runner().run(B.orgId, Number(connectionId));
    expect(out.status).toBe('skipped');
    expect(polls()).toBe(n);
    const conn = await connectionOf(im.installation.id);
    const waitMs = conn.next_poll_at!.getTime() - conn.last_poll_at!.getTime();
    expect(waitMs).toBeGreaterThanOrEqual(299_000);
  });

  it('the next poll starts the overlap before where the last one ended, and takes the lead that is new', async () => {
    skewMs += 20 * 60_000;
    portal.leads.push(imLead('IM-L3', 5));
    const conn = await connectionOf(im.installation.id);
    const cursor = new Date(conn.poll_cursor!);
    await makeDue(connectionId);
    const out = await runner().run(B.orgId, Number(connectionId));
    expect(out).toEqual({ status: 'ok', accepted: 1, duplicates: 0, failed: 0 });
    const q = portal.requests[polls() - 1]!.url.searchParams;
    // start_time is DD-MM-YYYYHH:mm:ss in IST: the mark less 30 minutes.
    const startIst = q.get('start_time')!;
    const start =
      Date.UTC(
        +startIst.slice(6, 10),
        +startIst.slice(3, 5) - 1,
        +startIst.slice(0, 2),
        +startIst.slice(10, 12),
        +startIst.slice(13, 15),
        +startIst.slice(16, 18),
      ) -
      330 * 60_000;
    expect(Math.abs(start - (cursor.getTime() - 30 * 60_000))).toBeLessThanOrEqual(1000);
    expect(stub.forOrg(B.orgId).map((i) => i.lead.externalId)).toContain('IM-L3');
  });

  it('a key IndiaMART refuses stops the connection and says why; new credentials start it again at once', async () => {
    skewMs += 20 * 60_000;
    portal.expired = true;
    await makeDue(connectionId);
    const out = await runner().run(B.orgId, Number(connectionId));
    expect(out.status).toBe('failed');
    const stopped = await connectionOf(im.installation.id);
    expect(stopped.status).toBe('error');
    expect(stopped.last_error).toMatch(/expired because it was not used for 7 days/);
    const view = await installOf(B, im.installation.id);
    expect(view.health).toMatchObject({ status: 'needs_reauth' });
    expect(view.health.lastError).toMatch(/expired/);
    const db = h.app.get(DatabaseService);
    expect(
      await db.privileged((tx) => h.app.get(PullStateRepository).due(tx, 100)),
    ).not.toContainEqual({ orgId: B.orgId, connectionId: Number(connectionId) });
    // The push address keeps working while the key is stale.
    const stored = (await inbox(B.orgId)).length;
    expect(
      (
        await http()
          .post(im.hook)
          .send({
            CODE: 200,
            STATUS: 'SUCCESS',
            RESPONSE: {
              UNIQUE_QUERY_ID: 'IM-P2',
              QUERY_TIME: '2026-10-04 12:00:00',
              SENDER_NAME: 'Priya',
              SENDER_MOBILE: '+91-9811111111',
              SENDER_COUNTRY_ISO: 'IN',
            },
          })
      ).status,
    ).toBe(200);
    await settled(B.orgId, stored + 1);
    expect(stub.forOrg(B.orgId).map((i) => i.lead.externalId)).toContain('IM-P2');
    // A lead that arrived by push says nothing about the key: the connection stays stopped and unhealthy, with its error.
    expect((await connectionOf(im.installation.id)).status).toBe('error');
    expect((await installOf(B, im.installation.id)).health.status).toBe('needs_reauth');
    expect((await connectionOf(im.installation.id)).last_error).toMatch(/expired/);

    portal.expired = false;
    const patched = await mp(B).patch(`/installations/${im.installation.id}`, {
      rowVersion: view.rowVersion,
      credentials: { crmKey: KEY },
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const restarted = await connectionOf(im.installation.id);
    expect(restarted.status).toBe('active');
    expect(restarted.consecutive_failures).toBe(0);
    // The five-minute rule still holds: the failed poll was a request, so the next one waits for the minimum interval after it.
    expect(restarted.next_poll_at!.getTime() - Date.now()).toBeGreaterThan(240_000);
    expect(restarted.next_poll_at!.getTime() - Date.now()).toBeLessThanOrEqual(305_000);
    expect((await installOf(B, im.installation.id)).health.status).toBe('unknown');
    await makeDue(connectionId);
    expect((await runner().run(B.orgId, Number(connectionId))).status).toBe('ok');
    expect((await installOf(B, im.installation.id)).health.status).toBe('healthy');
  });

  it("IndiaMART's 15 minute block is waited out, not retried into; an outage backs off; both keep the connection active", async () => {
    skewMs += 20 * 60_000;
    portal.blockFor(15 * 60_000);
    await makeDue(connectionId);
    expect((await runner().run(B.orgId, Number(connectionId))).status).toBe('failed');
    const blocked = await connectionOf(im.installation.id);
    expect(blocked.status).toBe('active');
    expect(blocked.last_error).toMatch(/blocked the CRM key for 15 minutes/);
    expect(blocked.next_poll_at!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect((await installOf(B, im.installation.id)).health.status).toBe('degraded');

    skewMs += 20 * 60_000;
    portal.down = true;
    await makeDue(connectionId);
    expect((await runner().run(B.orgId, Number(connectionId))).status).toBe('failed');
    const down = await connectionOf(im.installation.id);
    expect(down.status).toBe('active');
    expect(down.consecutive_failures).toBe(2);
    // The interval doubled for the second failure in a row.
    expect(down.next_poll_at!.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);

    skewMs += 20 * 60_000;
    portal.down = false;
    await makeDue(connectionId);
    expect((await runner().run(B.orgId, Number(connectionId))).status).toBe('ok');
    const back = await connectionOf(im.installation.id);
    expect([back.status, back.consecutive_failures, back.last_error]).toEqual(['active', 0, null]);
    expect((await installOf(B, im.installation.id)).health.status).toBe('healthy');
  });

  it('Sync now brings the poll forward, never faster than IndiaMART allows, and the worker runs it', async () => {
    skewMs += 20 * 60_000;
    // Polled a moment ago: it may not run before the five minutes are up.
    await h.owner.query(
      `UPDATE marketplace_connections SET last_poll_at = now() - interval '1 minute', next_poll_at = now() + interval '10 minutes' WHERE id = $1`,
      [connectionId],
    );
    const soon = await mp(B).post(`/installations/${im.installation.id}/sync`);
    expect(soon.status, JSON.stringify(soon.body)).toBe(200);
    const early = marketSyncResultSchema.parse(soon.body);
    expect(early).toMatchObject({ status: 'scheduled', minIntervalSeconds: 300 });
    const wait = new Date(early.runAt).getTime() - Date.now();
    expect(wait).toBeGreaterThan(3 * 60_000);
    expect(wait).toBeLessThanOrEqual(4 * 60_000 + 5000);

    // Long enough ago: it runs at once, through the real queue.
    await h.owner.query(
      `UPDATE marketplace_connections SET last_poll_at = now() - interval '1 hour', next_poll_at = now() + interval '10 minutes' WHERE id = $1`,
      [connectionId],
    );
    const n = polls();
    const now = await mp(B).post(`/installations/${im.installation.id}/sync`);
    expect(now.status).toBe(200);
    expect(new Date(marketSyncResultSchema.parse(now.body).runAt).getTime()).toBeLessThanOrEqual(
      Date.now() + 2000,
    );
    await until('the worker to poll', async () => polls() > n);
    await until('the poll to be recorded', async () =>
      (await connectionOf(im.installation.id)).last_poll_at!.getTime() > Date.now() - 20_000
        ? true
        : null,
    );
  });

  it('Sync now is refused for what has nothing to sync, for a paused installation, and without the permission', async () => {
    const jd = await install(C, 'justdial');
    const noPull = await mp(C).post(`/installations/${jd.installation.id}/sync`);
    expect(noPull.status).toBe(409);
    expect(code(noPull)).toBe('MKT_NO_CONNECTION');
    const reader = await api.member(B, 'reader', [['market.apps.read']]);
    const denied = await mp(reader.token).post(`/installations/${im.installation.id}/sync`);
    expect(denied.status).toBe(403);
    const view = await installOf(B, im.installation.id);
    expect(
      (
        await mp(B).post(`/installations/${im.installation.id}/disable`, {
          rowVersion: view.rowVersion,
        })
      ).status,
    ).toBe(200);
    const paused = await mp(B).post(`/installations/${im.installation.id}/sync`);
    expect(paused.status).toBe(409);
    expect(code(paused)).toBe('MKT_INSTALLATION_DISABLED');
    const fresh = await installOf(B, im.installation.id);
    expect(
      (
        await mp(B).post(`/installations/${im.installation.id}/enable`, {
          rowVersion: fresh.rowVersion,
        })
      ).status,
    ).toBe(200);
    expect(
      (await http().get(`/v2/marketplace/installations/${im.installation.id}/sync`)).status,
    ).toBe(404);
    await mp(C).post(`/installations/${jd.installation.id}/uninstall`, { dataChoice: 'keep' });
  });

  it('uninstalling removes the address and the stored deliveries at once', async () => {
    const before = (await inbox(B.orgId)).length;
    expect(before).toBeGreaterThan(0);
    const res = await mp(B).post(`/installations/${im.installation.id}/uninstall`, {
      dataChoice: 'delete',
    });
    expect(res.status).toBe(204);
    expect((await inbox(B.orgId)).length).toBe(0);
    expect((await http().post(im.hook).send({ CODE: 200 })).status).toBe(404);
  });
});

// --- Housing.com --------------------------------------------------------------------------------------------------------------------------

describe('Housing.com: a signed pull with a derived lead id', () => {
  let portal: FakeHousing;
  let hs: { installation: MarketInstallation; secret: string | null; hook: string };
  let connectionId = '';
  const lead = (minutesAgo: number, over: Record<string, unknown> = {}) => ({
    lead_name: 'Anita Rao',
    lead_phone: '9876543210',
    lead_email: 'anita@example.com',
    project_id: 1233,
    project_name: 'Sample Heights',
    locality: 'Powai',
    lead_date: String(Math.floor((Date.now() - minutesAgo * 60_000) / 1000)),
    ...over,
  });

  it('installs with the ID (shown) and the secret key (sealed), has no public address, and its first poll is signed as Housing.com requires', async () => {
    hs = await install(C, 'housing-com', { housingId: '4544', secretKey: 'K-secret-key-9' });
    expect(hs.secret).toBeNull();
    expect(hs.installation.connection!.inbound).toBeNull();
    expect(hs.installation.credentials).toEqual([
      expect.objectContaining({ key: 'housingId', kind: 'text', isSet: true, hint: '4544' }),
      expect.objectContaining({
        key: 'secretKey',
        kind: 'secret',
        isSet: true,
        hint: 'ends in ey-9',
      }),
    ]);
    portal = new FakeHousing('4544', 'K-secret-key-9', () => new Date());
    portal.leads = [lead(30), lead(20, { lead_phone: '+91 91234 56780', lead_name: 'Vikram' })];
    pullInternals().fetchImpl = (u, i) => portal.fetch(u, i);
    connectionId = (await connectionOf(hs.installation.id)).id;
    const out = await h.app.get(PullRunService).run(C.orgId, Number(connectionId));
    expect(out).toEqual({ status: 'ok', accepted: 2, duplicates: 0, failed: 0 });
    const ids = stub.forOrg(C.orgId).map((i) => i.lead.externalId);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(/^hs-[0-9a-f]{32}$/);
    const first = stub.forOrg(C.orgId)[0]!.lead;
    expect(first.fields).toMatchObject({
      name: 'Anita Rao',
      phone: '+919876543210',
      product: 'Sample Heights',
      locality: 'Powai',
    });
    expect(first.attribution).toEqual({ platform: 'housing', form: '1233' });
    expect(first.receivedAt).toBeTruthy();
  });

  it('the overlap fetches the same leads again; the derived id recognises them, they are not delivered or counted again, and a new one is', async () => {
    portal.leads.push(lead(2, { lead_name: 'Nikhil', lead_phone: '9000000001' }));
    await makeDue(connectionId);
    const before = stub.forOrg(C.orgId).length;
    const out = await h.app.get(PullRunService).run(C.orgId, Number(connectionId));
    expect(out).toEqual({ status: 'ok', accepted: 1, duplicates: 0, failed: 0 });
    expect(stub.forOrg(C.orgId).length).toBe(before + 1);
    const conn = await connectionOf(hs.installation.id);
    expect(numbers(conn.received_count, conn.accepted_count, conn.duplicate_count)).toEqual([
      3, 3, 0,
    ]);
    expect(conn.last_poll_leads).toBe(3);
  });

  it("a wrong secret key stops the connection with Housing.com's own reason", async () => {
    portal.leads = [];
    const view = await installOf(C, hs.installation.id);
    expect(
      (
        await mp(C).patch(`/installations/${hs.installation.id}`, {
          rowVersion: view.rowVersion,
          credentials: { secretKey: 'wrong-key-0000' },
        })
      ).status,
    ).toBe(200);
    await makeDue(connectionId);
    expect((await h.app.get(PullRunService).run(C.orgId, Number(connectionId))).status).toBe(
      'failed',
    );
    const conn = await connectionOf(hs.installation.id);
    expect(conn.status).toBe('error');
    expect(conn.last_error).toMatch(/Housing.com refused the request/);
    expect((await installOf(C, hs.installation.id)).health.status).toBe('needs_reauth');
  });
});

// --- a window that holds more than one answer carries -------------------------------------------------------------------------------

describe('a poll window that holds more leads than one answer carries', () => {
  const recipe = {
    schemaVersion: 1,
    key: 'window-portal',
    name: 'Window Portal',
    category: 'lead-sources',
    connector: {
      type: 'pull',
      request: {
        method: 'GET',
        baseUrl: 'https://api.window-portal-example.com',
        path: '/leads',
        query: { from: '{{window_start}}', to: '{{window_end}}', k: '{{cred.key}}' },
      },
      response: { itemsPath: 'items' },
      window: {
        format: 'epoch',
        utcOffsetMinutes: 0,
        maxSeconds: 7200,
        overlapSeconds: 0,
        initialLookbackSeconds: 7200,
      },
      pollIntervalSeconds: 300,
      limits: { minIntervalSeconds: 60, requestsPerMinute: 60 },
      maxItemsPerPoll: 2,
    },
    authFields: [{ key: 'key', label: 'Key', kind: 'secret', required: true }],
    mapping: {
      mode: 'explicit',
      externalId: { from: 'id' },
      fields: [
        { to: 'name', from: 'name', required: true },
        { to: 'phone', from: 'phone', transform: ['phone'] },
      ],
    },
  };
  const manifest = {
    manifestVersion: 1,
    id: 'window-portal',
    name: 'Window Portal',
    kind: 'integration',
    category: 'lead-sources',
    version: '1.0.0',
    description: 'A made-up portal that answers a time range, for the test.',
    scopes: ['leads.write'],
    connector: { type: 'pull' },
  };
  const requests: URL[] = [];

  it('is asked again in halves: nothing is handed over until it fits, then the window grows back and every lead arrives once', async () => {
    // A recipe published through the operator API: the pull type is publishable now.
    await publishListing(
      h,
      { manage: superToken, review: superToken },
      { manifest: manifest as never, recipe: recipe as never },
    );
    const now = Date.now();
    const at = (minutes: number) => Math.floor((now - minutes * 60_000) / 1000);
    const items = [
      { id: 'W1', name: 'First', phone: '9876543201', t: at(100) },
      { id: 'W2', name: 'Second', phone: '9876543202', t: at(50) },
      { id: 'W3', name: 'Third', phone: '9876543203', t: at(10) },
    ];
    pullInternals().fetchImpl = async (url) => {
      const u = new URL(url);
      requests.push(u);
      const from = Number(u.searchParams.get('from'));
      const to = Number(u.searchParams.get('to'));
      return {
        status: 200,
        text: async () => JSON.stringify({ items: items.filter((i) => i.t >= from && i.t <= to) }),
      };
    };
    const w = await install(A, 'window-portal', { key: 'window-key-1' });
    const id = (await connectionOf(w.installation.id)).id;
    const run = () => h.app.get(PullRunService).run(A.orgId, Number(id));
    const before = stub.forOrg(A.orgId).length;

    // 2 hours holds three leads, the answer carries two: nothing handed over, the window halves, the mark does not move.
    expect(await run()).toEqual({ status: 'retry', accepted: 0, duplicates: 0, failed: 0 });
    let conn = await connectionOf(w.installation.id);
    expect(conn.poll_window_seconds).toBe(3600);
    expect(conn.poll_cursor).toBeNull();
    expect(stub.forOrg(A.orgId).length).toBe(before);
    expect(
      Number(requests[0]!.searchParams.get('to')) - Number(requests[0]!.searchParams.get('from')),
    ).toBe(7200);

    // The first hour holds one lead: it fits, the mark moves to the end of the window, the window is back to its own width, and the poll is
    // scheduled soon because time is left to cover.
    await makeDue(id);
    expect(await run()).toEqual({ status: 'ok', accepted: 1, duplicates: 0, failed: 0 });
    conn = await connectionOf(w.installation.id);
    expect(conn.poll_window_seconds).toBeNull();
    expect(Math.abs(new Date(conn.poll_cursor!).getTime() - (now - 60 * 60_000))).toBeLessThan(
      5000,
    );
    expect(
      Number(requests[1]!.searchParams.get('to')) - Number(requests[1]!.searchParams.get('from')),
    ).toBe(3600);
    expect(conn.next_poll_at!.getTime() - Date.now()).toBeLessThan(90_000);

    // The rest: two leads, they fit.
    await makeDue(id);
    expect(await run()).toEqual({ status: 'ok', accepted: 2, duplicates: 0, failed: 0 });
    expect(
      stub
        .forOrg(A.orgId)
        .slice(before)
        .map((i) => i.lead.externalId),
    ).toEqual(['W1', 'W2', 'W3']);
    conn = await connectionOf(w.installation.id);
    expect(conn.next_poll_at!.getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
    const view = await installOf(A, w.installation.id);
    expect(Math.abs(new Date(view.connection!.syncedThrough!).getTime() - Date.now())).toBeLessThan(
      30_000,
    );
    expect(view.health.status).toBe('healthy');
  });
});

// --- retention ------------------------------------------------------------------------------------------------------------------------------

describe('retention', () => {
  it('stored deliveries are trimmed after 30 days, with whatever body they still hold', async () => {
    const all = await inbox(A.orgId);
    expect(all.length).toBeGreaterThan(0);
    await h.owner.query(
      `UPDATE marketplace_inbound_events SET received_at = now() - interval '31 days' WHERE org_id = $1 AND id = $2`,
      [A.orgId, all[0]!.id],
    );
    const removed = await h.app.get(InboundSweepService, { strict: false }).trim();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect((await inbox(A.orgId)).map((r) => r.id)).not.toContain(all[0]!.id);
  });
});
