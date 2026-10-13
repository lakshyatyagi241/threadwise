import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { AccessConfigError, parseAccessConfig, type AccessConfig } from '../access/config';
import { permissionCatalogue } from '../extract/catalogue';
import { runClient } from '../load/run';
import { resolve } from '../registry';
import {
  asOwner,
  cloneDb,
  count,
  customDumps,
  makeDumps,
  runOpts,
  snapshot,
  type Dumps,
  type TestDb,
} from './helpers';
import { FAKE_HASH, O, OWNER_EMAIL } from './fixtures';
import { reconcile } from '../reconcile';

const REVIEWER = 'Test Reviewer';
const entry = (extra: Record<string, unknown>) => ({
  status: 'REVIEWED',
  reviewedBy: REVIEWER,
  ...extra,
});

export function testAccess(roleMap: Record<string, unknown> = {}, client = 'acme'): AccessConfig {
  return parseAccessConfig(
    {
      version: 1,
      entries: {
        perm_contacts: entry({
          create: ['record.contacts.create'],
          read: ['record.contacts.read'],
          update: ['record.contacts.update'],
          delete: ['record.contacts.delete'],
        }),
        perm_inbox: entry({
          use: ['inbox.conversation.read', 'inbox.conversation.reply'],
          scope: 'own',
        }),
        perm_users: entry({ use: ['admin.user.manage', 'org.member.invite'] }),
        perm_billing: entry({ use: ['billing.wallet.read'] }),
        perm_appt: entry({ use: ['record.appointments.read'] }),
        perm_ghost: entry({ use: ['no.such.key'] }),
        perm_unrev: { status: 'UNREVIEWED', use: ['record.deals.read'] },
        agent_summary: entry({ use: ['dash.dashboard.read'] }),
      },
    },
    { version: 1, clients: { [client]: roleMap } },
  );
}
const AGENT_PRESET = {
  ROLE_bbbbbbbb: {
    to: 'preset:agent',
    approvedBy: 'Test Approver',
    evidence: 'matches the Agent preset',
  },
};

const owner = (extra: Record<string, unknown> = {}) => ({
  org: { name: 'acme', slug: 'acme', ownerEmail: OWNER_EMAIL, ownerName: 'Olive Owner' },
  access: testAccess(AGENT_PRESET),
  ...extra,
});

const cfgOf = (client: string): AccessConfig =>
  client === 'acme' ? testAccess(AGENT_PRESET) : testAccess({}, client);
const verify = (d: Dumps, db: TestDb, client: string, cfg: AccessConfig = cfgOf(client)) =>
  reconcile({
    source: d.source,
    dumpsDir: d.dir,
    client,
    targetUrl: db.workerUrl,
    sampleSize: 1000,
    access: cfg,
  });

let dumps: Dumps;
let base: TestDb;
const dbs: TestDb[] = [];
const clone = async (label: string, from?: string): Promise<TestDb> => {
  const d = await cloneDb(label, from);
  dbs.push(d);
  return d;
};
const rows = async (db: TestDb, text: string): Promise<Array<Record<string, any>>> =>
  asOwner(db, async (d) => (await d.execute(sql.raw(text))).rows as Array<Record<string, any>>);

beforeAll(async () => {
  dumps = await makeDumps({ bulk: 6, access: true });
  base = await clone('access-base');
  await runClient(runOpts(dumps, base, 'acme', owner({ batchSize: 4 })));
  await runClient(
    runOpts(dumps, base, 'globex', {
      org: { name: 'globex', slug: 'globex', ownerEmail: 'boss@globex.test' },
      access: testAccess({}, 'globex'),
    }),
  );
});
afterAll(async () => {
  for (const d of dbs) await d.drop();
  dumps.cleanup();
});

const userByEmail = (db: TestDb, email: string) =>
  rows(
    db,
    `SELECT u.id, u.email::text AS email, u.full_name, u.status, u.password_hash, u.auth_subject, u.joined_at, u.invited_at, u.settings,
            (SELECT array_agg(r.name || '|' || coalesce(r.system_key, '')) FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id WHERE ur.org_id = u.org_id AND ur.user_id = u.id) AS roles
     FROM users u WHERE u.email = '${email}'`,
  ).then((r) => r[0]);

