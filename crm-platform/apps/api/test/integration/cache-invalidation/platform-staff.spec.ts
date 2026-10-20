import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { PlatformRbacService } from '../../../src/modules/roles-permissions/platform-rbac.service';
import { PlatformRbacStore } from '../../../src/modules/roles-permissions/platform-rbac.store';
import { PlatformRolesService } from '../../../src/modules/roles-permissions/platform-roles.service';
import { startTcpFaultProxy, type TcpFaultProxy } from '../../unit/network-failure/tcp-fault-proxy';
import { buildInstance, secondsUntil, sleep, startEnv, type Env, type Instance } from './harness';
import { record } from './results';

/**
 * Platform operators' permissions (R03, P0): `prbac:v<version>:op<id>` for 600 s, the version in `prbac:version` for 600 s. Real
 * PlatformRolesService writers on a real Postgres and a private Redis, read through the real PlatformRbacService of two instances.
 */
Logger.overrideLogger(false);
const stub = (o: object) => o as never;

describe('platform operator permissions (prbac) follow role changes', () => {
  let env: Env;
  let a: Instance;
  let reader: Instance;
  let rbacA: PlatformRbacService;
  let rbacB: PlatformRbacService;
  let roles: PlatformRolesService;
  const proxies: TcpFaultProxy[] = [];
  let n = 0;

  const asOperator = <T>(fn: () => Promise<T>) =>
    RequestContextStore.run(
      { requestId: 'op', orgId: 0, actorType: 'platform_operator', actorId: 1, userId: null },
      fn,
    );

  async function fixture() {
    const tag = `${Date.now().toString(36)}${n++}`;
    const q = async (sql: string, p: unknown[] = []) =>
      (await env.pg.owner.query(sql, p)).rows[0] as Record<string, string | number>;
    const op = await q(
      `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES ($1,'Op','x','support') RETURNING id`,
      [`op-${tag}@x.test`],
    );
    const p1 = await q(`INSERT INTO platform_permissions (name) VALUES ($1) RETURNING id, name`, [
      `ci.read.${tag}`,
    ]);
    const p2 = await q(`INSERT INTO platform_permissions (name) VALUES ($1) RETURNING id, name`, [
      `ci.write.${tag}`,
    ]);
    const role = await q(
      `INSERT INTO platform_roles (name) VALUES ($1) RETURNING id, uuid, row_version`,
      [`Role ${tag}`],
    );
    const other = await q(`INSERT INTO platform_roles (name) VALUES ($1) RETURNING id, uuid`, [
      `Other ${tag}`,
    ]);
    await env.pg.owner.query(`INSERT INTO platform_role_permissions VALUES ($1,$2), ($1,$3)`, [
      role.id,
      p1.id,
      p2.id,
    ]);
    await env.pg.owner.query(`INSERT INTO platform_operator_roles VALUES ($1,$2)`, [
      op.id,
      role.id,
    ]);
    return {
      op: Number(op.id),
      role: { id: Number(role.id), uuid: String(role.uuid), name: `Role ${tag}` },
      other: { id: Number(other.id), uuid: String(other.uuid) },
      read: String(p1.name),
      write: String(p2.name),
    };
  }
  const rv = async (id: number) =>
    Number(
      (await env.pg.owner.query(`SELECT row_version FROM platform_roles WHERE id=$1`, [id])).rows[0]
        .row_version,
    );

  beforeAll(async () => {
    env = await startEnv();
    a = buildInstance(env, 'A');
    reader = buildInstance(env, 'B');
    rbacA = new PlatformRbacService(new PlatformRbacStore(a.db), a.redis);
    rbacB = new PlatformRbacService(new PlatformRbacStore(reader.db), reader.redis);
    roles = new PlatformRolesService(
      new PlatformRbacStore(a.db),
      rbacA,
      stub({ record: async () => undefined }),
    );
  }, 240_000);
  afterAll(async () => {
    await a?.close();
    await reader?.close();
    for (const p of proxies) await p.close();
    await env?.stop();
  });

  it('role permissions edited (PlatformRolesService.update): the operator loses one at once, on both instances', async () => {
    const f = await fixture();
    expect((await rbacA.permissionsOf(f.op)).has(f.write)).toBe(true);
    expect((await rbacB.permissionsOf(f.op)).has(f.write)).toBe(true);
    await asOperator(async () =>
      roles.update(f.role.uuid, {
        name: f.role.name,
        description: '',
        permissions: [f.read],
        rowVersion: await rv(f.role.id),
      } as never),
    );
    expect((await rbacA.permissionsOf(f.op)).has(f.write)).toBe(false);
    expect((await rbacB.permissionsOf(f.op)).has(f.write)).toBe(false);
    expect((await rbacB.permissionsOf(f.op)).has(f.read)).toBe(true);
  });

  it('operators moved to another role (PlatformRolesService.reassign) and role deleted (remove): seen at once on both instances', async () => {
    const f = await fixture();
    await env.pg.owner.query(
      `INSERT INTO platform_role_permissions SELECT $1, id FROM platform_permissions WHERE name = $2`,
      [f.other.id, f.read],
    );
    expect((await rbacB.permissionsOf(f.op)).has(f.write)).toBe(true);
    await asOperator(() => roles.reassign(f.role.uuid, { targetRoleId: f.other.uuid }));
    expect((await rbacA.permissionsOf(f.op)).has(f.write)).toBe(false);
    expect((await rbacB.permissionsOf(f.op)).has(f.read)).toBe(true);
    await asOperator(() => roles.remove(f.other.uuid));
    expect((await rbacB.permissionsOf(f.op)).has(f.read)).toBe(false);
  });

  it('a reader that read the OLD version from Postgres cannot put it back after the change (defect D6: it stayed for the full 600 s)', async () => {
    const f = await fixture();
    await env.admin.del('prbac:version');
    expect((await rbacA.permissionsOf(f.op)).has(f.write)).toBe(true); // fills prbac:v<N>:op<id> with the OLD permissions
    await env.admin.del('prbac:version'); // the cached version expires
    // the slow reader: reads the version from Postgres, then stalls before caching it
    const store = new PlatformRbacStore(reader.db);
    let release!: () => void;
    const held = new Promise<void>((ok) => (release = ok));
    const origTx = store.tx.bind(store);
    store.tx = (async (fn: never) => {
      const r = await origTx(fn);
      await held;
      return r;
    }) as typeof store.tx;
    const slow = new PlatformRbacService(store, reader.redis).permissionsOf(f.op);
    await sleep(300);
    await asOperator(async () =>
      roles.update(f.role.uuid, {
        name: f.role.name,
        description: '',
        permissions: [f.read],
        rowVersion: await rv(f.role.id),
      } as never),
    ); // commit + bump + drop the cached version
    release();
    await slow;
    expect((await rbacA.permissionsOf(f.op)).has(f.write)).toBe(false);
    expect((await rbacB.permissionsOf(f.op)).has(f.write)).toBe(false);
  });

  it('the cached version cannot be dropped (Redis unreachable for the writer): the old permissions die with the 600 s version TTL, read from Redis', async () => {
    const f = await fixture();
    const proxy = await startTcpFaultProxy({ host: env.redis.host, port: env.redis.port });
    proxies.push(proxy);
    const w = buildInstance(env, 'W', `redis://127.0.0.1:${proxy.port}`);
    try {
      const wRoles = new PlatformRolesService(
        new PlatformRbacStore(w.db),
        new PlatformRbacService(new PlatformRbacStore(w.db), w.redis),
        stub({ record: async () => undefined }),
      );
      expect((await rbacA.permissionsOf(f.op)).has(f.write)).toBe(true); // fills prbac:version (600 s)
      const ttl = await env.admin.ttl('prbac:version');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
      await proxy.setMode('refuse');
      await asOperator(async () =>
        wRoles.update(f.role.uuid, {
          name: f.role.name,
          description: '',
          permissions: [f.read],
          rowVersion: await rv(f.role.id),
        } as never),
      );
      expect((await rbacA.permissionsOf(f.op)).has(f.write)).toBe(true); // stale: nobody could drop the version
      await env.admin.expire('prbac:version', 1); // moves the 600 s clock on; the bound is the TTL read above
      const s = await secondsUntil(
        async () => (await rbacA.permissionsOf(f.op)).has(f.write),
        false,
        5,
        100,
      );
      expect(s).toBeLessThan(3);
      record('R03 platform operator permissions, invalidation lost', {
        boundSeconds: ttl,
        how: 'TTL read from Redis, expiry brought forward with EXPIRE',
      });
    } finally {
      await w.close();
    }
  }, 60_000);
});
