import { describe, expect, it, vi } from 'vitest';
import { validateMarketRecipe, type MarketRecipe } from '@crm/contracts';
import {
  ConnectorError,
  PullConnector,
  type ConnectorContext,
  type FetchLike,
  type PullState,
} from '../../../src/infra/providers/marketplace';
import {
  FakeHousing,
  FakeIndiaMart,
  FakeTradeIndia,
  indiaMartTimeOf,
  parseIndiaMartTime,
  type IndiaMartLead,
} from './fake-portals';
import { seededPortal } from './portal-seed';

const NOW = new Date('2026-10-04T12:00:00Z');
const allow = async () => undefined;
const never = async () => undefined;

const state = (over: Partial<PullState> = {}): PullState => ({
  cursor: null,
  since: null,
  now: NOW,
  ...over,
});

const ctx = (recipe: MarketRecipe, credentials: Record<string, string>): ConnectorContext => ({
  recipe,
  credentials,
  config: {},
});

const imLead = (id: string, at: Date, over: Partial<IndiaMartLead> = {}): IndiaMartLead => ({
  UNIQUE_QUERY_ID: id,
  QUERY_TYPE: 'W',
  QUERY_TIME: indiaMartTimeOf(at),
  SENDER_NAME: 'Rohit Sharma',
  SENDER_MOBILE: '+91-9876543210',
  SENDER_EMAIL: 'rohit@example.com',
  SENDER_COUNTRY_ISO: 'IN',
  QUERY_MESSAGE: 'Need a quote',
  ...over,
});
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

// --- the shipped recipes against the rules of their portals ------------------------------------------------------------------------------