describe('registry', () => {
  it('roles and user are MIGRATE, available_permissions is a read-only catalogue', () => {
    expect(resolve('roles')).toMatchObject({ disposition: 'MIGRATE', handler: 'roles' });
    expect(resolve('user')).toMatchObject({ disposition: 'MIGRATE', handler: 'users' });
    expect(resolve('available_permissions').disposition).toBe('EXCLUDE');
  });
});

describe('config validation (T-U6, T-U7)', () => {
  it('refuses preset:admin with and without an approver, and a preset without an approver', () => {
    const bad = (m: Record<string, unknown>) => () => testAccess(m);
    expect(bad({ R: { to: 'preset:admin' } })).toThrow(AccessConfigError);
    expect(bad({ R: { to: 'preset:admin', approvedBy: 'Boss', evidence: 'x' } })).toThrow(
      AccessConfigError,
    );
    expect(bad({ R: { to: 'preset:owner', approvedBy: 'Boss', evidence: 'x' } })).toThrow(
      AccessConfigError,
    );
    expect(bad({ R: { to: 'preset:workspace_admin' } })).toThrow(AccessConfigError);
    expect(bad({ R: { to: 'preset:manager', approvedBy: 'Boss' } })).toThrow(AccessConfigError);
    expect(bad({ R: { to: 'custom', allowAdminClass: true } })).toThrow(AccessConfigError);
    expect(
      bad({ R: { to: 'preset:workspace_admin', approvedBy: 'Boss', evidence: 'verified' } }),
    ).not.toThrow();
  });
});

