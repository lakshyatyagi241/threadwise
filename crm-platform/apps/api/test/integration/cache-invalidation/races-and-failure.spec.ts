import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { UsersRepository } from '../../../src/modules/admin/users/users.repository';
import { UsersService } from '../../../src/modules/admin/users/users.service';
import { SessionService } from '../../../src/modules/auth/sessions/session.service';
import { startTcpFaultProxy, type TcpFaultProxy } from '../../unit/network-failure/tcp-fault-proxy';
import { spawnInstance, type RemoteInstance } from './cross-process';
import { buildInstance, secondsUntil, sleep, startEnv, type Env, type Instance } from './harness';
import { record } from './results';

/**
 * Races and failures around invalidation (item #66, part 4), on a real Postgres and a private Redis:
 *  (a) a reader that computed the OLD value before the write caches it AFTER the writer invalidated (set-after-invalidate),
 *  (b) the invalidation itself is lost (Redis unreachable for the writer): the old value must die with its TTL, never later,
 *  (c) 50 parallel readers during one write: nobody who starts reading after the write returned sees the old value.
 */
Logger.overrideLogger(false);
const stub = (o: object) => o as never;
// The rank/last-owner rules are not under test; every one of them passes and withDenialAudit just runs the action.
const rules = new Proxy(
  {},
  { get: (_t, p) => (p === 'withDenialAudit' ? (_a: string, run: () => unknown) => run() : async () => undefined) },
) as never;

