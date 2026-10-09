import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { HOSTILE, VALID, byId } from './fixtures';

/**
 * Unicode, emoji and right-to-left text through the API (QA task 14): what a person types in a name, a title or a note comes back
 * exactly as typed, is found by search, and never turns into a server error. Real HTTP, real Postgres.
 *
 * Rule written down by these tests: text is stored as typed (no Unicode normalisation) and the outer whitespace is trimmed; limits
 * are counted in UTF-16 units, the way zod's `max` counts, so a four-byte emoji uses two of them.
 */
let h: Harness;
let api: Api;
let t: Tenant;
beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('unicode');
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

interface Target {
  name: string;
  path: string;
  /** The field the sample goes in. */
  field: string;
  body: (text: string, n: number) => Record<string, unknown>;
  table: string;
  column: string;
  /** Query-string parameter that searches this field, when the route has one. */
  search?: string;
  /** The route has no read-by-id (tags): the list stands in for it. */
  noReadById?: boolean;
}

let n = 0;
const TARGETS: Target[] = [
  {
    name: 'contact name',
    path: '/v2/contacts',
    field: 'name',
    body: (text) => ({ name: text, phone: `+9198${String(60000000 + ++n).padStart(8, '0')}` }),
    table: 'contacts',
    column: 'name',
    search: 'q',
  },
  {
    name: 'company name',
    path: '/v2/companies',
    field: 'name',
    body: (text) => ({ name: text }),
    table: 'companies',
    column: 'name',
    search: 'q',
  },
  {
    name: 'tag name',
    path: '/v2/tags',
    field: 'name',
    body: (text) => ({ name: text }),
    table: 'tags',
    column: 'name',
    search: 'q',
    noReadById: true,
  },
  {
    name: 'task title',
    path: '/v2/tasks',
    field: 'title',
    body: (text) => ({ title: text }),
    table: 'tasks',
    column: 'title',
    search: 'q',
  },
];

describe.each(TARGETS)('$name', (target) => {
  it.each(VALID.map((s) => [s.id, s] as const))(
    '%s: stored as typed, read back, found by search',
    async (_id, s) => {
      const sent = s.text;
      const created = await api.as(t.admin).post(target.path).send(target.body(sent, n));
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      // Only the outer whitespace goes (the byte order mark is whitespace to JavaScript's trim).
      expect(created.body[target.field]).toBe(sent.trim());

      const id = created.body.id as string;
      if (!target.noReadById) {
        const read = await api.as(t.admin).get(`${target.path}/${id}`);
        expect(read.status).toBe(200);
        expect(read.body[target.field]).toBe(sent.trim());
      }

      const row = await h.owner.query(
        `SELECT ${target.column} AS v FROM ${target.table} WHERE uuid = $1`,
        [id],
      );
      expect(row.rows[0].v).toBe(sent.trim());

      if (target.search) {
        // The first three characters (by code point, so an emoji is not cut in half) must find the record.
        const q = Array.from(sent.trim()).slice(0, 3).join('');
        const found = await api
          .as(t.admin)
          .get(`${target.path}?${target.search}=${encodeURIComponent(q)}&limit=100`);
        expect(found.status, JSON.stringify(found.body)).toBe(200);
        const items = (found.body.data ?? found.body.items ?? []) as Array<{ id: string }>;
        expect(items.map((x) => x.id)).toContain(id);
      }
    },
  );

  it.each(HOSTILE.filter((s) => s.id === 'nul').map((s) => [s.id, s] as const))(
    '%s: a NUL byte is refused with a 4xx, never a 5xx, and nothing is stored',
    async (_id, s) => {
      const before = Number(
        (
          await h.owner.query(`SELECT count(*)::int AS c FROM ${target.table} WHERE org_id = $1`, [
            t.orgId,
          ])
        ).rows[0].c,
      );
      const res = await api.as(t.admin).post(target.path).send(target.body(s.text, n));
      expect(res.status, `${s.label}: ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(400);
      expect(res.status, s.label).toBeLessThan(500);
      const after = Number(
        (
          await h.owner.query(`SELECT count(*)::int AS c FROM ${target.table} WHERE org_id = $1`, [
            t.orgId,
          ])
        ).rows[0].c,
      );
      expect(after).toBe(before);
    },
  );

  it('a right-to-left override is kept exactly as typed (recorded, not stripped)', async () => {
    const s = byId('bidi-override');
    const res = await api.as(t.admin).post(target.path).send(target.body(s.text, n));
    expect(res.status).toBe(201);
    expect(res.body[target.field]).toBe(s.text);
  });
});

describe('a lone surrogate (half an emoji from a client that cut a string)', () => {
  it('is accepted and stored as the replacement character, never a server error: recorded behaviour', async () => {
    const s = byId('lone-surrogate');
    const res = await api.as(t.admin).post('/v2/companies').send({ name: s.text });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('a\uFFFDb');
  });
});

describe('limits count UTF-16 units', () => {
  it('a company name of 191 accented letters is accepted and 192 is refused', async () => {
    const ok = await api
      .as(t.admin)
      .post('/v2/companies')
      .send({ name: 'é'.repeat(191) });
    expect(ok.status).toBe(201);
    const over = await api
      .as(t.admin)
      .post('/v2/companies')
      .send({ name: 'é'.repeat(192) });
    expect(over.status).toBe(422);
  });

  it('96 emoji (192 units) are refused although they are only 96 characters: recorded limit', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/companies')
      .send({ name: '😀'.repeat(96) });
    expect(res.status).toBe(422);
    const fits = await api
      .as(t.admin)
      .post('/v2/companies')
      .send({ name: '😀'.repeat(95) });
    expect(fits.status).toBe(201);
  });
});

describe('the same word in two Unicode forms', () => {
  it.fails(
    'a tag named Café in NFD is refused when the NFC one exists (DEFECT: both are accepted)',
    async () => {
      const nfc = byId('accent-nfc').text.split(' ')[0]!;
      const nfd = byId('accent-nfd').text.split(' ')[0]!;
      expect(nfc).not.toBe(nfd);
      expect(nfc.normalize('NFC')).toBe(nfd.normalize('NFC'));
      const first = await api.as(t.admin).post('/v2/tags').send({ name: nfc });
      expect(first.status).toBe(201);
      const second = await api.as(t.admin).post('/v2/tags').send({ name: nfd });
      // Expected: 409, the two look identical to a person. Today: 201, two tags that look the same.
      expect(second.status).toBe(409);
    },
  );
});
