import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  addon,
  generateKey,
  installSheets,
  rows,
  startHarness,
  type Harness,
} from './support';

/**
 * The webhook trigger (new in this port, modelled on Pabbly's Google Sheets webhook add-on): the Webhook URL carries the key, a test only
 * records the columns, and a data call writes the rows as contacts like "Push contacts". Real Postgres and Redis, the real app.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);
afterAll(async () => h?.stop());

async function workspace(label: string) {
  const t = await api.signup(label);
  await installSheets(h, t);
  const key = await generateKey(api, t.admin);
  return { t, key, call: addon(h, key) };
}

const overview = (token: string) => api.as(token).get('/v2/extension/sheets/overview');

describe('the Webhook URL', () => {
  it('is returned once with the new key, ends in the key, and is only masked on the setup page afterwards', async () => {
    const t = await api.signup('wh-url');
    await installSheets(h, t);
    const made = await api.as(t.admin).post('/v2/extension/sheets/key');
    expect(made.status).toBe(201);
    expect(made.body.webhookUrl).toMatch(
      /\/api\/v1\/sheets-addon\/webhook\/wsn_live_[0-9a-f]{32}$/,
    );
    expect(made.body.webhookUrl.endsWith(made.body.key)).toBe(true);

    const page = await overview(t.admin);
    expect(page.status).toBe(200);
    expect(page.body.webhookUrl).toContain(`wsn_live_••••••••${made.body.suffix}`);
    expect(JSON.stringify(page.body)).not.toContain(made.body.key);
    expect(page.body.lastCapture).toBeNull();
  });
});

describe('POST /webhook', () => {
  it('a test records the columns, writes no contact, and shows on the setup page', async () => {
    const { t, call } = await workspace('wh-test');
    const res = await call.post('/webhook', {
      event: 'test',
      sheet_name: 'Leads',
      rows: [{ ref: 2, values: { Name: 'Ann', Email: 'ann@example.com' } }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      event: 'test',
      received: 1,
      written: false,
      fields: ['Name', 'Email'],
    });
    expect(await rows(h, 'contacts', t)).toHaveLength(0);

    const page = await overview(t.admin);
    expect(page.body.lastCapture).toMatchObject({
      event: 'test',
      sheetName: 'Leads',
      rows: 1,
      fields: ['Name', 'Email'],
      sample: { Name: 'Ann', Email: 'ann@example.com' },
    });
  });

  it('an edit or a schedule call writes the rows as contacts and answers per row', async () => {
    const { t, call } = await workspace('wh-data');
    const res = await call.post('/webhook', {
      event: 'edit',
      sheet_name: 'Leads',
      rows: [
        { ref: 2, email: 'one@example.com', name: 'One', values: { Email: 'one@example.com' } },
        { ref: 3, values: { Name: 'No identity' } },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.written).toBe(true);
    expect(res.body.summary).toMatchObject({ created: 1, failed: 1 });
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'created',
      'failed',
    ]);
    const stored = await rows(h, 'contacts', t);
    expect(stored.map((c) => c.email)).toEqual(['one@example.com']);
    expect(stored[0].source).toBe('google_sheets');
  });

  it('accepts the key as the last path segment, the way the pasted URL carries it', async () => {
    const { key } = await workspace('wh-path');
    const res = await request(h.app.getHttpServer())
      .post(`/api/v1/sheets-addon/webhook/${key}`)
      .set('x-forwarded-for', '203.0.113.77')
      .send({ event: 'test', rows: [{ values: { Email: 'x@example.com' } }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fields).toEqual(['Email']);
  });

  it('refuses a wrong key in the path and in the header with the same 401, and never reaches the other workspace', async () => {
    const { key: keyA } = await workspace('wh-a');
    const bad = `wsn_live_${'0'.repeat(32)}`;
    const viaPath = await request(h.app.getHttpServer())
      .post(`/api/v1/sheets-addon/webhook/${bad}`)
      .set('x-forwarded-for', '203.0.113.78')
      .send({ event: 'test', rows: [{ values: {} }] });
    const viaHeader = await addon(h, bad, '203.0.113.79').post('/webhook', {
      event: 'test',
      rows: [{ values: {} }],
    });
    expect([viaPath.status, viaHeader.status]).toEqual([401, 401]);
    expect(viaPath.body.error).toBe(viaHeader.body.error);
    expect(keyA).not.toBe(bad);
  });

  it('rejects an unknown event, no rows and more than 500 rows with a 422 in the add-on envelope', async () => {
    const { call } = await workspace('wh-422');
    const unknown = await call.post('/webhook', { event: 'delete', rows: [{}] });
    const empty = await call.post('/webhook', { event: 'edit', rows: [] });
    const many = await call.post('/webhook', {
      event: 'edit',
      rows: Array.from({ length: 501 }, (_, i) => ({ email: `m${i}@example.com` })),
    });
    for (const res of [unknown, empty, many]) {
      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
    }
  });
});
