import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Dynamic object naming (BL-310), through the real API against a real Postgres (restricted role, forced RLS): the workspace's own words
 * for contact, appointment, deal and meeting. The route is gated by `admin.settings.manage`, a save is optimistic (`rev`), it is logged
 * in the workspace layer and audited, the words ride on the session for every member, workspaces never see each other's, the operator's
 * layer shows up only as a source, and no other part of the session changes.
 */
let h: Harness;
let api: Api;
let a: Tenant;
let b: Tenant;

const url = '/v2/persona/vocabulary';
const forms = (one: string, other = `${one}s`) => ({ one, other });

const get = (t: string, locale = 'en') => api.http().get(url).query({ locale }).set(bearer(t));
const put = (t: string, body: unknown, locale = 'en') =>
  api
    .http()
    .put(url)
    .query({ locale })
    .set(bearer(t))
    .send(body as object);
const session = async (token: string) => {
  const res = await api.http().get('/v2/auth/session').set(bearer(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Record<string, any>;
};
const row = async (orgId: number) =>
  (await h.owner.query(`SELECT * FROM workspace_persona WHERE org_id = $1`, [orgId])).rows[0];
const noun = (body: Record<string, any>, name: string) =>
  (body.nouns as Array<Record<string, any>>).find((n) => n.noun === name)!;

/** The operator columns can only be written on the privileged path (a trigger); the owner connection must say so too. */
async function asOperator(sql: string, params: unknown[] = []) {
  await h.owner.query('BEGIN');
  try {
    await h.owner.query(`SELECT set_config('app.privileged', 'on', true)`);
    await h.owner.query(sql, params);
    await h.owner.query('COMMIT');
  } catch (error) {
    await h.owner.query('ROLLBACK');
    throw error;
  }
}

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  a = await api.signup('vocab-a');
  b = await api.signup('vocab-b');
}, 900_000);

afterAll(async () => {
  await h?.stop();
});

