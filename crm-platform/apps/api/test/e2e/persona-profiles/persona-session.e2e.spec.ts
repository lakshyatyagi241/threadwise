import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionResponseSchema } from '@crm/contracts';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Persona profiles, phase 0 (docs/specs/persona-profiles.md, BL-280), through the real API against a real Postgres (restricted role,
 * forced RLS): provisioning gives every new workspace its `generic` row, `PersonaService.resolve` rides on the session as
 * `org.persona`, the layers resolve there, workspaces never see each other's, and nothing the persona says changes what a person may do.
 * Arranging and reading back use the owner connection; everything asserted about behaviour goes through HTTP.
 */
let h: Harness;
let api: Api;
let a: Tenant;
let b: Tenant;

/** The fields of GET /v2/auth/session these specs read. The persona view is typed as present; the spec that expects it absent asserts that. */
interface SessionView {
  permissions: unknown;
  org: {
    persona: {
      key: string;
      version: number;
      rev: number;
      solo: boolean;
      showAll: boolean;
      defaultVisibility: string;
      modules: Record<string, { visible: boolean; locked: boolean }>;
    };
  };
}

const session = async (t: Tenant) => {
  const res = await api.http().get('/v2/auth/session').set(bearer(t.admin));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as SessionView;
};

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

const row = async (orgId: number) =>
  (await h.owner.query(`SELECT * FROM workspace_persona WHERE org_id = $1`, [orgId])).rows[0];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  a = await api.signup('persona-a');
  b = await api.signup('persona-b');
}, 900_000);

afterAll(async () => {
  await h?.stop();
});

describe('provisioning', () => {
  it('gives a new workspace its generic persona row in the same transaction as the organization', async () => {
    const r = await row(a.orgId);
    expect(r).toMatchObject({
      org_id: a.orgId,
      persona_key: 'generic',
      persona_version: 1,
      pinned: false,
      solo_ui: 'auto',
      show_all_modules: false,
      workspace_overrides: {},
      operator_overrides: {},
      onboarding: {},
      rev: 1,
    });
    expect((await row(b.orgId)).persona_key).toBe('generic');
  });
});

