import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * WhatsApp message templates end to end (TW-TPL-007, 017, 019, 020, 022, 023, 025, 026, 028): the real API, a real Postgres with
 * row-level security, a real Redis. Only Meta Graph is faked, at the HTTP edge (`WabaHttp.fetchImpl`), so every URL and body the
 * platform sends is asserted.
 *
 * NOT RUN in the session that wrote it (no Docker there): run `pnpm --filter @crm/api test:e2e message-templates` where
 * testcontainers can start.
 */
Object.assign(process.env, {
  META_APP_ID: 'app-1',
  META_APP_SECRET: 'app-secret-1',
  META_EMBEDDED_CONFIG_ID: 'cfg-1',
});

let h: Harness;
let api: Api;

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  json: unknown;
}
let calls: Call[] = [];
/** Answers one fake Meta call; replaced per test. */
type MetaAnswer = { status: number; body: unknown };
let meta: (c: Call) => MetaAnswer = () => ({
  status: 404,
  body: { error: { message: 'unstubbed', code: 1 } },
});

const metaTemplate = (over: Record<string, unknown> = {}) => ({
  id: 'M1',
  name: 'order_update',
  language: 'en_US',
  status: 'PENDING',
  category: 'UTILITY',
  components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} is ready.' }],
  ...over,
});

