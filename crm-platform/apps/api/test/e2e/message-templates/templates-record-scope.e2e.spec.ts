import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** Global and Restricted record scope on templates (BL-430): a restricted role sees and acts on only the templates it created. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const KEYS = [
  'tpl.templates.read',
  'tpl.templates.create',
  'tpl.templates.delete',
  'tpl.templates.sync',
];
const as = (token: string) => ({ authorization: `Bearer ${token}` });

async function template(t: Tenant, userId: number, name: string): Promise<string> {
  const r = await h.owner.query(
    `INSERT INTO wa_templates (org_id, user_id, template_name, language, status, template_body, category, channel)
     VALUES ($1,$2,$3,'en','draft','Hello','utility','waba') RETURNING uuid`,
    [t.orgId, userId, name],
  );
  return r.rows[0].uuid as string;
}

describe('template record scope', () => {
  it('a restricted role sees only the templates it created, a global role sees all', async () => {
    const t = await api.signup('trs1');
    const mine = await api.member(
      t,
      'restricted',
      KEYS.map((k) => [k, 'own'] as [string, 'own']),
    );
    const global = await api.member(
      t,
      'global',
      KEYS.map((k) => [k, 'all'] as [string, 'all']),
    );
    const own = await template(t, mine.userId, 'mine_tpl');
    const other = await template(t, t.adminUserId, 'theirs_tpl');

    const names = (body: { data: Array<{ name: string }> }) => body.data.map((x) => x.name).sort();
    const list = await api.http().get('/v2/templates').set(as(mine.token));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(names(list.body)).toEqual(['mine_tpl']);
    const counts = await api.http().get('/v2/templates/counts').set(as(mine.token));
    expect(counts.body.statuses.all).toBe(1);

    const wide = await api.http().get('/v2/templates').set(as(global.token));
    expect(names(wide.body)).toEqual(['mine_tpl', 'theirs_tpl']);

    const get = (token: string, uuid: string, path = '') =>
      api.http().get(`/v2/templates/${uuid}${path}`).set(as(token));
    expect((await get(mine.token, own)).status).toBe(200);
    for (const path of ['', '/stats']) {
      expect((await get(mine.token, other, path)).status, path).toBe(404);
      expect((await get(global.token, other, path)).status, path).toBe(200);
    }
  });

  it('a restricted role cannot delete a template it did not create', async () => {
    const t = await api.signup('trs2');
    const mine = await api.member(
      t,
      'restricted',
      KEYS.map((k) => [k, 'own'] as [string, 'own']),
    );
    const other = await template(t, t.adminUserId, 'theirs_tpl');
    const own = await template(t, mine.userId, 'mine_tpl');
    const del = (uuid: string) =>
      api
        .http()
        .delete(`/v2/templates/${uuid}`)
        .set(as(mine.token))
        .set('idempotency-key', randomUUID());

    expect((await del(other)).status).toBe(404);
    expect(
      (await h.owner.query(`SELECT 1 FROM wa_templates WHERE uuid = $1`, [other])).rowCount,
    ).toBe(1);
    expect((await del(own)).status).toBe(204);
  });
});
