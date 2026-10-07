import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Tx } from '@crm/db';
import type { FieldType, SegmentGroup } from '@crm/contracts';
import {
  compileRules,
  emptyRuleContext,
  type RuleContext,
} from '../../../src/modules/crm/segments/segment-compiler';
import {
  countWithTimeout,
  segmentContactsWhere,
} from '../../../src/modules/crm/segments/segment-count';

/**
 * The segments table and the rule SQL against a real Postgres, as the restricted application role (a
 * superuser bypasses every policy and would make the isolation assertions vacuous, see rls.spec.ts).
 * Constraint checks use the owner connection: owners skip RLS but never CHECK, UNIQUE or FK.
 */
describe('segments: schema, isolation and rule SQL', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let segA: number;
  let segB: number;
  let tag1: number;
  let group1: number;

  const one = async (q: string, p: unknown[] = []) => Number((await owner.query(q, p)).rows[0].id);
  const rejects = (q: string, params: unknown[], pattern: RegExp) =>
    expect(owner.query(q, params)).rejects.toThrow(pattern);
  const rules = (name = 'x') =>
    JSON.stringify({
      type: 'group',
      combinator: 'and',
      children: [{ type: 'condition', field: 'name', operator: 'contains', value: name }],
    });

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
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });

    orgA = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('sa','A','starter') RETURNING id`,
    );
    orgB = await one(
      `INSERT INTO organizations (slug, name, plan) VALUES ('sb','B','starter') RETURNING id`,
    );
    userA = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@s.test','A','x') RETURNING id`,
      [orgA],
    );
    userB = await one(
      `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@s.test','B','x') RETURNING id`,
      [orgB],
    );
    segA = await one(
      `INSERT INTO segments (org_id, name, owner_id, rules) VALUES ($1,'Hot leads',$2,$3::jsonb) RETURNING id`,
      [orgA, userA, rules()],
    );
    segB = await one(
      `INSERT INTO segments (org_id, name, owner_id, rules) VALUES ($1,'Hot leads',$2,$3::jsonb) RETURNING id`,
      [orgB, userB, rules()],
    );

    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 180_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  async function asOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }

  describe('row-level security', () => {
    it('RLS is enabled and forced with a tenant policy', async () => {
      const res = await owner.query(
        `SELECT relrowsecurity, relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = 'segments' AND p.policyname = 'tenant_isolation')::int AS policies
           FROM pg_class WHERE relname = 'segments' AND relkind = 'r'`,
      );
      expect(res.rows[0]).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: 1,
      });
    });

    it('a workspace sees only its own segments, even when the other id is known exactly', async () => {
      const own = await asOrg(orgA, async () => (await app.query(`SELECT id FROM segments`)).rows);
      expect(own.map((r) => Number(r.id))).toEqual([segA]);
      const other = await asOrg(
        orgA,
        async () =>
          (await app.query(`SELECT 1 FROM segments WHERE org_id = $1 AND id = $2`, [orgB, segB]))
            .rows,
      );
      expect(other).toHaveLength(0);
    });

    it('with no tenant set nothing is visible, and a write into another workspace is refused by WITH CHECK', async () => {
      await app.query('BEGIN');
      try {
        expect((await app.query(`SELECT 1 FROM segments`)).rows).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
      await asOrg(orgA, async () => {
        await app.query('SAVEPOINT s');
        await expect(
          app.query(`INSERT INTO segments (org_id, name, rules) VALUES ($1,'Sneaky',$2::jsonb)`, [
            orgB,
            rules(),
          ]),
        ).rejects.toThrow(/row-level security/);
        await app.query('ROLLBACK TO s');
        // and it cannot update or delete the other workspace's row either
        const upd = await app.query(`UPDATE segments SET name = 'Hijacked' WHERE org_id = $1`, [
          orgB,
        ]);
        expect(upd.rowCount).toBe(0);
        const del = await app.query(`DELETE FROM segments WHERE org_id = $1`, [orgB]);
        expect(del.rowCount).toBe(0);
      });
    });
  });

  describe('constraints', () => {
    it('a name is unique per workspace ignoring case, and free in another workspace', async () => {
      await rejects(
        `INSERT INTO segments (org_id, name, rules) VALUES ($1,'  ',$2::jsonb)`,
        [orgA, rules()],
        /chk_segments_name/,
      );
      await rejects(
        `INSERT INTO segments (org_id, name, rules) VALUES ($1,'HOT LEADS',$2::jsonb)`,
        [orgA, rules()],
        /uq_segments_org_lower_name/,
      );
      await owner.query(
        `INSERT INTO segments (org_id, name, rules) VALUES ($1,'Other org name',$2::jsonb)`,
        [orgB, rules()],
      );
      await owner.query(`DELETE FROM segments WHERE org_id = $1 AND name = 'Other org name'`, [
        orgB,
      ]);
    });

    it('visibility, colour, rules and counts are checked', async () => {
      const bad = (extra: string, val: unknown, pattern: RegExp) =>
        rejects(
          `INSERT INTO segments (org_id, name, rules, ${extra}) VALUES ($1,'v' || random()::text,$2::jsonb,$3)`,
          [orgA, rules(), val],
          pattern,
        );
      await bad('visibility', 'public', /chk_segments_visibility/);
      // The third kind is legal, and a segment made before it existed is untouched.
      const ok = await one(
        `INSERT INTO segments (org_id, name, rules, visibility) VALUES ($1,'specific-ok',$2::jsonb,'specific') RETURNING id`,
        [orgA, rules()],
      );
      await owner.query(`DELETE FROM segments WHERE org_id = $1 AND id = $2`, [orgA, ok]);
      await bad('color', 'green', /chk_segments_color/);
      await bad('member_count_cache', -1, /chk_segments_count/);
      await bad('rules_version', 0, /chk_segments_rules_version/);
      await rejects(
        `INSERT INTO segments (org_id, name, rules) VALUES ($1,'r1','[]'::jsonb)`,
        [orgA],
        /chk_segments_rules/,
      );
      await rejects(
        `INSERT INTO segments (org_id, name, rules) VALUES ($1,'r2','{"type":"condition"}'::jsonb)`,
        [orgA],
        /chk_segments_rules/,
      );
    });

    it('the owner is composite: a user of another workspace cannot own a segment', async () => {
      await rejects(
        `INSERT INTO segments (org_id, name, owner_id, rules) VALUES ($1,'foreign owner',$2,$3::jsonb)`,
        [orgA, userB, rules()],
        /foreign key|violates/,
      );
    });

    it('deleting the owner leaves the segment, with no owner, in the same workspace', async () => {
      const u = await one(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'gone@s.test','Gone','x') RETURNING id`,
        [orgA],
      );
      const s = await one(
        `INSERT INTO segments (org_id, name, owner_id, rules) VALUES ($1,'orphan',$2,$3::jsonb) RETURNING id`,
        [orgA, u, rules()],
      );
      await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
      const row = (
        await owner.query(`SELECT org_id, owner_id FROM segments WHERE id = $1 AND org_id = $2`, [
          s,
          orgA,
        ])
      ).rows[0];
      expect(Number(row.org_id)).toBe(orgA);
      expect(row.owner_id).toBeNull();
      await owner.query(`DELETE FROM segments WHERE org_id = $1 AND id = $2`, [orgA, s]);
    });
  });

  describe('segment_shares', () => {
    let teamA: number;
    let teamB: number;
    let shared: number;
    beforeAll(async () => {
      teamA = await one(`INSERT INTO teams (org_id, name) VALUES ($1,'TA') RETURNING id`, [orgA]);
      teamB = await one(`INSERT INTO teams (org_id, name) VALUES ($1,'TB') RETURNING id`, [orgB]);
      shared = await one(
        `INSERT INTO segments (org_id, name, owner_id, rules, visibility) VALUES ($1,'Shares',$2,$3::jsonb,'specific') RETURNING id`,
        [orgA, userA, rules()],
      );
    });

    it('RLS is enabled and forced with a tenant policy', async () => {
      const res = await owner.query(
        `SELECT relrowsecurity, relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = 'segment_shares' AND p.policyname = 'tenant_isolation')::int AS policies
           FROM pg_class WHERE relname = 'segment_shares' AND relkind = 'r'`,
      );
      expect(res.rows[0]).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: 1,
      });
    });

    it('a workspace cannot read or write the shares of another', async () => {
      await owner.query(
        `INSERT INTO segment_shares (org_id, segment_id, user_id) VALUES ($1,$2,$3)`,
        [orgA, shared, userA],
      );
      expect(
        (await asOrg(orgB, async () => (await app.query(`SELECT 1 FROM segment_shares`)).rows))
          .length,
      ).toBe(0);
      expect(
        (await asOrg(orgA, async () => (await app.query(`SELECT 1 FROM segment_shares`)).rows))
          .length,
      ).toBe(1);
      await expect(
        asOrg(orgB, () =>
          app.query(`INSERT INTO segment_shares (org_id, segment_id, user_id) VALUES ($1,$2,$3)`, [
            orgA,
            shared,
            userA,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('one row per person and per team, each exactly one of the two', async () => {
      await rejects(
        `INSERT INTO segment_shares (org_id, segment_id, user_id) VALUES ($1,$2,$3)`,
        [orgA, shared, userA],
        /uq_segment_shares_user/,
      );
      await owner.query(
        `INSERT INTO segment_shares (org_id, segment_id, team_id) VALUES ($1,$2,$3)`,
        [orgA, shared, teamA],
      );
      await rejects(
        `INSERT INTO segment_shares (org_id, segment_id, team_id) VALUES ($1,$2,$3)`,
        [orgA, shared, teamA],
        /uq_segment_shares_team/,
      );
      await rejects(
        `INSERT INTO segment_shares (org_id, segment_id, user_id, team_id) VALUES ($1,$2,$3,$4)`,
        [orgA, shared, userA, teamA],
        /chk_segment_shares_target/,
      );
      await rejects(
        `INSERT INTO segment_shares (org_id, segment_id) VALUES ($1,$2)`,
        [orgA, shared],
        /chk_segment_shares_target/,
      );
    });

    it('the person, the team and the segment are composite: nothing points into another workspace', async () => {
      await rejects(
        `INSERT INTO segment_shares (org_id, segment_id, user_id) VALUES ($1,$2,$3)`,
        [orgA, shared, userB],
        /foreign key|violates/,
      );
      await rejects(
        `INSERT INTO segment_shares (org_id, segment_id, team_id) VALUES ($1,$2,$3)`,
        [orgA, shared, teamB],
        /foreign key|violates/,
      );
      await rejects(
        `INSERT INTO segment_shares (org_id, segment_id, user_id) VALUES ($1,$2,$3)`,
        [orgA, segB, userA],
        /foreign key|violates/,
      );
    });

    it('deleting a person, a team or the segment removes the shares', async () => {
      const u = await one(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'share@s.test','S','x') RETURNING id`,
        [orgA],
      );
      const t = await one(`INSERT INTO teams (org_id, name) VALUES ($1,'TX') RETURNING id`, [orgA]);
      await owner.query(
        `INSERT INTO segment_shares (org_id, segment_id, user_id) VALUES ($1,$2,$3)`,
        [orgA, shared, u],
      );
      await owner.query(
        `INSERT INTO segment_shares (org_id, segment_id, team_id) VALUES ($1,$2,$3)`,
        [orgA, shared, t],
      );
      const count = async () =>
        Number(
          (
            await owner.query(
              `SELECT count(*)::int AS n FROM segment_shares WHERE segment_id = $1`,
              [shared],
            )
          ).rows[0].n,
        );
      expect(await count()).toBe(4);
      await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
      await owner.query(`DELETE FROM teams WHERE org_id = $1 AND id = $2`, [orgA, t]);
      expect(await count()).toBe(2);
      await owner.query(`DELETE FROM segments WHERE org_id = $1 AND id = $2`, [orgA, shared]);
      expect(await count()).toBe(0);
    });

    it('a change of the people list alone moves row_version (through shares_rev)', async () => {
      const s = await one(
        `INSERT INTO segments (org_id, name, rules) VALUES ($1,'rev',$2::jsonb) RETURNING id`,
        [orgA, rules()],
      );
      await owner.query(
        `UPDATE segments SET shares_rev = shares_rev + 1 WHERE org_id = $1 AND id = $2`,
        [orgA, s],
      );
      const row = (
        await owner.query(`SELECT row_version FROM segments WHERE org_id = $1 AND id = $2`, [
          orgA,
          s,
        ])
      ).rows[0];
      expect(row.row_version).toBe(2);
      await owner.query(`DELETE FROM segments WHERE org_id = $1 AND id = $2`, [orgA, s]);
    });
  });

  describe('optimistic locking trigger', () => {
    it('a real edit bumps row_version and updated_at; a cached count or a usage stamp does not', async () => {
      const s = await one(
        `INSERT INTO segments (org_id, name, rules) VALUES ($1,'locked',$2::jsonb) RETURNING id`,
        [orgA, rules()],
      );
      const read = async () =>
        (
          await owner.query(
            `SELECT row_version, updated_at, member_count_cache FROM segments WHERE org_id = $1 AND id = $2`,
            [orgA, s],
          )
        ).rows[0];
      const first = await read();
      expect(first.row_version).toBe(1);

      await owner.query(`SELECT pg_sleep(0.05)`);
      await owner.query(
        `UPDATE segments SET member_count_cache = 42, member_count_at = now(), last_used_at = now() WHERE org_id = $1 AND id = $2`,
        [orgA, s],
      );
      const cached = await read();
      expect(cached.member_count_cache).toBe(42);
      expect(cached.row_version).toBe(1);
      expect(cached.updated_at.getTime()).toBe(first.updated_at.getTime());

      await owner.query(`UPDATE segments SET name = 'locked 2' WHERE org_id = $1 AND id = $2`, [
        orgA,
        s,
      ]);
      const renamed = await read();
      expect(renamed.row_version).toBe(2);
      expect(renamed.updated_at.getTime()).toBeGreaterThan(first.updated_at.getTime());

      // an edit together with a count write is still an edit
      await owner.query(
        `UPDATE segments SET color = '#112233', member_count_cache = 1 WHERE org_id = $1 AND id = $2`,
        [orgA, s],
      );
      expect((await read()).row_version).toBe(3);

      // the lock: the old version matches nothing
      const stale = await owner.query(
        `UPDATE segments SET name = 'x2' WHERE org_id = $1 AND id = $2 AND row_version = 1`,
        [orgA, s],
      );
      expect(stale.rowCount).toBe(0);
      await owner.query(`DELETE FROM segments WHERE org_id = $1 AND id = $2`, [orgA, s]);
    });
  });

  describe('permission keys', () => {
    it('the four keys exist; read and create take no scope, update and delete do', async () => {
      const res = await owner.query(
        `SELECT key, supports_scope FROM permission_defs WHERE key LIKE 'record.segments.%' ORDER BY key`,
      );
      expect(res.rows).toEqual([
        { key: 'record.segments.create', supports_scope: false },
        { key: 'record.segments.delete', supports_scope: true },
        { key: 'record.segments.read', supports_scope: false },
        { key: 'record.segments.update', supports_scope: true },
      ]);
    });
  });

  describe('the safe casts used by custom property rules', () => {
    const q = async (text: string, params: unknown[] = []) =>
      (await owner.query(text, params)).rows[0].v;

    it('segment_safe_numeric answers NULL for what is not a number instead of failing the query', async () => {
      expect(await q(`SELECT segment_safe_numeric('12.5') AS v`)).toBe('12.5');
      expect(await q(`SELECT segment_safe_numeric(' -3 ') AS v`)).toBe('-3');
      for (const bad of ['n/a', '', '1e5', '12,5', '0x10', "1'; DROP TABLE contacts; --"]) {
        expect(await q(`SELECT segment_safe_numeric($1) AS v`, [bad]), bad).toBeNull();
      }
      expect(await q(`SELECT segment_safe_numeric(NULL) AS v`)).toBeNull();
    });

    it('segment_safe_timestamptz reads a bare day as UTC whatever the session time zone, and answers NULL for garbage', async () => {
      await owner.query(`SET TIME ZONE 'Asia/Kolkata'`);
      try {
        expect((await q(`SELECT segment_safe_timestamptz('2026-10-03') AS v`)).toISOString()).toBe(
          '2026-10-03T00:00:00.000Z',
        );
        expect(
          (
            await q(`SELECT segment_safe_timestamptz('2026-10-03T09:30:00+05:30') AS v`)
          ).toISOString(),
        ).toBe('2026-10-03T04:00:00.000Z');
      } finally {
        await owner.query(`RESET TIME ZONE`);
      }
      for (const bad of ['2026-02-31', 'tomorrow', '', '2026-13-01', '99999-01-01']) {
        expect(await q(`SELECT segment_safe_timestamptz($1) AS v`, [bad]), bad).toBeNull();
      }
    });
  });

  describe('rules compiled to SQL, run as the application role', () => {
    const dialect = new PgDialect();

    const cond = (field: string, operator: string, value?: unknown) => ({
      type: 'condition' as const,
      field,
      operator,
      ...(value === undefined ? {} : { value }),
    });
    const group = (combinator: 'and' | 'or', ...children: unknown[]) =>
      ({ type: 'group', combinator, children }) as unknown as SegmentGroup;

    // Rules carry uuids; the rule context maps them to the internal ids the SQL uses.
    const TAG = '3b241101-e2bb-4255-8caf-4136c566a962';
    const GRP = '5a1d8b9e-0a53-4a39-8d6b-5f3e1c0b7a11';
    const USR = '9c4e2a77-61d5-4d0e-9b3f-2a8c7d1e6f05';
    const GONE = 'f0e1d2c3-b4a5-4968-8776-655443322110';
    let rc: RuleContext;

    beforeAll(async () => {
      tag1 = await one(`INSERT INTO tags (org_id, name) VALUES ($1,'vip') RETURNING id`, [orgA]);
      group1 = await one(
        `INSERT INTO contact_groups (org_id, name) VALUES ($1,'Warm') RETURNING id`,
        [orgA],
      );
      const mk = async (
        name: string,
        o: {
          email?: string;
          source?: string | null;
          score?: number | null;
          data?: Record<string, unknown>;
          created: string;
          activity?: string | null;
          unsub?: boolean;
          archived?: boolean;
          ownerId?: number | null;
          imported?: boolean;
        },
      ) =>
        one(
          `INSERT INTO contacts (org_id, name, email, source, lead_score, data, created_at, last_activity_at, is_unsubscribed, is_archived, owner_id)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb, now() - $7::interval, CASE WHEN $8::text IS NULL THEN NULL ELSE now() - $8::interval END, $9,$10,$11) RETURNING id`,
          [
            orgA,
            name,
            o.email ?? null,
            o.source ?? null,
            o.score ?? null,
            JSON.stringify(o.data ?? {}),
            o.created,
            o.activity ?? null,
            o.unsub ?? false,
            o.archived ?? false,
            o.ownerId ?? null,
          ],
        );
      const c1 = await mk('Aarav Sharma', {
        email: 'aarav@x.com',
        source: 'import',
        score: 80,
        data: {
          budget: 1500,
          since: '2026-01-15',
          colors: ['red', 'blue'],
          vip: true,
          tier: 'gold',
          plan: 'Gold',
        },
        created: '10 days',
        activity: '2 days',
        ownerId: userA,
      });
      const c2 = await mk('Bina Rao', {
        email: 'bina@y.org',
        score: 20,
        // dirty data: a number field holding text, an impossible date, a multiselect holding a string
        data: {
          budget: 'n/a',
          since: '2026-02-31',
          colors: 'red',
          vip: false,
          tier: 'silver',
          plan: 'gold',
        },
        created: '100 days',
      });
      const c3 = await mk('Chitra Iyer', {
        source: 'web',
        unsub: true,
        data: { budget: 99.5, since: '2025-06-01T10:00:00Z', colors: [], plan: '' },
        created: '400 days',
        activity: '200 days',
      });
      await mk('Aarav Archived', { source: 'import', created: '1 day', archived: true });
      await owner.query(`INSERT INTO contact_tags (org_id, contact_id, tag_id) VALUES ($1,$2,$3)`, [
        orgA,
        c1,
        tag1,
      ]);
      await owner.query(
        `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3), ($1,$4,$3)`,
        [orgA, c1, group1, c2],
      );
      void c3;

      rc = {
        ...emptyRuleContext(),
        tags: new Map([[TAG, tag1]]),
        groups: new Map([[GRP, group1]]),
        users: new Map([[USR, userA]]),
        stages: new Set(['new']),
        statuses: new Set(),
        fields: new Map<string, { type: FieldType }>([
          ['budget', { type: 'decimal' }],
          ['since', { type: 'date' }],
          ['colors', { type: 'multiselect' }],
          ['vip', { type: 'checkbox' }],
          ['tier', { type: 'select' }],
          ['plan', { type: 'text' }],
        ]),
      };
    }, 60_000);

    /** Names of the contacts a rule matches, run as the restricted role inside org A. */
    async function matches(rules: SegmentGroup): Promise<string[]> {
      const compiled = compileRules(orgA, rules, rc);
      const q = dialect.sqlToQuery(
        sql`SELECT name FROM contacts WHERE ${segmentContactsWhere(orgA, compiled.where)} ORDER BY name`,
      );
      return asOrg(orgA, async () =>
        (await app.query(q.sql, q.params as unknown[])).rows.map((r) => r.name as string),
      );
    }

    it('built-in text, numeric, boolean and owner conditions', async () => {
      expect(await matches(group('and', cond('name', 'contains', 'sharma')))).toEqual([
        'Aarav Sharma',
      ]);
      expect(await matches(group('and', cond('name', 'starts_with', 'b')))).toEqual(['Bina Rao']);
      expect(await matches(group('and', cond('email', 'is_empty')))).toEqual(['Chitra Iyer']);
      expect(await matches(group('and', cond('source', 'not_equals', 'import')))).toEqual([
        'Bina Rao',
        'Chitra Iyer',
      ]);
      expect(await matches(group('and', cond('source', 'in', ['IMPORT', 'web'])))).toEqual([
        'Aarav Sharma',
        'Chitra Iyer',
      ]);
      expect(
        await matches(group('and', cond('leadScore', 'gte', 20), cond('leadScore', 'lt', 80))),
      ).toEqual(['Bina Rao']);
      expect(
        await matches(group('and', cond('leadScore', 'between', { from: 0, to: 100 }))),
      ).toEqual(['Aarav Sharma', 'Bina Rao']);
      expect(await matches(group('and', cond('unsubscribed', 'is_true')))).toEqual(['Chitra Iyer']);
      expect(await matches(group('and', cond('owner', 'equals', USR)))).toEqual(['Aarav Sharma']);
      expect(await matches(group('and', cond('owner', 'is_empty')))).toEqual([
        'Bina Rao',
        'Chitra Iyer',
      ]);
    });

    it('a segment never contains archived contacts', async () => {
      expect(await matches(group('and', cond('name', 'contains', 'aarav')))).toEqual([
        'Aarav Sharma',
      ]);
    });

    it('tags and groups: any / all / none / empty', async () => {
      expect(await matches(group('and', cond('tags', 'has_any', [TAG])))).toEqual(['Aarav Sharma']);
      expect(await matches(group('and', cond('tags', 'has_none', [TAG])))).toEqual([
        'Bina Rao',
        'Chitra Iyer',
      ]);
      expect(await matches(group('and', cond('groups', 'has_all', [GRP])))).toEqual([
        'Aarav Sharma',
        'Bina Rao',
      ]);
      expect(await matches(group('and', cond('groups', 'is_empty')))).toEqual(['Chitra Iyer']);
      expect(await matches(group('and', cond('tags', 'is_not_empty')))).toEqual(['Aarav Sharma']);
    });

    it('relative and absolute dates', async () => {
      expect(await matches(group('and', cond('createdAt', 'in_last_days', 30)))).toEqual([
        'Aarav Sharma',
      ]);
      expect(await matches(group('and', cond('createdAt', 'more_than_days_ago', 365)))).toEqual([
        'Chitra Iyer',
      ]);
      expect(
        await matches(
          group(
            'and',
            cond('createdAt', 'in_last_days', 120),
            cond('createdAt', 'more_than_days_ago', 50),
          ),
        ),
      ).toEqual(['Bina Rao']);
      expect(await matches(group('and', cond('lastActivityAt', 'is_empty')))).toEqual(['Bina Rao']);
      expect(await matches(group('and', cond('lastActivityAt', 'in_last_days', 7)))).toEqual([
        'Aarav Sharma',
      ]);
      expect(
        await matches(group('and', cond('lastActivityAt', 'more_than_days_ago', 100))),
      ).toEqual(['Chitra Iyer']);
      expect(await matches(group('and', cond('createdAt', 'after', '2000-01-01')))).toEqual([
        'Aarav Sharma',
        'Bina Rao',
        'Chitra Iyer',
      ]);
      expect(await matches(group('and', cond('createdAt', 'before', '2000-01-01')))).toEqual([]);
    });

    it('custom properties by type, with dirty stored values simply not matching', async () => {
      // number: 'n/a' is not a number, so Bina matches neither side of the comparison
      expect(await matches(group('and', cond('custom.budget', 'gte', 100)))).toEqual([
        'Aarav Sharma',
      ]);
      expect(await matches(group('and', cond('custom.budget', 'lt', 100)))).toEqual([
        'Chitra Iyer',
      ]);
      expect(
        await matches(group('and', cond('custom.budget', 'between', { from: 50, to: 2000 }))),
      ).toEqual(['Aarav Sharma', 'Chitra Iyer']);
      // date: 2026-02-31 does not exist, so Bina matches no date comparison; a bare day and an instant both work
      expect(await matches(group('and', cond('custom.since', 'before', '2026-06-01')))).toEqual([
        'Aarav Sharma',
        'Chitra Iyer',
      ]);
      expect(await matches(group('and', cond('custom.since', 'equals', '2026-01-15')))).toEqual([
        'Aarav Sharma',
      ]);
      expect(
        await matches(
          group(
            'and',
            cond('custom.since', 'on_or_after', '2025-06-01T10:00:00Z'),
            cond('custom.since', 'before', '2026-01-01'),
          ),
        ),
      ).toEqual(['Chitra Iyer']);
      // multiselect: Bina's stored value is a plain string, which is not an array
      expect(await matches(group('and', cond('custom.colors', 'has_any', ['red'])))).toEqual([
        'Aarav Sharma',
      ]);
      expect(
        await matches(group('and', cond('custom.colors', 'has_all', ['red', 'blue']))),
      ).toEqual(['Aarav Sharma']);
      expect(await matches(group('and', cond('custom.colors', 'is_empty')))).toEqual([
        'Chitra Iyer',
      ]);
      // boolean, select, text
      expect(await matches(group('and', cond('custom.vip', 'is_true')))).toEqual(['Aarav Sharma']);
      expect(await matches(group('and', cond('custom.vip', 'is_false')))).toEqual([
        'Bina Rao',
        'Chitra Iyer',
      ]);
      expect(await matches(group('and', cond('custom.tier', 'in', ['gold', 'silver'])))).toEqual([
        'Aarav Sharma',
        'Bina Rao',
      ]);
      expect(await matches(group('and', cond('custom.plan', 'equals', 'gold')))).toEqual([
        'Aarav Sharma',
        'Bina Rao',
      ]);
      expect(await matches(group('and', cond('custom.plan', 'is_empty')))).toEqual(['Chitra Iyer']);
    });

    it('AND / OR / nesting', async () => {
      expect(
        await matches(
          group(
            'or',
            cond('source', 'equals', 'web'),
            group('and', cond('leadScore', 'gt', 50), cond('tags', 'has_any', [TAG])),
          ),
        ),
      ).toEqual(['Aarav Sharma', 'Chitra Iyer']);
    });

    it('hostile operands are just data: they match nothing and change nothing', async () => {
      for (const attack of ["'; DROP TABLE contacts; --", "' OR '1'='1", '%', '_', '\\']) {
        expect(await matches(group('and', cond('name', 'equals', attack)))).toEqual([]);
        expect(await matches(group('and', cond('custom.plan', 'equals', attack)))).toEqual([]);
      }
      expect(await matches(group('and', cond('name', 'contains', '%')))).toEqual([]);
      const still = await owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [
        orgA,
      ]);
      expect(still.rows[0].n).toBe(4);
    });

    it('a condition on something deleted matches nothing, and the others still count', async () => {
      const compiled = compileRules(
        orgA,
        group('or', cond('tags', 'has_any', [GONE]), cond('source', 'equals', 'web')),
        rc,
      );
      expect(compiled.invalid).toHaveLength(1);
      expect(
        await matches(
          group('or', cond('tags', 'has_any', [GONE]), cond('source', 'equals', 'web')),
        ),
      ).toEqual(['Chitra Iyer']);
      expect(await matches(group('and', cond('tags', 'has_none', [GONE])))).toEqual([]);
    });

    describe('counting under a time limit', () => {
      const withTx = async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
        const orm = drizzle(app);
        return orm.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.org_id', ${String(orgA)}, true)`);
          return fn(tx as unknown as Tx);
        });
      };

      it('a count that finishes is exact and leaves the statement timeout as it was', async () => {
        const { counted, after } = await withTx(async (tx) => {
          const compiled = compileRules(orgA, group('and', cond('name', 'contains', 'a')), rc);
          const counted = await countWithTimeout(tx, segmentContactsWhere(orgA, compiled.where));
          const after = (await tx.execute(sql`SELECT current_setting('statement_timeout') AS v`))
            .rows[0] as { v: string };
          return { counted, after: after.v };
        });
        expect(counted).toEqual({ count: 3, approximate: false });
        expect(after).toBe('0');
      });

      it('a count that is too slow is cancelled, answers approximately, and leaves the transaction usable', async () => {
        const result = await withTx(async (tx) => {
          const slow = sql`${segmentContactsWhere(orgA, sql`true`)} AND pg_sleep(0.3) IS NOT NULL`;
          const noFallback = await countWithTimeout(tx, slow, { timeoutMs: 50 });
          const withFallback = await countWithTimeout(tx, slow, { timeoutMs: 50, fallback: 1234 });
          const next = (await tx.execute(sql`SELECT 1 AS ok`)).rows[0] as { ok: number };
          const setting = (await tx.execute(sql`SELECT current_setting('statement_timeout') AS v`))
            .rows[0] as { v: string };
          return { noFallback, withFallback, next, setting: setting.v };
        });
        expect(result.noFallback.approximate).toBe(true);
        expect(result.noFallback.count).toBeGreaterThanOrEqual(0);
        expect(result.withFallback).toEqual({ count: 1234, approximate: true });
        expect(result.next.ok).toBe(1);
        expect(result.setting).toBe('0');
      });
    });
  });
});
