import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyGate,
  buildChecklist,
  callbackFor,
  graph,
  metaPlan,
  openSealed,
  parseReconcile,
  removeOverride,
  scrub,
  subscribeWaba,
  verifyToken,
  type Callback,
  type Facts,
  type FetchLike,
  type GraphDeps,
  forwardedByPartner,
} from '../load/cutover';

const KEY = randomBytes(32).toString('base64');
const TOKEN = 'EA' + randomBytes(24).toString('hex');
const seal = (plain: string, keyB64 = KEY): string => {
  const key = Buffer.from(keyB64, 'base64');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const id = createHash('sha256').update(key).digest('hex').slice(0, 8);
  return [
    'v1',
    iv.toString('base64'),
    c.getAuthTag().toString('base64'),
    ct.toString('base64'),
    id,
  ].join(':');
};

describe("callback URL and verify token (the app's waba-rules.ts)", () => {
  it('derives the ?k= key and the verify token from the credentials key, like the app', () => {
    const cb = callbackFor(
      { CREDENTIALS_ENCRYPTION_KEY: KEY },
      'https://api.example.com/',
    ) as Callback;
    const k = createHmac('sha256', Buffer.from(KEY, 'base64'))
      .update('waba-webhook-url-key')
      .digest('hex')
      .slice(0, 32);
    expect(cb.url).toBe(`https://api.example.com/v2/public/webhooks/whatsapp?k=${k}`);
    expect(cb.verifyToken).toBe(
      createHmac('sha256', Buffer.from(KEY, 'base64'))
        .update('waba-webhook-verify-token')
        .digest('hex')
        .slice(0, 40),
    );
    expect(cb.verifyTokenFrom).toMatch(/derived/);
  });
  it('uses WABA_VERIFY_TOKEN, then WHATSAPP_VERIFY_TOKEN, and WABA_WEBHOOK_PUBLIC_URL before APP_URL; the flag wins', () => {
    const env = {
      CREDENTIALS_ENCRYPTION_KEY: KEY,
      WABA_VERIFY_TOKEN: 'abc-verify',
      WHATSAPP_VERIFY_TOKEN: 'zzz',
      WABA_WEBHOOK_PUBLIC_URL: 'https://hook.example.com',
      APP_URL: 'https://app.example.com',
    };
    const cb = callbackFor(env) as Callback;
    expect(cb.verifyToken).toBe('abc-verify');
    expect(cb.url.startsWith('https://hook.example.com/v2/')).toBe(true);
    expect(
      (callbackFor(env, 'https://flag.example.com') as Callback).url.startsWith(
        'https://flag.example.com/',
      ),
    ).toBe(true);
    expect((callbackFor({ ...env, WABA_VERIFY_TOKEN: '' }) as Callback).verifyToken).toBe('zzz');
  });
  it('is never hard-coded: no URL, a plain http URL, a local URL or no key is an error', () => {
    expect(callbackFor({ CREDENTIALS_ENCRYPTION_KEY: KEY })).toHaveProperty('error');
    expect(
      callbackFor({ CREDENTIALS_ENCRYPTION_KEY: KEY }, 'http://api.example.com'),
    ).toHaveProperty('error');
    expect(
      callbackFor({ CREDENTIALS_ENCRYPTION_KEY: KEY }, 'https://localhost:3000'),
    ).toHaveProperty('error');
    expect(callbackFor({}, 'https://api.example.com')).toHaveProperty('error');
  });
  it('scrub hides the url key and the secrets it has seen', () => {
    const cb = callbackFor(
      { CREDENTIALS_ENCRYPTION_KEY: KEY },
      'https://api.example.com',
    ) as Callback;
    expect(scrub(`call ${cb.url} with ${cb.verifyToken} and Bearer ${TOKEN}`)).not.toMatch(
      new RegExp(`${cb.verifyToken}|k=[0-9a-f]{8}|${TOKEN}`),
    );
  });
});

describe('opening the sealed token', () => {
  it('opens a CryptoService-format blob and reveals nothing on failure', () => {
    const blob = seal(JSON.stringify({ access_token: TOKEN }));
    expect(openSealed(blob, { CREDENTIALS_ENCRYPTION_KEY: KEY }).accessToken).toBe(TOKEN);
    const other = randomBytes(32).toString('base64');
    expect(() => openSealed(blob, { CREDENTIALS_ENCRYPTION_KEY: other })).toThrow(/key ring/);
    // an old key in the previous list still opens it
    expect(
      openSealed(blob, {
        CREDENTIALS_ENCRYPTION_KEY: other,
        CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS: KEY,
      }).accessToken,
    ).toBe(TOKEN);
    expect(() => openSealed('garbage', { CREDENTIALS_ENCRYPTION_KEY: KEY })).toThrow(/app format/);
    expect(() => openSealed(blob, {})).toThrow(/not set/);
    try {
      openSealed(blob, { CREDENTIALS_ENCRYPTION_KEY: other });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(TOKEN);
    }
  });
});