/** Meta's happy path for one WABA: create returns an id, listing by name returns it back. */
function happyMeta(over: { category?: string; status?: string } = {}) {
  return (c: Call): MetaAnswer => {
    if (c.method === 'POST' && /\/message_templates$/.test(new URL(c.url).pathname))
      return { status: 200, body: { id: 'M1', status: 'PENDING', category: 'UTILITY' } };
    if (c.method === 'GET' && /\/message_templates$/.test(new URL(c.url).pathname))
      return {
        status: 200,
        body: {
          data: [
            metaTemplate({
              category: over.category ?? 'UTILITY',
              status: over.status ?? 'PENDING',
            }),
          ],
        },
      };
    if (c.method === 'DELETE') return { status: 200, body: { success: true } };
    return { status: 404, body: { error: { message: 'unstubbed', code: 1 } } };
  };
}

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const http = h.app.get(WabaHttp);
  const fake: FetchLike = async (url, init) => {
    const call: Call = {
      method: String(init?.method),
      url,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      json: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const a = meta(call);
    return new Response(JSON.stringify(a.body), { status: a.status });
  };
  http.fetchImpl = fake;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

/** One Meta number lives in one workspace (a unique index), so each test releases what it connected. */
afterEach(async () => {
  await h.owner.query(`DELETE FROM wa_templates`);
  await h.owner.query(`DELETE FROM wa_provider_configs WHERE provider = 'waba'`);
});

beforeEach(() => {
  calls = [];
  meta = happyMeta();
});

let seq = 0;
/** A connected WhatsApp number with an encrypted token, straight into the table. */
async function seedConnection(t: Tenant, status = 'connected') {
  const n = ++seq;
  const waba = `1000${Date.now() % 100000}${n}`;
  const crypto = h.app.get(CryptoService, { strict: false });
  const res = await h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, credentials_json, meta_json, phone_number, display_label, is_primary, connected_at)
     VALUES ($1, 'waba', $2, $3, $4::jsonb, '+919112290122', 'Acme', true, now()) RETURNING id, uuid`,
    [
      t.orgId,
      status,
      crypto.encrypt(JSON.stringify({ access_token: 'TOKEN-1' })),
      JSON.stringify({ waba_id: waba, phone_number_id: `2000${n}`, provider: 'meta' }),
    ],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string, waba };
}

/** A template row straight into the table. */
async function seedTemplate(
  t: Tenant,
  conn: { id: number },
  over: Record<string, unknown> = {},
): Promise<{ id: number; uuid: string }> {
  const v = {
    template_name: 'promo',
    language: 'en_US',
    status: 'approved',
    meta_status: 'APPROVED',
    meta_template_id: null,
    template_body: 'Hi {{1}}',
    meta_category: 'UTILITY',
    ...over,
  };
  const res = await h.owner.query(
    `INSERT INTO wa_templates (org_id, template_name, language, status, meta_status, meta_template_id, template_body, meta_category, category, provider_config_id, channel, submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'utility',$9,'waba', now() - interval '3 hours') RETURNING id, uuid`,
    [
      t.orgId,
      v.template_name,
      v.language,
      v.status,
      v.meta_status,
      v.meta_template_id,
      v.template_body,
      v.meta_category,
      conn.id,
    ],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string };
}

const send = (t: string, method: 'post' | 'put' | 'delete', path: string, body?: unknown) => {
  const req = api.as(t)[method](path);
  req.set('idempotency-key', `k${Math.random()}`);
  return body === undefined ? req : req.send(body as object);
};

const form = (connectionId: string, over: Record<string, unknown> = {}) => ({
  name: 'Order Update',
  language: 'en_US',
  metaCategory: 'UTILITY',
  templateType: 'standard',
  body: 'Hi {{name}}, your order {{order}} is ready.',
  variableMap: {
    body: [
      { num: 1, key: '1', example: 'Ana' },
      { num: 2, key: '2', example: '42' },
    ],
  },
  connectionId,
  submit: true,
  ...over,
});

const templateRows = async (orgId: number) =>
  (await h.owner.query(`SELECT * FROM wa_templates WHERE org_id = $1 ORDER BY id`, [orgId])).rows;

describe('create and submit (TW-TPL-007, 024, 025)', () => {
  it("saves the template, sends the normalised payload to Meta and keeps Meta's id, status and category", async () => {
    const t = await api.signup('tc');
    const conn = await seedConnection(t);
    meta = happyMeta({ category: 'MARKETING' }); // Meta recategorised it (allow_category_change)

    const res = await send(t.admin, 'post', '/v2/templates', form(conn.uuid));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.metaError).toBeNull();
    expect(res.body.template).toMatchObject({
      name: 'order_update',
      language: 'en_US',
      body: 'Hi {{1}}, your order {{2}} is ready.',
      status: 'pending',
      metaStatus: 'PENDING',
      metaTemplateId: 'M1',
      metaCategory: 'MARKETING',
      connectionId: conn.uuid,
    });
    expect(res.body.template.variableMap.body).toEqual([
      { num: 1, key: 'name', example: 'Ana' },
      { num: 2, key: 'order', example: '42' },
    ]);
    expect(res.body.template.submittedAt).not.toBeNull();

    const create = calls.find((c) => c.method === 'POST')!;
    expect(new URL(create.url).pathname).toMatch(new RegExp(`/${conn.waba}/message_templates$`));
    expect(create.headers.authorization).toBe('Bearer TOKEN-1');
    expect(create.json).toEqual({
      name: 'order_update',
      language: 'en_US',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'Hi {{1}}, your order {{2}} is ready.',
          example: { body_text: [['Ana', '42']] },
        },
      ],
      allow_category_change: true,
      parameter_format: 'POSITIONAL',
    });

    // The detail page's facts and the audit trail.
    const rows = await templateRows(t.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ meta_template_id: 'M1', meta_category: 'MARKETING' });
    expect(Number(rows[0].user_id)).toBe(t.adminUserId);
    expect(await api.auditCount(t.orgId, 'wa_templates', 'insert')).toBe(1);
    expect(await api.events(t.orgId, 'template.created')).toHaveLength(1);
    expect(await api.events(t.orgId, 'template.submitted')).toHaveLength(1);

    const detail = await api.as(t.admin).get(`/v2/templates/${res.body.template.id}`);
    expect(detail.status).toBe(200);
    // The payload is rebuilt from the stored template, so it carries the category Meta settled on (it recategorised the request).
    expect(detail.body.metaPayload).toMatchObject({ name: 'order_update', category: 'MARKETING' });
    expect(detail.body.lint.filter((i: { severity: string }) => i.severity === 'error')).toEqual(
      [],
    );
  });

  it('a draft is saved without calling Meta', async () => {
    const t = await api.signup('td');
    const conn = await seedConnection(t);
    const res = await send(t.admin, 'post', '/v2/templates', form(conn.uuid, { submit: false }));
    expect(res.status).toBe(201);
    expect(res.body.template).toMatchObject({ status: 'draft', metaTemplateId: null });
    expect(calls).toHaveLength(0);
  });

  it('refuses a name already used on the number in that language', async () => {
    const t = await api.signup('tn');
    const conn = await seedConnection(t);
    await send(t.admin, 'post', '/v2/templates', form(conn.uuid, { submit: false }));
    const again = await send(
      t.admin,
      'post',
      '/v2/templates',
      form(conn.uuid, { name: 'order update', submit: false }),
    );
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('TPL_NAME_TAKEN');
    expect(await templateRows(t.orgId)).toHaveLength(1);
  });

  it("keeps the row when Meta refuses, with Meta's words, and a retry works once it is fixed", async () => {
    const t = await api.signup('tr');
    const conn = await seedConnection(t);
    meta = () => ({
      status: 400,
      body: {
        error: {
          message: 'Invalid parameter',
          code: 100,
          error_user_msg: 'Body has too many variables for its length',
        },
      },
    });

    const res = await send(t.admin, 'post', '/v2/templates', form(conn.uuid));
    expect(res.status).toBe(201);
    expect(res.body.metaError).toContain('Body has too many variables for its length');
    expect(res.body.template).toMatchObject({ status: 'rejected', metaTemplateId: null });
    expect(res.body.template.rejectionReason).toContain('Body has too many variables');
    expect(await templateRows(t.orgId)).toHaveLength(1);
    expect(await api.events(t.orgId, 'template.submit_failed')).toHaveLength(1);

    meta = happyMeta();
    const retry = await send(t.admin, 'post', `/v2/templates/${res.body.template.id}/submit`);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.metaError).toBeNull();
    expect(retry.body.template).toMatchObject({ status: 'pending', metaTemplateId: 'M1' });

    // A template already on Meta is not sent again.
    calls = [];
    const noop = await send(t.admin, 'post', `/v2/templates/${res.body.template.id}/submit`);
    expect(noop.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it('an outage is not a refusal: the row stays a draft and says why', async () => {
    const t = await api.signup('to');
    const conn = await seedConnection(t);
    meta = () => ({
      status: 503,
      body: { error: { message: 'Service unavailable', code: 2, is_transient: true } },
    });
    const res = await send(t.admin, 'post', '/v2/templates', form(conn.uuid));
    expect(res.status).toBe(201);
    expect(res.body.metaError).toContain('Service unavailable');
    expect(res.body.template.status).toBe('draft');
  });

  it('a lint error stops everything: nothing is saved and nothing is sent', async () => {
    const t = await api.signup('tl');
    const conn = await seedConnection(t);
    const res = await send(
      t.admin,
      'post',
      '/v2/templates',
      form(conn.uuid, { body: '{{a}}{{b}} order ready', variableMap: undefined }),
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('TPL_LINT_FAILED');
    expect(res.body.errors.map((e: { path: string }) => e.path)).toContain('body');
    expect(calls).toHaveLength(0);
    expect(await templateRows(t.orgId)).toHaveLength(0);
  });

  it('the lint endpoint gives the same verdict without saving', async () => {
    const t = await api.signup('tp');
    const conn = await seedConnection(t);
    const res = await send(
      t.admin,
      'post',
      '/v2/templates/lint',
      form(conn.uuid, { body: 'Hi {{name}} bye' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.normalized.body).toBe('Hi {{1}} bye');
    expect(res.body.normalized.variableMap.body).toEqual([{ num: 1, key: 'name', example: 'Ana' }]);
    expect(res.body.metaPayload.components[0].text).toBe('Hi {{1}} bye');
    expect(calls).toHaveLength(0);
    expect(await templateRows(t.orgId)).toHaveLength(0);
  });

  it('refuses to submit through a number that is not connected', async () => {
    const t = await api.signup('tx');
    const conn = await seedConnection(t, 'disconnected');
    const res = await send(t.admin, 'post', '/v2/templates', form(conn.uuid));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TPL_NO_CONNECTION');
    expect(calls).toHaveLength(0);
  });
});

describe('edit (TW-TPL-018, 019)', () => {
  it('edits a rejected template, replaces the Meta copy on submit, and checks the row version', async () => {
    const t = await api.signup('te');
    const conn = await seedConnection(t);
    const row = await seedTemplate(t, conn, {
      status: 'rejected',
      meta_status: 'REJECTED',
      meta_template_id: 'OLD1',
      template_name: 'order_update',
    });
    const detail = await api.as(t.admin).get(`/v2/templates/${row.uuid}`);

    const stale = await send(t.admin, 'put', `/v2/templates/${row.uuid}`, {
      ...form(conn.uuid),
      connectionId: undefined,
      rowVersion: detail.body.rowVersion + 5,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');

    const ok = await send(t.admin, 'put', `/v2/templates/${row.uuid}`, {
      ...form(conn.uuid),
      connectionId: undefined,
      rowVersion: detail.body.rowVersion,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.template).toMatchObject({ status: 'pending', metaTemplateId: 'M1' });
    const methods = calls.map((c) => c.method);
    expect(methods.indexOf('DELETE')).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf('DELETE')).toBeLessThan(methods.indexOf('POST'));
    expect(new URL(calls.find((c) => c.method === 'DELETE')!.url).searchParams.get('hsm_id')).toBe(
      'OLD1',
    );
  });

  it('an approved template cannot be edited', async () => {
    const t = await api.signup('tna');
    const conn = await seedConnection(t);
    const row = await seedTemplate(t, conn, { meta_template_id: 'M9' });
    const res = await send(t.admin, 'put', `/v2/templates/${row.uuid}`, {
      ...form(conn.uuid),
      connectionId: undefined,
      rowVersion: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TPL_NOT_EDITABLE');
    expect(calls).toHaveLength(0);
  });
});

describe('delete (TW-TPL-020)', () => {
  it('is refused while a processing or scheduled broadcast uses the template', async () => {
    const t = await api.signup('tdel');
    const conn = await seedConnection(t);
    const row = await seedTemplate(t, conn, { meta_template_id: 'M7' });
    const b = await h.owner.query(
      `INSERT INTO broadcasts (org_id, name, status, template_id) VALUES ($1, 'Promo run', 'processing', $2) RETURNING id`,
      [t.orgId, row.id],
    );

    const blocked = await send(t.admin, 'delete', `/v2/templates/${row.uuid}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('TPL_IN_USE');
    expect(calls).toHaveLength(0);
    expect(await templateRows(t.orgId)).toHaveLength(1);

    await h.owner.query(`UPDATE broadcasts SET status = 'completed' WHERE id = $1`, [b.rows[0].id]);
    const ok = await send(t.admin, 'delete', `/v2/templates/${row.uuid}`);
    expect(ok.status).toBe(204);
    expect(await templateRows(t.orgId)).toHaveLength(0);
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(new URL(del.url).searchParams.get('name')).toBe('promo');
    expect(await api.events(t.orgId, 'template.deleted')).toHaveLength(1);
    expect(await api.auditCount(t.orgId, 'wa_templates', 'delete')).toBe(1);
  });

  it('still deletes locally when Meta cannot', async () => {
    const t = await api.signup('tdm');
    const conn = await seedConnection(t);
    const row = await seedTemplate(t, conn, { meta_template_id: 'M8' });
    meta = () => ({ status: 500, body: { error: { message: 'boom', code: 1 } } });
    const ok = await send(t.admin, 'delete', `/v2/templates/${row.uuid}`);
    expect(ok.status).toBe(204);
    expect(await templateRows(t.orgId)).toHaveLength(0);
  });
});

