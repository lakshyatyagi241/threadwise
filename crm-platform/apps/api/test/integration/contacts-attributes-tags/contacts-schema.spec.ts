import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The contacts-attributes-tags tables against a real Postgres, as the restricted application role
 * (a superuser bypasses every policy and would make the isolation assertions vacuous, see
 * rls.spec.ts). Constraint checks use the owner connection: owners skip RLS but never CHECK,
 * UNIQUE or FK.
 */
describe('contact groups, memberships and import jobs: schema and isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let groupA: number;
  let groupB: number;
  let contactA: number;
  let contactB: number;

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

    const a = await owner.query(
      `INSERT INTO organizations (slug, name, plan) VALUES ('a','A','starter') RETURNING id`,
    );
    const b = await owner.query(
      `INSERT INTO organizations (slug, name, plan) VALUES ('b','B','starter') RETURNING id`,
    );
    orgA = Number(a.rows[0].id);
    orgB = Number(b.rows[0].id);
    groupA = Number(
      (
        await owner.query(
          `INSERT INTO contact_groups (org_id, name) VALUES ($1,'VIP') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    groupB = Number(
      (
        await owner.query(
          `INSERT INTO contact_groups (org_id, name) VALUES ($1,'VIP') RETURNING id`,
          [orgB],
        )
      ).rows[0].id,
    );
    contactA = Number(
      (
        await owner.query(
          `INSERT INTO contacts (org_id, name, phone) VALUES ($1,'CA','+911111111111') RETURNING id`,
          [orgA],
        )
      ).rows[0].id,
    );
    contactB = Number(
      (
        await owner.query(
          `INSERT INTO contacts (org_id, name, phone) VALUES ($1,'CB','+922222222222') RETURNING id`,
          [orgB],
        )
      ).rows[0].id,
    );
    await owner.query(
      `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3)`,
      [orgA, contactA, groupA],
    );
    await owner.query(
      `INSERT INTO contact_import_jobs (org_id, file_name) VALUES ($1,'a.csv'), ($2,'b.csv')`,
      [orgA, orgB],
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
    it('has RLS enabled and forced, with a tenant policy, on every new table', async () => {
      const res = await owner.query(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation')::int AS policies
           FROM pg_class c
          WHERE c.relname IN ('contact_groups','contact_group_members','contact_import_jobs') AND c.relkind = 'r'
          ORDER BY c.relname`,
      );
      expect(res.rows).toEqual([
        {
          relname: 'contact_group_members',
          relrowsecurity: true,
          relforcerowsecurity: true,
          policies: 1,
        },
        { relname: 'contact_groups', relrowsecurity: true, relforcerowsecurity: true, policies: 1 },
        {
          relname: 'contact_import_jobs',
          relrowsecurity: true,
          relforcerowsecurity: true,
          policies: 1,
        },
      ]);
    });

    it('shows a workspace only its own groups, memberships and import jobs', async () => {
      await asOrg(orgA, async () => {
        expect(
          (await app.query(`SELECT id FROM contact_groups`)).rows.map((r) => Number(r.id)),
        ).toEqual([groupA]);
        expect((await app.query(`SELECT contact_id FROM contact_group_members`)).rows).toHaveLength(
          1,
        );
        expect((await app.query(`SELECT file_name FROM contact_import_jobs`)).rows).toEqual([
          { file_name: 'a.csv' },
        ]);
      });
      await asOrg(orgB, async () => {
        expect(
          (await app.query(`SELECT id FROM contact_groups`)).rows.map((r) => Number(r.id)),
        ).toEqual([groupB]);
        expect((await app.query(`SELECT contact_id FROM contact_group_members`)).rows).toHaveLength(
          0,
        );
        expect((await app.query(`SELECT file_name FROM contact_import_jobs`)).rows).toEqual([
          { file_name: 'b.csv' },
        ]);
      });
    });

    it("hides another workspace's group even when its id is known exactly", async () => {
      const rows = await asOrg(
        orgA,
        async () =>
          (
            await app.query(`SELECT * FROM contact_groups WHERE org_id = $1 AND id = $2`, [
              orgB,
              groupB,
            ])
          ).rows,
      );
      expect(rows).toHaveLength(0);
    });

    it('refuses to write a group, a membership or a job into another workspace (WITH CHECK, not only USING)', async () => {
      await expect(
        asOrg(orgA, () =>
          app.query(`INSERT INTO contact_groups (org_id, name) VALUES ($1, 'Smuggled')`, [orgB]),
        ),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        asOrg(orgA, () =>
          app.query(
            `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3)`,
            [orgB, contactB, groupB],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        asOrg(orgA, () =>
          app.query(`INSERT INTO contact_import_jobs (org_id, file_name) VALUES ($1, 'x.csv')`, [
            orgB,
          ]),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('cannot move a group to another workspace with an UPDATE', async () => {
      await expect(
        asOrg(orgA, () =>
          app.query(`UPDATE contact_groups SET org_id = $1 WHERE org_id = $2`, [orgB, orgA]),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('fails closed with no tenant set: nothing is visible', async () => {
      await app.query('BEGIN');
      try {
        expect((await app.query(`SELECT * FROM contact_groups`)).rows).toHaveLength(0);
        expect((await app.query(`SELECT * FROM contact_import_jobs`)).rows).toHaveLength(0);
      } finally {
        await app.query('ROLLBACK');
      }
    });
  });

  describe('composite foreign keys', () => {
    it("a membership cannot point at a group of another workspace, nor at another workspace's contact", async () => {
      await expect(
        owner.query(
          `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3)`,
          [orgA, contactA, groupB],
        ),
      ).rejects.toThrow(/fk_contact_group_members_group_id/);
      await expect(
        owner.query(
          `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3)`,
          [orgA, contactB, groupA],
        ),
      ).rejects.toThrow(/fk_contact_group_members_contact_id/);
    });

    it('a contact cannot reference an import job of another workspace', async () => {
      const jobB = (
        await owner.query(`SELECT id FROM contact_import_jobs WHERE org_id = $1`, [orgB])
      ).rows[0].id;
      await expect(
        owner.query(`UPDATE contacts SET import_job_id = $1 WHERE org_id = $2 AND id = $3`, [
          jobB,
          orgA,
          contactA,
        ]),
      ).rejects.toThrow(/fk_contacts_import_job/);
    });

    it('deleting a group removes its memberships and keeps the contacts; deleting a contact removes its memberships and keeps the group', async () => {
      const g = Number(
        (
          await owner.query(
            `INSERT INTO contact_groups (org_id, name) VALUES ($1,'Temp') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const c = Number(
        (
          await owner.query(
            `INSERT INTO contacts (org_id, name) VALUES ($1,'Temp contact') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      await owner.query(
        `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3), ($1,$4,$3)`,
        [orgA, c, g, contactA],
      );
      await owner.query(`DELETE FROM contact_groups WHERE org_id = $1 AND id = $2`, [orgA, g]);
      expect(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM contact_group_members WHERE group_id = $1`,
            [g],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await owner.query(`SELECT count(*)::int AS n FROM contacts WHERE id = ANY($1)`, [
            [c, contactA],
          ])
        ).rows[0].n,
      ).toBe(2);

      const g2 = Number(
        (
          await owner.query(
            `INSERT INTO contact_groups (org_id, name) VALUES ($1,'Temp 2') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      await owner.query(
        `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3)`,
        [orgA, c, g2],
      );
      await owner.query(`DELETE FROM contacts WHERE org_id = $1 AND id = $2`, [orgA, c]);
      expect(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM contact_group_members WHERE group_id = $1`,
            [g2],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (await owner.query(`SELECT count(*)::int AS n FROM contact_groups WHERE id = $1`, [g2]))
          .rows[0].n,
      ).toBe(1);
    });

    it('deleting an import job keeps its contacts and clears their import marker', async () => {
      const job = Number(
        (
          await owner.query(
            `INSERT INTO contact_import_jobs (org_id, file_name) VALUES ($1,'del.csv') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const c = Number(
        (
          await owner.query(
            `INSERT INTO contacts (org_id, name, import_job_id) VALUES ($1,'Imp',$2) RETURNING id`,
            [orgA, job],
          )
        ).rows[0].id,
      );
      await owner.query(`DELETE FROM contact_import_jobs WHERE org_id = $1 AND id = $2`, [
        orgA,
        job,
      ]);
      expect(
        (await owner.query(`SELECT import_job_id FROM contacts WHERE id = $1`, [c])).rows[0]
          .import_job_id,
      ).toBeNull();
    });
  });

  describe('integrity', () => {
    it('a group name is unique per workspace ignoring case, and the same name is fine in another workspace', async () => {
      await expect(
        owner.query(`INSERT INTO contact_groups (org_id, name) VALUES ($1, 'vip')`, [orgA]),
      ).rejects.toThrow(/uq_contact_groups_org_lower_name/);
      await expect(
        owner.query(`INSERT INTO contact_groups (org_id, name) VALUES ($1, 'ViP')`, [orgA]),
      ).rejects.toThrow(/uq_contact_groups_org_lower_name/);
      expect(groupB).not.toBe(groupA); // both orgs have a "VIP" (the beforeAll proves it)
    });

    it('a group needs a real name (not blank, at most 191), a hex colour, a note of at most 500', async () => {
      const ins = (name: string, color: string | null = null, note: string | null = null) =>
        owner.query(`INSERT INTO contact_groups (org_id, name, color, note) VALUES ($1,$2,$3,$4)`, [
          orgA,
          name,
          color,
          note,
        ]);
      await expect(ins('')).rejects.toThrow(/chk_contact_groups_name/);
      await expect(ins('   ')).rejects.toThrow(/chk_contact_groups_name/);
      await expect(ins('x'.repeat(192))).rejects.toThrow(/chk_contact_groups_name/);
      await expect(ins('Bad colour', 'green')).rejects.toThrow(/chk_contact_groups_color/);
      await expect(ins('Bad colour 2', '#12345')).rejects.toThrow(/chk_contact_groups_color/);
      await expect(ins('Long note', null, 'n'.repeat(501))).rejects.toThrow(
        /chk_contact_groups_note/,
      );
      await ins('Good', '#22C55E', 'ok');
      await ins('x'.repeat(191));
    });

    it('a contact is in a group once (no duplicate membership rows)', async () => {
      await expect(
        owner.query(
          `INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES ($1,$2,$3)`,
          [orgA, contactA, groupA],
        ),
      ).rejects.toThrow(/uq_contact_group_members_contact_id_group_id/);
    });

    it('an import job has one of four statuses; a contact source is at most 128 characters', async () => {
      await expect(
        owner.query(
          `INSERT INTO contact_import_jobs (org_id, file_name, status) VALUES ($1,'x','paused')`,
          [orgA],
        ),
      ).rejects.toThrow(/chk_contact_import_jobs_status/);
      await expect(
        owner.query(`UPDATE contacts SET source = $1 WHERE id = $2`, ['s'.repeat(129), contactA]),
      ).rejects.toThrow(/chk_contacts_source/);
      await owner.query(`UPDATE contacts SET source = $1 WHERE id = $2`, [
        's'.repeat(128),
        contactA,
      ]);
    });

    it('row_version moves on update (optimistic locking) for the new tables', async () => {
      const before = (
        await owner.query(`SELECT row_version FROM contact_groups WHERE id = $1`, [groupA])
      ).rows[0].row_version;
      await owner.query(`UPDATE contact_groups SET note = 'changed' WHERE id = $1`, [groupA]);
      const after = (
        await owner.query(`SELECT row_version FROM contact_groups WHERE id = $1`, [groupA])
      ).rows[0].row_version;
      expect(after).toBe(before + 1);
    });

    it('registers the new capability keys, and the search indexes exist', async () => {
      const keys = (
        await owner.query(
          `SELECT key FROM permission_defs WHERE key LIKE 'record.contact-groups.%' OR key = 'record.contacts.import' ORDER BY key`,
        )
      ).rows.map((r) => r.key);
      expect(keys).toEqual([
        'record.contact-groups.create',
        'record.contact-groups.delete',
        'record.contact-groups.read',
        'record.contact-groups.update',
        'record.contacts.import',
      ]);
      const idx = (
        await owner.query(
          `SELECT indexname FROM pg_indexes WHERE tablename = 'contacts' AND indexname LIKE '%trgm'`,
        )
      ).rows
        .map((r) => r.indexname)
        .sort();
      expect(idx).toEqual([
        'idx_contacts_email_trgm',
        'idx_contacts_name_trgm',
        'idx_contacts_phone_digits_trgm',
      ]);
    });
  });
});