describe('the reconcile report', () => {
  const md =
    '# Reconciliation: iskm\n\nGenerated 2026-10-12T10:00:00.000Z. **PASS**  (unaccounted 0, alarms 0, integrity 0)\n';
  it('reads the header line', () => {
    expect(parseReconcile(md)).toMatchObject({ ok: true, unaccounted: 0, alarms: 0, integrity: 0 });
    expect(
      parseReconcile(md.replace('PASS', 'FAIL').replace('unaccounted 0', 'unaccounted 3')),
    ).toMatchObject({ ok: false, unaccounted: 3 });
    expect(parseReconcile('nothing')).toBeNull();
  });
});

const good = (): Facts => ({
  orgFound: true,
  numbers: [
    {
      ext: '109876543210987',
      channel: { status: 'disconnected', wabaConfigId: null },
      cfg: {
        id: 7,
        status: 'pending',
        via: 'migration',
        providerKey: 'meta',
        wabaId: '123456789012345',
        hasCredentials: true,
      },
      tokenOpens: true,
    },
  ],
  report: {
    ok: true,
    unaccounted: 0,
    alarms: 0,
    integrity: 0,
    generatedAt: new Date('2026-10-12T10:00:00Z'),
  },
  lastLoadAt: new Date('2026-10-12T09:00:00Z'),
  flows: { live: 2, armed: 2, stray: 0 },
  backup: { name: 'desk-pre-cutover-iskm-x.dump', atMs: Date.parse('2026-10-12T09:30:00Z') },
  callback: {
    url: 'https://api.example.com/v2/public/webhooks/whatsapp?k=aaaaaaaaaaaaaaaa',
    verifyToken: 'v',
    verifyTokenFrom: 'WABA_VERIFY_TOKEN',
  },
  now: new Date('2026-10-12T11:00:00Z'),
  wabooOff: true,
  maxReportAgeHours: 48,
});
const statusOf = (f: Facts, id: string) =>
  buildChecklist(f).find((i) => i.id === id || i.id.startsWith(`${id}:`))?.status;

describe('the checklist', () => {
  it('passes a clean state; the only open items are manual confirmations', () => {
    const items = buildChecklist(good());
    expect(items.filter((i) => i.status === 'FAIL')).toEqual([]);
    expect(items.filter((i) => i.status === 'MANUAL').map((i) => i.id)).toEqual([
      'verify-token-same',
      'app-of-token',
    ]);
  });
  it('waboo-off is MANUAL until the operator says so', () => {
    expect(statusOf({ ...good(), wabooOff: false }, 'waboo-off')).toBe('MANUAL');
  });
  it('fails on each broken precondition', () => {
    const g = good();
    const n = (p: Partial<Facts['numbers'][0]>): Facts => ({
      ...g,
      numbers: [{ ...g.numbers[0]!, ...p }],
    });
    expect(statusOf({ ...g, orgFound: false }, 'org')).toBe('FAIL');
    expect(statusOf({ ...g, numbers: [] }, 'channel')).toBe('FAIL');
    expect(statusOf(n({ cfg: null }), 'config')).toBe('FAIL');
    expect(statusOf(n({ channel: { status: 'connected', wabaConfigId: null } }), 'channel')).toBe(
      'FAIL',
    );
    expect(statusOf(n({ ext: 'map-id' }), 'number-id')).toBe('FAIL');
    expect(
      statusOf(n({ tokenOpens: 'the stored credential does not open with this key' }), 'token'),
    ).toBe('FAIL');
    expect(statusOf(n({ cfg: { ...g.numbers[0]!.cfg!, providerKey: 'interakt' } }), 'route')).toBe(
      'FAIL',
    );
    // a number the Pinnacle partner program already onboarded goes live through the Meta subscription and the database alone
    expect(statusOf(n({ cfg: { ...g.numbers[0]!.cfg!, providerKey: 'pinnacle' } }), 'route')).toBe(
      'PASS',
    );
    expect(statusOf({ ...g, flows: { live: 3, armed: 2, stray: 1 } }, 'flows')).toBe('FAIL');
    expect(statusOf({ ...g, backup: null }, 'backup')).toBe('FAIL');
    expect(
      statusOf({ ...g, backup: { name: 'x', atMs: Date.parse('2026-10-10T00:00:00Z') } }, 'backup'),
    ).toBe('FAIL');
    expect(statusOf({ ...g, callback: { error: 'no public URL' } }, 'webhook')).toBe('FAIL');
    expect(statusOf({ ...g, report: null }, 'verified')).toBe('FAIL');
    expect(
      statusOf(
        { ...g, report: { ...(g.report as object), integrity: 1 } as Facts['report'] },
        'verified',
      ),
    ).toBe('FAIL');
    expect(
      statusOf(
        { ...g, report: { ...(g.report as object), unaccounted: 2 } as Facts['report'] },
        'verified',
      ),
    ).toBe('FAIL');
    expect(statusOf({ ...g, lastLoadAt: new Date('2026-10-12T10:30:00Z') }, 'verified')).toBe(
      'FAIL',
    ); // report older than the last load
    expect(statusOf({ ...g, now: new Date('2026-10-20T00:00:00Z') }, 'verified')).toBe('FAIL'); // too old
  });
  it('an already cut over number is not a failure (idempotent re-run)', () => {
    const g = good();
    const done: Facts = {
      ...g,
      numbers: [
        {
          ...g.numbers[0]!,
          channel: { status: 'connected', wabaConfigId: 7 },
          cfg: { ...g.numbers[0]!.cfg!, status: 'connected' },
        },
      ],
    };
    expect(buildChecklist(done).filter((i) => i.status === 'FAIL')).toEqual([]);
  });
});