describe('invalidation under races and failure', () => {
  let env: Env;
  let a: Instance;
  let b: RemoteInstance;
  const proxies: TcpFaultProxy[] = [];
  const extra: Instance[] = [];
  let n = 0;

  async function ws() {
    const tag = `${Date.now().toString(36)}${n++}`;
    const orgId = Number(
      (await env.pg.owner.query(`INSERT INTO organizations (slug,name,plan) VALUES ($1,$1,'starter') RETURNING id`, [`rf-${tag}`])).rows[0].id,
    );
    const mk = async (name: string) => {
      const u = (await env.pg.owner.query(
        `INSERT INTO users (org_id,email,full_name,password_hash) VALUES ($1,$2,$3,'x') RETURNING id, uuid`,
        [orgId, `${name}-${tag}@rf.test`, name],
      )).rows[0];
      await env.pg.owner.query(`INSERT INTO user_security (org_id,user_id,email_verified_at) VALUES ($1,$2,now())`, [orgId, u.id]);
      return { id: Number(u.id), uuid: String(u.uuid) };
    };
    const actor = await mk('actor');
    const target = await mk('target');
    const as = <T>(fn: () => Promise<T>) =>
      RequestContextStore.run({ requestId: tag, orgId, actorType: 'user', actorId: actor.id, userId: actor.id }, fn);
    return { orgId, actor, target, as };
  }
  const suspendTarget = async (w: Awaited<ReturnType<typeof ws>>, svc: UsersService) => {
    const rv = Number((await env.pg.owner.query(`SELECT row_version FROM users WHERE id=$1 AND org_id=$2`, [w.target.id, w.orgId])).rows[0].row_version);
    await w.as(() => svc.update(w.target.uuid, { status: 'inactive', rowVersion: rv }));
  };
  const usersFor = (inst: Instance) =>
    new UsersService(
      inst.db,
      new UsersRepository(),
      stub({ emit: async () => undefined }),
      stub({ record: async () => undefined }),
      inst.rbac,
      stub({}),
      rules,
      stub({ revokeAllForUser: async () => undefined, tombstone: async () => undefined }),
      inst.gates,
    );
  /** Makes every transaction of `inst` hold its answer until `release()`: the reader has READ, but has not yet cached. */
  function holdReads(inst: Instance) {
    let release!: () => void;
    const held = new Promise<void>((ok) => (release = ok));
    const orig = inst.db.txAs.bind(inst.db);
    inst.db.txAs = (async (...args: Parameters<typeof orig>) => {
      const r = await orig(...args);
      await held;
      return r;
    }) as typeof inst.db.txAs;
    return {
      release: () => {
        release();
        inst.db.txAs = orig;
      },
    };
  }

  beforeAll(async () => {
    env = await startEnv();
    a = buildInstance(env, 'A');
    b = await spawnInstance(env, 'B');
  }, 240_000);
  afterAll(async () => {
    b?.kill();
    await a?.close();
    for (const e of extra) await e.close();
    for (const p of proxies) await p.close();
    await env?.stop();
  });

  describe('(a) set-after-invalidate: a slow reader caches the old value after the writer invalidated', () => {
    it('account gate: the slow reader must not leave the old state in Redis (defect D4: it stayed for the full 30 s)', async () => {
      const w = await ws();
      const reader = buildInstance(env, 'R');
      extra.push(reader);
      const hold = holdReads(reader);
      const slow = reader.gates.stateFor(w.orgId, w.target.id, { includeOrgSuspension: false }); // reads "active", then waits
      await sleep(300);
      await suspendTarget(w, usersFor(a)); // commit + gates.invalidate (DEL) while the reader is still waiting
      hold.release();
      expect((await slow).suspended).toBe(false); // that one request legitimately saw the old state
      // Everyone after it must see the truth, at once:
      expect((await a.gates.stateFor(w.orgId, w.target.id, { includeOrgSuspension: false })).suspended).toBe(true);
      expect((await b.call<{ suspended: boolean }>('gate.state', w.orgId, w.target.id)).suspended).toBe(true);
    });

    it('RBAC: a reader that loaded the old roles version cannot put it back over the new one (Lua raise-only)', async () => {
      const w = await ws();
      const reader = buildInstance(env, 'R2');
      extra.push(reader);
      await env.admin.del(`rbac:version:${w.orgId}`);
      const origPriv = reader.db.privileged.bind(reader.db);
      let release!: () => void;
      const held = new Promise<void>((ok) => (release = ok));
      reader.db.privileged = (async (...args: Parameters<typeof origPriv>) => {
        const r = await origPriv(...args);
        await held; // the reader has read version 1 from Postgres and is about to cache it
        return r;
      }) as typeof reader.db.privileged;
      const slow = reader.rbac.grantsForUser(w.orgId, w.target.id);
      await sleep(300);
      await a.rbac.bumpRolesVersion(w.orgId); // version 2 is now in Postgres and Redis
      release();
      await slow;
      expect(await env.admin.get(`rbac:version:${w.orgId}`)).toBe('2');
    });

    it('workspace suspension: the 1.5 s re-check removes an old verdict cached shortly after the invalidation', async () => {
      const w = await ws();
      const reader = buildInstance(env, 'R3');
      extra.push(reader);
      const hold = holdReads(reader);
      const slow = reader.orgs.isSuspended(w.orgId); // reads "active"
      await sleep(300);
      await env.pg.owner.query(`UPDATE organizations SET status='suspended' WHERE id=$1`, [w.orgId]);
      await a.orgs.invalidate(w.orgId); // DEL now, DEL again in 1.5 s
      hold.release();
      expect(await slow).toBe(false);
      expect(await env.admin.get(`auth:org-susp:${w.orgId}`)).toBe('0'); // the old verdict was re-cached by the slow reader
      const s = await secondsUntil(() => a.orgs.isSuspended(w.orgId), true, 8, 50);
      expect(s).toBeLessThanOrEqual(1.8);
      record('R05 set-after-invalidate (reader 0.3 s late)', { measuredStaleSeconds: s, documentedSeconds: 5 });
    });
  });

  describe('(b) the invalidation is lost (writer cannot reach Redis): the old value lives at most as long as its TTL', () => {
    async function writerBehind(mode: 'refuse') {
      const proxy = await startTcpFaultProxy({ host: env.redis.host, port: env.redis.port });
      proxies.push(proxy);
      const w = buildInstance(env, 'W', `redis://127.0.0.1:${proxy.port}`);
      extra.push(w);
      return { proxy, w, cut: () => proxy.setMode(mode) };
    }

    it('account gate: DEL lost -> fresh within 30 s, measured', async () => {
      const w = await ws();
      const { w: writer, cut } = await writerBehind('refuse');
      expect((await a.gates.stateFor(w.orgId, w.target.id, { includeOrgSuspension: false })).suspended).toBe(false);
      await cut();
      await suspendTarget(w, usersFor(writer)); // the Postgres write lands; the DEL is swallowed
      const s = await secondsUntil(async () => (await a.gates.stateFor(w.orgId, w.target.id, { includeOrgSuspension: false })).suspended, true, 40, 250);
      expect(s).toBeLessThanOrEqual(30.5);
      record('R04 account gate, invalidation lost', { measuredStaleSeconds: s, documentedSeconds: 30 });
    }, 90_000);

    it('workspace suspension: DEL lost -> fresh within 5 s, measured', async () => {
      const w = await ws();
      const { w: writer, cut } = await writerBehind('refuse');
      expect(await a.orgs.isSuspended(w.orgId)).toBe(false);
      await cut();
      await env.pg.owner.query(`UPDATE organizations SET status='suspended' WHERE id=$1`, [w.orgId]);
      await writer.orgs.invalidate(w.orgId); // swallowed
      const s = await secondsUntil(() => a.orgs.isSuspended(w.orgId), true, 9, 100);
      expect(s).toBeLessThanOrEqual(5.5);
      record('R05 workspace suspension, invalidation lost', { measuredStaleSeconds: s, documentedSeconds: 5 });
    }, 60_000);

    it('RBAC: neither the DEL nor the new version can be written -> the change is reported as failed, and the old version carries a TTL of at most 600 s', async () => {
      const w = await ws();
      const { w: writer, cut } = await writerBehind('refuse');
      await a.rbac.grantsForUser(w.orgId, w.target.id); // fills rbac:version:<org> with its TTL
      const ttl = await env.admin.ttl(`rbac:version:${w.orgId}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
      await cut();
      await expect(writer.rbac.bumpRolesVersion(w.orgId)).rejects.toThrow(/permission cache could not be refreshed/);
      // Postgres moved on, Redis did not: the stale version dies with its TTL. Time is moved on by shortening that one TTL.
      expect(await env.admin.get(`rbac:version:${w.orgId}`)).toBe('1');
      await env.admin.expire(`rbac:version:${w.orgId}`, 1);
      const s = await secondsUntil(async () => Number((await env.pg.owner.query(`SELECT roles_version FROM organizations WHERE id=$1`, [w.orgId])).rows[0].roles_version) === 2 && (await a.rbac.grantsForUser(w.orgId, w.target.id), await env.admin.get(`rbac:version:${w.orgId}`)), '2', 5, 100);
      expect(s).toBeLessThan(3);
      record('R02 RBAC version, invalidation lost', { boundSeconds: ttl, how: 'TTL read from Redis, expiry brought forward with EXPIRE (a full 600 s run is in the slow spec)' });
    }, 60_000);
  });

  describe('(c) 50 parallel readers during one write', () => {
    async function storm(
      read: (i: number) => Promise<boolean>, // true = sees the NEW value
      write: () => Promise<void>,
    ) {
      let stop = false;
      let wrote = Infinity; // time the write call returned
      const late: string[] = [];
      let reads = 0;
      const readers = Array.from({ length: 50 }, (_, i) =>
        (async () => {
          while (!stop) {
            const start = performance.now();
            const fresh = await read(i);
            reads++;
            if (start > wrote && !fresh) late.push(`reader ${i} started ${(start - wrote).toFixed(0)} ms after the write returned and saw the old value`);
          }
        })(),
      );
      await sleep(400);
      await write();
      wrote = performance.now();
      await sleep(1_200);
      stop = true;
      await Promise.all(readers);
      return { late, reads };
    }

    it('account gate: no reader that starts after the suspension returned sees the account as active', async () => {
      const w = await ws();
      const other = buildInstance(env, 'S');
      extra.push(other);
      const svc = usersFor(a);
      const { late, reads } = await storm(
        async (i) => (await (i % 2 ? a : other).gates.stateFor(w.orgId, w.target.id, { includeOrgSuspension: false })).suspended,
        () => suspendTarget(w, svc),
      );
      expect(reads).toBeGreaterThan(200);
      expect(late).toEqual([]);
      record('R04 account gate, 50 parallel readers', { reads, readersSeeingOldValueAfterWrite: late.length });
    }, 60_000);

    it('RBAC: no reader that starts after a role change returned sees the old grants', async () => {
      const w = await ws();
      const perm = String((await env.pg.owner.query(`SELECT key FROM permission_defs ORDER BY key LIMIT 1`)).rows[0].key);
      const role = Number((await env.pg.owner.query(`INSERT INTO roles (org_id,name) VALUES ($1,'R') RETURNING id`, [w.orgId])).rows[0].id);
      await env.pg.owner.query(`INSERT INTO role_grants (org_id,role_id,permission_key,effect,record_scope) VALUES ($1,$2,$3,'allow','all')`, [w.orgId, role, perm]);
      await env.pg.owner.query(`INSERT INTO user_roles VALUES ($1,$2,$3)`, [w.orgId, w.target.id, role]);
      const other = buildInstance(env, 'S2');
      extra.push(other);
      const { late, reads } = await storm(
        async (i) => !(await (i % 2 ? a : other).rbac.grantsForUser(w.orgId, w.target.id)).has(perm),
        async () => {
          await env.pg.owner.query(`DELETE FROM role_grants WHERE org_id=$1 AND role_id=$2`, [w.orgId, role]);
          await a.rbac.bumpRolesVersion(w.orgId); // what RolesService.update does after commit
        },
      );
      expect(reads).toBeGreaterThan(200);
      expect(late).toEqual([]);
      record('R01/R02 RBAC, 50 parallel readers', { reads, readersSeeingOldValueAfterWrite: late.length });
    }, 60_000);

    it('workspace suspension: no reader that starts after invalidate() returned sees the workspace as active', async () => {
      const w = await ws();
      const { late, reads } = await storm(
        (i) => (i % 2 ? a : a).orgs.isSuspended(w.orgId),
        async () => {
          await env.pg.owner.query(`UPDATE organizations SET status='suspended' WHERE id=$1`, [w.orgId]);
          await a.orgs.invalidate(w.orgId);
        },
      );
      expect(reads).toBeGreaterThan(200);
      expect(late).toEqual([]);
      record('R05 workspace suspension, 50 parallel readers', { reads, readersSeeingOldValueAfterWrite: late.length });
    }, 60_000);
  });

  describe('session revocation across two processes (R09/M07)', () => {
    const sessionsOn = (inst: Instance) => new SessionService(inst.db, stub({}), inst.policy, inst.epoch, stub({}), inst.redis);
    async function liveSession(w: Awaited<ReturnType<typeof ws>>) {
      const r = await env.pg.owner.query(
        `INSERT INTO auth_sessions (org_id,user_id,expires_at) VALUES ($1,$2, now() + interval '1 day') RETURNING uuid`,
        [w.orgId, w.target.id],
      );
      return String(r.rows[0].uuid);
    }
    const revokedOnB = (sid: string) => b.call<number>('redis.exists', `auth:rev:${sid}`).then((x) => x === 1);

    it('revokeAllForUser on A: the tombstone is in Redis before the call returns, with a TTL of at most 16 minutes; B refuses the token at once', async () => {
      const w = await ws();
      const sid = await liveSession(w);
      expect(await revokedOnB(sid)).toBe(false);
      expect(await sessionsOn(a).revokeAllForUser(w.orgId, w.target.id, 'test')).toBe(1);
      expect(await revokedOnB(sid)).toBe(true);
      const ttl = await env.admin.ttl(`auth:rev:${sid}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(16 * 60);
    });

    it('the tombstone cannot be written (Redis unreachable for A): A refuses the token itself, B does after A retries, within about 6 s of Redis returning', async () => {
      const w = await ws();
      const sid = await liveSession(w);
      const proxy = await startTcpFaultProxy({ host: env.redis.host, port: env.redis.port });
      proxies.push(proxy);
      const writer = buildInstance(env, 'W2', `redis://127.0.0.1:${proxy.port}`);
      extra.push(writer);
      const svc = sessionsOn(writer);
      await proxy.setMode('refuse');
      await svc.revokeAllForUser(w.orgId, w.target.id, 'test');
      expect(svc.isRevocationPending(sid)).toBe(true); // this process refuses the token from memory
      expect(await revokedOnB(sid)).toBe(false); // the other process cannot know yet
      await proxy.setMode('pass');
      const s = await secondsUntil(() => revokedOnB(sid), true, 15, 100);
      expect(s).toBeLessThanOrEqual(6.5);
      record('R09 session tombstone, write lost', { measuredSecondsAfterRedisBack: s, retryEverySeconds: 5, accessTokenLifeSeconds: 900 });
    }, 60_000);
  });
});
