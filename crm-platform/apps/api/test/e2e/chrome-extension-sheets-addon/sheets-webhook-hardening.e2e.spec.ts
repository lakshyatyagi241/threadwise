import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSheetsKey } from '../../../src/modules/chrome-extension-sheets-addon/sheets-key.rules';
import { installBodyLimits } from '../../../src/modules/platform-infrastructure/body-limits/body-limits';
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
 * The receiving end of the add-on (`POST /api/v1/sheets-addon/webhook`) under the conditions a real sheet creates: the same row sent again,
 * two requests at once for the same new person, oversized bodies, and what is stored of the key. Real Postgres and Redis, the real app,
 * with the body-size limits installed the way `main.ts` installs them.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness({ configureApp: (app) => installBodyLimits(app as never) });
  api = new Api(h);
  // Listening, so concurrent requests share one server instead of each opening and closing its own.
  await h.app.listen(0, '127.0.0.1');
}, 240_000);
afterAll(async () => h?.stop());

async function workspace(label: string) {
  const t = await api.signup(label);
  await installSheets(h, t);
  const key = await generateKey(api, t.admin);
  return { t, key, call: addon(h, key) };
}

const consentRows = (t: Awaited<ReturnType<typeof workspace>>['t']) =>
  rows(h, 'contact_consent_events', t, `action = 'granted'`);

describe('idempotency: the same row sent again changes nothing', () => {
  it('is one contact, one created event and one consent entry however often the row arrives, edit or schedule', async () => {
    const { t, call } = await workspace('idem');
    const row = {
      ref: 2,
      name: 'Asha',
      email: 'asha@example.com',
      consent: true,
      consent_note: 'Ticked the box on the web form, 2026-10-01',
    };
    const first = await call.post('/webhook', { event: 'edit', rows: [row] });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.results[0]).toMatchObject({ status: 'created' });
    const id = first.body.results[0].id;

    for (const event of ['edit', 'schedule', 'edit']) {
      const again = await call.post('/webhook', { event, rows: [row] });
      expect(again.status).toBe(200);
      expect(again.body.summary).toMatchObject({ created: 0, updated: 0, unchanged: 1, failed: 0 });
      expect(again.body.results[0]).toMatchObject({ status: 'unchanged', id });
    }

    expect(await rows(h, 'contacts', t)).toHaveLength(1);
    expect(await consentRows(t)).toHaveLength(1);
    expect(await api.events(t.orgId, 'contact.created')).toHaveLength(1);
    expect(await api.auditCount(t.orgId, 'contacts', 'insert')).toBe(1);
  });

  it('a changed row updates the one contact and still records the same consent once; a new note is a new entry', async () => {
    const { t, call } = await workspace('idem-update');
    const base = {
      email: 'bo@example.com',
      consent: true,
      consent_note: 'Said yes on the phone, 2026-10-01',
    };
    await call.post('/webhook', { event: 'edit', rows: [{ ref: 2, ...base, name: 'Bo' }] });
    const renamed = await call.post('/webhook', {
      event: 'edit',
      rows: [{ ref: 2, ...base, name: 'Bo Chen' }],
    });
    expect(renamed.body.results[0].status).toBe('updated');
    expect(await rows(h, 'contacts', t)).toHaveLength(1);
    expect(await consentRows(t)).toHaveLength(1);

    await call.post('/webhook', {
      event: 'edit',
      rows: [{ ref: 2, ...base, consent_note: 'Signed the paper form, 2026-10-05' }],
    });
    expect(await rows(h, 'contacts', t)).toHaveLength(1);
    expect(await consentRows(t)).toHaveLength(2);
  });

  it('replaying a captured request later is harmless: it is the same idempotent upsert, and it cannot reach another workspace', async () => {
    const a = await workspace('replay-a');
    const b = await workspace('replay-b');
    const body = { event: 'edit', rows: [{ ref: 2, email: 'replay@example.com', name: 'Replay' }] };
    const original = await a.call.post('/webhook', body);
    expect(original.body.results[0].status).toBe('created');
    const replayed = await Promise.all([
      a.call.post('/webhook', body),
      a.call.post('/webhook', body),
    ]);
    for (const r of replayed) expect(r.body.results[0].status).toBe('unchanged');
    expect(await rows(h, 'contacts', a.t)).toHaveLength(1);
    // The same bytes with another workspace's key land in that workspace only.
    const other = await b.call.post('/webhook', body);
    expect(other.body.results[0].status).toBe('created');
    expect(await rows(h, 'contacts', b.t)).toHaveLength(1);
    expect(await rows(h, 'contacts', a.t)).toHaveLength(1);
  });
});