describe("IndiaMART (pull) against IndiaMART's documented rules", () => {
  const KEY = 'gIhfk7cDWoxdqBeFv+sb7kevHW7O1Axy';
  const r = seededPortal('indiamart').recipe;
  const make = () => {
    const portal = new FakeIndiaMart(KEY, () => NOW);
    return { portal, connector: new PullConnector(portal.fetch, allow, never) };
  };
  const run = (c: PullConnector, s: PullState = state(), key = KEY) =>
    c.pull(ctx(r, { crmKey: key }), s);

  it("asks for the last day on a new connection, in IndiaMART's own date format and zone, with the key percent-encoded", async () => {
    const { portal, connector } = make();
    portal.leads = [imLead('Q1', minutesAgo(30))];
    await run(connector);
    const req = portal.requests[0]!;
    expect(req.method).toBe('GET');
    expect(req.url.origin + req.url.pathname).toBe(
      'https://mapi.indiamart.com/wservce/crm/crmListing/v2/',
    );
    // The key has a plus sign: sent as %2B, so IndiaMART reads the same key it issued.
    expect(req.url.search).toContain('glusr_crm_key=gIhfk7cDWoxdqBeFv%2Bsb7kevHW7O1Axy');
    // 12:00 UTC is 17:30 in India; DD-MM-YYYYHH:MM:SS with no space.
    expect(req.url.searchParams.get('start_time')).toBe('03-10-202617:30:00');
    expect(req.url.searchParams.get('end_time')).toBe('04-10-202617:30:00');
  });

  it('turns the answer into leads: no placeholder name, the mobile in E.164, IST read as IST, the message with real line breaks', async () => {
    const { portal, connector } = make();
    portal.leads = [
      imLead('Q1', minutesAgo(30), {
        QUERY_MESSAGE: 'Need 500 pcs.\\nSend your best price.',
        QUERY_TYPE: 'B',
        QUERY_MCAT_NAME: 'Steel Pipes',
        SENDER_CITY: 'Pune',
      }),
      imLead('Q2', minutesAgo(10), {
        SENDER_NAME: 'IndiaMART Buyer',
        SENDER_MOBILE: undefined,
        SENDER_MOBILE_ALT: '+91-9123456780',
      }),
    ];
    const out = await run(connector);
    expect(out.rejected).toEqual([]);
    expect(out.leads.map((l) => l.externalId)).toEqual(['Q1', 'Q2']);
    expect(out.leads[0]).toMatchObject({
      fields: {
        name: 'Rohit Sharma',
        phone: '+919876543210',
        email: 'rohit@example.com',
        message: 'Need 500 pcs.\nSend your best price.',
        city: 'Pune',
        product: 'Steel Pipes',
        lead_type: 'Buy lead',
      },
      attribution: { platform: 'indiamart', campaign: 'Buy lead', form: 'Steel Pipes' },
      receivedAt: minutesAgo(30).toISOString(),
    });
    // Q2: the placeholder name is nothing, and the second mobile stands in for the first.
    expect(out.leads[1]!.fields.name).toBeUndefined();
    expect(out.leads[1]!.fields.phone).toBe('+919123456780');
  });

  it('the high-water mark is the end of the window it covered, and the next window starts the overlap before it', async () => {
    const { portal, connector } = make();
    portal.leads = [imLead('Q1', minutesAgo(30))];
    const first = await run(connector);
    expect(first.windowEnd).toEqual(NOW);
    expect(first.behind).toBe(false);
    expect(first.fetched).toBe(1);

    // Fifteen minutes later (IndiaMART lets us ask again after five).
    const later = new Date(NOW.getTime() + 15 * 60_000);
    const portal2 = new FakeIndiaMart(KEY, () => later);
    portal2.leads = [
      imLead('Q1', minutesAgo(30)),
      imLead('Q3', new Date(NOW.getTime() + 5 * 60_000)),
    ];
    const again = await new PullConnector(portal2.fetch, allow, never).pull(
      ctx(r, { crmKey: KEY }),
      state({ cursor: first.windowEnd!.toISOString(), now: later }),
    );
    // 12:15 UTC = 17:45 IST; start = the previous end (17:30) less 30 minutes of overlap.
    const q = portal2.requests[0]!.url.searchParams;
    expect(q.get('start_time')).toBe('04-10-202617:00:00');
    expect(q.get('end_time')).toBe('04-10-202617:45:00');
    // Q1 is in the overlap and comes again with the same id (the delivery service's dedupe absorbs it); Q3 is new.
    expect(again.leads.map((l) => l.externalId)).toEqual(['Q1', 'Q3']);
  });

  it('a connection that was away catches up one window of at most six days per poll, and says it is behind', async () => {
    const { portal, connector } = make();
    const out = await run(
      connector,
      state({ cursor: new Date(NOW.getTime() - 20 * 86_400_000).toISOString() }),
    );
    const q = portal.requests[0]!.url.searchParams;
    // The mark (14 Sept 17:30 IST) less the half hour of overlap, and six days on.
    expect(q.get('start_time')).toBe('14-09-202617:00:00');
    expect(q.get('end_time')).toBe('20-09-202617:00:00');
    expect(out.behind).toBe(true);
    expect(out.windowEnd!.getTime()).toBeLessThan(NOW.getTime());
    // IndiaMART's own limit is seven days: the answer was not a refusal.
    expect(out.leads).toEqual([]);
  });

  it('no leads in the window is a success that hands nothing over (CODE 204), not an error', async () => {
    const { connector } = make();
    const out = await run(connector);
    expect(out).toMatchObject({ leads: [], rejected: [], fetched: 0, behind: false });
  });

  it('maps each refusal IndiaMART documents to what the connection does about it', async () => {
    const wrongKey = make();
    await expect(run(wrongKey.connector, state(), 'not-the-key')).rejects.toMatchObject({
      code: 'key_rejected',
      retry: false,
      health: 'needs_reauth',
    });

    const expired = make();
    expired.portal.expired = true;
    await expect(run(expired.connector)).rejects.toMatchObject({
      code: 'key_expired',
      retry: false,
      health: 'needs_reauth',
    });

    const tooSoon = make();
    await run(tooSoon.connector);
    await expect(run(tooSoon.connector)).rejects.toMatchObject({
      code: 'rate_limited',
      retry: true,
      health: 'degraded',
      retryAfterSeconds: 300,
    });

    const blocked = make();
    for (let i = 0; i < 5; i++) await run(blocked.connector).catch(() => undefined);
    await expect(run(blocked.connector)).rejects.toMatchObject({
      code: 'key_blocked',
      retry: true,
      retryAfterSeconds: 900,
    });

    const down = make();
    down.portal.down = true;
    await expect(run(down.connector)).rejects.toMatchObject({
      code: 'portal_error',
      retry: true,
      health: 'degraded',
    });
  });

  it('reads the same refusals when IndiaMART also sets the HTTP status', async () => {
    const { portal, connector } = make();
    portal.httpErrors = true;
    await expect(run(connector, state(), 'wrong')).rejects.toMatchObject({
      code: 'key_rejected',
      retry: false,
    });
    const quiet = new FakeIndiaMart(KEY, () => NOW);
    quiet.httpErrors = true;
    expect(await run(new PullConnector(quiet.fetch, allow, never))).toMatchObject({
      leads: [],
      fetched: 0,
    });
  });

  it('Test connection asks for the last hour only, and leaves nothing behind', async () => {
    const { portal, connector } = make();
    portal.leads = [imLead('Q1', minutesAgo(30))];
    const res = await connector.test(ctx(r, { crmKey: KEY }));
    expect(res).toEqual({ ok: true, code: null, message: null });
    const q = portal.requests[0]!.url.searchParams;
    // The window is the last hour up to the real clock (this one is not the fixed NOW of the other tests).
    const span = parseIndiaMartTime(q.get('end_time'))! - parseIndiaMartTime(q.get('start_time'))!;
    expect(span).toBeGreaterThanOrEqual(3599_000);
    expect(span).toBeLessThanOrEqual(3601_000);
    const bad = await connector.test(ctx(r, { crmKey: 'wrong' }));
    expect(bad).toMatchObject({ ok: false, code: 'key_rejected' });
  });

  it('also receives, at an address with the secret in its path, and reads the same fields as the poll does', () => {
    const { connector } = make();
    expect(connector.describeAuth(r)).toEqual({
      auth: 'path',
      tokenHeader: '',
      signatureHeader: '',
      methods: ['POST'],
      formats: ['json'],
      mode: 'async',
    });
    expect(connector.secretFor(r, { crmKey: 'k' }, 'mkt_generated')).toBe('mkt_generated');
    expect(
      connector.authenticate(
        r,
        { rawBody: Buffer.alloc(0), headers: {}, pathToken: 'mkt_generated' },
        'mkt_generated',
      ),
    ).toBe(true);
    expect(
      connector.authenticate(
        r,
        { rawBody: Buffer.alloc(0), headers: {}, pathToken: 'mkt_other' },
        'mkt_generated',
      ),
    ).toBe(false);
    expect(
      connector.authenticate(r, { rawBody: Buffer.alloc(0), headers: {} }, 'mkt_generated'),
    ).toBe(false);
    // IndiaMART's push body is {CODE, STATUS, RESPONSE: {...}} with one lead as an object.
    const pushed = connector.parse(r, seededPortal('indiamart').recipe.testPayloads[0]!.payload);
    expect(pushed.rejected).toEqual([]);
    expect(pushed.leads[0]).toMatchObject({
      externalId: '2000000001',
      fields: { name: 'Rohit Sharma', phone: '+919876543210' },
    });
  });
});

