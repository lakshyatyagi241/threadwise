import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, setupStatusResponseSchema, systemStatusResponseSchema } from '@crm/contracts';
import { bearer, operatorToken } from './helpers';
import { SETUP_TOKEN, startHarness, type Harness } from './harness';

/**
 * Purchase-code enforcement (WD-INST-003, -017, -020) with `LICENCE_MODE=envato`, against a stand-in for
 * api.envato.com. Covers the wizard's licence step, the same check repeated by the install run (WaDesk checked it
 * only on the page), and the Updater's licence card.
 */
const ITEM = '63755235';
const AUTHOR_TOKEN = 'author-token-do-not-log';
const GOOD = 'aaaaaaaa-bbbb-cccc-dddd-111111111111';
const OTHER_ITEM = 'aaaaaaaa-bbbb-cccc-dddd-222222222222';
const BROKEN = 'aaaaaaaa-bbbb-cccc-dddd-333333333333';
const DOWN = 'aaaaaaaa-bbbb-cccc-dddd-444444444444';

const calls: Array<{ url: string; auth: string | null }> = [];
const envato = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
  const code = new URL(url).searchParams.get('code');
  if (code === DOWN) throw new Error(`connect ECONNREFUSED while fetching ${url}`);
  if (code === BROKEN) return new Response('boom', { status: 503 });
  if (code === GOOD) return Response.json({ item: { id: Number(ITEM) } });
  if (code === OTHER_ITEM) return Response.json({ item: { id: 1234 } });
  return new Response('{}', { status: 404 });
}) as typeof fetch;

