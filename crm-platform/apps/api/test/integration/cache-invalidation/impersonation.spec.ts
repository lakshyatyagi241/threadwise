import { Logger } from '@nestjs/common';
import { IMPERSONATION_MAX_MINUTES } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImpersonationService } from '../../../src/modules/auth/platform/impersonation.service';
import { PlatformStore } from '../../../src/modules/auth/platform/platform-store';
import { startTcpFaultProxy, type TcpFaultProxy } from '../../unit/network-failure/tcp-fault-proxy';
import { buildInstance, secondsUntil, startEnv, type Env, type Instance } from './harness';
import { record } from './results';

/**
 * Act-as sessions (R10 tombstone, M05 five-second "still open" copy): an operator ends a session on instance A; the token must stop
 * working on instance B at once (tombstone) or, if the tombstone could not be written, within the 5 s copy.
 */
Logger.overrideLogger(false);
const stub = (o: object) => o as never;

describe('impersonation session end is seen by every instance', () => {
  let env: Env;
  let a: Instance;
  let b: Instance;
  let svcA: ImpersonationService;
  let svcB: ImpersonationService;
  const proxies: TcpFaultProxy[] = [];
  const extra: Instance[] = [];
  let n = 0;

  const make = (inst: Instance) =>
    new ImpersonationService(
      new PlatformStore(inst.db),
      stub({}),
      stub({ record: async () => undefined }),
      inst.epoch,
      stub({ get: () => 'http://localhost:3000' }),
      inst.redis,
    );

  async function session() {
    const tag = `${Date.now().toString(36)}${n++}`;
    const orgId = Number(
      (
        await env.pg.owner.query(
          `INSERT INTO organizations (slug,name) VALUES ($1,$1) RETURNING id`,
          [`im-${tag}`],
        )
      ).rows[0].id,
    );
    const userId = Number(
      (
        await env.pg.owner.query(
          `INSERT INTO users (org_id,email,full_name) VALUES ($1,$2,'T') RETURNING id`,
          [orgId, `t-${tag}@x.test`],
        )
      ).rows[0].id,
    );
    const op = Number(
      (
        await env.pg.owner.query(
          `INSERT INTO platform_operators (email,full_name,password_hash,role) VALUES ($1,'O','x','super_admin') RETURNING id`,
          [`o-${tag}@x.test`],
        )
      ).rows[0].id,
    );
    const uuid = String(
      (
        await env.pg.owner.query(
          `INSERT INTO impersonation_sessions (target_workspace_id, reason, operator_id, target_user_id, expires_at, handoff_expires_at)
       VALUES ($1,'cache invalidation test session for item 66',$2,$3, now() + interval '30 minutes', now() + interval '1 minute') RETURNING uuid`,
          [orgId, op, userId],
        )
      ).rows[0].uuid,
    );
    const claims = {
      org: orgId,
      sub: userId,
      imp: { sid: uuid, oid: op, ro: false, exp: Math.floor(Date.now() / 1000) + 1800 },
    };
    return { uuid, claims: claims as never };
  }
  const open = (svc: ImpersonationService, claims: never) =>
    svc.assertOpen(claims).then(
      () => true,
      () => false,
    );

  beforeAll(async () => {
    env = await startEnv();
    a = buildInstance(env, 'A');
    b = buildInstance(env, 'B');
    svcA = make(a);
    svcB = make(b);
  }, 240_000);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    for (const e of extra) await e.close();
    for (const p of proxies) await p.close();
    await env?.stop();
  });

  it('ended on A (close): the token is refused on B at once, and the tombstone outlives the longest session by 5 minutes only', async () => {
    const s = await session();
    expect(await open(svcA, s.claims)).toBe(true);
    expect(await open(svcB, s.claims)).toBe(true); // B now holds a 5 s "open" copy
    await svcA.close(s.uuid, 'operator');
    expect(await open(svcA, s.claims)).toBe(false);
    expect(await open(svcB, s.claims)).toBe(false);
    const ttl = await env.admin.ttl(`auth:imp-end:${s.uuid}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual((IMPERSONATION_MAX_MINUTES + 5) * 60);
  });

  it('the tombstone cannot be written (Redis unreachable for A): B refuses the token within the 5 s copy, measured', async () => {
    const s = await session();
    const proxy = await startTcpFaultProxy({ host: env.redis.host, port: env.redis.port });
    proxies.push(proxy);
    const w = buildInstance(env, 'W', `redis://127.0.0.1:${proxy.port}`);
    extra.push(w);
    expect(await open(svcB, s.claims)).toBe(true);
    await proxy.setMode('refuse');
    await make(w).close(s.uuid, 'operator');
    expect(await env.admin.exists(`auth:imp-end:${s.uuid}`)).toBe(0);
    const sec = await secondsUntil(() => open(svcB, s.claims), false, 8, 100);
    expect(sec).toBeLessThanOrEqual(5.5);
    record('R10/M05 impersonation end, tombstone lost', {
      measuredStaleSeconds: sec,
      documentedSeconds: 5,
    });
  }, 40_000);
});