describe('reading the words', () => {
  it('a new workspace has no words of its own: the product wording for all four nouns', async () => {
    const res = await get(a.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ locale: 'en', rev: 1, personaKey: 'generic' });
    expect(res.body.nouns.map((n: Record<string, any>) => n.noun)).toEqual([
      'contact',
      'appointment',
      'deal',
      'meeting',
    ]);
    for (const n of res.body.nouns) {
      expect(n).toMatchObject({
        effective: null,
        source: 'default',
        workspace: null,
        workspaceLocales: [],
      });
    }
  });

  it('the session of a workspace with no words carries no `nouns` field (the golden view)', async () => {
    const body = await session(a.admin);
    expect(body.org.persona).not.toHaveProperty('nouns');
  });

  it('needs admin.settings.manage, for reading and for writing', async () => {
    const reader = await api.member(a, 'reader', [['record.contacts.read']]);
    expect((await get(reader.token)).status).toBe(403);
    const res = await put(reader.token, { rev: 1, nouns: { contact: null } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect((await get('not-a-token')).status).toBe(401);
  });

  it('rejects an unusable locale', async () => {
    const res = await get(a.admin, 'not a locale!');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('saving the words', () => {
  it('sets a noun for one language, bumps the revision, rides on the session and is logged and audited', async () => {
    const res = await put(a.admin, { rev: 1, nouns: { contact: { en: forms('Patient') } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.rev).toBe(2);
    expect(noun(res.body, 'contact')).toEqual({
      noun: 'contact',
      effective: forms('Patient'),
      source: 'workspace',
      workspace: forms('Patient'),
      workspaceLocales: ['en'],
    });
    expect(noun(res.body, 'deal').source).toBe('default');

    // every member sees the words on their session, not only the admin
    const reader = await api.member(a, 'reader2', [['record.contacts.read']]);
    for (const token of [a.admin, reader.token]) {
      const s = await session(token);
      expect(s.org.persona.nouns).toEqual({ en: { contact: forms('Patient') } });
      expect(s.org.persona.rev).toBe(2);
    }

    // stored in the workspace's own layer, the rest of the document kept, the operator layer untouched
    const r = await row(a.orgId);
    expect(r.workspace_overrides).toEqual({
      v: 1,
      vocab: { contact: { en: forms('Patient') } },
    });
    expect(r.operator_overrides).toEqual({});

    const log = await h.owner.query(
      `SELECT layer, actor_kind, actor_id, action, item_id, before, after
         FROM workspace_persona_log WHERE org_id = $1 ORDER BY id`,
      [a.orgId],
    );
    expect(log.rows).toEqual([
      {
        layer: 'workspace',
        actor_kind: 'user',
        actor_id: a.adminUserId,
        action: 'vocabulary.set',
        item_id: 'contact',
        before: null,
        after: { en: forms('Patient') },
      },
    ]);
    const audit = await h.owner.query(
      `SELECT module, action, delta FROM audit_log WHERE org_id = $1 AND module = 'persona_vocabulary'`,
      [a.orgId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: 'update' });
    expect(audit.rows[0].delta.contact.new).toEqual({ en: forms('Patient') });
  });

  it('changes nothing else about the session', async () => {
    const before = await session(a.admin);
    const saved = await put(a.admin, {
      rev: (await row(a.orgId)).rev,
      nouns: { appointment: { en: forms('Visit') } },
    });
    expect(saved.status).toBe(200);
    const after = await session(a.admin);
    const strip = (s: Record<string, any>) => ({
      ...s,
      org: { ...s.org, persona: { ...s.org.persona, nouns: undefined, rev: undefined } },
    });
    expect(strip(after)).toEqual(strip(before));
    expect(after.permissions).toEqual(before.permissions);
    expect(after.org.persona.nouns.en).toEqual({
      contact: forms('Patient'),
      appointment: forms('Visit'),
    });
  });

  it('a save with a stale revision is a 409 and writes nothing', async () => {
    const current = (await row(a.orgId)).rev as number;
    const res = await put(a.admin, { rev: current - 1, nouns: { deal: { en: forms('Case') } } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROW_VERSION_CONFLICT');
    expect((await row(a.orgId)).rev).toBe(current);
    expect(noun((await get(a.admin)).body, 'deal').source).toBe('default');
  });

  it('a save that changes nothing writes nothing: no new revision, no log line', async () => {
    const before = await row(a.orgId);
    const logs = (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM workspace_persona_log WHERE org_id = $1`,
        [a.orgId],
      )
    ).rows[0].n as number;
    const res = await put(a.admin, {
      rev: before.rev,
      nouns: { contact: { en: forms('Patient') } },
    });
    expect(res.status).toBe(200);
    expect(res.body.rev).toBe(before.rev);
    expect((await row(a.orgId)).rev).toBe(before.rev);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM workspace_persona_log WHERE org_id = $1`,
          [a.orgId],
        )
      ).rows[0].n,
    ).toBe(logs);
  });

  it('works per language: setting one keeps the others, `null` removes just that one, a noun `null` removes them all', async () => {
    let rev = (await row(a.orgId)).rev as number;
    let res = await put(a.admin, { rev, nouns: { contact: { hi: forms('मरीज') } } });
    expect(res.status).toBe(200);
    expect(noun(res.body, 'contact').workspaceLocales).toEqual(['en', 'hi']);
    // the asked language decides which forms come back
    const hi = await get(a.admin, 'hi');
    expect(noun(hi.body, 'contact')).toMatchObject({
      workspace: forms('मरीज'),
      source: 'workspace',
    });

    rev = res.body.rev;
    res = await put(a.admin, { rev, nouns: { contact: { en: null } } });
    expect(noun(res.body, 'contact')).toMatchObject({
      workspace: null,
      source: 'default',
      workspaceLocales: ['hi'],
    });

    rev = res.body.rev;
    res = await put(a.admin, { rev, nouns: { contact: null } });
    expect(noun(res.body, 'contact')).toMatchObject({ workspaceLocales: [], source: 'default' });
    const s = await session(a.admin);
    expect(s.org.persona.nouns.en).toEqual({ appointment: forms('Visit') });
    expect(s.org.persona.nouns).not.toHaveProperty('hi');

    // removing the last words takes the field off the session again
    rev = res.body.rev;
    res = await put(a.admin, { rev, nouns: { appointment: null } });
    expect(res.status).toBe(200);
    expect((await session(a.admin)).org.persona).not.toHaveProperty('nouns');
    const log = await h.owner.query(
      `SELECT action FROM workspace_persona_log WHERE org_id = $1 ORDER BY id DESC LIMIT 1`,
      [a.orgId],
    );
    expect(log.rows[0].action).toBe('vocabulary.reset');
  });

  it('keeps the rest of the workspace overrides (hidden modules) when it saves words', async () => {
    await h.owner.query(
      `UPDATE workspace_persona SET workspace_overrides = $2::jsonb WHERE org_id = $1`,
      [a.orgId, JSON.stringify({ v: 1, modules: { 'nav:deals': { state: 'hide' } } })],
    );
    const rev = (await row(a.orgId)).rev as number;
    const res = await put(a.admin, { rev, nouns: { deal: { en: forms('Case') } } });
    expect(res.status).toBe(200);
    expect((await row(a.orgId)).workspace_overrides).toEqual({
      v: 1,
      modules: { 'nav:deals': { state: 'hide' } },
      vocab: { deal: { en: forms('Case') } },
    });
    const s = await session(a.admin);
    expect(s.org.persona.modules).toEqual({ 'nav:deals': { visible: false, locked: false } });
    expect(s.org.persona.nouns.en.deal).toEqual(forms('Case'));
  });

  it.each([
    ['text an ICU message would read as syntax', { contact: { en: forms('{count}', 'Patients') } }],
    ['markup', { contact: { en: forms('Patient', '<b>Patients</b>') } }],
    ['a name that is too long', { contact: { en: forms('x'.repeat(41)) } }],
    ['an empty name', { contact: { en: forms('', 'Patients') } }],
    ['a missing plural', { contact: { en: { one: 'Patient' } } }],
    ['a noun a workspace cannot rename', { task: { en: forms('Job') } }],
    ['a language that is not a code', { contact: { 'English!': forms('Patient') } }],
    ['nothing at all', {}],
  ])('refuses %s', async (_name, nouns) => {
    const rev = (await row(a.orgId)).rev as number;
    const res = await put(a.admin, { rev, nouns });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect((await row(a.orgId)).rev).toBe(rev);
  });

  it('refuses a body without a revision', async () => {
    const res = await put(a.admin, { nouns: { contact: null } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('a workspace created some other way (no persona row) starts on generic with its first save', async () => {
    const c = await api.signup('vocab-c');
    await asOperator(`DELETE FROM workspace_persona WHERE org_id = $1`, [c.orgId]);
    const read = await get(c.admin);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ rev: 1, personaKey: 'generic' });
    const res = await put(c.admin, { rev: 1, nouns: { meeting: { en: forms('Consult') } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(noun(res.body, 'meeting').workspace).toEqual(forms('Consult'));
    expect((await row(c.orgId)).persona_key).toBe('generic');
  });
});

describe('workspaces and layers', () => {
  it("keeps workspaces apart: another workspace's words never show up, and its revision is not ours", async () => {
    const aWords = (await session(a.admin)).org.persona.nouns.en;
    expect(aWords.deal).toEqual(forms('Case'));
    const sb = await session(b.admin);
    expect(sb.org.persona).not.toHaveProperty('nouns');
    expect(noun((await get(b.admin)).body, 'deal').source).toBe('default');
    // b saves its own, a does not see it
    const rev = (await row(b.orgId)).rev as number;
    const res = await put(b.admin, { rev, nouns: { deal: { en: forms('Admission') } } });
    expect(res.status).toBe(200);
    expect((await session(a.admin)).org.persona.nouns.en.deal).toEqual(forms('Case'));
    expect((await session(b.admin)).org.persona.nouns.en.deal).toEqual(forms('Admission'));
    // the log of one never holds the other's lines
    const logs = await h.owner.query(
      `SELECT DISTINCT org_id FROM workspace_persona_log WHERE item_id = 'deal'`,
    );
    expect(logs.rows.map((r) => Number(r.org_id)).sort()).toEqual([a.orgId, b.orgId].sort());
  });

  it("shows the account team's words as a source only, and the workspace's own words win over them", async () => {
    await asOperator(
      `UPDATE workspace_persona SET operator_overrides = $2::jsonb, operator_note = 'internal note', operator_updated_at = now() WHERE org_id = $1`,
      [b.orgId, JSON.stringify({ v: 1, vocab: { contact: { en: forms('Client') } } })],
    );
    const read = await get(b.admin);
    expect(noun(read.body, 'contact')).toMatchObject({
      effective: forms('Client'),
      source: 'operator',
      workspace: null,
    });
    expect(JSON.stringify(read.body)).not.toMatch(/internal note/);
    const s = await session(b.admin);
    expect(s.org.persona.nouns.en.contact).toEqual(forms('Client'));
    expect(JSON.stringify(s)).not.toMatch(/internal note/);

    const rev = (await row(b.orgId)).rev as number;
    const res = await put(b.admin, { rev, nouns: { contact: { en: forms('Member') } } });
    expect(noun(res.body, 'contact')).toMatchObject({
      effective: forms('Member'),
      source: 'workspace',
    });
    // the operator's column is untouched by a workspace save
    expect((await row(b.orgId)).operator_overrides).toEqual({
      v: 1,
      vocab: { contact: { en: forms('Client') } },
    });
    // removing the workspace's words falls back to the operator's
    const back = await put(b.admin, { rev: res.body.rev, nouns: { contact: null } });
    expect(noun(back.body, 'contact')).toMatchObject({
      effective: forms('Client'),
      source: 'operator',
    });
    await asOperator(
      `UPDATE workspace_persona SET operator_overrides = '{}'::jsonb, operator_note = NULL WHERE org_id = $1`,
      [b.orgId],
    );
  });

  it('a stored document that no longer parses does not break reading or saving', async () => {
    await h.owner.query(
      `UPDATE workspace_persona SET workspace_overrides = '{"v":9,"modules":"broken"}'::jsonb WHERE org_id = $1`,
      [b.orgId],
    );
    expect((await get(b.admin)).status).toBe(200);
    const rev = (await row(b.orgId)).rev as number;
    const res = await put(b.admin, { rev, nouns: { meeting: { en: forms('Call') } } });
    expect(res.status).toBe(200);
    expect((await row(b.orgId)).workspace_overrides).toEqual({
      v: 1,
      vocab: { meeting: { en: forms('Call') } },
    });
    expect((await session(b.admin)).org.persona.nouns.en).toEqual({ meeting: forms('Call') });
  });
});