let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Tr1cky-Passphrase!42';
const form = (over: Record<string, unknown> = {}) => ({
  setupToken: SETUP_TOKEN,
  purchaseCode: GOOD,
  operator: { fullName: 'Asha Rao', email: 'owner@acme.test', password: PASSWORD },
  organization: { name: 'Acme Ltd', slug: 'acme', timezone: 'UTC', locale: 'en' },
  ...over,
});
const count = async (table: string) =>
  Number((await h.owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
const reason = (res: request.Response) =>
  (res.body.errors as Array<{ path: string; message: string }>)[0]?.message;

beforeAll(async () => {
  h = await startHarness(
    { LICENCE_MODE: 'envato', ENVATO_ITEM_ID: ITEM, ENVATO_AUTHOR_TOKEN: AUTHOR_TOKEN },
    envato,
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('the licence step (WD-INST-003)', () => {
  it('is part of the wizard: status says a code is required', async () => {
    const status = setupStatusResponseSchema.parse((await api().get('/v2/setup/status')).body);
    expect(status.licenceRequired).toBe(true);
  });

  it('verifies a code sold for this item, sending the author token as a bearer and nothing else secret', async () => {
    const res = await api()
      .post('/v2/setup/verify-licence')
      .send({ setupToken: SETUP_TOKEN, purchaseCode: GOOD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const call = calls.at(-1);
    expect(call?.auth).toBe(`Bearer ${AUTHOR_TOKEN}`);
    expect(call?.url).toContain('api.envato.com/v3/market/author/sale');
  });

  it('answers each Envato outcome with its own reason: not found, HTTP error, unreachable, other product', async () => {
    const check = async (code: string) =>
      api().post('/v2/setup/verify-licence').send({ setupToken: SETUP_TOKEN, purchaseCode: code });

    const notFound = await check('zzzzzzzz-0000-0000-0000-000000000000');
    expect(notFound.status).toBe(422);
    expect(notFound.body.code).toBe(ERROR_CODES.SETUP_LICENCE_INVALID);
    expect(reason(notFound)).toBe('not_found');

    expect(reason(await check(BROKEN))).toBe('http_error');
    const down = await check(DOWN);
    expect(reason(down)).toBe('unreachable');
    // the failure message must not echo the request (it carries the code) or any secret
    expect(JSON.stringify(down.body)).not.toContain(AUTHOR_TOKEN);
    expect(JSON.stringify(down.body)).not.toContain('ECONNREFUSED');

    expect(reason(await check(OTHER_ITEM))).toBe('other_product');
  });

  it('refuses an empty code and a wrong setup token', async () => {
    const empty = await api()
      .post('/v2/setup/verify-licence')
      .send({ setupToken: SETUP_TOKEN, purchaseCode: '  ' });
    expect(empty.status).toBe(422);
    const token = await api()
      .post('/v2/setup/verify-licence')
      .send({ setupToken: 'x'.repeat(40), purchaseCode: GOOD });
    expect(token.status).toBe(403);
  });
});

describe('the gate is the write, not the page (WD-INST-003 quirk 4)', () => {
  it('step 1 verifies the code again: no code, a bad code or another product stops the run', async () => {
    const none = await api()
      .post('/v2/setup/run')
      .send({ ...form({ purchaseCode: undefined }), step: 1 });
    expect(none.status).toBe(422);
    expect(reason(none)).toBe('empty');

    const other = await api()
      .post('/v2/setup/run')
      .send({ ...form({ purchaseCode: OTHER_ITEM }), step: 1 });
    expect(other.status).toBe(422);
    expect(reason(other)).toBe('other_product');
    expect(await count('platform_setup')).toBe(0);
  });

  it('the one-call bootstrap cannot skip it either, and creates nothing', async () => {
    const res = await api()
      .post('/v2/setup/bootstrap')
      .send(form({ purchaseCode: 'zzzzzzzz-0000-0000-0000-000000000000' }));
    expect(res.status).toBe(422);
    expect(await count('platform_operators')).toBe(0);
    expect(await count('organizations')).toBe(0);
  });

  it('a verified code is stored sealed with the time, and the run completes', async () => {
    const res = await api().post('/v2/setup/bootstrap').send(form());
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const code = (
      await h.owner.query(
        `SELECT value, is_secret FROM platform_settings WHERE key = 'inst.licence.code'`,
      )
    ).rows[0];
    expect(code.is_secret).toBe(true);
    expect(JSON.stringify(code.value)).not.toContain(GOOD);
    const meta = (
      await h.owner.query(`SELECT value FROM platform_settings WHERE key = 'inst.licence'`)
    ).rows[0];
    expect(new Date(meta.value.verifiedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('the Updater licence card (WD-INST-020)', () => {
  let token: string;
  it('shows the licence as required and verified after setup, never the code', async () => {
    token = await operatorToken(h, 'owner@acme.test', PASSWORD);
    const res = await api().get('/v2/platform/system').set(bearer(token));
    expect(res.status).toBe(200);
    const sys = systemStatusResponseSchema.parse(res.body);
    expect(sys.licence).toMatchObject({ required: true, verified: true });
    expect(sys.licence.verifiedAt).not.toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(GOOD);
  });

  it('re-verifies a code for a super admin and audits it without the code', async () => {
    const res = await api()
      .post('/v2/platform/system/licence')
      .set(bearer(token))
      .send({ purchaseCode: GOOD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.licence).toMatchObject({ required: true, verified: true });
    const audit = await h.owner.query(
      `SELECT status, payload FROM security_events WHERE event = 'admin.updater.verify' ORDER BY id`,
    );
    expect(audit.rows.at(-1)).toMatchObject({ status: 'success' });
    expect(JSON.stringify(audit.rows)).not.toContain(GOOD);
  });

  it('answers a bad code with the reason and audits the failure', async () => {
    const res = await api()
      .post('/v2/platform/system/licence')
      .set(bearer(token))
      .send({ purchaseCode: OTHER_ITEM });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(ERROR_CODES.SETUP_LICENCE_INVALID);
    expect(reason(res)).toBe('other_product');
    const audit = await h.owner.query(
      `SELECT status, payload FROM security_events WHERE event = 'admin.updater.verify' ORDER BY id DESC LIMIT 1`,
    );
    expect(audit.rows[0]).toMatchObject({
      status: 'failure',
      payload: { result: 'other_product' },
    });
  });

  it('is for the super admin only, and for signed-in operators only', async () => {
    expect(
      (await api().post('/v2/platform/system/licence').send({ purchaseCode: GOOD })).status,
    ).toBe(401);
    await h.owner.query(
      `INSERT INTO platform_operators (email, full_name, password_hash, role)
       SELECT 'support@acme.test', 'Support', password_hash, 'support' FROM platform_operators WHERE email = 'owner@acme.test'`,
    );
    const support = await operatorToken(h, 'support@acme.test', PASSWORD);
    const res = await api()
      .post('/v2/platform/system/licence')
      .set(bearer(support))
      .send({ purchaseCode: GOOD });
    expect(res.status).toBe(403);
    expect((await api().get('/v2/platform/system').set(bearer(support))).status).toBe(200);
  });
});