describe('two requests at once for the same new person', () => {
  it('make one contact, not two', async () => {
    const { t, call } = await workspace('race');
    const body = { event: 'edit', rows: [{ ref: 2, email: 'race@example.com', name: 'Race' }] };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => call.post('/webhook', body)),
    );
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const statuses = results.map((r) => r.body.results[0].status as string);
    expect(statuses.filter((s) => s === 'created')).toHaveLength(1);
    for (const s of statuses) expect(['created', 'updated', 'unchanged']).toContain(s);
    const contacts = await rows(h, 'contacts', t, `email = 'race@example.com'`);
    expect(contacts).toHaveLength(1);
    const identities = await rows(
      h,
      'contact_identities',
      t,
      `kind = 'email' AND value = 'race@example.com'`,
    );
    expect(identities).toHaveLength(1);
    expect(identities[0].contact_id).toBe(contacts[0].id);
    expect(await api.events(t.orgId, 'contact.created')).toHaveLength(1);
  });

  it('also hold for a phone number, and for the same person written two ways in one call', async () => {
    const { t, call } = await workspace('race-phone');
    const same = {
      event: 'edit',
      default_country_code: '+91',
      rows: [{ ref: 2, phone: '98765 43210' }],
    };
    await Promise.all(Array.from({ length: 6 }, () => call.post('/webhook', same)));
    expect(await rows(h, 'contacts', t, `phone = '+919876543210'`)).toHaveLength(1);
    const two = await call.post('/webhook', {
      event: 'edit',
      rows: [
        { ref: 2, email: 'dup@example.com' },
        { ref: 3, email: 'DUP@example.com', name: 'Dup' },
      ],
    });
    expect(two.body.results.map((r: { status: string }) => r.status)).toEqual([
      'created',
      'updated',
    ]);
    expect(await rows(h, 'contacts', t, `email = 'dup@example.com'`)).toHaveLength(1);
  });

  it('never merge two workspaces: the same email at the same moment is one contact in each', async () => {
    const a = await workspace('race-a');
    const b = await workspace('race-b');
    const body = { event: 'edit', rows: [{ ref: 2, email: 'both@example.com' }] };
    await Promise.all([
      ...Array.from({ length: 4 }, () => a.call.post('/webhook', body)),
      ...Array.from({ length: 4 }, () => b.call.post('/webhook', body)),
    ]);
    expect(await rows(h, 'contacts', a.t, `email = 'both@example.com'`)).toHaveLength(1);
    expect(await rows(h, 'contacts', b.t, `email = 'both@example.com'`)).toHaveLength(1);
  });

  it('a person who matches two contacts by identity is refused, not merged, even under load', async () => {
    const { t, call } = await workspace('race-split');
    await api.seedContacts(t, [
      { name: 'One', email: 'one@example.com' },
      { name: 'Two', phone: '+919876500000' },
    ]);
    await h.owner.query(
      `INSERT INTO contact_identities (org_id, contact_id, kind, value, is_primary)
       SELECT c.org_id, c.id, 'email', c.email, true FROM contacts c WHERE c.org_id = $1 AND c.email IS NOT NULL`,
      [t.orgId],
    );
    await h.owner.query(
      `INSERT INTO contact_identities (org_id, contact_id, kind, value, is_primary)
       SELECT c.org_id, c.id, 'phone', c.phone, true FROM contacts c WHERE c.org_id = $1 AND c.phone IS NOT NULL`,
      [t.orgId],
    );
    const res = await call.post('/webhook', {
      event: 'edit',
      rows: [{ ref: 2, email: 'one@example.com', phone: '+919876500000' }],
    });
    expect(res.body.results[0]).toMatchObject({ status: 'failed', error: { code: 'CONFLICT' } });
    expect(await rows(h, 'contacts', t)).toHaveLength(2);
  });
});