describe('refresh (TW-TPL-026)', () => {
  it("takes Meta's status, quality and approval time", async () => {
    const t = await api.signup('trf');
    const conn = await seedConnection(t);
    const row = await seedTemplate(t, conn, {
      status: 'pending',
      meta_status: 'PENDING',
      meta_template_id: 'M1',
      template_name: 'order_update',
    });
    meta = (c) =>
      c.method === 'GET'
        ? {
            status: 200,
            body: {
              data: [metaTemplate({ status: 'APPROVED', quality_score: { score: 'GREEN' } })],
            },
          }
        : { status: 404, body: {} };
    const res = await send(t.admin, 'post', `/v2/templates/${row.uuid}/refresh`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      status: 'approved',
      metaStatus: 'APPROVED',
      qualityScore: 'GREEN',
    });
    expect(res.body.approvedAt).not.toBeNull();
    expect(await api.events(t.orgId, 'template.status_changed')).toHaveLength(1);

    // A second refresh straight away answers from the row.
    calls = [];
    await send(t.admin, 'post', `/v2/templates/${row.uuid}/refresh`);
    expect(calls).toHaveLength(0);
  });

  it('a template never sent to Meta comes back unchanged', async () => {
    const t = await api.signup('trn');
    const conn = await seedConnection(t);
    const row = await seedTemplate(t, conn, { status: 'draft', meta_status: null });
    const res = await send(t.admin, 'post', `/v2/templates/${row.uuid}/refresh`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('draft');
    expect(calls).toHaveLength(0);
  });
});