describe('the apply gate', () => {
  const base = {
    mode: 'apply' as const,
    orgSlug: 'iskm',
    confirmOrgSlug: 'iskm',
    confirmCutover: 'CUT OVER iskm',
    wabooOff: true,
  };
  const clean = buildChecklist(good());
  it('allows exactly the full set', () => {
    expect(applyGate(base, clean).refusals).toEqual([]);
  });
  it('refuses each missing piece', () => {
    expect(applyGate({ ...base, confirmOrgSlug: undefined }, clean).refusals.join()).toMatch(
      /confirm-org-slug/,
    );
    expect(applyGate({ ...base, confirmOrgSlug: 'other' }, clean).refusals.join()).toMatch(
      /confirm-org-slug/,
    );
    expect(applyGate({ ...base, wabooOff: false }, clean).refusals.join()).toMatch(/waboo-off/);
    expect(applyGate({ ...base, confirmCutover: undefined }, clean).refusals.join()).toMatch(
      /confirm-cutover/,
    );
    expect(applyGate({ ...base, confirmCutover: 'cut over iskm' }, clean).refusals.join()).toMatch(
      /confirm-cutover/,
    );
    expect(applyGate({ ...base, confirmCutover: 'CUT OVER iskm ' }, clean).refusals.join()).toMatch(
      /confirm-cutover/,
    );
    expect(applyGate(base, buildChecklist({ ...good(), backup: null })).refusals.join()).toMatch(
      /checklist FAIL \(backup\)/,
    );
  });
  it('the rollback needs its own phrase, not the cutover one', () => {
    const r = { ...base, mode: 'rollback' as const };
    expect(applyGate(r, []).refusals.join()).toMatch(/ROLL BACK iskm/);
    expect(applyGate({ ...r, confirmCutover: 'ROLL BACK iskm' }, []).refusals).toEqual([]);
  });
});

// ---- the Graph layer, with a fake HTTP layer ---------------------------------------------------------------------------------------
interface Call {
  method: string;
  url: string;
  auth: string | null;
  body: unknown;
  hasSignal: boolean;
}
function fakeGraph(script: (c: Call, n: number) => { status?: number; body?: unknown }): {
  d: GraphDeps;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const c: Call = {
      method: String(init?.method),
      url,
      auth: (init?.headers as Record<string, string>)?.Authorization ?? null,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      hasSignal: init?.signal instanceof AbortSignal,
    };
    calls.push(c);
    const r = script(c, calls.length);
    const status = r.status ?? 200;
    return new Response(JSON.stringify(r.body ?? {}), { status });
  };
  return {
    d: {
      fetchImpl,
      base: 'https://graph.facebook.com',
      version: 'v25.0',
      sleep: async () => undefined,
    },
    calls,
  };
}
const cb = callbackFor({ CREDENTIALS_ENCRYPTION_KEY: KEY }, 'https://api.example.com') as Callback;
const WABA = '123456789012345';
const sub = (uri?: string) => ({
  data: [
    { whatsapp_business_api_data: { id: '1', ...(uri ? { override_callback_uri: uri } : {}) } },
  ],
});

