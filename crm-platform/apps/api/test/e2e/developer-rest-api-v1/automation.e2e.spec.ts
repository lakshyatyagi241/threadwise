import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { Api, startHarness, tenantWithKey, type Harness, type Tenant } from './support';

/**
 * The automation group of the customer API: message templates and flows (TW-API-030 to 037, 044 to 047). Auto-replies (TW-API-038 to
 * 043) are blocked on a missing domain and have no test here.
 */
describe('customer API v1: automation', () => {
  let h: Harness;
  let api: Api;

  beforeAll(async () => {
    h = await startHarness();
    api = new Api(h);
  }, 240_000);
  afterAll(async () => h.stop());

  let seq = 0;
  /** A connected WhatsApp number with an encrypted token, straight into the table. */
  async function seedNumber(t: Tenant, status = 'connected', primary = true) {
    const n = ++seq;
    const crypto = h.app.get(CryptoService, { strict: false });
    const res = await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, credentials_json, meta_json, phone_number, display_label, is_primary, connected_at)
       VALUES ($1, 'waba', $2, $3, $4::jsonb, $5, 'Acme', $6, now()) RETURNING id, uuid`,
      [
        t.orgId,
        status,
        crypto.encrypt(JSON.stringify({ access_token: 'TOKEN-1' })),
        JSON.stringify({
          waba_id: `7000${Date.now() % 100000}${n}`,
          phone_number_id: `8000${n}`,
          provider: 'meta',
        }),
        `+91981120${String(n).padStart(4, '0')}`,
        primary,
      ],
    );
    return { id: Number(res.rows[0].id), uuid: String(res.rows[0].uuid) };
  }

  interface TplSpec {
    name?: string;
    status?: string;
    metaStatus?: string | null;
    metaId?: string | null;
    body?: string;
    footer?: string | null;
    buttons?: unknown[] | null;
    conn?: { id: number } | null;
    quality?: string | null;
    pausedUntil?: string | null;
    createdAt?: string;
    metaCategory?: string;
    type?: string;
  }
  /** A template straight into the table. Sendable by default (approved on Meta, with a Meta id). */
  async function seedTemplate(t: Tenant, spec: TplSpec = {}) {
    const res = await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, language, status, meta_status, meta_template_id, template_body, footer, buttons,
                                 meta_category, category, template_type, provider_config_id, channel, quality_score, paused_until, created_at, submitted_at)
       VALUES ($1,$2,'en_US',$3,$4,$5,$6,$7,$8::jsonb,$9,lower($9),$10,$11,'waba',$12,$13::timestamptz, COALESCE($14::timestamptz, now()), now())
       RETURNING id, uuid`,
      [
        t.orgId,
        spec.name ?? `tpl_${randomUUID().slice(0, 8)}`,
        spec.status ?? 'approved',
        spec.metaStatus === undefined ? 'APPROVED' : spec.metaStatus,
        spec.metaId === undefined ? `M${randomUUID().slice(0, 12)}` : spec.metaId,
        spec.body ?? 'Hi {{1}}, your order {{2}} is ready.',
        spec.footer ?? null,
        spec.buttons === undefined || spec.buttons === null ? null : JSON.stringify(spec.buttons),
        spec.metaCategory ?? 'UTILITY',
        spec.type ?? 'standard',
        spec.conn === undefined ? null : spec.conn?.id,
        spec.quality ?? null,
        spec.pausedUntil ?? null,
        spec.createdAt ?? null,
      ],
    );
    return { id: Number(res.rows[0].id), uuid: String(res.rows[0].uuid) };
  }

  const tplRow = async (uuid: string) =>
    (await h.owner.query(`SELECT * FROM wa_templates WHERE uuid = $1`, [uuid])).rows[0];

  // --- templates: list, categories, show ------------------------------------------------------------------------------------

  describe('templates: read', () => {
    it('every template route answers 401 missing_api_key without a key (TW-API-030, 031, 033)', async () => {
      const { call } = await tenantWithKey(api, 'tpl-401');
      for (const path of ['/templates', '/templates/categories', `/templates/${randomUUID()}`]) {
        const res = await call.raw('get', path);
        expect(res.status, path).toBe(401);
        expect(res.body.error.code, path).toBe('missing_api_key');
      }
    });

    it('GET /templates/categories lists Marketing, Authentication and Utility with ids 1, 2, 3 and no meta, and is not read as an id (TW-API-031)', async () => {
      const { call } = await tenantWithKey(api, 'tpl-cat');
      const res = await call.get('/templates/categories');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual({
        data: [
          { id: 1, name: 'Marketing' },
          { id: 2, name: 'Authentication' },
          { id: 3, name: 'Utility' },
        ],
      });
      expect(res.body).not.toHaveProperty('meta');
    });

    it('GET /templates lists only sendable templates, newest first, in the public shape (TW-API-030)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-list');
      const num = await seedNumber(tenant);
      const day = (d: number) => `2026-09-0${d}T10:00:00Z`;
      const oldest = await seedTemplate(tenant, { name: 'oldest', conn: num, createdAt: day(1) });
      const middle = await seedTemplate(tenant, {
        name: 'middle',
        conn: null,
        createdAt: day(2),
        footer: 'Thanks',
        buttons: [
          { type: 'URL', text: 'Open', url: 'https://a.test' },
          { type: 'QUICK_REPLY', text: 'Yes' },
        ],
      });
      const newest = await seedTemplate(tenant, { name: 'newest', conn: num, createdAt: day(3) });
      // not sendable: draft, pending on Meta, no Meta id, paused, and one on a number that is not connected
      await seedTemplate(tenant, {
        name: 'draft',
        status: 'draft',
        metaStatus: null,
        metaId: null,
        conn: num,
      });
      await seedTemplate(tenant, {
        name: 'pending',
        status: 'pending',
        metaStatus: 'PENDING',
        conn: num,
      });
      await seedTemplate(tenant, { name: 'nometa', metaId: null, conn: num });
      await seedTemplate(tenant, {
        name: 'paused',
        pausedUntil: '2999-01-01T00:00:00Z',
        conn: num,
      });
      const off = await seedNumber(tenant, 'disconnected', false);
      await seedTemplate(tenant, { name: 'offline', conn: off });

      const res = await call.get('/templates');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.map((t: { name: string }) => t.name)).toEqual([
        'newest',
        'middle',
        'oldest',
      ]);
      expect(res.body.meta).toEqual({ limit: 25, next_cursor: null, has_more: false });
      const mid = res.body.data[1];
      expect(mid).toEqual({
        id: middle.uuid,
        name: 'middle',
        type: 'standard',
        category: 'utility',
        language: 'en_US',
        header: null,
        header_location: null,
        body: 'Hi {{1}}, your order {{2}} is ready.',
        footer: 'Thanks',
        buttons: [
          { type: 'visit_website', text: 'Open', value: 'https://a.test' },
          { type: 'quick_reply', text: 'Yes' },
        ],
        carousel_data: [],
        attachment_type: null,
        status: 'approved',
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
      expect(res.body.data[0].id).toBe(newest.uuid);
      expect(res.body.data[2].id).toBe(oldest.uuid);
      for (const hidden of [
        'meta_status',
        'meta_template_id',
        'quality_score',
        'variable_map',
        'provider_config_id',
      ])
        expect(mid).not.toHaveProperty(hidden);
    });

    it('GET /templates on an empty workspace answers an empty list (TW-API-030)', async () => {
      const { call } = await tenantWithKey(api, 'tpl-empty');
      const res = await call.get('/templates');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [],
        meta: { limit: 25, next_cursor: null, has_more: false },
      });
    });

    it("GET /templates pages with a cursor and never shows another workspace's templates (TW-API-030)", async () => {
      const a = await tenantWithKey(api, 'tpl-page-a');
      const b = await tenantWithKey(api, 'tpl-page-b');
      for (let i = 1; i <= 5; i++)
        await seedTemplate(a.tenant, { name: `a${i}`, createdAt: `2026-09-0${i}T10:00:00Z` });
      await seedTemplate(b.tenant, { name: 'secret-b' });

      const first = await a.call.get('/templates?limit=2');
      expect(first.body.data.map((t: { name: string }) => t.name)).toEqual(['a5', 'a4']);
      expect(first.body.meta.has_more).toBe(true);
      const second = await a.call.get(
        `/templates?per_page=2&cursor=${first.body.meta.next_cursor}`,
      );
      expect(second.body.data.map((t: { name: string }) => t.name)).toEqual(['a3', 'a2']);
      const third = await a.call.get(`/templates?limit=2&cursor=${second.body.meta.next_cursor}`);
      expect(third.body.data.map((t: { name: string }) => t.name)).toEqual(['a1']);
      expect(third.body.meta).toMatchObject({ has_more: false, next_cursor: null });
      expect(JSON.stringify([first.body, second.body, third.body])).not.toContain('secret-b');
      expect((await a.call.get('/templates?page=2')).status).toBe(422);
    });

    it('GET /templates keeps scanning past unsendable rows so a page is not short (TW-API-030)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-scan');
      for (let i = 1; i <= 4; i++)
        await seedTemplate(tenant, { name: `ok${i}`, createdAt: `2026-09-0${i}T10:00:00Z` });
      for (let i = 5; i <= 8; i++)
        await seedTemplate(tenant, {
          name: `bad${i}`,
          metaId: null,
          createdAt: `2026-09-0${i}T10:00:00Z`,
        });
      const res = await call.get('/templates?limit=2');
      expect(res.body.data.map((t: { name: string }) => t.name)).toEqual(['ok4', 'ok3']);
      expect(res.body.meta.has_more).toBe(true);
    });

    it('GET /templates/{id} returns a template whatever its state, and 404 not_found for another workspace, an unknown id and a non-uuid (TW-API-033)', async () => {
      const a = await tenantWithKey(api, 'tpl-show-a');
      const b = await tenantWithKey(api, 'tpl-show-b');
      const rejected = await seedTemplate(a.tenant, {
        name: 'rejected_one',
        status: 'rejected',
        metaStatus: 'REJECTED',
        metaId: null,
      });
      const theirs = await seedTemplate(b.tenant, { name: 'theirs' });

      const ok = await a.call.get(`/templates/${rejected.uuid}`);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data).toMatchObject({
        id: rejected.uuid,
        name: 'rejected_one',
        status: 'rejected',
        buttons: [],
        carousel_data: [],
      });

      for (const id of [theirs.uuid, randomUUID()]) {
        const res = await a.call.get(`/templates/${id}`);
        expect(res.status, id).toBe(404);
        expect(res.body.error.code).toBe('not_found');
      }
      expect((await a.call.get('/templates/12')).status).toBe(404);
    });

    it('a key whose scopes name another resource is refused 403 forbidden; templates:read reads but cannot write (TW-API-030, 032)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-scope');
      await h.owner.query(`UPDATE api_keys SET scopes = ARRAY['contacts:read'] WHERE org_id = $1`, [
        tenant.orgId,
      ]);
      expect((await call.get('/templates')).status).toBe(403);
      await h.owner.query(
        `UPDATE api_keys SET scopes = ARRAY['templates:read'] WHERE org_id = $1`,
        [tenant.orgId],
      );
      expect((await call.get('/templates')).status).toBe(200);
      const write = await call.post('/templates', {
        template_name: 'x',
        category: 3,
        template_body: 'y',
      });
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe('forbidden');
    });
  });

  // --- templates: write ------------------------------------------------------------------------------------------------------

  describe('templates: create, update, delete', () => {
    it('POST /templates saves a draft on the primary number, never calls Meta, stamps the key owner and audits it (TW-API-032)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-create');
      const num = await seedNumber(tenant);
      const res = await call.post('/templates', {
        template_name: 'Order Update',
        category: 3,
        template_body: 'Hi {{name}}, your order {{city}} is ready.',
        footer: 'Acme',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({
        name: 'order_update',
        type: 'standard',
        category: 'utility',
        language: 'en_US',
        body: 'Hi {{1}}, your order {{2}} is ready.',
        footer: 'Acme',
        status: 'draft',
      });
      const row = await tplRow(res.body.data.id);
      expect(Number(row.org_id)).toBe(tenant.orgId);
      expect(Number(row.provider_config_id)).toBe(num.id);
      expect(Number(row.user_id)).toBe(tenant.adminUserId);
      expect(row.meta_template_id).toBeNull();
      expect(row.submitted_at).toBeNull();
      expect(row.variable_map).toEqual({
        body: [
          { num: 1, key: 'name' },
          { num: 2, key: 'city' },
        ],
      });
      const audit = await h.owner.query(
        `SELECT action, actor_type FROM audit_log WHERE org_id = $1 AND module = 'wa_templates'`,
        [tenant.orgId],
      );
      expect(audit.rows).toEqual([{ action: 'insert', actor_type: 'api_key' }]);
      const outbox = await h.owner.query(
        `SELECT event_type FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'wa_templates'`,
        [tenant.orgId],
      );
      expect(outbox.rows.map((r) => r.event_type)).toEqual(['template.created']);
    });

    it('POST /templates reads the category as a Meta id, a slug or an industry bucket (TW-API-032)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-cats');
      await seedNumber(tenant);
      const make = async (name: string, category: string | number) =>
        (await call.post('/templates', { template_name: name, category, template_body: 'x' })).body
          .data.category;
      expect(await make('c_one', 1)).toBe('marketing');
      expect(await make('c_two', '2')).toBe('authentication');
      expect(await make('c_slug', ' Utility ')).toBe('utility');
      expect(await make('c_bucket', 'travel')).toBe('utility');
    });

    it('POST /templates needs a body only for a literal standard type; with the type omitted the body is stored empty (TW-API-032)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-body');
      await seedNumber(tenant);
      const refused = await call.post('/templates', {
        template_name: 'nb',
        category: 3,
        template_type: 'standard',
      });
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('validation_failed');
      expect(refused.body.error.details.template_body).toBeDefined();
      const quirk = await call.post('/templates', { template_name: 'nb2', category: 3 });
      expect(quirk.status, JSON.stringify(quirk.body)).toBe(201);
      expect(quirk.body.data.body).toBe('');
    });

    it('POST /templates keeps three buttons, call-to-action first, then quick replies (TW-API-032)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-buttons');
      await seedNumber(tenant);
      const res = await call.post('/templates', {
        template_name: 'btns',
        category: 3,
        template_body: 'x',
        buttons: [
          { type: 'visit_website', text: 'Site', value: 'https://a.test' },
          { type: 'call_phone', text: 'Call', value: '9811200001', country_code: '91' },
          { type: 'quick_reply', text: 'One' },
          { type: 'quick_reply', text: 'Two' },
        ],
        quick_replies: ['Three', { text: 'Four' }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.buttons.map((b: { type: string }) => b.type)).toEqual([
        'visit_website',
        'call_phone',
        'quick_reply',
      ]);
      const stored = (await tplRow(res.body.data.id)).buttons;
      expect(stored).toHaveLength(3);
    });

    it('POST /templates refuses a bad body with 422 and details per field (TW-API-032)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-422');
      await seedNumber(tenant);
      const cases: Array<[object, string]> = [
        [{ category: 3, template_body: 'x' }, 'template_name'],
        [{ template_name: 'x', template_body: 'x' }, 'category'],
        [{ template_name: 'x'.repeat(192), category: 3, template_body: 'x' }, 'template_name'],
        [{ template_name: 'x', category: 3, template_body: 'x'.repeat(4097) }, 'template_body'],
        [
          { template_name: 'x', category: 3, template_body: 'x', template_type: 'bogus' },
          'template_type',
        ],
        [{ template_name: 'x', category: 3, template_body: 'x', latitude: 10 }, 'longitude'],
        [
          { template_name: 'x', category: 3, template_body: 'x', code_expiration_minutes: 120 },
          'code_expiration_minutes',
        ],
      ];
      for (const [body, field] of cases) {
        const res = await call.post('/templates', body);
        expect(res.status, JSON.stringify(body)).toBe(422);
        expect(res.body.error.details, JSON.stringify(res.body)).toHaveProperty(field);
      }
      expect(
        (
          await h.owner.query(`SELECT count(*)::int AS n FROM wa_templates WHERE org_id = $1`, [
            tenant.orgId,
          ])
        ).rows[0].n,
      ).toBe(0);
    });

    it('POST /templates without a WhatsApp number answers 422 tpl_no_connection and stores nothing (TW-API-032)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-nonum');
      const res = await call.post('/templates', {
        template_name: 'x',
        category: 3,
        template_body: 'y',
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('tpl_no_connection');
      expect(
        (
          await h.owner.query(`SELECT count(*)::int AS n FROM wa_templates WHERE org_id = $1`, [
            tenant.orgId,
          ])
        ).rows[0].n,
      ).toBe(0);
    });

    it('POST /templates names what it cannot store yet instead of dropping it: carousel and a location pin (TW-API-032)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-unsup');
      await seedNumber(tenant);
      const carousel = await call.post('/templates', {
        template_name: 'c',
        category: 3,
        template_type: 'carousel',
        carousel_data: [{}],
      });
      expect(carousel.status).toBe(422);
      const pin = await call.post('/templates', {
        template_name: 'p',
        category: 3,
        template_body: 'x',
        latitude: 10,
        longitude: 20,
      });
      expect(pin.status).toBe(422);
      expect(pin.body.error.details).toHaveProperty('latitude');
    });

    it('POST /templates answers 409 for a name already used on the number and 401 without a key (TW-API-032)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-dup');
      await seedNumber(tenant);
      const body = { template_name: 'same_name', category: 3, template_body: 'x' };
      expect((await call.post('/templates', body)).status).toBe(201);
      const dup = await call.post('/templates', body);
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('tpl_name_taken');
      expect((await call.raw('post', '/templates')).status).toBe(401);
    });

    it('PUT /templates/{id} overwrites header, footer and expiry, keeps buttons unless sent, and clears them with an empty list (TW-API-034)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-put');
      const num = await seedNumber(tenant);
      const t = await seedTemplate(tenant, {
        name: 'editable',
        status: 'draft',
        metaStatus: null,
        metaId: null,
        conn: num,
        footer: 'Old footer',
        buttons: [{ type: 'QUICK_REPLY', text: 'Keep me' }],
      });
      const res = await call.put(`/templates/${t.uuid}`, {
        template_name: 'editable',
        category: 3,
        template_body: 'New body {{1}}',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        body: 'New body {{1}}',
        footer: null,
        language: 'en_US',
      });
      expect(res.body.data.buttons).toEqual([{ type: 'quick_reply', text: 'Keep me' }]);

      const cleared = await call.put(`/templates/${t.uuid}`, {
        template_name: 'editable',
        category: 3,
        template_body: 'Body',
        buttons: [],
      });
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
      expect(cleared.body.data.buttons).toEqual([]);
      const audit = await h.owner.query(
        `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'wa_templates' ORDER BY id`,
        [tenant.orgId],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['update', 'update']);
    });

    it('PUT /templates/{id} validates before it looks the template up: unknown id with a valid body is 404, with an empty body 422 (TW-API-034)', async () => {
      const { call } = await tenantWithKey(api, 'tpl-put-order');
      const missing = await call.put(`/templates/${randomUUID()}`, {
        template_name: 'x',
        category: 3,
        template_body: 'y',
      });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('not_found');
      const invalid = await call.put(`/templates/${randomUUID()}`, {});
      expect(invalid.status).toBe(422);
    });

    it("PUT /templates/{id} cannot touch another workspace's template (TW-API-034)", async () => {
      const a = await tenantWithKey(api, 'tpl-put-a');
      const b = await tenantWithKey(api, 'tpl-put-b');
      const numB = await seedNumber(b.tenant);
      const theirs = await seedTemplate(b.tenant, {
        name: 'theirs',
        status: 'draft',
        metaStatus: null,
        metaId: null,
        conn: numB,
        body: 'untouched',
      });
      const res = await a.call.put(`/templates/${theirs.uuid}`, {
        template_name: 'theirs',
        category: 3,
        template_body: 'hijacked',
      });
      expect(res.status).toBe(404);
      expect((await tplRow(theirs.uuid)).template_body).toBe('untouched');
    });

    it('PUT /templates/{id} on an approved template is refused 409 and leaves it approved (TW-API-034, intended difference)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-put-approved');
      const num = await seedNumber(tenant);
      const t = await seedTemplate(tenant, {
        name: 'approved_one',
        conn: num,
        body: 'as approved',
      });
      const res = await call.put(`/templates/${t.uuid}`, {
        template_name: 'approved_one',
        category: 3,
        template_body: 'changed',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('tpl_not_editable');
      const row = await tplRow(t.uuid);
      expect(row.status).toBe('approved');
      expect(row.template_body).toBe('as approved');
    });

    it("DELETE /templates/{id} removes an own template (a later GET is 404) and refuses another workspace's (TW-API-035)", async () => {
      const a = await tenantWithKey(api, 'tpl-del-a');
      const b = await tenantWithKey(api, 'tpl-del-b');
      const numA = await seedNumber(a.tenant);
      const numB = await seedNumber(b.tenant);
      const mine = await seedTemplate(a.tenant, {
        name: 'mine',
        status: 'draft',
        metaStatus: null,
        metaId: null,
        conn: numA,
      });
      const theirs = await seedTemplate(b.tenant, {
        name: 'theirs',
        status: 'draft',
        metaStatus: null,
        metaId: null,
        conn: numB,
      });

      const res = await a.call.delete(`/templates/${mine.uuid}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual({
        data: { deleted: true, message: 'Template deleted successfully' },
      });
      expect((await a.call.get(`/templates/${mine.uuid}`)).status).toBe(404);
      expect(await tplRow(mine.uuid)).toBeUndefined();
      const audit = await h.owner.query(
        `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'wa_templates'`,
        [a.tenant.orgId],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['delete']);

      const foreign = await a.call.delete(`/templates/${theirs.uuid}`);
      expect(foreign.status).toBe(404);
      expect(foreign.body.error.code).toBe('not_found');
      expect(await tplRow(theirs.uuid)).toBeDefined();
      expect((await a.call.delete(`/templates/${randomUUID()}`)).status).toBe(404);
    });
  });

  // --- templates: send -------------------------------------------------------------------------------------------------------

  describe('templates: send', () => {
    async function seedChannel(t: Tenant, num: { id: number }, status = 'connected') {
      await h.owner.query(
        `INSERT INTO channels (org_id, kind, name, status, waba_config_id) VALUES ($1,'whatsapp_cloud','Cloud',$2,$3)`,
        [t.orgId, status, num.id],
      );
    }

    it('POST /templates/{id}/send queues the template through the inbox pipeline, with the values in order, and captures the contact (TW-API-036)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-send');
      const num = await seedNumber(tenant);
      await seedChannel(tenant, num);
      const t = await seedTemplate(tenant, { name: 'order_ready', conn: num });

      const res = await call.post(`/templates/${t.uuid}/send`, {
        to: '+91 98112-00555',
        body: { '2': 'B-42', '1': 'Ana' },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      expect(res.body.data).toEqual({
        message_id: expect.any(String),
        wamid: null,
        status: 'queued',
        template_id: t.uuid,
        template_name: 'order_ready',
        to: '919811200555',
      });
      const msg = (
        await h.owner.query(
          `SELECT kind, body, status, sender_kind, meta, direction FROM messages WHERE org_id = $1 AND uuid = $2`,
          [tenant.orgId, res.body.data.message_id],
        )
      ).rows[0];
      expect(msg).toMatchObject({
        kind: 'template',
        status: 'queued',
        sender_kind: 'bot',
        direction: 'out',
        body: 'Hi Ana, your order B-42 is ready.',
      });
      expect(msg.meta).toMatchObject({
        templateName: 'order_ready',
        templateLanguage: 'en_US',
        templateVariables: { '1': 'Ana', '2': 'B-42' },
      });
      const contact = await h.owner.query(
        `SELECT source FROM contacts WHERE org_id = $1 AND phone LIKE '%9811200555'`,
        [tenant.orgId],
      );
      expect(contact.rows).toHaveLength(1);
    });

    it('POST /templates/{id}/send takes the values as a list too, and refuses numbers in the list (TW-API-036)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-send-list');
      const num = await seedNumber(tenant);
      await seedChannel(tenant, num);
      const t = await seedTemplate(tenant, { conn: num });
      const ok = await call.post(`/templates/${t.uuid}/send`, {
        to: '919811200556',
        body: ['John', '123'],
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(202);
      const bad = await call.post(`/templates/${t.uuid}/send`, { to: '919811200556', body: [123] });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('validation_failed');
    });

    it("POST /templates/{id}/send answers 404 template_not_found for an unknown or another workspace's template (TW-API-036)", async () => {
      const a = await tenantWithKey(api, 'tpl-send-nf-a');
      const b = await tenantWithKey(api, 'tpl-send-nf-b');
      const numB = await seedNumber(b.tenant);
      const theirs = await seedTemplate(b.tenant, { conn: numB });
      for (const id of [randomUUID(), theirs.uuid]) {
        const res = await a.call.post(`/templates/${id}/send`, { to: '919811200557' });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('template_not_found');
      }
      expect((await a.call.raw('post', `/templates/${randomUUID()}/send`)).status).toBe(401);
    });

    it('POST /templates/{id}/send refuses a template Meta has not approved, a paused one and a RED one, in that order, and creates no contact (TW-API-036)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-send-gates');
      const num = await seedNumber(tenant);
      await seedChannel(tenant, num);
      const pending = await seedTemplate(tenant, {
        status: 'pending',
        metaStatus: 'PENDING',
        conn: num,
        quality: 'RED',
      });
      const paused = await seedTemplate(tenant, {
        pausedUntil: '2999-01-01T00:00:00Z',
        conn: num,
        quality: 'RED',
      });
      const red = await seedTemplate(tenant, { conn: num, quality: 'RED' });
      const unknown = await seedTemplate(tenant, { conn: num, quality: 'UNKNOWN' });
      const expectCode = async (id: string, code: string) => {
        const res = await call.post(`/templates/${id}/send`, {
          to: '919811200558',
          body: ['a', 'b'],
        });
        expect(res.status, code).toBe(422);
        expect(res.body.error.code).toBe(code);
        expect(res.body.error.details).toEqual({ template_id: [id] });
      };
      await expectCode(pending.uuid, 'not_approved');
      await expectCode(paused.uuid, 'paused');
      await expectCode(red.uuid, 'quality_floor');
      expect(
        (
          await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [
            tenant.orgId,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await call.post(`/templates/${unknown.uuid}/send`, {
            to: '919811200558',
            body: ['a', 'b'],
          })
        ).status,
      ).toBe(202);
    });

    it('POST /templates/{id}/send answers 422 no_provider when the number has no connected channel (TW-API-036)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-send-noprov');
      const num = await seedNumber(tenant);
      const t = await seedTemplate(tenant, { conn: num });
      const res = await call.post(`/templates/${t.uuid}/send`, { to: '919811200559' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('no_provider');
    });

    it('POST /templates/{id}/send refuses an unusable recipient with 422 on `to` (TW-API-036)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-send-to');
      const num = await seedNumber(tenant);
      await seedChannel(tenant, num);
      const t = await seedTemplate(tenant, { conn: num });
      expect((await call.post(`/templates/${t.uuid}/send`, {})).status).toBe(422);
      expect((await call.post(`/templates/${t.uuid}/send`, { to: 'x'.repeat(33) })).status).toBe(
        422,
      );
      const res = await call.post(`/templates/${t.uuid}/send`, { to: 'abc' });
      expect(res.status).toBe(422);
      expect(res.body.error.details).toHaveProperty('to');
    });

    it('POST /templates/{id}/send says plainly that header files, header text and button values are not sendable yet (TW-API-036)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'tpl-send-unsup');
      const num = await seedNumber(tenant);
      await seedChannel(tenant, num);
      const t = await seedTemplate(tenant, { conn: num });
      for (const [body, field] of [
        [{ to: '919811200560', header_text: 'Hi' }, 'header_text'],
        [{ to: '919811200560', header_media_url: 'https://a.test/x.png' }, 'header_media_url'],
        [{ to: '919811200560', buttons: [{ index: 0, value: 'abc' }] }, 'buttons'],
      ] as const) {
        const res = await call.post(`/templates/${t.uuid}/send`, body);
        expect(res.status).toBe(422);
        expect(res.body.error.details).toHaveProperty(field);
      }
    });

    it('POST /templates/{id}/send with an inline header file runs the upload guard: .php and disguised HTML are 422 unsupported_media_type (TW-API-037)', async () => {
      const { tenant, key } = await tenantWithKey(api, 'tpl-send-guard');
      const num = await seedNumber(tenant);
      await seedChannel(tenant, num);
      const t = await seedTemplate(tenant, { conn: num });
      const php = await sendFile(key.secret, t.uuid, Buffer.from('<?php echo 1;'), 'shell.php');
      expect(php.status, JSON.stringify(php.body)).toBe(422);
      expect(php.body.error.code).toBe('unsupported_media_type');
      const html = await sendFile(
        key.secret,
        t.uuid,
        Buffer.from('<html><script>alert(1)</script></html>'),
        'photo.png',
      );
      expect(html.status).toBe(422);
      expect(html.body.error.code).toBe('unsupported_media_type');
      const big = await sendFile(
        key.secret,
        t.uuid,
        Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(16 * 1024 * 1024)]),
        'big.pdf',
      );
      expect(big.status).toBe(422);
      expect(big.body.error.details).toHaveProperty('header_media');
    });

    it('POST /templates/{id}/send checks the guard before the template lookup and stores no file (TW-API-037)', async () => {
      const { key } = await tenantWithKey(api, 'tpl-send-guard-order');
      const res = await sendFile(key.secret, randomUUID(), Buffer.from('<?php'), 'a.php');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('unsupported_media_type');
      const ok = await sendFile(key.secret, randomUUID(), Buffer.from('%PDF-1.4\nbody'), 'a.pdf');
      expect(ok.status).toBe(404);
      expect(ok.body.error.code).toBe('template_not_found');
    });
  });

  /** A multipart send: the file in `header_media`, the recipient as a field. */
  function sendFile(secret: string, id: string, file: Buffer, filename: string) {
    return request(h.app.getHttpServer())
      .post(`/api/v1/templates/${id}/send`)
      .set({ authorization: `Bearer ${secret}` })
      .field('to', '919811200561')
      .attach('header_media', file, filename);
  }

  // --- flows -----------------------------------------------------------------------------------------------------------------

  async function seedFlow(
    t: Tenant,
    over: {
      name?: string;
      published?: boolean;
      active?: boolean;
      category?: string | null;
      updatedAt?: string;
      createdAt?: string;
    } = {},
  ) {
    const res = await h.owner.query(
      `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, category, is_published, is_active, provider, flow_type, created_at, updated_at)
       VALUES ($1,$2,$3::jsonb,'manual_enroll',$4,$5,$6,'simulator','chat', COALESCE($7::timestamptz, now()), COALESCE($8::timestamptz, now()))
       RETURNING id, uuid`,
      [
        t.orgId,
        over.name ?? `Flow ${randomUUID().slice(0, 6)}`,
        JSON.stringify({
          flowNodes: [{ id: 'a', type: 'message', data: { text: 'hi' } }],
          flowEdges: [],
          vars: {},
        }),
        over.category ?? null,
        over.published ?? true,
        over.active ?? true,
        over.createdAt ?? null,
        over.updatedAt ?? null,
      ],
    );
    return { id: Number(res.rows[0].id), uuid: String(res.rows[0].uuid) };
  }

  describe('flows', () => {
    it('every flow route answers 401 missing_api_key without a key (TW-API-044 to 047)', async () => {
      const { call } = await tenantWithKey(api, 'flow-401');
      const id = randomUUID();
      for (const [method, path] of [
        ['get', '/flows'],
        ['get', `/flows/${id}`],
        ['post', `/flows/${id}/enroll`],
        ['get', `/flows/${id}/subscribers`],
      ] as const) {
        const res = await call.raw(method, path);
        expect(res.status, path).toBe(401);
        expect(res.body.error.code).toBe('missing_api_key');
      }
    });

    it("GET /flows lists live, paused and draft flows by last update with the subscriber count, and never another workspace's (TW-API-044)", async () => {
      const a = await tenantWithKey(api, 'flow-list-a');
      const b = await tenantWithKey(api, 'flow-list-b');
      const live = await seedFlow(a.tenant, {
        name: 'Live',
        category: 'sales',
        updatedAt: '2026-09-03T10:00:00Z',
        createdAt: '2026-08-01T10:00:00Z',
      });
      await seedFlow(a.tenant, {
        name: 'Paused',
        active: false,
        updatedAt: '2026-09-02T10:00:00Z',
      });
      await seedFlow(a.tenant, {
        name: 'Draft',
        published: false,
        updatedAt: '2026-09-01T10:00:00Z',
      });
      await seedFlow(b.tenant, { name: 'Secret B' });
      const contacts = await api.seedContacts(a.tenant, [
        { name: 'One' },
        { name: 'Two' },
        { name: 'Three' },
        { name: 'Four' },
        { name: 'Five' },
      ]);
      const statuses = ['active', 'paused', 'completed', 'failed', 'active'];
      for (let i = 0; i < contacts.length; i++)
        await h.owner.query(
          `INSERT INTO flow_subscribers (org_id, flow_id, contact_id, status, enrolled_at)
           SELECT $1, $2, c.id, $4, now() FROM contacts c WHERE c.org_id = $1 AND c.uuid = $3`,
          [a.tenant.orgId, live.id, contacts[i], statuses[i]],
        );

      const res = await a.call.get('/flows');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(
        res.body.data.map((f: { name: string; status: string }) => [f.name, f.status]),
      ).toEqual([
        ['Live', 'live'],
        ['Paused', 'paused'],
        ['Draft', 'draft'],
      ]);
      expect(res.body.data[0]).toEqual({
        id: live.uuid,
        name: 'Live',
        trigger: 'manual_enroll',
        status: 'live',
        category: 'sales',
        subscribers_count: 5,
        created_at: '2026-08-01T10:00:00.000Z',
        updated_at: '2026-09-03T10:00:00.000Z',
      });
      expect(res.body.meta).toEqual({ limit: 25, next_cursor: null, has_more: false });
      expect(JSON.stringify(res.body)).not.toContain('Secret B');
    });

    it('GET /flows pages with a cursor; an empty workspace answers an empty list; a bad cursor is 422 (TW-API-044)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'flow-page');
      expect((await call.get('/flows')).body).toEqual({
        data: [],
        meta: { limit: 25, next_cursor: null, has_more: false },
      });
      for (let i = 1; i <= 3; i++)
        await seedFlow(tenant, { name: `F${i}`, updatedAt: `2026-09-0${i}T10:00:00Z` });
      const first = await call.get('/flows?limit=2');
      expect(first.body.data.map((f: { name: string }) => f.name)).toEqual(['F3', 'F2']);
      const second = await call.get(`/flows?limit=2&cursor=${first.body.meta.next_cursor}`);
      expect(second.body.data.map((f: { name: string }) => f.name)).toEqual(['F1']);
      expect(second.body.meta.has_more).toBe(false);
      expect((await call.get('/flows?cursor=garbage')).status).toBe(422);
    });

    it("GET /flows/{id} answers the flow, 404 not_found for another workspace's flow and for a non-uuid (TW-API-045)", async () => {
      const a = await tenantWithKey(api, 'flow-show-a');
      const b = await tenantWithKey(api, 'flow-show-b');
      const draft = await seedFlow(a.tenant, { name: 'Mine', published: false });
      const theirs = await seedFlow(b.tenant, { name: 'Theirs' });
      const res = await a.call.get(`/flows/${draft.uuid}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: draft.uuid,
        name: 'Mine',
        status: 'draft',
        subscribers_count: 0,
      });
      const foreign = await a.call.get(`/flows/${theirs.uuid}`);
      expect(foreign.status).toBe(404);
      expect(foreign.body.error).toMatchObject({ code: 'not_found', message: 'Flow not found.' });
      expect((await a.call.get('/flows/7')).status).toBe(404);
    });

    it('a key scoped to flows:read reads flows but cannot enrol (TW-API-046)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'flow-scope');
      const f = await seedFlow(tenant);
      await h.owner.query(`UPDATE api_keys SET scopes = ARRAY['flows:read'] WHERE org_id = $1`, [
        tenant.orgId,
      ]);
      expect((await call.get('/flows')).status).toBe(200);
      const res = await call.post(`/flows/${f.uuid}/enroll`, { phone: '+919811200001' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('POST /flows/{id}/enroll by contact id answers 201 with the subscriber; with no sender the launch fails but the call still answers 201 and says why (TW-API-046)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'flow-enroll');
      const f = await seedFlow(tenant);
      const [contact] = await api.seedContacts(tenant, [{ name: 'Asha', phone: '+919811200001' }]);
      const res = await call.post(`/flows/${f.uuid}/enroll`, { contact_id: contact });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({
        flow_id: f.uuid,
        contact_id: contact,
        subscriber_id: expect.any(String),
        status: 'failed',
        enrolled_at: expect.any(String),
      });
      expect(res.body.data.failure_reason).toMatch(/No connected .* sender/);
      const list = await call.get(`/flows/${f.uuid}/subscribers`);
      expect(list.body.data[0]).toMatchObject({
        id: res.body.data.subscriber_id,
        status: 'failed',
        failure_reason: res.body.data.failure_reason,
      });
    });

    it('POST /flows/{id}/enroll twice returns the same subscriber and no second row (TW-API-046)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'flow-twice');
      const f = await seedFlow(tenant);
      const [contact] = await api.seedContacts(tenant, [{ name: 'Asha', phone: '+919811200002' }]);
      const first = await call.post(`/flows/${f.uuid}/enroll`, { contact_id: contact });
      await h.owner.query(
        `UPDATE flow_subscribers SET status = 'active', failed_at = NULL, failure_reason = NULL WHERE org_id = $1`,
        [tenant.orgId],
      );
      const second = await call.post(`/flows/${f.uuid}/enroll`, { contact_id: contact });
      expect(second.status).toBe(201);
      expect(second.body.data.subscriber_id).toBe(first.body.data.subscriber_id);
      expect(second.body.data.status).toBe('active');
      expect(
        (
          await h.owner.query(`SELECT count(*)::int AS n FROM flow_subscribers WHERE org_id = $1`, [
            tenant.orgId,
          ])
        ).rows[0].n,
      ).toBe(1);
    });

    it('POST /flows/{id}/enroll by phone finds the contact by its number; an unknown number is 404 contact_not_found (TW-API-046)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'flow-phone');
      const f = await seedFlow(tenant);
      const [contact] = await api.seedContacts(tenant, [{ name: 'Bala', phone: '+919811200003' }]);
      const hit = await call.post(`/flows/${f.uuid}/enroll`, { phone: '+91 98112 00003' });
      expect(hit.status, JSON.stringify(hit.body)).toBe(201);
      expect(hit.body.data.contact_id).toBe(contact);
      const miss = await call.post(`/flows/${f.uuid}/enroll`, { phone: '+919000000000' });
      expect(miss.status).toBe(404);
      expect(miss.body.error.code).toBe('contact_not_found');
    });

    it('POST /flows/{id}/enroll: the contact id wins over the phone (TW-API-046)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'flow-idwins');
      const f = await seedFlow(tenant);
      const [one, two] = await api.seedContacts(tenant, [
        { name: 'One', phone: '+919811200004' },
        { name: 'Two', phone: '+919811200005' },
      ]);
      const res = await call.post(`/flows/${f.uuid}/enroll`, {
        contact_id: one,
        phone: '+919811200005',
      });
      expect(res.body.data.contact_id).toBe(one);
      expect(res.body.data.contact_id).not.toBe(two);
    });

    it('POST /flows/{id}/enroll refuses a paused flow with 422 flow_inactive, but a draft that is active proceeds (TW-API-046)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'flow-inactive');
      const paused = await seedFlow(tenant, { active: false });
      const draft = await seedFlow(tenant, { published: false });
      const [contact] = await api.seedContacts(tenant, [{ name: 'Asha', phone: '+919811200006' }]);
      const refused = await call.post(`/flows/${paused.uuid}/enroll`, { contact_id: contact });
      expect(refused.status).toBe(422);
      expect(refused.body.error).toMatchObject({
        code: 'flow_inactive',
        message: 'Flow is not active.',
      });
      expect((await call.post(`/flows/${draft.uuid}/enroll`, { contact_id: contact })).status).toBe(
        201,
      );
    });

    it("POST /flows/{id}/enroll: neither contact_id nor phone is 422; another workspace's flow or contact is 404 (TW-API-046)", async () => {
      const a = await tenantWithKey(api, 'flow-enroll-a');
      const b = await tenantWithKey(api, 'flow-enroll-b');
      const fa = await seedFlow(a.tenant);
      const fb = await seedFlow(b.tenant);
      const [ca] = await api.seedContacts(a.tenant, [{ name: 'A', phone: '+919811200007' }]);
      const [cb] = await api.seedContacts(b.tenant, [{ name: 'B', phone: '+919811200008' }]);
      const empty = await a.call.post(`/flows/${fa.uuid}/enroll`, {});
      expect(empty.status).toBe(422);
      expect(empty.body.error.details).toHaveProperty('contact_id');
      expect(
        (await a.call.post(`/flows/${fb.uuid}/enroll`, { contact_id: ca })).body.error.code,
      ).toBe('not_found');
      const foreignContact = await a.call.post(`/flows/${fa.uuid}/enroll`, { contact_id: cb });
      expect(foreignContact.status).toBe(404);
      expect(foreignContact.body.error.code).toBe('contact_not_found');
      expect(
        (
          await h.owner.query(`SELECT count(*)::int AS n FROM flow_subscribers WHERE org_id = $1`, [
            b.tenant.orgId,
          ])
        ).rows[0].n,
      ).toBe(0);
    });

    it('GET /flows/{id}/subscribers lists newest first with counts over the whole flow and a clamped limit (TW-API-047)', async () => {
      const { tenant, call } = await tenantWithKey(api, 'flow-subs');
      const f = await seedFlow(tenant);
      const people = await api.seedContacts(
        tenant,
        Array.from({ length: 7 }, (_, i) => ({
          name: i === 0 ? '' : `Person ${i}`,
          phone: `+91981130000${i}`,
        })),
      );
      for (let i = 0; i < people.length; i++)
        await h.owner.query(
          `INSERT INTO flow_subscribers (org_id, flow_id, contact_id, status, enrolled_at, failed_at, failure_reason)
           SELECT $1, $2, c.id, $4, now() + ($5 || ' seconds')::interval, CASE WHEN $4 = 'failed' THEN now() END, CASE WHEN $4 = 'failed' THEN 'No connected sender' END
           FROM contacts c WHERE c.org_id = $1 AND c.uuid = $3`,
          [
            tenant.orgId,
            f.id,
            people[i],
            i % 4 === 3 ? 'failed' : i % 4 === 2 ? 'completed' : 'active',
            String(i),
          ],
        );

      const res = await call.get(`/flows/${f.uuid}/subscribers?limit=3`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0]).toMatchObject({
        contact_id: people[6],
        contact_name: 'Person 6',
        contact_phone: '919811300006',
        status: 'completed',
        failure_reason: null,
      });
      expect(res.body.meta).toMatchObject({
        count: 3,
        limit: 3,
        has_more: true,
        counts: { active: 4, paused: 0, completed: 2, failed: 1 },
      });
      const rest = await call.get(
        `/flows/${f.uuid}/subscribers?limit=500&cursor=${res.body.meta.next_cursor}`,
      );
      expect(rest.body.data).toHaveLength(4);
      const failed = rest.body.data.find((s: { status: string }) => s.status === 'failed');
      expect(failed).toMatchObject({
        failed_at: expect.any(String),
        failure_reason: 'No connected sender',
      });
      const unnamed = rest.body.data.find(
        (s: { contact_id: string }) => s.contact_id === people[0],
      );
      expect(unnamed.contact_name).toBe(`#${people[0]}`);
      expect((await call.get(`/flows/${f.uuid}/subscribers?limit=0`)).body.data).toHaveLength(1);
      expect((await call.get(`/flows/${f.uuid}/subscribers?cursor=abc`)).status).toBe(422);
    });

    it("GET /flows/{id}/subscribers is 404 for another workspace's flow (TW-API-047)", async () => {
      const a = await tenantWithKey(api, 'flow-subs-a');
      const b = await tenantWithKey(api, 'flow-subs-b');
      const theirs = await seedFlow(b.tenant);
      const res = await a.call.get(`/flows/${theirs.uuid}/subscribers`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });
});