describe('sync from Meta (TW-TPL-028)', () => {
  const remote = (id: string, name: string, over: Record<string, unknown> = {}) =>
    metaTemplate({
      id,
      name,
      status: 'APPROVED',
      category: 'MARKETING',
      components: [{ type: 'BODY', text: 'Hi {{1}}', example: { body_text: [['Ana']] } }],
      ...over,
    });

  it("never flags a template as removed when Meta's list broke off, and flags it when the list was read to the end", async () => {
    const t = await api.signup('ts');
    const conn = await seedConnection(t);
    const a = await seedTemplate(t, conn, {
      template_name: 'promo_a',
      meta_template_id: 'MA',
      status: 'pending',
      meta_status: 'PENDING',
    });
    const b = await seedTemplate(t, conn, { template_name: 'promo_b', meta_template_id: 'MB' });

    // Page 1 answers, page 2 fails.
    meta = (c) => {
      const after = new URL(c.url).searchParams.get('after');
      if (!after)
        return {
          status: 200,
          body: {
            data: [remote('MA', 'promo_a')],
            paging: { cursors: { after: 'C1' }, next: 'https://graph.test/next' },
          },
        };
      return { status: 500, body: { error: { message: 'boom', code: 2 } } };
    };
    const partial = await send(t.admin, 'post', '/v2/templates/sync', { connectionId: conn.uuid });
    expect(partial.status).toBe(503);
    expect(partial.body.code).toBe('WABA_PROVIDER_UNAVAILABLE');
    const afterPartial = Object.fromEntries(
      (await templateRows(t.orgId)).map((r) => [r.template_name, r]),
    );
    expect(afterPartial.promo_a).toMatchObject({ status: 'approved', meta_status: 'APPROVED' }); // what was fetched is saved
    expect(afterPartial.promo_b.status).toBe('approved'); // and nothing was flagged
    expect(afterPartial.promo_b.meta_status).toBe('APPROVED');

    // Meta lists a new template and not B; the list is read to the end.
    meta = () => ({
      status: 200,
      body: { data: [remote('MA', 'promo_a'), remote('MC', 'promo_c')] },
    });
    const full = await send(t.admin, 'post', '/v2/templates/sync', { connectionId: conn.uuid });
    expect(full.status, JSON.stringify(full.body)).toBe(200);
    expect(full.body).toEqual({ created: 1, updated: 1, missing: 1, total: 2 });
    const rows = Object.fromEntries((await templateRows(t.orgId)).map((r) => [r.template_name, r]));
    expect(rows.promo_b).toMatchObject({ status: 'deleted', meta_status: 'DELETED' }); // flagged, never removed
    expect(rows.promo_c).toMatchObject({
      meta_template_id: 'MC',
      status: 'approved',
      meta_category: 'MARKETING',
    });
    expect(Number(rows.promo_c.provider_config_id)).toBe(Number(conn.id));
    expect(a.id).toBeGreaterThan(0);
    expect(b.id).toBeGreaterThan(0);
    expect(await api.events(t.orgId, 'template.synced')).toHaveLength(2);
  });

  it('links a never-submitted local template to its Meta twin by name and language instead of duplicating it', async () => {
    const t = await api.signup('tsl');
    const conn = await seedConnection(t);
    await seedTemplate(t, conn, {
      template_name: 'promo',
      language: 'en',
      status: 'draft',
      meta_status: null,
    });
    meta = () => ({ status: 200, body: { data: [remote('MP', 'promo', { language: 'en_US' })] } });
    const res = await send(t.admin, 'post', '/v2/templates/sync', { connectionId: conn.uuid });
    expect(res.body).toEqual({ created: 0, updated: 1, missing: 0, total: 1 });
    const rows = await templateRows(t.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ meta_template_id: 'MP', status: 'approved' });
  });

  it('a failure on the very first page changes nothing', async () => {
    const t = await api.signup('tsf');
    const conn = await seedConnection(t);
    await seedTemplate(t, conn, { meta_template_id: 'MZ' });
    meta = () => ({ status: 400, body: { error: { message: 'Invalid token', code: 190 } } });
    const res = await send(t.admin, 'post', '/v2/templates/sync', { connectionId: conn.uuid });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('TPL_META_REJECTED');
    expect((await templateRows(t.orgId))[0].status).toBe('approved');
  });
});