describe('Housing.com (pull, signed) against its document', () => {
  const r = seededPortal('housing-com').recipe;
  const creds = { housingId: '4544', secretKey: 'K-secret-key' };
  const lead = (at: Date, over: Record<string, unknown> = {}) => ({
    lead_name: 'Anita Rao',
    lead_phone: '9876543210',
    lead_email: 'anita@example.com',
    project_id: 1233,
    project_name: 'Sample Heights',
    locality: 'Powai',
    lead_date: String(Math.floor(at.getTime() / 1000)),
    ...over,
  });

  it('signs each request with HMAC-SHA256 of the request time, and Housing.com accepts it', async () => {
    const portal = new FakeHousing('4544', 'K-secret-key', () => NOW);
    portal.leads = [lead(minutesAgo(30))];
    const out = await new PullConnector(portal.fetch, allow, never).pull(ctx(r, creds), state());
    const q = portal.requests[0]!.url.searchParams;
    expect(q.get('id')).toBe('4544');
    expect(q.get('current_time')).toBe(String(NOW.getTime() / 1000));
    expect(q.get('hash')).toMatch(/^[0-9a-f]{64}$/);
    expect(q.get('end_date')).toBe(String(NOW.getTime() / 1000));
    expect(q.get('start_date')).toBe(String(NOW.getTime() / 1000 - 86_400));
    expect(out.leads).toHaveLength(1);
  });

  it('derives the lead id (Housing.com sends none), reads the time as epoch seconds, and labels the project', async () => {
    const portal = new FakeHousing('4544', 'K-secret-key', () => NOW);
    portal.leads = [
      lead(minutesAgo(30)),
      lead(minutesAgo(20), { lead_email: null, lead_phone: '+91 91234 56780' }),
    ];
    const out = await new PullConnector(portal.fetch, allow, never).pull(ctx(r, creds), state());
    expect(out.leads[0]!.externalId).toMatch(/^hs-[0-9a-f]{32}$/);
    expect(out.leads[0]).toMatchObject({
      fields: {
        name: 'Anita Rao',
        phone: '+919876543210',
        email: 'anita@example.com',
        product: 'Sample Heights',
        locality: 'Powai',
      },
      attribution: { platform: 'housing', form: '1233' },
      receivedAt: minutesAgo(30).toISOString(),
    });
    expect(out.leads[1]!.fields.phone).toBe('+919123456780');
    expect(out.leads[1]!.fields.email).toBeUndefined();
    expect(out.leads[0]!.externalId).not.toBe(out.leads[1]!.externalId);
    // The same lead fetched again (window overlap) has the same id.
    const again = await new PullConnector(portal.fetch, allow, never).pull(ctx(r, creds), state());
    expect(again.leads.map((l) => l.externalId)).toEqual(out.leads.map((l) => l.externalId));
  });

  it('reads a bare list, or an object that holds the one list (the document does not show the wrapper)', async () => {
    const portal = new FakeHousing('4544', 'K-secret-key', () => NOW);
    portal.leads = [lead(minutesAgo(30))];
    portal.wrapper = 'object';
    const out = await new PullConnector(portal.fetch, allow, never).pull(ctx(r, creds), state());
    expect(out.leads).toHaveLength(1);
  });

  it('is refused for a wrong key or an out-of-date clock (401), and a missing parameter (422)', async () => {
    const portal = new FakeHousing('4544', 'K-secret-key', () => NOW);
    const bad = new PullConnector(portal.fetch, allow, never).pull(
      ctx(r, { ...creds, secretKey: 'wrong' }),
      state(),
    );
    await expect(bad).rejects.toMatchObject({
      code: 'auth_rejected',
      retry: false,
      health: 'needs_reauth',
    });
    // This server's clock is 20 minutes ahead of Housing.com's: the signed time is "delayed".
    const late = new FakeHousing(
      '4544',
      'K-secret-key',
      () => new Date(NOW.getTime() - 20 * 60_000),
    );
    await expect(
      new PullConnector(late.fetch, allow, never).pull(ctx(r, creds), state()),
    ).rejects.toMatchObject({
      code: 'auth_rejected',
    });
    await expect(
      new PullConnector(portal.fetch, allow, never).pull(
        ctx(r, { housingId: '', secretKey: 'K-secret-key' }),
        state(),
      ),
    ).rejects.toMatchObject({ code: 'request_refused', retry: false, health: 'error' });
  });
});

