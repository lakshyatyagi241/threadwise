import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';
import { GENERIC_PERSONA_DEFINITION, personaDefinitionSchema } from '@crm/contracts';

/**
 * Persona profiles, phase 0 (docs/specs/persona-profiles.md, BL-280), against a real Postgres as the restricted application role (a
 * superuser skips every policy, so the owner connection is used only to arrange state and read it back).
 *
 * The backfill is proven the way it will run: every migration EXCEPT the three persona ones is applied, workspaces are created, and then
 * the persona migrations run on top of them.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const PERSONA_FILES = /^20261230090[012]00_persona_/;
// Later migrations that only insert into the persona tables (the edition presets, BL-383): they wait for phase 3 like the persona ones.
const LATER_PERSONA_DATA = /_edition_personas\.sql$/;
const BULK = 2_100; // more than two backfill batches of 1000

describe('persona profiles: schema, backfill and access rules', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let tmp: string;
  let orgA: number;
  let orgB: number;
  let orgC: number;
  const preexisting: number[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );

    // 1. the product as it is today: every migration but the persona ones
    tmp = mkdtempSync(join(tmpdir(), 'persona-mig-'));
    mkdirSync(tmp, { recursive: true });
    for (const f of readdirSync(MIGRATIONS)) {
      if (f.endsWith('.sql') && !PERSONA_FILES.test(f) && !LATER_PERSONA_DATA.test(f))
        copyFileSync(join(MIGRATIONS, f), join(tmp, f));
    }
    await runMigrations(container.getConnectionUri(), { dir: tmp, log: () => undefined });

    // 2. workspaces that exist before personas do
    for (const slug of ['pre-a', 'pre-b', 'pre-c']) {
      const r = await owner.query(
        `INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`,
        [slug],
      );
      preexisting.push(Number(r.rows[0].id));
    }
    await owner.query(
      `INSERT INTO organizations (slug, name) SELECT 'bulk-' || g, 'Bulk ' || g FROM generate_series(1, ${BULK}) g`,
    );
    [orgA, orgB, orgC] = preexisting as [number, number, number];

    // 3. the persona migrations on top of them
    const res = await runMigrations(container.getConnectionUri(), {
      dir: MIGRATIONS,
      log: () => undefined,
    });
    expect(res.applied.filter((f) => PERSONA_FILES.test(f))).toHaveLength(3);

    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 600_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  /** Runs `fn` as the restricted role inside a transaction that is always rolled back. */
  async function within<T>(
    ctx: { org?: number; user?: number; privileged?: boolean },
    fn: () => Promise<T>,
  ): Promise<T> {
    await app.query('BEGIN');
    try {
      if (ctx.org) await app.query(`SELECT set_config('app.org_id', '${ctx.org}', true)`);
      if (ctx.user) await app.query(`SELECT set_config('app.user_id', '${ctx.user}', true)`);
      if (ctx.privileged) await app.query(`SELECT set_config('app.privileged', 'on', true)`);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const tenant = <T>(org: number, fn: () => Promise<T>) => within({ org }, fn);
  const privileged = <T>(fn: () => Promise<T>) => within({ privileged: true }, fn);
  const n = (r: { rows: Array<{ n: string | number }> }) => Number(r.rows[0]!.n);

  describe('seed and backfill', () => {
    it('seeds the generic persona and its version 1, equal to GENERIC_PERSONA_DEFINITION', async () => {
      const p = await owner.query(
        `SELECT key, status, is_system, current_version FROM personas WHERE key NOT IN ('chat_team', 'sales_team', 'both')`,
      );
      expect(p.rows).toEqual([
        { key: 'generic', status: 'active', is_system: true, current_version: 1 },
      ]);
      // The edition presets (BL-383) are catalog data on top of it: published version 1, not system, no workspace moved onto them.
      const editions = await owner.query(
        `SELECT p.key, p.is_system, v.status FROM personas p JOIN persona_versions v ON v.persona_id = p.id WHERE p.key IN ('chat_team', 'sales_team', 'both') ORDER BY 1`,
      );
      expect(editions.rows).toEqual([
        { key: 'both', is_system: false, status: 'published' },
        { key: 'chat_team', is_system: false, status: 'published' },
        { key: 'sales_team', is_system: false, status: 'published' },
      ]);
      const moved = await owner.query(
        `SELECT count(*)::int AS n FROM workspace_persona WHERE persona_key <> 'generic'`,
      );
      expect(moved.rows[0].n).toBe(0);
      const v = await owner.query(
        `SELECT v.version, v.status, v.definition, v.published_at FROM persona_versions v JOIN personas p ON p.id = v.persona_id WHERE p.key = 'generic'`,
      );
      expect(v.rows).toHaveLength(1);
      expect(v.rows[0].version).toBe(1);
      expect(v.rows[0].status).toBe('published');
      expect(v.rows[0].published_at).not.toBeNull();
      expect(personaDefinitionSchema.parse(v.rows[0].definition)).toEqual(
        GENERIC_PERSONA_DEFINITION,
      );
    });

    it('puts EVERY existing workspace on generic, solo off, onboarding done, no overrides (also past the batch size)', async () => {
      const orgs = n(await owner.query(`SELECT count(*) AS n FROM organizations`));
      expect(orgs).toBeGreaterThanOrEqual(BULK + 3);
      expect(n(await owner.query(`SELECT count(*) AS n FROM workspace_persona`))).toBe(orgs);
      const bad = await owner.query(`
        SELECT count(*) AS n FROM workspace_persona
         WHERE persona_key <> 'generic' OR persona_version <> 1 OR pinned OR solo_ui <> 'off' OR show_all_modules
            OR workspace_overrides <> '{}'::jsonb OR operator_overrides <> '{}'::jsonb
            OR operator_note IS NOT NULL OR rev <> 1
            OR onboarding -> 'completedAt' IS NULL OR (onboarding ->> 'backfilled')::boolean IS NOT TRUE`);
      expect(n(bad)).toBe(0);
    });

    it('is idempotent and does not overwrite what a workspace changed since', async () => {
      await owner.query(`UPDATE workspace_persona SET show_all_modules = true WHERE org_id = $1`, [
        orgA,
      ]);
      const before = await owner.query(
        `SELECT count(*) AS n, max(rev) AS rev FROM workspace_persona`,
      );
      const sql = readFileSync(
        join(
          MIGRATIONS,
          readdirSync(MIGRATIONS).find((f) => f.includes('persona_generic_seed_backfill'))!,
        ),
        'utf8',
      );
      await owner.query(sql);
      await owner.query(sql);
      const after = await owner.query(
        `SELECT count(*) AS n, max(rev) AS rev FROM workspace_persona`,
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
      const row = await owner.query(
        `SELECT show_all_modules FROM workspace_persona WHERE org_id = $1`,
        [orgA],
      );
      expect(row.rows[0].show_all_modules).toBe(true);
      await owner.query(`UPDATE workspace_persona SET show_all_modules = false WHERE org_id = $1`, [
        orgA,
      ]);
    });

    it('a rerun gives a row to a workspace created while the deploy ran', async () => {
      const r = await owner.query(
        `INSERT INTO organizations (slug, name) VALUES ('late', 'Late') RETURNING id`,
      );
      const late = Number(r.rows[0].id);
      expect(
        n(
          await owner.query(`SELECT count(*) AS n FROM workspace_persona WHERE org_id = $1`, [
            late,
          ]),
        ),
      ).toBe(0);
      const sql = readFileSync(
        join(
          MIGRATIONS,
          readdirSync(MIGRATIONS).find((f) => f.includes('persona_generic_seed_backfill'))!,
        ),
        'utf8',
      );
      await owner.query(sql);
      expect(
        n(
          await owner.query(`SELECT count(*) AS n FROM workspace_persona WHERE org_id = $1`, [
            late,
          ]),
        ),
      ).toBe(1);
    });
  });

  describe('operator permissions', () => {
    it('seeds the four platform keys, held by Super Admin and Admin, with Platform Support only reading', async () => {
      const res = await owner.query(`
        SELECT r.name AS role, array_agg(p.name::text ORDER BY p.name::text) AS keys
          FROM platform_role_permissions rp
          JOIN platform_roles r ON r.id = rp.role_id
          JOIN platform_permissions p ON p.id = rp.permission_id
         WHERE p.name::text LIKE 'platform.persona.%' GROUP BY r.name ORDER BY r.name`);
      const all = [
        'platform.persona.manage',
        'platform.persona.override',
        'platform.persona.publish',
        'platform.persona.view',
      ];
      expect(res.rows).toEqual([
        { role: 'Admin', keys: all },
        { role: 'Platform Support', keys: ['platform.persona.view'] },
        { role: 'Super Admin', keys: all },
      ]);
      const sys = await owner.query(
        `SELECT bool_and(is_system) AS s FROM platform_permissions WHERE name::text LIKE 'platform.persona.%'`,
      );
      expect(sys.rows[0].s).toBe(true);
    });

    it('adds no tenant permission key (a workspace uses admin.settings.manage)', async () => {
      const res = await owner.query(
        `SELECT key FROM permission_defs WHERE key ~ '(^|[.])persona([.]|$)'`,
      );
      expect(res.rows).toEqual([]);
    });
  });

  describe('platform catalog access rules', () => {
    it('a workspace reads personas and published versions, but not a draft', async () => {
      await owner.query(`INSERT INTO personas (key) VALUES ('clinic')`);
      const clinic = (await owner.query(`SELECT id FROM personas WHERE key = 'clinic'`)).rows[0].id;
      await owner.query(
        `INSERT INTO persona_versions (persona_id, version, status, definition) VALUES ($1, 1, 'draft', $2::jsonb)`,
        [clinic, JSON.stringify({ secret: 'work in progress' })],
      );
      try {
        const seen = await tenant(orgA, () =>
          app.query(
            `SELECT p.key, v.status FROM personas p LEFT JOIN persona_versions v ON v.persona_id = p.id WHERE p.key IN ('clinic', 'generic') ORDER BY 1, 2`,
          ),
        );
        expect(seen.rows).toEqual([
          { key: 'clinic', status: null },
          { key: 'generic', status: 'published' },
        ]);
        const asOperator = await privileged(() =>
          app.query(`SELECT status FROM persona_versions WHERE persona_id = $1`, [clinic]),
        );
        expect(asOperator.rows).toEqual([{ status: 'draft' }]);
      } finally {
        await owner.query(`DELETE FROM persona_versions WHERE persona_id = $1`, [clinic]);
        await owner.query(`DELETE FROM personas WHERE id = $1`, [clinic]);
      }
    });

    it('a workspace cannot write the catalog; the privileged path can', async () => {
      await expect(
        tenant(orgA, () => app.query(`INSERT INTO personas (key) VALUES ('mine')`)),
      ).rejects.toThrow(/row-level security/i);
      const update = await tenant(orgA, () =>
        app.query(`UPDATE personas SET sort_order = 9 WHERE key = 'generic'`),
      );
      expect(update.rowCount).toBe(0);
      const del = await tenant(orgA, () => app.query(`DELETE FROM personas WHERE key = 'generic'`));
      expect(del.rowCount).toBe(0);
      await expect(
        tenant(orgA, () =>
          app.query(
            `INSERT INTO persona_versions (persona_id, version, status, definition) SELECT id, 2, 'draft', '{}' FROM personas WHERE key = 'generic'`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
      const unsup = await tenant(orgA, () => app.query(`UPDATE persona_versions SET note = 'x'`));
      expect(unsup.rowCount).toBe(0);

      const ok = await privileged(() =>
        app.query(`INSERT INTO personas (key) VALUES ('mine') RETURNING key`),
      );
      expect(ok.rows).toEqual([{ key: 'mine' }]);
    });

    it('a published version is immutable, even for the operator; only published -> superseded is allowed', async () => {
      await owner.query(`INSERT INTO personas (key) VALUES ('versions')`);
      const id = (await owner.query(`SELECT id FROM personas WHERE key = 'versions'`)).rows[0].id;
      try {
        await owner.query(
          `INSERT INTO persona_versions (persona_id, version, status, definition, published_at) VALUES ($1, 1, 'published', '{"a":1}'::jsonb, now())`,
          [id],
        );
        await expect(
          privileged(() =>
            app.query(
              `UPDATE persona_versions SET definition = '{"a":2}'::jsonb WHERE persona_id = $1`,
              [id],
            ),
          ),
        ).rejects.toThrow(/immutable/);
        await expect(
          privileged(() =>
            app.query(`UPDATE persona_versions SET note = 'edited' WHERE persona_id = $1`, [id]),
          ),
        ).rejects.toThrow(/immutable/);
        await expect(
          privileged(() => app.query(`DELETE FROM persona_versions WHERE persona_id = $1`, [id])),
        ).rejects.toThrow(/cannot be deleted/);
        await expect(
          privileged(() =>
            app.query(
              `UPDATE persona_versions SET status = 'draft', published_at = NULL WHERE persona_id = $1`,
              [id],
            ),
          ),
        ).rejects.toThrow(/immutable/);
        const ok = await privileged(() =>
          app.query(
            `UPDATE persona_versions SET status = 'superseded' WHERE persona_id = $1 RETURNING status`,
            [id],
          ),
        );
        expect(ok.rows).toEqual([{ status: 'superseded' }]);
      } finally {
        await owner.query(
          `ALTER TABLE persona_versions DISABLE TRIGGER trg_persona_versions_guard`,
        );
        await owner.query(`DELETE FROM persona_versions WHERE persona_id = $1`, [id]);
        await owner.query(`ALTER TABLE persona_versions ENABLE TRIGGER trg_persona_versions_guard`);
        await owner.query(`DELETE FROM personas WHERE id = $1`, [id]);
      }
    });

    it('a draft may be edited and deleted, and a persona has at most one', async () => {
      await owner.query(`INSERT INTO personas (key) VALUES ('drafts')`);
      const id = (await owner.query(`SELECT id FROM personas WHERE key = 'drafts'`)).rows[0].id;
      try {
        await owner.query(
          `INSERT INTO persona_versions (persona_id, version, definition) VALUES ($1, 1, '{}')`,
          [id],
        );
        await expect(
          owner.query(
            `INSERT INTO persona_versions (persona_id, version, definition) VALUES ($1, 2, '{}')`,
            [id],
          ),
        ).rejects.toThrow(/uq_persona_versions_one_draft/);
        const edited = await privileged(() =>
          app.query(
            `UPDATE persona_versions SET note = 'wip' WHERE persona_id = $1 RETURNING note`,
            [id],
          ),
        );
        expect(edited.rows).toEqual([{ note: 'wip' }]);
        const gone = await privileged(() =>
          app.query(`DELETE FROM persona_versions WHERE persona_id = $1`, [id]),
        );
        expect(gone.rowCount).toBe(1);
      } finally {
        await owner.query(`DELETE FROM persona_versions WHERE persona_id = $1`, [id]);
        await owner.query(`DELETE FROM personas WHERE id = $1`, [id]);
      }
    });

    it('guards the catalog with constraints: generic cannot be archived, keys follow the pattern, versions need their state', async () => {
      await expect(
        owner.query(`UPDATE personas SET status = 'archived' WHERE key = 'generic'`),
      ).rejects.toThrow(/chk_personas_system_active/);
      for (const bad of ['Clinic', '1abc', 'a', 'with-dash', 'x'.repeat(41)]) {
        await expect(owner.query(`INSERT INTO personas (key) VALUES ($1)`, [bad])).rejects.toThrow(
          /chk_personas_key/,
        );
      }
      await expect(
        owner.query(`UPDATE persona_versions SET published_at = NULL WHERE version = 1`),
      ).rejects.toThrow(/chk_persona_versions_published|immutable/);
    });

    it('a workspace cannot point at a persona that does not exist', async () => {
      await expect(
        owner.query(`UPDATE workspace_persona SET persona_key = 'ghost' WHERE org_id = $1`, [orgA]),
      ).rejects.toThrow(/workspace_persona_persona_key_fkey/);
    });
  });

  describe('workspace_persona: tenant isolation and the operator columns', () => {
    it('a workspace sees only its own row', async () => {
      const own = await tenant(orgA, () => app.query(`SELECT org_id FROM workspace_persona`));
      expect(own.rows.map((r) => Number(r.org_id))).toEqual([orgA]);
      const none = await app.query(`SELECT org_id FROM workspace_persona`); // no tenant context at all
      expect(none.rows).toEqual([]);
      expect(
        n(await privileged(() => app.query(`SELECT count(*) AS n FROM workspace_persona`))),
      ).toBeGreaterThan(BULK);
    });

    it("cannot read, change, delete or create another workspace's row", async () => {
      const read = await tenant(orgA, () =>
        app.query(`SELECT 1 FROM workspace_persona WHERE org_id = $1`, [orgB]),
      );
      expect(read.rowCount).toBe(0);
      const upd = await tenant(orgA, () =>
        app.query(`UPDATE workspace_persona SET show_all_modules = true WHERE org_id = $1`, [orgB]),
      );
      expect(upd.rowCount).toBe(0);
      await owner.query(`DELETE FROM workspace_persona WHERE org_id = $1`, [orgC]);
      try {
        await expect(
          tenant(orgA, () =>
            app.query(`INSERT INTO workspace_persona (org_id) VALUES ($1)`, [orgC]),
          ),
        ).rejects.toThrow(/row-level security/i);
        const own = await tenant(orgC, () =>
          app.query(
            `INSERT INTO workspace_persona (org_id) VALUES ($1) RETURNING persona_key, solo_ui`,
            [orgC],
          ),
        );
        expect(own.rows).toEqual([{ persona_key: 'generic', solo_ui: 'auto' }]);
      } finally {
        await owner.query(
          `INSERT INTO workspace_persona (org_id) VALUES ($1) ON CONFLICT DO NOTHING`,
          [orgC],
        );
      }
    });

    it('a workspace changes its own layer, and rev is bumped by every change whatever the statement says', async () => {
      const now = (
        await owner.query(`SELECT rev, row_version FROM workspace_persona WHERE org_id = $1`, [
          orgA,
        ])
      ).rows[0];
      const start = Number(now.rev);
      const startVersion = Number(now.row_version);
      const r = await tenant(orgA, async () => {
        const first = await app.query(
          `UPDATE workspace_persona SET show_all_modules = true WHERE org_id = $1 RETURNING rev, row_version`,
          [orgA],
        );
        const second = await app.query(
          `UPDATE workspace_persona SET solo_ui = 'on', rev = 999 WHERE org_id = $1 RETURNING rev`,
          [orgA],
        );
        const third = await app.query(
          `UPDATE workspace_persona SET solo_ui = 'on' WHERE org_id = $1 RETURNING rev`,
          [orgA],
        ); // no real change: still a write, still a new rev
        return [first.rows[0], second.rows[0], third.rows[0]];
      });
      expect(r.map((x) => x.rev)).toEqual([start + 1, start + 2, start + 3]);
      expect(r[0].row_version).toBe(startVersion + 1);
    });

    it('a workspace cannot write the operator columns (trigger), the operator can', async () => {
      const columns: Array<[string, string]> = [
        ['operator_overrides', `'{"v":1,"modules":{}}'::jsonb`],
        ['operator_note', `'hello'`],
        ['operator_updated_at', `now()`],
      ];
      for (const [col, value] of columns) {
        await expect(
          tenant(orgA, () =>
            app.query(`UPDATE workspace_persona SET ${col} = ${value} WHERE org_id = $1`, [orgA]),
          ),
        ).rejects.toThrow(/operator columns are written by the platform operator only/);
      }
      const ok = await privileged(() =>
        app.query(
          `UPDATE workspace_persona SET operator_overrides = '{"v":1,"modules":{}}'::jsonb, operator_note = 'asked by phone', operator_updated_at = now()
            WHERE org_id = $1 RETURNING rev, operator_note`,
          [orgA],
        ),
      );
      expect(ok.rows[0].operator_note).toBe('asked by phone');
      expect(ok.rows[0].rev).toBeGreaterThan(1);
    });

    it('a workspace creating its own row cannot smuggle in operator values', async () => {
      await owner.query(`DELETE FROM workspace_persona WHERE org_id = $1`, [orgC]);
      try {
        await expect(
          tenant(orgC, () =>
            app.query(
              `INSERT INTO workspace_persona (org_id, operator_note) VALUES ($1, 'sneaky')`,
              [orgC],
            ),
          ),
        ).rejects.toThrow(/operator columns/);
        await expect(
          tenant(orgC, () =>
            app.query(
              `INSERT INTO workspace_persona (org_id, operator_overrides) VALUES ($1, '{"v":1}')`,
              [orgC],
            ),
          ),
        ).rejects.toThrow(/operator columns/);
      } finally {
        await owner.query(
          `INSERT INTO workspace_persona (org_id) VALUES ($1) ON CONFLICT DO NOTHING`,
          [orgC],
        );
      }
    });

    it("a workspace cannot delete its own row (that would drop the operator's overrides)", async () => {
      await expect(
        tenant(orgA, () => app.query(`DELETE FROM workspace_persona WHERE org_id = $1`, [orgA])),
      ).rejects.toThrow(/permission denied/);
    });

    it('the row goes away with its workspace', async () => {
      const r = await owner.query(
        `INSERT INTO organizations (slug, name) VALUES ('doomed', 'Doomed') RETURNING id`,
      );
      const id = Number(r.rows[0].id);
      await owner.query(`INSERT INTO workspace_persona (org_id) VALUES ($1)`, [id]);
      await owner.query(`DELETE FROM organizations WHERE id = $1`, [id]);
      expect(
        n(await owner.query(`SELECT count(*) AS n FROM workspace_persona WHERE org_id = $1`, [id])),
      ).toBe(0);
    });

    it('rejects values the model does not allow', async () => {
      await expect(
        owner.query(`UPDATE workspace_persona SET solo_ui = 'maybe' WHERE org_id = $1`, [orgB]),
      ).rejects.toThrow(/chk_workspace_persona_solo_ui/);
      await expect(
        owner.query(`UPDATE workspace_persona SET team_size = '7' WHERE org_id = $1`, [orgB]),
      ).rejects.toThrow(/chk_workspace_persona_team_size/);
      await expect(
        owner.query(
          `UPDATE workspace_persona SET workspace_overrides = '[]'::jsonb WHERE org_id = $1`,
          [orgB],
        ),
      ).rejects.toThrow(/chk_workspace_persona_overrides/);
    });
  });

  describe('workspace_persona_applied', () => {
    it('is tenant-isolated and holds one row per preset', async () => {
      await owner.query(
        `INSERT INTO workspace_persona_applied (org_id, preset_kind, preset_key, persona_key, persona_version) VALUES ($1, 'booking_type', 'consultation-30', 'generic', 1)`,
        [orgA],
      );
      try {
        const own = await tenant(orgA, () =>
          app.query(`SELECT preset_key FROM workspace_persona_applied`),
        );
        expect(own.rows).toEqual([{ preset_key: 'consultation-30' }]);
        const other = await tenant(orgB, () =>
          app.query(`SELECT preset_key FROM workspace_persona_applied`),
        );
        expect(other.rows).toEqual([]);
        await expect(
          tenant(orgB, () =>
            app.query(
              `INSERT INTO workspace_persona_applied (org_id, preset_kind, preset_key, persona_key, persona_version) VALUES ($1, 'template', 'x', 'generic', 1)`,
              [orgA],
            ),
          ),
        ).rejects.toThrow(/row-level security/i);
        await expect(
          owner.query(
            `INSERT INTO workspace_persona_applied (org_id, preset_kind, preset_key, persona_key, persona_version) VALUES ($1, 'booking_type', 'consultation-30', 'generic', 1)`,
            [orgA],
          ),
        ).rejects.toThrow(/duplicate key/);
        await expect(
          owner.query(
            `INSERT INTO workspace_persona_applied (org_id, preset_kind, preset_key, persona_key, persona_version) VALUES ($1, 'nonsense', 'x', 'generic', 1)`,
            [orgA],
          ),
        ).rejects.toThrow(/chk_workspace_persona_applied_kind/);
      } finally {
        await owner.query(`DELETE FROM workspace_persona_applied`);
      }
    });
  });

  describe('workspace_persona_log', () => {
    /** A workspace member: tenant context plus the acting user, which the append policy binds `actor_id` to. */
    const asUser = <T>(org: number, fn: () => Promise<T>) => within({ org, user: 1 }, fn);
    const insert = (layer: string, actor: string, reason: string | null, org: number) =>
      app.query(
        `INSERT INTO workspace_persona_log (org_id, layer, actor_kind, actor_id, action, item_id, reason)
         VALUES ($1, $2, $3, 1, 'set', 'nav:deals', $4) RETURNING id`,
        [org, layer, actor, reason],
      );

    it('a workspace appends its own history and reads it back, only its own', async () => {
      const seen = await asUser(orgA, async () => {
        await insert('workspace', 'user', null, orgA);
        await insert('persona_change', 'user', null, orgA);
        return app.query(`SELECT layer FROM workspace_persona_log ORDER BY id`);
      });
      expect(seen.rows).toEqual([{ layer: 'workspace' }, { layer: 'persona_change' }]);
      await expect(asUser(orgA, () => insert('workspace', 'user', null, orgB))).rejects.toThrow(
        /row-level security/i,
      );
    });

    it('a workspace cannot write an operator row, and never sees one', async () => {
      await expect(
        asUser(orgA, () => insert('operator', 'operator', 'because we said so', orgA)),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        asUser(orgA, () => insert('persona_change', 'operator', 'because we said so', orgA)),
      ).rejects.toThrow(/row-level security/i);
      await owner.query(
        `INSERT INTO workspace_persona_log (org_id, layer, actor_kind, action, reason) VALUES ($1, 'operator', 'operator', 'lock', 'they asked for it')`,
        [orgA],
      );
      await owner.query(
        `INSERT INTO workspace_persona_log (org_id, layer, actor_kind, action, reason) VALUES ($1, 'persona_change', 'operator', 'switch', 'moved to clinic')`,
        [orgA],
      );
      try {
        const asTenant = await asUser(orgA, () =>
          app.query(`SELECT layer, actor_kind FROM workspace_persona_log`),
        );
        expect(asTenant.rows.every((r) => r.actor_kind === 'user' && r.layer !== 'operator')).toBe(
          true,
        );
        const asOperator = await privileged(() =>
          app.query(
            `SELECT count(*) AS n FROM workspace_persona_log WHERE actor_kind = 'operator'`,
          ),
        );
        expect(n(asOperator)).toBe(2);
      } finally {
        await owner.query(`DELETE FROM workspace_persona_log`);
      }
    });

    it('an operator row needs a reason of at least 5 characters, and the layer decides the actor', async () => {
      await expect(privileged(() => insert('operator', 'operator', null, orgA))).rejects.toThrow(
        /chk_workspace_persona_log_reason/,
      );
      await expect(privileged(() => insert('operator', 'operator', 'abc', orgA))).rejects.toThrow(
        /chk_workspace_persona_log_reason/,
      );
      await expect(
        privileged(() => insert('operator', 'user', 'a good reason', orgA)),
      ).rejects.toThrow(/chk_workspace_persona_log_layer_actor/);
      const ok = await privileged(() => insert('operator', 'operator', 'a good reason', orgA));
      expect(ok.rowCount).toBe(1);
    });

    it('is append-only for every role, the operator path included', async () => {
      await owner.query(
        `INSERT INTO workspace_persona_log (org_id, layer, actor_kind, action) VALUES ($1, 'workspace', 'user', 'set')`,
        [orgA],
      );
      try {
        await expect(
          asUser(orgA, () => app.query(`UPDATE workspace_persona_log SET action = 'edited'`)),
        ).rejects.toThrow(/permission denied/);
        await expect(
          asUser(orgA, () => app.query(`DELETE FROM workspace_persona_log`)),
        ).rejects.toThrow(/permission denied/);
        await expect(
          privileged(() => app.query(`UPDATE workspace_persona_log SET action = 'edited'`)),
        ).rejects.toThrow(/permission denied/);
        await expect(
          privileged(() => app.query(`DELETE FROM workspace_persona_log`)),
        ).rejects.toThrow(/permission denied/);
      } finally {
        await owner.query(`DELETE FROM workspace_persona_log`);
      }
    });

    it('a workspace cannot forge who acted or when', async () => {
      await expect(
        asUser(orgA, () =>
          app.query(
            `INSERT INTO workspace_persona_log (org_id, layer, actor_kind, actor_id, action) VALUES ($1, 'workspace', 'user', 2, 'set')`,
            [orgA],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
      const stamped = await asUser(orgA, () =>
        app.query(
          `INSERT INTO workspace_persona_log (org_id, layer, actor_kind, actor_id, action, created_at)
           VALUES ($1, 'workspace', 'user', 1, 'set', '2001-01-01') RETURNING created_at > now() - interval '1 minute' AS fresh`,
          [orgA],
        ),
      );
      expect(stamped.rows).toEqual([{ fresh: true }]);
      // the operator path keeps the clock it is given (an import or a replay)
      const operator = await privileged(() =>
        app.query(
          `INSERT INTO workspace_persona_log (org_id, layer, actor_kind, action, reason, created_at)
           VALUES ($1, 'operator', 'operator', 'lock', 'replayed from audit', '2001-01-01') RETURNING created_at < now() - interval '1 year' AS old`,
          [orgA],
        ),
      );
      expect(operator.rows).toEqual([{ old: true }]);
    });
  });

  describe('deleting a platform operator', () => {
    it('clears the operator references on versions and workspace rows instead of failing, and a workspace still cannot do that itself', async () => {
      const op = await owner.query(
        `INSERT INTO platform_operators (email, full_name, password_hash) VALUES ('persona-op@example.test', 'Persona Op', 'x') RETURNING id`,
      );
      const opId = Number(op.rows[0].id);
      await owner.query(`INSERT INTO personas (key) VALUES ('opdel')`);
      const pid = (await owner.query(`SELECT id FROM personas WHERE key = 'opdel'`)).rows[0].id;
      try {
        await owner.query(
          `INSERT INTO persona_versions (persona_id, version, status, definition, created_by, published_by, published_at)
           VALUES ($1, 1, 'published', '{}', $2, $2, now())`,
          [pid, opId],
        );
        // the operator columns of the workspace row are set for good here (the helpers roll back)
        await owner.query('BEGIN');
        await owner.query(`SELECT set_config('app.privileged', 'on', true)`);
        await owner.query(
          `UPDATE workspace_persona SET operator_updated_by = $2, operator_updated_at = now(), operator_note = 'n' WHERE org_id = $1`,
          [orgB, opId],
        );
        await owner.query('COMMIT');

        await expect(
          tenant(orgB, () =>
            app.query(`UPDATE workspace_persona SET operator_updated_by = NULL WHERE org_id = $1`, [
              orgB,
            ]),
          ),
        ).rejects.toThrow(/operator columns/);

        await owner.query(`DELETE FROM platform_operators WHERE id = $1`, [opId]);

        const v = await owner.query(
          `SELECT created_by, published_by, status FROM persona_versions WHERE persona_id = $1`,
          [pid],
        );
        expect(v.rows).toEqual([{ created_by: null, published_by: null, status: 'published' }]);
        const w = await owner.query(
          `SELECT operator_updated_by, operator_note FROM workspace_persona WHERE org_id = $1`,
          [orgB],
        );
        expect(w.rows).toEqual([{ operator_updated_by: null, operator_note: 'n' }]);
      } finally {
        await owner.query('BEGIN');
        await owner.query(`SELECT set_config('app.privileged', 'on', true)`);
        await owner.query(
          `UPDATE workspace_persona SET operator_note = NULL, operator_updated_at = NULL WHERE org_id = $1`,
          [orgB],
        );
        await owner.query('COMMIT');
        await owner.query(
          `ALTER TABLE persona_versions DISABLE TRIGGER trg_persona_versions_guard`,
        );
        await owner.query(`DELETE FROM persona_versions WHERE persona_id = $1`, [pid]);
        await owner.query(`ALTER TABLE persona_versions ENABLE TRIGGER trg_persona_versions_guard`);
        await owner.query(`DELETE FROM personas WHERE id = $1`, [pid]);
        await owner.query(`DELETE FROM platform_operators WHERE id = $1`, [opId]);
      }
    });
  });

  describe('row-level security is on and forced where it should be', () => {
    it('all five tables', async () => {
      const res = await owner.query(`
        SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
               (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname)::int AS policies
          FROM pg_class c
         WHERE c.relname IN ('personas', 'persona_versions', 'workspace_persona', 'workspace_persona_applied', 'workspace_persona_log')
         ORDER BY 1`);
      expect(res.rows).toHaveLength(5);
      for (const r of res.rows) {
        expect(r.enabled, r.relname).toBe(true);
        expect(r.forced, r.relname).toBe(true);
        expect(r.policies, r.relname).toBeGreaterThan(0);
      }
    });
  });
});