describe('header media (TW-TPL-009, 025)', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ]);

  it('uploads the example to Meta and returns the handle', async () => {
    const t = await api.signup('tm');
    const conn = await seedConnection(t);
    meta = (c) =>
      /\/app-1\/uploads/.test(c.url)
        ? { status: 200, body: { id: 'upload:S1' } }
        : /upload:S1/.test(c.url)
          ? { status: 200, body: { h: 'HANDLE-1' } }
          : { status: 404, body: {} };
    const res = await api
      .as(t.admin)
      .post('/v2/templates/media')
      .field('connectionId', conn.uuid)
      .attach('file', png, { filename: 'banner.png', contentType: 'image/png' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ handle: 'HANDLE-1', fileName: 'banner.png', mimeType: 'image/png' });
    expect(new URL(calls[0]!.url).searchParams.get('file_type')).toBe('image/png');
  });

  it('refuses a file type Meta does not take, and a file whose content is not what its name says', async () => {
    const t = await api.signup('tmr');
    const conn = await seedConnection(t);
    const gif = await api
      .as(t.admin)
      .post('/v2/templates/media')
      .field('connectionId', conn.uuid)
      .attach('file', png, { filename: 'a.gif', contentType: 'image/gif' });
    expect(gif.status).toBe(422);
    const fake = await api
      .as(t.admin)
      .post('/v2/templates/media')
      .field('connectionId', conn.uuid)
      .attach('file', Buffer.from('<html>not a png</html>'), {
        filename: 'a.png',
        contentType: 'image/png',
      });
    expect(fake.status).toBe(422);
    expect(calls).toHaveLength(0);
  });
});