describe('limits: size and rows, with the documented answers', () => {
  it('refuses more than 500 rows, none, a body that is not JSON, and an unknown event with 4xx in the add-on envelope', async () => {
    const { call } = await workspace('limits-shape');
    const many = await call.post('/webhook', {
      event: 'edit',
      rows: Array.from({ length: 501 }, (_, i) => ({ email: `m${i}@example.com` })),
    });
    expect(many.status).toBe(422);
    expect(many.body).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(many.body)).toContain('Send at most 500 rows at a time');
    const none = await call.post('/webhook', { event: 'edit', rows: [] });
    expect(none.status).toBe(422);
    const bad = await request(h.app.getHttpServer())
      .post('/api/v1/sheets-addon/webhook')
      .set({
        authorization: `Bearer ${(await workspace('limits-json')).key}`,
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.50',
      })
      .send('{"event": "edit", "rows": [');
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ ok: false });
  });

  it('accepts exactly 500 rows', async () => {
    const { t, call } = await workspace('limits-500');
    const res = await call.post('/webhook', {
      event: 'edit',
      rows: Array.from({ length: 500 }, (_, i) => ({ ref: i + 2, email: `r${i}@example.com` })),
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.summary).toMatchObject({ created: 500, failed: 0 });
    expect(await rows(h, 'contacts', t)).toHaveLength(500);
  }, 120_000);

  it('accepts a body just under 2 MiB and answers 413 PAYLOAD_TOO_LARGE just over it, before anything is read as a row', async () => {
    const { call } = await workspace('limits-bytes');
    const filler = (bytes: number) => ({
      event: 'test',
      rows: [{ values: { Notes: 'x'.repeat(bytes) } }],
    });
    const under = await call.post('/webhook', filler(2 * 1024 * 1024 - 4096));
    expect(under.status, JSON.stringify(under.body).slice(0, 200)).toBe(200);
    const over = await call.post('/webhook', filler(2 * 1024 * 1024 + 1024));
    expect(over.status).toBe(413);
    expect(over.body).toMatchObject({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('answers the 413 even with no key at all (the parser runs first) and without echoing the body', async () => {
    const res = await request(h.app.getHttpServer())
      .post('/api/v1/sheets-addon/webhook')
      .set('x-forwarded-for', '203.0.113.51')
      .send({ event: 'test', rows: [{ values: { Notes: 'y'.repeat(2 * 1024 * 1024 + 1024) } }] });
    expect(res.status).toBe(413);
    expect(JSON.stringify(res.body)).not.toContain('yyyyyyyy');
  });

  it('reports a cell over its field limit as that row failing, with the field, and saves the others', async () => {
    const { t, call } = await workspace('limits-field');
    const res = await call.post('/webhook', {
      event: 'edit',
      rows: [
        { ref: 2, email: 'long@example.com', name: 'n'.repeat(300) },
        { ref: 3, email: 'fine@example.com' },
        { ref: { nested: true }, email: 'ref@example.com' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({
      status: 'failed',
      error: { code: 'VALIDATION_FAILED', field: 'name' },
    });
    expect(res.body.results[1]).toMatchObject({ status: 'created' });
    expect(res.body.results[2].status).toBe('failed');
    expect((await rows(h, 'contacts', t)).map((c) => c.email)).toEqual(['fine@example.com']);
  });

  it('a 50,000-character raw cell in `values` is accepted and only a short sample of it is kept', async () => {
    const { t, call } = await workspace('limits-sample');
    const res = await call.post('/webhook', {
      event: 'edit',
      rows: [{ ref: 2, email: 'big@example.com', values: { Bio: 'z'.repeat(50_000) } }],
    });
    expect(res.status).toBe(200);
    const overview = await api.as(t.admin).get('/v2/extension/sheets/overview');
    expect(overview.body.lastCapture.sample.Bio.length).toBeLessThanOrEqual(120);
  });
});

describe('the key is only ever stored hashed', () => {
  it('has the sha256 and the last 8 characters in the database, and the secret itself nowhere: not in any table, not in Redis', async () => {
    const { t, key, call } = await workspace('hashed');
    // Exercise everything that could write the key somewhere: a test, a data call, a 401, the setup page, a rotate and a revoke.
    await call.post('/webhook', { event: 'test', rows: [{ values: { Email: 'a@example.com' } }] });
    await call.post('/webhook', { event: 'edit', rows: [{ ref: 2, email: 'hashed@example.com' }] });
    await addon(h, `wsn_live_${'1'.repeat(32)}`).get('/health');
    await request(h.app.getHttpServer())
      .post(`/api/v1/sheets-addon/webhook/${key}`)
      .set('x-forwarded-for', '203.0.113.60')
      .send({ event: 'test', rows: [{ values: {} }] });
    await api.as(t.admin).get('/v2/extension/sheets/overview');
    await api.as(t.admin).get('/v2/extension/sheets/key');

    const stored = await h.owner.query(
      `SELECT sheets_key_hash, sheets_key_suffix FROM user_settings WHERE org_id = $1 AND user_id = $2`,
      [t.orgId, t.adminUserId],
    );
    expect(stored.rows[0]).toEqual({
      sheets_key_hash: hashSheetsKey(key),
      sheets_key_suffix: key.slice(-8),
    });
    expect(stored.rows[0].sheets_key_hash).toMatch(/^[0-9a-f]{64}$/);

    const hits = await scanDatabase(key);
    expect(hits, `the key appears in: ${hits.join(', ')}`).toEqual([]);
    const redisHits = await scanRedis(key);
    expect(redisHits, `the key appears in Redis: ${redisHits.join(', ')}`).toEqual([]);

    // Rotate and revoke leave no trace of either key either.
    const rotated = await api.as(t.admin).post('/v2/extension/sheets/key');
    expect(rotated.status).toBe(201);
    await api.as(t.admin).delete('/v2/extension/sheets/key');
    expect(await scanDatabase(key)).toEqual([]);
    expect(await scanDatabase(rotated.body.key as string)).toEqual([]);
    expect(await scanRedis(key)).toEqual([]);
    expect((await addon(h, key, '203.0.113.61').get('/health')).status).toBe(401);
  });

  it('never returns the secret again after creation, and the setup page only shows it masked', async () => {
    const t = await api.signup('hashed-page');
    await installSheets(h, t);
    const made = await api.as(t.admin).post('/v2/extension/sheets/key');
    const key = made.body.key as string;
    for (const path of ['/v2/extension/sheets/key', '/v2/extension/sheets/overview']) {
      const res = await api.as(t.admin).get(path);
      expect(JSON.stringify(res.body), path).not.toContain(key);
    }
  });
});

async function scanDatabase(secret: string): Promise<string[]> {
  const tables = await h.owner.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition`,
  );
  const hits: string[] = [];
  for (const { name } of tables.rows as Array<{ name: string }>) {
    try {
      const res = await h.owner.query(`SELECT 1 FROM "${name}" t WHERE t::text LIKE $1 LIMIT 1`, [
        `%${secret}%`,
      ]);
      if (res.rowCount) hits.push(name);
    } catch {
      // a table the owner cannot cast to text is not one that stores a key
    }
  }
  return hits;
}

async function scanRedis(secret: string): Promise<string[]> {
  const hits: string[] = [];
  for (const k of await h.redis.keys('*')) {
    if (k.includes(secret)) hits.push(k);
    const type = await h.redis.type(k);
    const value =
      type === 'string'
        ? await h.redis.get(k)
        : type === 'hash'
          ? JSON.stringify(await h.redis.hgetall(k))
          : type === 'list'
            ? JSON.stringify(await h.redis.lrange(k, 0, -1))
            : type === 'set'
              ? JSON.stringify(await h.redis.smembers(k))
              : '';
    if (value?.includes(secret)) hits.push(k);
  }
  return hits;
}