describe('the persona view on the session', () => {
  it('is generic and hides nothing for a new workspace (the golden check)', async () => {
    const body = await session(a);
    expect(sessionResponseSchema.safeParse(body).success).toBe(true);
    expect(body.org.persona).toEqual({
      key: 'generic',
      version: 1,
      rev: 1,
      solo: false,
      showAll: false,
      defaultVisibility: 'show',
      modules: {},
    });
  });

  it('changes nothing else about the session: permissions, landing, flags and the rest are identical', async () => {
    const before = await session(a);
    await h.owner.query(
      `UPDATE workspace_persona SET workspace_overrides = $2::jsonb, show_all_modules = false WHERE org_id = $1`,
      [
        a.orgId,
        JSON.stringify({
          v: 1,
          modules: { 'nav:deals': { state: 'hide' }, 'nav:inbox': { state: 'hide' } },
        }),
      ],
    );
    const after = await session(a);
    const strip = (s: SessionView) => ({ ...s, org: { ...s.org, persona: undefined } });
    expect(strip(after)).toEqual(strip(before));
    expect(after.permissions).toEqual(before.permissions);
    // ... while the view itself did change
    expect(after.org.persona.modules).toEqual({
      'nav:deals': { visible: false, locked: false },
      'nav:inbox': { visible: false, locked: false },
    });
    expect(after.org.persona.rev).toBe(before.org.persona.rev + 1);
    await h.owner.query(
      `UPDATE workspace_persona SET workspace_overrides = '{}'::jsonb WHERE org_id = $1`,
      [a.orgId],
    );
  });

  it("resolves the layers: the workspace's hide, Show more modules, and an operator lock that beats both", async () => {
    await h.owner.query(
      `UPDATE workspace_persona SET workspace_overrides = $2::jsonb WHERE org_id = $1`,
      [
        a.orgId,
        JSON.stringify({
          v: 1,
          modules: { 'nav:deals': { state: 'show' }, 'tile:channels': { state: 'hide' } },
        }),
      ],
    );
    await asOperator(
      `UPDATE workspace_persona SET operator_overrides = $2::jsonb, operator_note = 'internal note', operator_updated_at = now() WHERE org_id = $1`,
      [
        a.orgId,
        JSON.stringify({
          v: 1,
          modules: { 'nav:deals': { state: 'hide', locked: true, reason: 'owner asked us to' } },
        }),
      ],
    );
    const body = await session(a);
    // the lock wins over the workspace's show; the workspace's own hide stands
    expect(body.org.persona.modules).toEqual({
      'nav:deals': { visible: false, locked: true },
      'tile:channels': { visible: false, locked: false },
    });
    // the member sees the decision and "locked", never the operator's reason or note
    expect(JSON.stringify(body)).not.toMatch(/internal note|owner asked us to/);

    await h.owner.query(`UPDATE workspace_persona SET show_all_modules = true WHERE org_id = $1`, [
      a.orgId,
    ]);
    const shown = await session(a);
    expect(shown.org.persona.showAll).toBe(true);
    // Show more modules does not reveal what the operator locked hidden, and does not undo the workspace's own hide
    expect(shown.org.persona.modules).toEqual({
      'nav:deals': { visible: false, locked: true },
      'tile:channels': { visible: false, locked: false },
    });

    await asOperator(
      `UPDATE workspace_persona SET operator_overrides = '{}'::jsonb, operator_note = NULL WHERE org_id = $1`,
      [a.orgId],
    );
    await h.owner.query(
      `UPDATE workspace_persona SET workspace_overrides = '{}'::jsonb, show_all_modules = false WHERE org_id = $1`,
      [a.orgId],
    );
  });

  it("keeps workspaces apart: another workspace's overrides never show up", async () => {
    const before = await session(a);
    await h.owner.query(
      `UPDATE workspace_persona SET workspace_overrides = $2::jsonb, solo_ui = 'on' WHERE org_id = $1`,
      [b.orgId, JSON.stringify({ v: 1, modules: { 'nav:contacts': { state: 'hide' } } })],
    );
    expect(await session(a)).toEqual(before);
    const mine = await session(b);
    expect(mine.org.persona.modules).toEqual({ 'nav:contacts': { visible: false, locked: false } });
    expect(mine.org.persona.solo).toBe(true);
    await h.owner.query(
      `UPDATE workspace_persona SET workspace_overrides = '{}'::jsonb, solo_ui = 'auto' WHERE org_id = $1`,
      [b.orgId],
    );
  });

  it('shows everything (no persona field) when nothing is known, and the session still works', async () => {
    const saved = await row(a.orgId);
    // 1. a workspace with no row at all (created while a deploy ran)
    await asOperator(`DELETE FROM workspace_persona WHERE org_id = $1`, [a.orgId]);
    expect((await session(a)).org.persona).toBeUndefined();
    await h.owner.query(`INSERT INTO workspace_persona (org_id) VALUES ($1)`, [a.orgId]);

    // 2. pinned to a version that does not exist
    await h.owner.query(
      `UPDATE workspace_persona SET pinned = true, persona_version = 9 WHERE org_id = $1`,
      [a.orgId],
    );
    expect((await session(a)).org.persona).toBeUndefined();
    await h.owner.query(
      `UPDATE workspace_persona SET pinned = false, persona_version = 1 WHERE org_id = $1`,
      [a.orgId],
    );

    // 3. an override document that no longer parses is silent, not an error
    await h.owner.query(
      `UPDATE workspace_persona SET workspace_overrides = '{"v":9,"modules":"broken"}'::jsonb WHERE org_id = $1`,
      [a.orgId],
    );
    const body = await session(a);
    expect(body.org.persona).toMatchObject({
      key: 'generic',
      defaultVisibility: 'show',
      modules: {},
    });
    await h.owner.query(
      `UPDATE workspace_persona SET workspace_overrides = '{}'::jsonb WHERE org_id = $1`,
      [a.orgId],
    );
    expect((await row(a.orgId)).persona_key).toBe(saved.persona_key);
  });

  it('follows a newly published version of its persona without a write to the workspace, unless pinned', async () => {
    const generic = (await h.owner.query(`SELECT id FROM personas WHERE key = 'generic'`)).rows[0]
      .id;
    const definition = {
      schemaVersion: 1,
      label: { en: 'Generic' },
      summary: { en: 'Everything, hiding the store.' },
      icon: 'layers',
      teamSizes: [],
      vocabulary: { nouns: {}, phrases: {} },
      modules: { default: 'show', ids: { 'nav:store': 'hide' } },
      presets: {
        addons: [],
        bookingTypes: [],
        lifecycleStages: [],
        pipelines: [],
        templates: [],
        settings: {},
      },
      checklist: [],
    };
    await asOperator(
      `INSERT INTO persona_versions (persona_id, version, status, definition, published_at) VALUES ($1, 2, 'published', $2::jsonb, now())`,
      [generic, JSON.stringify(definition)],
    );
    try {
      await asOperator(`UPDATE personas SET current_version = 2 WHERE id = $1`, [generic]);
      // a follows latest: it moves to version 2 on its own
      const followed = await session(a);
      expect(followed.org.persona).toMatchObject({
        version: 2,
        modules: { 'nav:store': { visible: false, locked: false } },
      });
      expect((await row(a.orgId)).persona_version).toBe(1); // its row was not touched
      // b is pinned to version 1 and stays there
      await h.owner.query(`UPDATE workspace_persona SET pinned = true WHERE org_id = $1`, [
        b.orgId,
      ]);
      expect((await session(b)).org.persona).toMatchObject({ version: 1, modules: {} });
    } finally {
      await asOperator(`UPDATE personas SET current_version = 1 WHERE id = $1`, [generic]);
      await h.owner.query(
        `ALTER TABLE persona_versions DISABLE TRIGGER trg_persona_versions_guard`,
      );
      await h.owner.query(`DELETE FROM persona_versions WHERE persona_id = $1 AND version = 2`, [
        generic,
      ]);
      await h.owner.query(`ALTER TABLE persona_versions ENABLE TRIGGER trg_persona_versions_guard`);
      await h.owner.query(`UPDATE workspace_persona SET pinned = false WHERE org_id = $1`, [
        b.orgId,
      ]);
    }
  });
});