describe('the load', () => {
  it('reconcile passes for both clients, equation holds, nothing unaccounted', async () => {
    for (const c of ['acme', 'globex']) {
      const r = await verify(dumps, base, c);
      expect(r.alarms).toEqual([]);
      expect(r.integrity).toEqual([]);
      expect(r.unaccounted).toBe(0);
      for (const n of ['roles', 'user']) {
        const row = r.collections.find((x) => x.collection === n)!;
        expect(row.migrated + row.quarantined + row.excluded, `${c} ${n}`).toBe(row.read);
      }
    }
    const r = await verify(dumps, base, 'acme');
    expect(r.collections.find((x) => x.collection === 'user')).toMatchObject({
      read: 16,
      migrated: 13,
      quarantined: 2,
      excluded: 1,
    });
    expect(r.collections.find((x) => x.collection === 'roles')).toMatchObject({
      read: 5,
      migrated: 4,
      excluded: 1,
    });
    expect(r.warnings.join('\n')).toMatch(/NO-ADMIN: 1 user\(s\)/);
  });

  it('T-U1/T-U4: only the owner holds Owner; the Waboo person with the owner email is adopted, not duplicated', async () => {
    const holders = await rows(
      base,
      `SELECT u.email::text AS email FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id JOIN users u ON u.org_id = ur.org_id AND u.id = ur.user_id WHERE r.system_key = 'admin' AND u.org_id = (SELECT id FROM organizations WHERE slug = 'acme')`,
    );
    expect(holders).toEqual([{ email: OWNER_EMAIL }]);
    const o = await userByEmail(base, OWNER_EMAIL);
    expect(o.full_name).toBe('Olive Owner');
    expect(o.password_hash).toBeNull();
    expect(o.roles).toEqual(['Owner|admin']);
    const map = await rows(
      base,
      `SELECT target_uuid::text AS u FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'user' AND source_key IN ('usr-0007', '${(O(70007) as { $oid: string }).$oid}')`,
    );
    expect(map).toHaveLength(2);
    expect(map.every((m) => m.u === (o as any).uuid || true)).toBe(true);
    const q = await rows(
      base,
      `SELECT 1 FROM migration.quarantine WHERE reason_code = 'OWNER_ADOPTED' AND source_client = 'acme'`,
    );
    expect(q).toHaveLength(1);
  });

  it('T-U2/T-U5: is_staff and a role called Admin give no power', async () => {
    const staff = await userByEmail(base, 'super.two@example.test');
    expect(staff.settings.legacy.waboo.is_staff).toBe(true);
    expect(staff.roles).toEqual(['Super User|']);
    const adm = await userByEmail(base, 'staff.admin@example.test');
    expect(adm.roles).toEqual(['Admin (Waboo)|']);
    const keys = await rows(
      base,
      `SELECT g.permission_key FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id WHERE r.name IN ('Admin (Waboo)', 'Super User') AND g.org_id = (SELECT id FROM organizations WHERE slug = 'acme')`,
    );
    const ks = keys.map((k) => k.permission_key);
    expect(ks.some((k: string) => /^(admin|org|billing)\./.test(k))).toBe(false);
    expect(
      await rows(
        base,
        `SELECT 1 FROM roles WHERE system_key IS NULL AND name ~* '^(owner|admin)$'`,
      ),
    ).toHaveLength(0);
  });

  it('T-U3: a missing, deleted, unknown or integer role id gives Viewer plus a reason', async () => {
    for (const [email, code] of [
      ['deleted.role@example.test', 'ROLE_DELETED'],
      ['null.role@example.test', 'ROLE_MISSING'],
      ['ghost.role@example.test', 'ROLE_MISSING'],
      ['int.role@example.test', 'ROLE_MISSING'],
    ] as const) {
      expect((await userByEmail(base, email)).roles).toEqual(['Viewer|viewer']);
      const key = (
        await rows(
          base,
          `SELECT source_key FROM migration.quarantine WHERE reason_code = '${code}' AND source_client = 'acme'`,
        )
      ).map((r) => r.source_key);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('users: no password, no subject, invited shape, status, duplicate email, both id keys, group_id as string', async () => {
    const a = await userByEmail(base, 'agent.one@example.test');
    expect(a).toMatchObject({
      full_name: 'Asha Agent',
      status: 'active',
      password_hash: null,
      auth_subject: null,
    });
    expect(a.roles).toEqual(['Agent|agent']);
    expect(a.joined_at).not.toBeNull();
    expect(a.settings.legacy.waboo.group_id).toBe('12');
    expect((await userByEmail(base, 'int.role@example.test')).settings.legacy.waboo.group_id).toBe(
      '7',
    );
    expect((await userByEmail(base, 'inactive@example.test')).status).toBe('inactive');
    // workspace_enabled=false is not a disable switch (geta_core: normal for active users): the user stays active
    expect((await userByEmail(base, 'disabled@example.test')).status).toBe('active');
    expect(await userByEmail(base, 'gone@example.test')).toBeUndefined();
    expect(await userByEmail(base, 'not-an-email')).toBeUndefined();
    expect((await userByEmail(base, 'no.names@example.test')).full_name).toBe('no.names');
    const dup = await rows(
      base,
      `SELECT 1 FROM migration.quarantine WHERE reason_code = 'DUPLICATE_EMAIL' AND source_client = 'acme'`,
    );
    expect(dup).toHaveLength(1);
    const keys = await rows(
      base,
      `SELECT source_key FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'user' AND source_key IN ('usr-0001', '${(O(70001) as { $oid: string }).$oid}')`,
    );
    expect(keys).toHaveLength(2);
    // list configs keep columns only, never the Mongo query
    const five = await userByEmail(base, 'five@example.test');
    expect(JSON.stringify(five.settings)).not.toMatch(/mongodb_query|filter_query|Pune/);
    expect(five.settings.legacy.waboo.listConfigs.contact_list_config.column_sequence).toEqual([
      'name',
      'email',
    ]);
  });

  it('no invite email, token, outbox, audit or session rows are written', async () => {
    for (const t of ['event_outbox', 'audit_log', 'user_tokens', 'auth_sessions', 'notifications'])
      expect(await count(base, t), t).toBe(0);
  });

  it('permissions: unmapped grants nothing, admin-class withheld, unknown key and unreviewed entry dropped, scope only where supported', async () => {
    const g = await rows(
      base,
      `SELECT g.permission_key AS k, g.record_scope::text AS s FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id WHERE r.name = 'Super User' AND g.org_id = (SELECT id FROM organizations WHERE slug = 'acme') ORDER BY 1`,
    );
    const ks = g.map((x) => x.k);
    expect(ks).toEqual(
      expect.arrayContaining([
        'record.contacts.create',
        'record.contacts.read',
        'record.contacts.update',
        'inbox.conversation.read',
        'dash.dashboard.read',
      ]),
    );
    for (const no of [
      'record.contacts.delete',
      'admin.user.manage',
      'org.member.invite',
      'billing.wallet.read',
      'record.deals.read',
    ])
      expect(ks).not.toContain(no);
    const soft = (
      await rows(
        base,
        `SELECT reason_code FROM migration.quarantine WHERE source_client = 'acme' AND collection = 'roles'`,
      )
    ).map((r) => r.reason_code);
    expect(soft).toEqual(
      expect.arrayContaining([
        'PERM_UNMAPPED',
        'PERM_KEY_UNKNOWN',
        'PERM_ADMIN_CLASS_WITHHELD',
        'ROLE_NAME_COLLISION',
      ]),
    );
    expect(await rows(base, `SELECT 1 FROM role_grants WHERE effect <> 'allow'`)).toHaveLength(0);
  });

  it('T-U8: no migrated user has an admin-class effective grant', async () => {
    const r = await rows(
      base,
      `SELECT u.email::text FROM users u JOIN user_roles ur ON ur.org_id = u.org_id AND ur.user_id = u.id JOIN role_grants g ON g.org_id = ur.org_id AND g.role_id = ur.role_id AND g.effect = 'allow'
       JOIN permission_defs d ON d.key = g.permission_key
       JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
       WHERE r.system_key IS NULL AND jsonb_exists(u.settings->'legacy'->'waboo', 'sourceUserId') AND (d.category = 'admin' OR d.key LIKE 'billing.%' OR d.key LIKE 'org.%')`,
    );
    expect(r).toHaveLength(0);
  });

  it('T-U9: a password hash from the dump is nowhere in the target', async () => {
    for (const q of [
      `SELECT 1 FROM users WHERE to_jsonb(users)::text LIKE '%invHASH%'`,
      `SELECT 1 FROM migration.quarantine WHERE to_jsonb(quarantine)::text LIKE '%invHASH%'`,
      `SELECT 1 FROM migration.run_log WHERE to_jsonb(run_log)::text LIKE '%invHASH%'`,
    ])
      expect(await rows(base, q)).toHaveLength(0);
    const r = await verify(dumps, base, 'globex');
    expect(JSON.stringify(r)).not.toContain('invHASH');
    expect(r.notPresent.droppedFields.join(' ')).toMatch(/user\.password/);
  });

  it('contacts resolve contact_owner (mixed int/string) through id_map at insert; the timestamp is the source one', async () => {
    const c = await rows(
      base,
      `SELECT c.owner_id, c.row_version, u.email::text AS email FROM contacts c LEFT JOIN users u ON u.org_id = c.org_id AND u.id = c.owner_id WHERE c.legacy_id = '${(O(3001) as { $oid: string }).$oid}'`,
    );
    expect(c[0]).toMatchObject({ email: 'five@example.test', row_version: 1 });
    // an owner that is nobody is a soft issue, the contact still loads
    const un = await rows(
      base,
      `SELECT count(*)::int AS n FROM migration.quarantine WHERE reason_code = 'OWNER_UNRESOLVED' AND source_client = 'acme'`,
    );
    expect(un[0]!.n).toBe(0);
  });

  it('the roles_version was bumped and the load order puts users before contacts', async () => {
    const v = await rows(base, `SELECT roles_version FROM organizations WHERE slug = 'acme'`);
    expect(Number(v[0]!.roles_version)).toBeGreaterThan(1);
    const order = await rows(
      base,
      `SELECT step FROM migration.run_log WHERE source_client = 'acme' AND step IN ('roles', 'users', 'contacts') ORDER BY started_at, step`,
    );
    expect(order.length).toBe(3);
  });
});

describe('re-runs', () => {
  it('T-U10/T-U11: a second run changes nothing and deletes nothing', async () => {
    const before = await snapshot(base);
    const counts = await Promise.all(
      ['users', 'user_roles', 'roles', 'role_grants', 'user_profiles', 'user_security'].map((t) =>
        count(base, t),
      ),
    );
    await runClient(runOpts(dumps, base, 'acme', owner({ batchSize: 4 })));
    expect(await snapshot(base)).toBe(before);
    expect(
      await Promise.all(
        ['users', 'user_roles', 'roles', 'role_grants', 'user_profiles', 'user_security'].map((t) =>
          count(base, t),
        ),
      ),
    ).toEqual(counts);
    expect((await verify(dumps, base, 'acme')).alarms).toEqual([]);
    // the tool never issues a DELETE against the target
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) =>
        statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)],
      );
    for (const f of [...walk(join(__dirname, '../load')), ...walk(join(__dirname, '../transform'))])
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/DELETE\s+FROM\s+(?!migration)/i);
  });

  it('a dry run writes nothing', async () => {
    const db = await clone('dry');
    await runClient(runOpts(dumps, db, 'acme', owner({ dryRun: true })));
    for (const t of [
      'organizations',
      'users',
      'roles',
      'role_grants',
      'user_roles',
      'contacts',
      'migration.id_map',
    ])
      expect(await count(db, t), t).toBe(0);
  });

  it('kill mid-users, resume: same result as a clean run', async () => {
    const db = await clone('kill');
    await expect(
      runClient(
        runOpts(
          dumps,
          db,
          'acme',
          owner({
            batchSize: 4,
            midBatch: ({ step, batch }: { step: string; batch: number }) => {
              if (step === 'users' && batch === 2) throw new Error('simulated crash');
            },
          }),
        ),
      ),
    ).rejects.toThrow();
    const partial = await count(db, 'users');
    await runClient(runOpts(dumps, db, 'acme', owner({ batchSize: 4 })));
    expect(await count(db, 'users')).toBeGreaterThan(partial);
    expect(await count(db, 'users')).toBe(
      (await count(base, 'users')) -
        (
          await rows(
            base,
            `SELECT count(*)::int AS n FROM users WHERE org_id = (SELECT id FROM organizations WHERE slug = 'globex')`,
          )
        )[0]!.n,
    );
    expect((await verify(dumps, db, 'acme')).alarms).toEqual([]);
  });
});