describe('TradeIndia (pull, beta)', () => {
  const r = seededPortal('tradeindia').recipe;
  const creds = { userId: '1001', profileId: '2002', apiKey: 'ti-key' };

  it('asks with the three keys and whole days in Indian time, and maps the inquiry', async () => {
    const portal = new FakeTradeIndia('1001', '2002', 'ti-key');
    portal.leads = [
      {
        rfi_id: 'TI-1',
        sender_name: 'Neha',
        sender_mobile: '9876543210',
        sender_email: 'NEHA@x.com',
        product_name: 'Cotton',
        message: 'Rate please',
        day: '2026-10-04',
      },
    ];
    const out = await new PullConnector(portal.fetch, allow, never).pull(ctx(r, creds), state());
    const q = portal.requests[0]!.url.searchParams;
    expect(q.get('userid')).toBe('1001');
    expect(q.get('profile_id')).toBe('2002');
    expect(q.get('key')).toBe('ti-key');
    // 12:00 UTC is 17:30 IST on the 4th; a day back is the 3rd.
    expect(q.get('from_date')).toBe('2026-10-03');
    expect(q.get('to_date')).toBe('2026-10-04');
    expect(out.leads[0]).toMatchObject({
      externalId: 'TI-1',
      fields: {
        name: 'Neha',
        phone: '+919876543210',
        email: 'neha@x.com',
        product: 'Cotton',
        received_at_approximate: true,
      },
      attribution: { platform: 'tradeindia' },
    });
    expect(out.leads[0]!.receivedAt).toBeUndefined();
  });

  it('a refusal stops the connection and says why (403)', async () => {
    const portal = new FakeTradeIndia('1001', '2002', 'ti-key');
    await expect(
      new PullConnector(portal.fetch, allow, never).pull(
        ctx(r, { ...creds, apiKey: 'nope' }),
        state(),
      ),
    ).rejects.toMatchObject({ code: 'auth_rejected', retry: false, health: 'needs_reauth' });
  });
});