describe('tenancy and permissions', () => {
  it('another organization sees nothing of a template, and cannot use its number', async () => {
    const a = await api.signup('ta');
    const b = await api.signup('tb');
    const conn = await seedConnection(a);
    const row = await seedTemplate(a, conn, { meta_template_id: 'MX' });

    expect((await api.as(b.admin).get('/v2/templates')).body.data).toEqual([]);
    expect((await api.as(a.admin).get('/v2/templates')).body.data).toHaveLength(1);
    const get = await api.as(b.admin).get(`/v2/templates/${row.uuid}`);
    expect(get.status).toBe(404);
    expect(get.body.code).toBe('TPL_NOT_FOUND');
    expect((await send(b.admin, 'delete', `/v2/templates/${row.uuid}`)).status).toBe(404);
    expect((await send(b.admin, 'post', `/v2/templates/${row.uuid}/refresh`)).status).toBe(404);
    expect((await send(b.admin, 'post', '/v2/templates', form(conn.uuid))).status).toBe(404);
    expect(
      (await send(b.admin, 'post', '/v2/templates/sync', { connectionId: conn.uuid })).status,
    ).toBe(404);
    expect(calls).toHaveLength(0);
    expect(await templateRows(a.orgId)).toHaveLength(1);
  });

  it('a viewer can read but not write, and saving a draft does not allow talking to Meta', async () => {
    const t = await api.signup('tpm');
    const conn = await seedConnection(t);
    const row = await seedTemplate(t, conn, { status: 'rejected', meta_status: 'REJECTED' });
    const viewer = await api.member(t, 'viewer', [['tpl.templates.read']]);
    const author = await api.member(t, 'author', [
      ['tpl.templates.read'],
      ['tpl.templates.create'],
    ]);

    expect((await api.as(viewer.token).get('/v2/templates')).status).toBe(200);
    expect((await api.as(viewer.token).get(`/v2/templates/${row.uuid}`)).status).toBe(200);
    for (const res of [
      await send(viewer.token, 'post', '/v2/templates', form(conn.uuid, { submit: false })),
      await send(viewer.token, 'delete', `/v2/templates/${row.uuid}`),
      await send(viewer.token, 'post', '/v2/templates/sync', { connectionId: conn.uuid }),
      await send(viewer.token, 'post', `/v2/templates/${row.uuid}/submit`),
      await send(viewer.token, 'post', `/v2/templates/${row.uuid}/refresh`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }

    expect(
      (await send(author.token, 'post', '/v2/templates', form(conn.uuid, { submit: false })))
        .status,
    ).toBe(201);
    const toMeta = await send(
      author.token,
      'post',
      '/v2/templates',
      form(conn.uuid, { name: 'second', submit: true }),
    );
    expect(toMeta.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