describe('graph()', () => {
  it('sends the token only as a header, with a timeout, and never leaks it in an error', async () => {
    const { d, calls } = fakeGraph(() => ({
      status: 400,
      body: { error: { message: `bad token ${TOKEN}`, code: 190 } },
    }));
    await expect(
      graph(d, TOKEN, { method: 'GET', path: '/1', query: { fields: 'id' } }),
    ).rejects.toThrow(/code 190/);
    try {
      await graph(d, TOKEN, { method: 'GET', path: '/1' });
    } catch (e) {
      expect((e as Error).message).not.toContain(TOKEN);
    }
    expect(calls[0]!.auth).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v25.0/1?fields=id');
    expect(calls[0]!.url).not.toContain(TOKEN);
    expect(calls[0]!.hasSignal).toBe(true);
  });
  it('refuses a plain http endpoint', async () => {
    const { d } = fakeGraph(() => ({}));
    await expect(
      graph({ ...d, base: 'http://graph.example' }, TOKEN, { method: 'GET', path: '/1' }),
    ).rejects.toThrow(/https/);
  });
});

describe('verifyToken (read only)', () => {
  it('reads the phone number and checks it is the right, Cloud API number', async () => {
    const { d, calls } = fakeGraph(() => ({
      body: {
        id: '555000111222',
        display_phone_number: '+91 91122 90122',
        platform_type: 'CLOUD_API',
        status: 'CONNECTED',
      },
    }));
    expect((await verifyToken(d, TOKEN, '555000111222', '+919112290122')).ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(calls[0]!.url).toContain('/v25.0/555000111222?fields=');
    const on = fakeGraph(() => ({ body: { id: '555000111222', platform_type: 'ON_PREMISE' } }));
    expect((await verifyToken(on.d, TOKEN, '555000111222', null)).ok).toBe(false);
    const other = fakeGraph(() => ({
      body: { id: '555000111222', display_phone_number: '+1 202 555 0100' },
    }));
    expect((await verifyToken(other.d, TOKEN, '555000111222', '+919112290122')).ok).toBe(false);
    const bad = fakeGraph(() => ({
      status: 401,
      body: { error: { message: 'Invalid OAuth access token', code: 190 } },
    }));
    expect((await verifyToken(bad.d, TOKEN, '555000111222', null)).ok).toBe(false);
  });
});

describe('subscribeWaba', () => {
  it('reads, sets the override with the verify token, and confirms with a read', async () => {
    let posted = false;
    const { d, calls } = fakeGraph((c) =>
      c.method === 'POST'
        ? ((posted = true), { body: { success: true } })
        : { body: sub(posted ? cb.url : undefined) },
    );
    const r = await subscribeWaba(d, TOKEN, WABA, cb, false);
    expect(r.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      `GET /v25.0/${WABA}/subscribed_apps`,
      `POST /v25.0/${WABA}/subscribed_apps`,
      `GET /v25.0/${WABA}/subscribed_apps`,
    ]);
    expect(calls[1]!.body).toEqual({ override_callback_uri: cb.url, verify_token: cb.verifyToken });
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });
  it('is idempotent: an override that is already ours makes no write', async () => {
    const { d, calls } = fakeGraph(() => ({ body: sub(cb.url) }));
    const r = await subscribeWaba(d, TOKEN, WABA, cb, false);
    expect(r).toMatchObject({ ok: true, skipped: true });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
  it('refuses to overwrite a different override unless told to', async () => {
    const other = 'https://waboo.example.org/hook?k=1234567890abcdef';
    const a = fakeGraph(() => ({ body: sub(other) }));
    const r = await subscribeWaba(a.d, TOKEN, WABA, cb, false);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('waboo.example.org');
    expect(r.text).not.toContain('1234567890abcdef');
    expect(a.calls.every((c) => c.method === 'GET')).toBe(true);
    let posted = false;
    const b = fakeGraph((c) =>
      c.method === 'POST' ? ((posted = true), {}) : { body: sub(posted ? cb.url : other) },
    );
    expect((await subscribeWaba(b.d, TOKEN, WABA, cb, true)).ok).toBe(true);
  });
  it('makes no Meta override for a number the partner platform forwards (Pinnacle): the token check only, nothing to undo', () => {
    expect(
      metaPlan('1056012750933621', WABA, false, true).map((c) => `${c.method} ${c.path}`),
    ).toEqual(['GET /1056012750933621']);
    expect(metaPlan('1056012750933621', WABA, true, true)).toEqual([]);
    expect(metaPlan('1056012750933621', WABA, false)).toHaveLength(5);
    expect(forwardedByPartner('pinnacle')).toBe(true);
    expect(forwardedByPartner('meta')).toBe(false);
    expect(forwardedByPartner(null)).toBe(false);
  });
  it('says what Meta answered when the override never takes', async () => {
    const { d } = fakeGraph((c) =>
      c.method === 'GET'
        ? { body: sub(undefined) }
        : c.body !== undefined
          ? {
              status: 400,
              body: { error: { message: 'Callback URL is not allowed for this app', code: 100 } },
            }
          : { body: { success: true } },
    );
    const r = await subscribeWaba(d, TOKEN, WABA, cb, false);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('Meta said:');
    expect(r.text).toContain('code 100: Callback URL is not allowed for this app');
    expect(r.text).not.toContain(TOKEN);
  });
  it('falls back to a plain subscribe and retries the override, like the app', async () => {
    let n = 0;
    let wired = false;
    const { d, calls } = fakeGraph((c) => {
      if (c.method === 'GET') return { body: sub(wired ? cb.url : undefined) };
      n++;
      if (n === 1) return { status: 400, body: { error: { message: 'not yet', code: 100 } } }; // atomic override refused
      if (n === 2) return { body: { success: true } }; // plain subscribe
      if (n === 3) return { status: 400, body: { error: { message: 'still not', code: 100 } } };
      wired = true;
      return { body: { success: true } };
    });
    expect((await subscribeWaba(d, TOKEN, WABA, cb, false)).ok).toBe(true);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((p) => p.body)).toEqual([
      { override_callback_uri: cb.url, verify_token: cb.verifyToken },
      undefined,
      { override_callback_uri: cb.url, verify_token: cb.verifyToken },
      { override_callback_uri: cb.url, verify_token: cb.verifyToken },
    ]);
  });
  it('does not claim success when Meta never shows the override', async () => {
    const { d } = fakeGraph((c) =>
      c.method === 'POST' ? { body: { success: true } } : { body: sub() },
    );
    const r = await subscribeWaba(d, TOKEN, WABA, cb, false);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/did not confirm/);
  });
  it('stops on a rejected token without retrying', async () => {
    const { d, calls } = fakeGraph((c) =>
      c.method === 'GET'
        ? { body: sub() }
        : { status: 401, body: { error: { message: 'expired', code: 190 } } },
    );
    expect((await subscribeWaba(d, TOKEN, WABA, cb, false)).ok).toBe(false);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('removeOverride (rollback)', () => {
  it('removes the subscription, subscribes again without an override and confirms', async () => {
    let step = 0;
    const { d, calls } = fakeGraph((c) => {
      if (c.method === 'GET') return { body: sub(step < 2 ? cb.url : undefined) };
      step++;
      return { body: { success: true } };
    });
    expect((await removeOverride(d, TOKEN, WABA, cb)).ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE', 'POST', 'GET']);
    expect(calls[2]!.body).toBeUndefined();
  });
  it('does nothing when the override is not ours, and fails loudly when it will not go', async () => {
    const none = fakeGraph(() => ({ body: sub('https://other.example.org/x') }));
    expect(await removeOverride(none.d, TOKEN, WABA, cb)).toMatchObject({
      ok: true,
      skipped: true,
    });
    expect(none.calls.every((c) => c.method === 'GET')).toBe(true);
    const stuck = fakeGraph(() => ({ body: sub(cb.url) }));
    expect((await removeOverride(stuck.d, TOKEN, WABA, cb)).ok).toBe(false);
  });
});

describe('the listed Meta calls', () => {
  it('lists the verify read, the subscription read, the override POST and the confirm read; the rollback has the removal', () => {
    const a = metaPlan('555', WABA, false);
    expect(a.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /555',
      `GET /${WABA}/subscribed_apps`,
      `POST /${WABA}/subscribed_apps`,
      `POST /${WABA}/subscribed_apps`,
      `GET /${WABA}/subscribed_apps`,
    ]);
    expect(a[2]!.fields).toMatch(/override_callback_uri.*verify_token/);
    expect(metaPlan('555', WABA, true).map((c) => c.method)).toEqual([
      'GET',
      'DELETE',
      'POST',
      'GET',
    ]);
  });
});