// --- the engine's own rules, with a made-up portal ---------------------------------------------------------------------------------------

describe('the pull engine', () => {
  const recipe = (
    connector: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ): MarketRecipe => {
    const v = validateMarketRecipe({
      schemaVersion: 1,
      key: 'portal',
      name: 'Portal',
      category: 'lead-sources',
      connector: {
        type: 'pull',
        request: {
          baseUrl: 'https://api.portal-example.com',
          path: '/leads',
          query: { from: '{{window_start}}', to: '{{window_end}}', k: '{{cred.key}}' },
        },
        response: { itemsPath: 'items' },
        window: {
          format: 'epoch',
          maxSeconds: 86_400,
          overlapSeconds: 0,
          initialLookbackSeconds: 3600,
        },
        pollIntervalSeconds: 300,
        limits: { minIntervalSeconds: 60, requestsPerMinute: 6 },
        maxItemsPerPoll: 3,
        ...connector,
      },
      authFields: [{ key: 'key', label: 'Key', kind: 'secret', required: true }],
      mapping: {
        mode: 'explicit',
        externalId: { from: 'id' },
        fields: [{ to: 'name', from: 'name' }],
      },
      ...extra,
    });
    if (!v.ok) throw new Error(JSON.stringify(v.problems));
    return v.recipe;
  };
  const json = (
    status: number,
    body: unknown,
    extra: Partial<Awaited<ReturnType<FetchLike>>> = {},
  ) => ({
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    ...extra,
  });
  const items = (n: number) =>
    Array.from({ length: n }, (_v, i) => ({ id: String(i + 1), name: `N${i + 1}` }));
  const creds = { key: 'k' };

  it('pages inside a window: asks page after page, spaced by the requests-per-minute limit, and stops at a short page', async () => {
    const r = recipe({
      pagination: {
        style: 'page',
        pageParam: 'page',
        sizeParam: 'size',
        pageSize: 2,
        startPage: 1,
        maxPages: 5,
      },
      maxItemsPerPoll: 50,
    });
    const pages: Record<string, unknown[]> = {
      '1': items(2),
      '2': items(2).map((x) => ({ ...x, id: x.id + 'b' })),
      '3': [{ id: 'last', name: 'L' }],
    };
    const fetchImpl = vi.fn<FetchLike>(async (url) =>
      json(200, { items: pages[new URL(url).searchParams.get('page')!] ?? [] }),
    );
    const sleep = vi.fn(async (_ms: number) => undefined);
    const out = await new PullConnector(fetchImpl, allow, sleep).pull(ctx(r, creds), state());
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(new URL(fetchImpl.mock.calls[0]![0]).searchParams.get('size')).toBe('2');
    expect(out.leads.map((l) => l.externalId)).toEqual(['1', '2', '1b', '2b', 'last']);
    // 6 requests a minute is one every 10 seconds; no wait before the first page.
    expect(sleep.mock.calls).toEqual([[10_000], [10_000]]);
  });

  it('stops at the page limit', async () => {
    const r = recipe({
      pagination: { style: 'page', pageParam: 'page', pageSize: 2, startPage: 0, maxPages: 2 },
      maxItemsPerPoll: 50,
    });
    const fetchImpl = vi.fn<FetchLike>(async () => json(200, { items: items(2) }));
    const out = await new PullConnector(fetchImpl, allow, async () => undefined).pull(
      ctx(r, creds),
      state(),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(fetchImpl.mock.calls[0]![0]).searchParams.get('page')).toBe('0');
    expect(out.fetched).toBe(4);
  });

  it('a window that holds more than one answer carries is asked again in halves: nothing is mapped now, so nothing is lost', async () => {
    const r = recipe();
    const out = await new PullConnector(
      async () => json(200, { items: items(4) }),
      allow,
      never,
    ).pull(ctx(r, creds), state());
    expect(out).toMatchObject({
      overflow: true,
      leads: [],
      behind: true,
      windowSeconds: 3600,
      fetched: 4,
    });
    // A narrower window of the same width fits and is taken whole.
    const fits = await new PullConnector(
      async () => json(200, { items: items(3) }),
      allow,
      never,
    ).pull(ctx(r, creds), state());
    expect(fits.overflow).toBeUndefined();
    expect(fits.leads).toHaveLength(3);
  });

  it('an answer longer than the platform reads is the same case; with nothing narrower left it is an error, and an over-full smallest window is taken as far as it fits', async () => {
    const r = recipe();
    const truncated = async () => json(200, '{"items":[', { truncated: true });
    expect(
      await new PullConnector(truncated, allow, never).pull(ctx(r, creds), state()),
    ).toMatchObject({ overflow: true });
    // Already at the smallest span (300 s): cannot narrow further.
    const tiny = state({ windowSeconds: 400 });
    await expect(
      new PullConnector(truncated, allow, never).pull(ctx(r, creds), tiny),
    ).rejects.toMatchObject({
      code: 'response_too_large',
      retry: true,
    });
    const full = await new PullConnector(
      async () => json(200, { items: items(9) }),
      allow,
      never,
    ).pull(ctx(r, creds), tiny);
    expect(full.overflow).toBeUndefined();
    expect(full.leads).toHaveLength(3);
  });

  it('an empty window is not asked: the portal is not called when the mark is at now', async () => {
    const r = recipe();
    const fetchImpl = vi.fn<FetchLike>(async () => json(200, { items: [] }));
    const out = await new PullConnector(fetchImpl, allow, never).pull(
      ctx(r, creds),
      state({ cursor: NOW.toISOString() }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out).toMatchObject({ leads: [], behind: false, fetched: 0 });
    expect(out.windowEnd).toEqual(NOW);
  });

  it('an address guard that refuses stops the request before it is made; a redirect is never followed', async () => {
    const r = recipe();
    const fetchImpl = vi.fn<FetchLike>(async () => json(200, { items: [] }));
    const refuse = async () => {
      throw new Error('private address');
    };
    await expect(
      new PullConnector(fetchImpl, refuse, never).pull(ctx(r, creds), state()),
    ).rejects.toMatchObject({
      code: 'url_refused',
      retry: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    const redirected = vi.fn<FetchLike>(async () => json(302, ''));
    await expect(
      new PullConnector(redirected, allow, never).pull(ctx(r, creds), state()),
    ).rejects.toMatchObject({
      code: 'portal_redirect',
      retry: false,
    });
    // The request itself says not to follow one.
    expect(redirected.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
  });

  it("honours the portal's Retry-After, and a mapped penalty beats it", async () => {
    const r = recipe();
    const waiting = async () =>
      json(429, 'slow down', {
        headers: { get: (n: string) => (n === 'retry-after' ? '120' : null) },
      });
    await expect(
      new PullConnector(waiting, allow, never).pull(ctx(r, creds), state()),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      retry: true,
      retryAfterSeconds: 120,
    });
    const mapped = recipe(
      {},
      {
        errorMapping: [
          {
            status: 429,
            code: 'blocked',
            message: 'Blocked.',
            retry: true,
            health: 'degraded',
            retryAfterSeconds: 900,
          },
        ],
      },
    );
    await expect(
      new PullConnector(waiting, allow, never).pull(ctx(mapped, creds), state()),
    ).rejects.toMatchObject({
      code: 'blocked',
      retryAfterSeconds: 900,
    });
  });

  it('reads a status a portal keeps in its body as a string, and an empty 200 as no leads', async () => {
    const r = recipe({
      response: { itemsPath: 'items', statusPath: 'status', emptyStatuses: [204, 404] },
    });
    const body = (status: string) => async () => json(200, { status, items: items(1) });
    await expect(
      new PullConnector(body('401'), allow, never).pull(ctx(r, creds), state()),
    ).rejects.toMatchObject({ code: 'auth_rejected' });
    expect(
      await new PullConnector(body('404'), allow, never).pull(ctx(r, creds), state()),
    ).toMatchObject({ leads: [], fetched: 0 });
    expect(
      await new PullConnector(body('200'), allow, never).pull(ctx(r, creds), state()),
    ).toMatchObject({ fetched: 1 });
    expect(
      await new PullConnector(async () => json(200, ''), allow, never).pull(ctx(r, creds), state()),
    ).toMatchObject({ leads: [], fetched: 0 });
    expect(
      await new PullConnector(async () => json(204, ''), allow, never).pull(ctx(r, creds), state()),
    ).toMatchObject({ leads: [], fetched: 0 });
  });

  it('something that is not JSON is retried, not mapped', async () => {
    const r = recipe();
    await expect(
      new PullConnector(async () => json(200, '<html>maintenance</html>'), allow, never).pull(
        ctx(r, creds),
        state(),
      ),
    ).rejects.toBeInstanceOf(ConnectorError);
    await expect(
      new PullConnector(async () => json(200, '<html>maintenance</html>'), allow, never).pull(
        ctx(r, creds),
        state(),
      ),
    ).rejects.toMatchObject({
      code: 'bad_answer',
      retry: true,
    });
  });

  it('a recipe is refused when its window, signature or limits contradict themselves', () => {
    const bad = (connector: Record<string, unknown>) =>
      validateMarketRecipe({
        schemaVersion: 1,
        key: 'portal',
        name: 'Portal',
        category: 'lead-sources',
        connector: {
          type: 'pull',
          request: {
            baseUrl: 'https://api.portal-example.com',
            path: '/leads',
            query: { from: '{{window_start}}', to: '{{window_end}}' },
          },
          window: { format: 'epoch', maxSeconds: 86_400 },
          pollIntervalSeconds: 300,
          ...connector,
        },
        mapping: { mode: 'explicit', fields: [{ to: 'name', from: 'name' }] },
      });
    expect(bad({}).ok).toBe(true);
    // Both a cursor and a window.
    expect(
      bad({
        cursor: { from: 'id' },
        request: {
          baseUrl: 'https://api.portal-example.com',
          query: { from: '{{window_start}}', to: '{{window_end}}', after: '{{cursor}}' },
        },
      }).ok,
    ).toBe(false);
    // A window the request never uses.
    expect(bad({ request: { baseUrl: 'https://api.portal-example.com', query: {} } }).ok).toBe(
      false,
    );
    // Window placeholders without a window.
    expect(bad({ window: undefined }).ok).toBe(false);
    // The poll interval below the portal's own minimum.
    expect(bad({ pollIntervalSeconds: 60, limits: { minIntervalSeconds: 300 } }).ok).toBe(false);
    // A signing key that is not a secret field the recipe declares.
    expect(
      bad({
        request: {
          baseUrl: 'https://api.portal-example.com',
          query: { from: '{{window_start}}', to: '{{window_end}}' },
          sign: {
            algorithm: 'hmac_sha256',
            keyField: 'missing',
            timestampParam: 't',
            signatureParam: 'h',
          },
        },
      }).ok,
    ).toBe(false);
    // An overlap longer than half of the window.
    expect(bad({ window: { format: 'epoch', maxSeconds: 1000, overlapSeconds: 600 } }).ok).toBe(
      false,
    );
  });
});