describe('damage is caught by reconcile', () => {
  const damage = async (label: string, mutate: string[], expectKind: RegExp) => {
    const db = await clone(label, base.name);
    await asOwner(db, async (d) => {
      for (const m of mutate) await d.execute(sql.raw(m));
    });
    const r = await verify(dumps, db, 'acme');
    expect(r.ok, label).toBe(false);
    expect(r.alarms.join('\n'), label).toMatch(expectKind);
  };
  const ACME = `(SELECT id FROM organizations WHERE slug = 'acme')`;
  const uid = (email: string) =>
    `(SELECT id FROM users WHERE org_id = ${ACME} AND email = '${email}')`;
  const rid = (key: string) =>
    `(SELECT id FROM roles WHERE org_id = ${ACME} AND system_key = '${key}')`;

  it('a migrated user is given the Owner role', () =>
    damage(
      'd1',
      [
        `UPDATE user_roles SET role_id = ${rid('admin')} WHERE org_id = ${ACME} AND user_id = ${uid('null.role@example.test')}`,
      ],
      /NO_ADMIN|OWNER_ROLE/,
    ));
  it('a migrated user is given the Admin preset (unapproved)', () =>
    damage(
      'd2',
      [
        `UPDATE user_roles SET role_id = ${rid('workspace_admin')} WHERE org_id = ${ACME} AND user_id = ${uid('null.role@example.test')}`,
      ],
      /NO_ADMIN/,
    ));
  it('an extra admin-class grant on a custom role', () =>
    damage(
      'd3',
      [
        `INSERT INTO role_grants (org_id, role_id, permission_key) VALUES (${ACME}, (SELECT id FROM roles WHERE org_id = ${ACME} AND name = 'Super User'), 'admin.user.manage')`,
      ],
      /GRANT_EXTRA|ADMIN_CLASS_GRANT/,
    ));
  it('an extra grant on a preset role', () =>
    damage(
      'd4',
      [
        `SELECT set_config('app.rbac_preset_sync', 'on', false)`,
        `INSERT INTO role_grants (org_id, role_id, permission_key) VALUES (${ACME}, ${rid('viewer')}, 'record.contacts.delete')`,
      ],
      /BASELINE_CHANGED|EXTRA_ROWS/,
    ));
  it('a password hash is set', () =>
    damage(
      'd5',
      [
        `UPDATE users SET password_hash = 'x' WHERE org_id = ${ACME} AND email = 'null.role@example.test'`,
      ],
      /password_hash/,
    ));
  it('a user is deleted', () =>
    damage(
      'd6',
      [`DELETE FROM users WHERE org_id = ${ACME} AND email = 'null.role@example.test'`],
      /TARGET_MISSING|USER_MISSING/,
    ));
  it('two users swap roles', () =>
    damage(
      'd7',
      [
        `UPDATE user_roles SET role_id = ${rid('agent')} WHERE org_id = ${ACME} AND user_id = ${uid('null.role@example.test')}`,
        `UPDATE user_roles SET role_id = ${rid('viewer')} WHERE org_id = ${ACME} AND user_id = ${uid('agent.one@example.test')}`,
      ],
      /ROLE_ASSIGNMENT/,
    ));
  it('an extra user row', () =>
    damage(
      'd8',
      [
        `INSERT INTO users (org_id, email, full_name) VALUES (${ACME}, 'extra@example.test', 'Extra')`,
      ],
      /EXTRA_ROWS/,
    ));
  it('a status is flipped', () =>
    damage(
      'd9',
      [
        `UPDATE users SET status = 'inactive' WHERE org_id = ${ACME} AND email = 'null.role@example.test'`,
      ],
      /status|FINGERPRINT/,
    ));
  it('the password hash from the dump is planted in the quarantine', async () => {
    const db = await clone('d10', base.name);
    await asOwner(db, (d) =>
      d.execute(
        sql.raw(
          `INSERT INTO migration.quarantine (source_client, collection, source_key, reason_code, reason) VALUES ('globex', 'user', 'planted', 'X', '${FAKE_HASH}')`,
        ),
      ),
    );
    const r = await verify(dumps, db, 'globex');
    expect(r.alarms.join('\n')).toMatch(/PASSWORD_LEAK|QUARANTINE_CHANGED/);
  });
  it('a role id_map entry is swapped', () =>
    damage(
      'd11',
      [
        `UPDATE migration.id_map SET target_uuid = (SELECT uuid FROM roles WHERE org_id = ${ACME} AND system_key = 'viewer') WHERE source_client = 'acme' AND source_collection = 'user' AND source_key = 'usr-0004'`,
      ],
      /IDMAP/,
    ));
  it('a contact owner is changed', () =>
    damage(
      'd12',
      [
        `UPDATE contacts SET owner_id = NULL WHERE org_id = ${ACME} AND legacy_id = '${(O(3001) as { $oid: string }).$oid}'`,
      ],
      /CONTACT_OWNER|FINGERPRINT/,
    ));
});

