import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The channel registry table against a real Postgres, as the restricted application role (a superuser bypasses every policy and
 * would make the isolation assertions vacuous, see rls.spec.ts). Constraint checks use the owner connection: owners skip RLS but
 * never CHECK, UNIQUE or FK.
 */
describe('channels: schema, constraints and isolation', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;
  let chanA: number;
  let chanB: number;
  let uuidA: string;

  // A sealed-looking value: the table only checks the vault's version tag, never opens it.
  const SEALED = 'v1:aXY=:dGFn:Y2lwaGVy';
  const SECRET_A = 'v1:QQ==:QQ==:org-A-secret-cipher';
  const HASH = 'a'.repeat(64);

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

    const one = async (sql: string, p: unknown[] = []) =>
      (await owner.query(sql, p)).rows[0] as Record<string, unknown>;
    orgA = Number(
      (
        await one(
          `INSERT INTO organizations (slug, name, plan) VALUES ('ch-a','A','starter') RETURNING id`,
        )
      ).id,
    );
    orgB = Number(
      (
        await one(
          `INSERT INTO organizations (slug, name, plan) VALUES ('ch-b','B','starter') RETURNING id`,
        )
      ).id,
    );
    userA = Number(
      (
        await one(
          `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'a@ch.test','A','x') RETURNING id`,
          [orgA],
        )
      ).id,
    );
    userB = Number(
      (
        await one(
          `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'b@ch.test','B','x') RETURNING id`,
          [orgB],
        )
      ).id,
    );
    const a = await one(
      `INSERT INTO channels (org_id, kind, name, status, external_id, credentials_enc, webhook_token_hash, created_by)
       VALUES ($1,'whatsapp_cloud','Org A number','disconnected','111',$2,$3,$4) RETURNING id, uuid`,
      [orgA, SECRET_A, HASH, userA],
    );
    chanA = Number(a.id);
    uuidA = a.uuid as string;
    const b = await one(
      `INSERT INTO channels (org_id, kind, name, status, external_id, credentials_enc) VALUES ($1,'whatsapp_cloud','Org B number','disconnected','222',$2) RETURNING id, uuid`,
      [orgB, SEALED],
    );
    chanB = Number(b.id);

    app = new Client({
      connectionString: container.getConnectionUri().replace(/\/\/[^@]+@/, '//crm_app_user:test@'),
    });
    await app.connect();
  }, 240_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  /** Runs `fn` as the restricted role inside a transaction scoped to `org`, the way DatabaseService.tx does. */
  async function asTenant<T>(org: number, fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(org)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }

  describe('row-level security (forced, as the app role)', () => {
    it('is enabled and forced with a tenant_isolation policy', async () => {
      const r = await owner.query(
        `SELECT relrowsecurity, relforcerowsecurity,
                (SELECT count(*)::int FROM pg_policies WHERE tablename = 'channels' AND policyname = 'tenant_isolation') AS policies
         FROM pg_class WHERE relname = 'channels'`,
      );
      expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true, policies: 1 });
    });

    it('a tenant sees only its own channels', async () => {
      const rows = await asTenant(
        orgA,
        async () => (await app.query(`SELECT id, name FROM channels`)).rows,
      );
      expect(rows.map((r) => Number(r.id))).toEqual([chanA]);
    });

    it('no tenant context sees nothing', async () => {
      await app.query('BEGIN');
      try {
        expect((await app.query(`SELECT id FROM channels`)).rows).toEqual([]);
      } finally {
        await app.query('ROLLBACK');
      }
    });

    it("another tenant's secrets are not selectable: not by id, uuid, or an explicit column list", async () => {
      await asTenant(orgB, async () => {
        for (const sql of [
          `SELECT credentials_enc FROM channels WHERE id = ${chanA}`,
          `SELECT credentials_enc, webhook_token_hash FROM channels WHERE uuid = '${uuidA}'`,
          `SELECT * FROM channels WHERE org_id = ${orgA}`,
        ]) {
          expect((await app.query(sql)).rows).toEqual([]);
        }
        expect(
          (
            await app.query(
              `SELECT count(*)::int AS n FROM channels WHERE credentials_enc LIKE '%org-A-secret%'`,
            )
          ).rows[0].n,
        ).toBe(0);
      });
    });

    it("a tenant cannot update or delete another tenant's channel", async () => {
      await asTenant(orgB, async () => {
        expect(
          (await app.query(`UPDATE channels SET name = 'hijacked' WHERE id = ${chanA}`)).rowCount,
        ).toBe(0);
        expect((await app.query(`DELETE FROM channels WHERE id = ${chanA}`)).rowCount).toBe(0);
      });
      expect(
        (await owner.query(`SELECT name FROM channels WHERE id = $1`, [chanA])).rows[0].name,
      ).toBe('Org A number');
    });

    it('WITH CHECK: a tenant cannot write a row into another tenant', async () => {
      await asTenant(orgB, async () => {
        await expect(
          app.query(
            `INSERT INTO channels (org_id, kind, name) VALUES (${orgA}, 'simulator', 'planted')`,
          ),
        ).rejects.toThrow(/row-level security/);
      });
    });

    it('a row cannot be moved to another tenant by an update either', async () => {
      await asTenant(orgB, async () => {
        await expect(
          app.query(`UPDATE channels SET org_id = ${orgA} WHERE id = ${chanB}`),
        ).rejects.toThrow(/row-level security/);
      });
    });
  });

  describe('the public webhook lookup', () => {
    it('answers two ids for a known uuid, for the app role with no tenant context, and nothing else', async () => {
      const r = await app.query(`SELECT * FROM chat_channel_lookup($1::uuid)`, [uuidA]);
      expect(r.rows.map((x) => [Number(x.channel_id), Number(x.channel_org_id)])).toEqual([
        [chanA, orgA],
      ]);
      expect(Object.keys(r.rows[0]).sort()).toEqual(['channel_id', 'channel_org_id']);
    });

    it('answers nothing for an unknown uuid', async () => {
      const r = await app.query(`SELECT * FROM chat_channel_lookup($1::uuid)`, [
        '00000000-0000-4000-8000-000000000000',
      ]);
      expect(r.rows).toEqual([]);
    });

    it('does not leave RLS lifted behind it', async () => {
      await app.query('BEGIN');
      try {
        await app.query(`SELECT * FROM chat_channel_lookup($1::uuid)`, [uuidA]);
        expect((await app.query(`SELECT id FROM channels`)).rows).toEqual([]);
      } finally {
        await app.query('ROLLBACK');
      }
    });

    it('is not callable by PUBLIC (only the application roles)', async () => {
      const r = await owner.query(
        `SELECT has_function_privilege('public', 'chat_channel_lookup(uuid)', 'EXECUTE') AS pub,
                has_function_privilege('crm_app_user', 'chat_channel_lookup(uuid)', 'EXECUTE') AS app`,
      );
      expect(r.rows[0]).toEqual({ pub: false, app: true });
    });
  });

  describe('constraints', () => {
    const insert = (cols: string, vals: unknown[]) =>
      owner.query(
        `INSERT INTO channels (org_id, kind, name, ${cols}) VALUES ($1, 'simulator', 'x', ${vals.map((_, i) => `$${i + 2}`).join(',')})`,
        [orgA, ...vals],
      );

    it('refuses a plaintext credentials value: only the vault output (a version tag) is stored', async () => {
      await expect(insert('credentials_enc', ['EAAB-plaintext-token'])).rejects.toThrow(
        /chk_channels_credentials_sealed/,
      );
      await expect(insert('credentials_enc', [SEALED])).resolves.toBeDefined();
    });

    it('refuses a bad status, a malformed kind, a blank or overlong name, a non-object settings value', async () => {
      await expect(insert('status', ['paused'])).rejects.toThrow(/chk_channels_status/);
      await expect(
        owner.query(`INSERT INTO channels (org_id, kind, name) VALUES ($1, 'Bad Kind!', 'x')`, [
          orgA,
        ]),
      ).rejects.toThrow(/chk_channels_kind/);
      await expect(
        owner.query(`INSERT INTO channels (org_id, kind, name) VALUES ($1, 'simulator', '   ')`, [
          orgA,
        ]),
      ).rejects.toThrow(/chk_channels_name/);
      await expect(
        owner.query(`INSERT INTO channels (org_id, kind, name) VALUES ($1, 'simulator', $2)`, [
          orgA,
          'n'.repeat(121),
        ]),
      ).rejects.toThrow(/chk_channels_name/);
      await expect(insert('settings', ['[]'])).rejects.toThrow(/chk_channels_settings/);
    });

    it('stores a SHA-256 hex of the webhook token, never anything else', async () => {
      await expect(insert('webhook_token_hash', ['not-a-hash'])).rejects.toThrow(
        /chk_channels_webhook_token_hash/,
      );
    });

    it('a provider account is connected once per workspace and once per kind, and a WhatsApp number once on the platform', async () => {
      await expect(
        owner.query(
          `INSERT INTO channels (org_id, kind, name, external_id) VALUES ($1,'whatsapp_cloud','dup','111')`,
          [orgA],
        ),
      ).rejects.toThrow(/channels_org_id_kind_external_id_key|uq_channels_whatsapp_number/);
      // A number id leads to exactly one channel, whichever workspace holds it: the first to connect it does.
      await expect(
        owner.query(
          `INSERT INTO channels (org_id, kind, name, external_id) VALUES ($1,'whatsapp_cloud','stolen','111')`,
          [orgB],
        ),
      ).rejects.toThrow(/uq_channels_whatsapp_number/);
      // Other kinds keep the per-workspace rule only.
      await owner.query(
        `INSERT INTO channels (org_id, kind, name, external_id) VALUES ($1,'webchat','w-a','111'),($2,'webchat','w-b','111')`,
        [orgA, orgB],
      );
      await owner.query(`DELETE FROM channels WHERE kind = 'webchat' AND external_id = '111'`);
    });

    it('simulators have no external id and never collide', async () => {
      await owner.query(
        `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','s1'),($1,'simulator','s2')`,
        [orgA],
      );
      await owner.query(`DELETE FROM channels WHERE org_id = $1 AND kind = 'simulator'`, [orgA]);
    });

    it("created_by is a composite foreign key: a channel cannot be created by another workspace's user", async () => {
      await expect(
        owner.query(
          `INSERT INTO channels (org_id, kind, name, created_by) VALUES ($1,'simulator','x',$2)`,
          [orgA, userB],
        ),
      ).rejects.toThrow(/channels_org_id_created_by_fkey/);
    });

    it('removing the creating user keeps the channel (created_by is set null, org_id untouched)', async () => {
      const u = Number(
        (
          await owner.query(
            `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,'gone@ch.test','G','x') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      const c = Number(
        (
          await owner.query(
            `INSERT INTO channels (org_id, kind, name, created_by) VALUES ($1,'simulator','kept',$2) RETURNING id`,
            [orgA, u],
          )
        ).rows[0].id,
      );
      await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [orgA, u]);
      const r = await owner.query(`SELECT org_id, created_by FROM channels WHERE id = $1`, [c]);
      expect({ org: Number(r.rows[0].org_id), by: r.rows[0].created_by }).toEqual({
        org: orgA,
        by: null,
      });
      await owner.query(`DELETE FROM channels WHERE id = $1`, [c]);
    });

    it('deleting the organization removes its channels', async () => {
      const o = Number(
        (
          await owner.query(
            `INSERT INTO organizations (slug, name, plan) VALUES ('ch-tmp','T','starter') RETURNING id`,
          )
        ).rows[0].id,
      );
      await owner.query(`INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','t')`, [
        o,
      ]);
      await owner.query(`DELETE FROM organizations WHERE id = $1`, [o]);
      expect(
        (await owner.query(`SELECT count(*)::int AS n FROM channels WHERE org_id = $1`, [o]))
          .rows[0].n,
      ).toBe(0);
    });

    it('row_version and updated_at move on every update (optimistic locking)', async () => {
      const before = (
        await owner.query(`SELECT row_version, updated_at FROM channels WHERE id = $1`, [chanB])
      ).rows[0];
      await owner.query(`UPDATE channels SET name = 'Org B renamed' WHERE id = $1`, [chanB]);
      const after = (
        await owner.query(`SELECT row_version, updated_at FROM channels WHERE id = $1`, [chanB])
      ).rows[0];
      expect(after.row_version).toBe(before.row_version + 1);
      expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(before.updated_at).getTime(),
      );
    });
  });

  describe('the capability key', () => {
    it('inbox.channel.manage exists, is not scoped, and a new organization gets it on its Owner and Admin presets', async () => {
      const def = await owner.query(
        `SELECT supports_scope FROM permission_defs WHERE key = 'inbox.channel.manage'`,
      );
      expect(def.rows).toEqual([{ supports_scope: false }]);
      const org = Number(
        (
          await owner.query(
            `INSERT INTO organizations (slug, name, plan) VALUES ('ch-preset','P','starter') RETURNING id`,
          )
        ).rows[0].id,
      );
      await owner.query(`SELECT set_config('app.privileged', 'on', false)`);
      await owner.query(`SELECT provision_workspace_presets($1)`, [org]);
      const roles = await owner.query(
        `SELECT r.system_key FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
         WHERE g.org_id = $1 AND g.permission_key = 'inbox.channel.manage' ORDER BY 1`,
        [org],
      );
      expect(roles.rows.map((r) => r.system_key)).toEqual(['admin', 'workspace_admin']);
    });
  });

  describe('the WABA link (20261017090000_chat_channels_waba_link.sql)', () => {
    const migration = readFileSync(
      resolve(
        __dirname,
        '../../../../../packages/db/migrations/20261017090000_chat_channels_waba_link.sql',
      ),
      'utf8',
    );
    /** The backfill, exactly as the migration runs it: from its privileged switch to the end of the last INSERT. */
    const backfill = migration.slice(
      migration.indexOf("SELECT set_config('app.privileged'"),
      migration.indexOf('-- --- the removed'),
    );

    let org: number;
    let other: number;
    const one = async (sql: string, p: unknown[] = []) =>
      (await owner.query(sql, p)).rows[0] as Record<string, unknown>;
    const config = async (
      orgId: number,
      o: {
        phone?: string | null;
        waba?: string;
        status?: string;
        label?: string | null;
        number?: string | null;
      },
    ) =>
      Number(
        (
          await one(
            `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, meta_json)
             VALUES ($1,'waba',$2,$3,$4,$5::jsonb) RETURNING id`,
            [
              orgId,
              o.status ?? 'connected',
              o.number === undefined ? '+1 555 000 9999' : o.number,
              o.label === undefined ? null : o.label,
              JSON.stringify({
                waba_id: o.waba ?? '12345678901',
                ...(o.phone === null ? {} : { phone_number_id: o.phone }),
              }),
            ],
          )
        ).id,
      );

    beforeAll(async () => {
      org = Number(
        (
          await one(
            `INSERT INTO organizations (slug, name, plan) VALUES ('ch-link','L','starter') RETURNING id`,
          )
        ).id,
      );
      other = Number(
        (
          await one(
            `INSERT INTO organizations (slug, name, plan) VALUES ('ch-link2','L2','starter') RETURNING id`,
          )
        ).id,
      );
    });

    it("a channel can only point at its own workspace's connection (composite key), and one connection has one channel", async () => {
      const mine = await config(org, { phone: '70000000001' });
      const theirs = await config(other, { phone: '70000000002' });
      await expect(
        owner.query(
          `INSERT INTO channels (org_id, kind, name, waba_config_id) VALUES ($1,'whatsapp_cloud','x',$2)`,
          [org, theirs],
        ),
      ).rejects.toThrow(/fk_channels_waba_config/);
      await owner.query(
        `INSERT INTO channels (org_id, kind, name, waba_config_id) VALUES ($1,'whatsapp_cloud','ok',$2)`,
        [org, mine],
      );
      await expect(
        owner.query(
          `INSERT INTO channels (org_id, kind, name, waba_config_id) VALUES ($1,'whatsapp_cloud','again',$2)`,
          [org, mine],
        ),
      ).rejects.toThrow(/uq_channels_waba_config/);
    });

    it('removing the connection detaches the channel (the link goes null; the row, its org and its threads stay)', async () => {
      const cfg = await config(org, { phone: '70000000003' });
      const ch = await one(
        `INSERT INTO channels (org_id, kind, name, status, waba_config_id) VALUES ($1,'whatsapp_cloud','detach','connected',$2) RETURNING id`,
        [org, cfg],
      );
      await owner.query(`DELETE FROM wa_provider_configs WHERE org_id = $1 AND id = $2`, [
        org,
        cfg,
      ]);
      const row = await one(`SELECT org_id, waba_config_id, status FROM channels WHERE id = $1`, [
        ch.id,
      ]);
      expect(Number(row.org_id)).toBe(org);
      expect(row.waba_config_id).toBeNull();
      expect(row.status).toBe('connected');
    });

    it('the lookup of the removed provider-level webhook is gone', async () => {
      const r = await one(`SELECT to_regprocedure('chat_channel_by_external(text, text)') AS fn`);
      expect(r.fn).toBeNull();
    });

    it('backfill: links the channel that already has the number, makes one for a connected number without it, and skips what cannot be a channel', async () => {
      const c = Number(
        (
          await one(
            `INSERT INTO organizations (slug, name, plan) VALUES ('ch-fill','F','starter') RETURNING id`,
          )
        ).id,
      );
      const holder = Number(
        (
          await one(
            `INSERT INTO organizations (slug, name, plan) VALUES ('ch-fill-held','H','starter') RETURNING id`,
          )
        ).id,
      );

      const fresh = await config(c, {
        phone: '71000000001',
        label: 'Sales',
        number: '+1 555 111 0001',
      });
      const adopted = await config(c, { phone: '71000000002', label: 'Support' });
      const early = await one(
        `INSERT INTO channels (org_id, kind, name, status, external_id) VALUES ($1,'whatsapp_cloud','Pasted earlier','disconnected','71000000002') RETURNING id`,
        [c],
      );
      const off = await config(c, { phone: '71000000003', status: 'disconnected' });
      const noPhone = await config(c, { phone: null });
      const shortId = await config(c, { phone: '123' });
      const heldElsewhere = await config(c, { phone: '71000000004' });
      await owner.query(
        `INSERT INTO channels (org_id, kind, name, external_id) VALUES ($1,'whatsapp_cloud','Held by another workspace','71000000004')`,
        [holder],
      );
      const blankLabel = await config(c, { phone: '71000000005', label: '  ', number: null });

      await owner.query(backfill);
      await owner.query(backfill); // idempotent: a second run changes nothing

      const rows = (
        await owner.query(
          `SELECT id, name, status, external_id, display_address, business_account_id, waba_config_id FROM channels WHERE org_id = $1 ORDER BY id`,
          [c],
        )
      ).rows;
      const byConfig = (id: number) => rows.find((r) => Number(r.waba_config_id) === id);
      expect(byConfig(fresh)).toMatchObject({
        name: 'Sales',
        status: 'connected',
        external_id: '71000000001',
        display_address: '+1 555 111 0001',
        business_account_id: '12345678901',
      });
      // The channel that already existed for the number is the one linked: same row, same name, nothing duplicated.
      expect(byConfig(adopted)).toMatchObject({
        name: 'Pasted earlier',
        external_id: '71000000002',
        business_account_id: '12345678901',
      });
      expect(Number(byConfig(adopted)!.id)).toBe(Number(early.id));
      expect(byConfig(blankLabel)).toMatchObject({ name: 'WhatsApp', display_address: null });
      for (const skipped of [off, noPhone, shortId, heldElsewhere])
        expect(byConfig(skipped)).toBeUndefined();
      expect(rows).toHaveLength(3);
    });
  });
});