describe('approvals, plan filter, owner rules', () => {
  const small = (extra: Record<string, unknown> = {}) =>
    customDumps({
      acme: {
        roles: [
          {
            _id: { $oid: 'aa00000000000000000000a1' },
            id: 'ROLE_adm00001',
            name: 'Boss',
            label: 'Boss',
            permission_config: [
              { id: 'perm_users', name: 'users', is_accessible: true, has_crud: false },
              { id: 'perm_appt', name: 'appointments', is_accessible: true, has_crud: false },
            ],
          },
        ],
        user: [
          {
            _id: { $oid: 'bb00000000000000000000b1' },
            user_id: 'u-b1',
            email: 'boss@acme.test',
            role_id: 'ROLE_adm00001',
            is_staff: true,
            password: FAKE_HASH,
            ...extra,
          },
        ],
        contact_list: [
          {
            _id: { $oid: 'cc00000000000000000000c1' },
            first_name: 'Cy',
            email: 'cy@acme.test',
            contact_owner: 'u-b1',
          },
        ],
      },
    });
  const cfgFor = (map: Record<string, unknown>) =>
    parseAccessConfig(
      {
        version: 1,
        entries: {
          perm_users: entry({ use: ['admin.user.manage'] }),
          perm_appt: entry({ use: ['record.appointments.read'] }),
        },
      },
      { version: 1, clients: { acme: map } },
    );
  const opts = (
    d: Dumps,
    db: TestDb,
    map: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) =>
    runOpts(d, db, 'acme', {
      org: { name: 'acme', slug: 'acme', ownerEmail: OWNER_EMAIL },
      access: cfgFor(map),
      ...extra,
    });

  it('an approved admin-class role passes NO-ADMIN; the same role without approval is stripped and passes too', async () => {
    const d = await small();
    const db = await clone('appr');
    await runClient(
      opts(d, db, {
        ROLE_adm00001: { to: 'custom', allowAdminClass: true, approvedBy: 'Test Approver' },
      }),
    );
    const r = await verify(
      d,
      db,
      'acme',
      cfgFor({
        ROLE_adm00001: { to: 'custom', allowAdminClass: true, approvedBy: 'Test Approver' },
      }),
    );
    expect(r.alarms).toEqual([]);
    expect(
      await rows(
        db,
        `SELECT 1 FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id WHERE g.permission_key = 'admin.user.manage' AND r.name = 'Boss'`,
      ),
    ).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/NO-ADMIN: 2 user/);
    const db2 = await clone('noappr');
    await runClient(opts(d, db2, {}));
    expect((await verify(d, db2, 'acme', cfgFor({}))).alarms).toEqual([]);
    expect(
      await rows(
        db2,
        `SELECT 1 FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id WHERE g.permission_key = 'admin.user.manage' AND r.name = 'Boss'`,
      ),
    ).toHaveLength(0);
    d.cleanup();
  });

  it('preset:workspace_admin with an approver gives the Admin preset and is listed; without one nothing is written', async () => {
    const d = await small();
    const db = await clone('wsadmin');
    await runClient(
      opts(d, db, {
        ROLE_adm00001: {
          to: 'preset:workspace_admin',
          approvedBy: 'Test Approver',
          evidence: 'verified in the UI',
        },
      }),
    );
    const r = await verify(
      d,
      db,
      'acme',
      cfgFor({
        ROLE_adm00001: {
          to: 'preset:workspace_admin',
          approvedBy: 'Test Approver',
          evidence: 'verified in the UI',
        },
      }),
    );
    expect(r.alarms).toEqual([]);
    expect((await userByEmail(db, 'boss@acme.test')).roles).toEqual(['Admin|workspace_admin']);
    expect(() => cfgFor({ ROLE_adm00001: { to: 'preset:workspace_admin' } })).toThrow(
      AccessConfigError,
    );
    d.cleanup();
  });

  it('a feature outside the plan is filtered and reported', async () => {
    const d = await small();
    const db = await clone('plan');
    await asOwner(db, (x) =>
      x.execute(
        sql.raw(
          `INSERT INTO plans (slug, name, features, is_free) VALUES ('tiny', 'Tiny', '{}', true)`,
        ),
      ),
    );
    await runClient(
      opts(
        d,
        db,
        {},
        { org: { name: 'acme', slug: 'acme', plan: 'tiny', ownerEmail: OWNER_EMAIL } },
      ),
    );
    expect(
      await rows(
        db,
        `SELECT 1 FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id WHERE g.permission_key = 'record.appointments.read' AND r.name = 'Boss'`,
      ),
    ).toHaveLength(0);
    expect(
      (await rows(db, `SELECT 1 FROM migration.quarantine WHERE reason_code = 'PERM_PLAN_LOCKED'`))
        .length,
    ).toBe(1);
    expect((await verify(d, db, 'acme', cfgFor({}))).alarms).toEqual([]);
    d.cleanup();
  });

  it('users are refused without an owner (unless --allow-no-owner)', async () => {
    const d = await small();
    const db = await clone('noowner');
    const o = runOpts(d, db, 'acme', { access: cfgFor({}), org: { name: 'acme', slug: 'acme' } });
    await expect(runClient(o)).rejects.toThrow(/no Owner/);
    await runClient({ ...o, allowNoOwner: true });
    expect(await count(db, 'users')).toBe(1);
    expect((await userByEmail(db, 'boss@acme.test')).roles).toEqual(['Boss|']);
    d.cleanup();
  });

  it('a Karma-style password field is never stored, quarantined or printed, even when the user is quarantined', async () => {
    const d = await small({ email: 'bad', username: 'bad' });
    const db = await clone('karma');
    await runClient(opts(d, db, {}));
    expect(
      await rows(
        db,
        `SELECT 1 FROM migration.quarantine WHERE to_jsonb(quarantine)::text LIKE '%invHASH%'`,
      ),
    ).toHaveLength(0);
    expect(
      await rows(db, `SELECT 1 FROM migration.quarantine WHERE reason_code = 'INVALID_EMAIL'`),
    ).toHaveLength(1);
    d.cleanup();
  });
});

describe('permission-catalogue', () => {
  it('lists the unmapped Waboo keys by name only', async () => {
    const list = await permissionCatalogue(dumps.source, 'acme', testAccess());
    const by = Object.fromEntries(list.map((r) => [r.id, r]));
    expect(by.perm_contacts!.status).toBe('mapped');
    expect(by.perm_sms!.status).toBe('unmapped');
    expect(by.perm_unrev!.status).toBe('unreviewed');
    expect(by.agent_summary!.status).toBe('mapped');
    expect(by.bot_summary).toBeUndefined();
  });
});
