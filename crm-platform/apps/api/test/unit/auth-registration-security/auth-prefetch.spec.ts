import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PREFETCH_FAILED, takeAuthPrefetch } from '../../../src/common/context/auth-prefetch';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { RbacService } from '../../../src/kernel/rbac/rbac.service';
import { JwtAuthGuard } from '../../../src/modules/auth/guards/jwt-auth.guard';
import { AccountGateService } from '../../../src/modules/auth/security/account-gate.service';
import { OrgSuspensionService } from '../../../src/modules/auth/security/org-suspension.service';
import { AuthKeys } from '../../../src/modules/auth/support/redis-keys';
import type { TokenClaims } from '../../../src/modules/auth/token.service';

/**
 * JwtAuthGuard sends the Redis reads the account gate and the permission check will want together with its own session read, and
 * those services take the answers instead of asking again. These tests pin who gets a prefetch, that it is consumed once and only
 * for the same org and user, that a failed or missing answer falls back to the service's own path, and that it never changes a
 * verdict of the guard that started it.
 */
const staff: TokenClaims = { sub: 5, org: 7, typ: 'user', uid: 'owner', sid: 'sess-1', ep: 4 };

const baseCtx = (over: Partial<RequestContext> = {}) =>
  ({
    requestId: 'r',
    orgId: 0,
    actorType: 'system',
    actorId: null,
    userId: null,
    ...over,
  }) as RequestContext;
const inRequest = <T>(fn: (ctx: RequestContext) => Promise<T>, ctx = baseCtx()) =>
  RequestContextStore.run(ctx, () => fn(RequestContextStore.require()));

function buildGuard(
  claims: TokenClaims,
  opts: {
    get?: ReturnType<typeof vi.fn>;
    mget?: ReturnType<typeof vi.fn>;
    withRbac?: boolean;
  } = {},
) {
  const redis = {
    mget: opts.mget ?? vi.fn().mockResolvedValue([null, null, null]),
    get: opts.get ?? vi.fn().mockResolvedValue(null),
  };
  const rbac = { startCachedRead: vi.fn().mockResolvedValue({ version: 3, grants: null }) };
  const guard = new JwtAuthGuard(
    new Reflector(),
    { verifyAccess: async () => claims } as never,
    { current: async () => 4 } as never,
    { policy: async () => ({ sessionTimeoutMinutes: 30, maxConcurrentSessions: 1 }) } as never,
    {
      touchActivity: vi.fn(),
      expireIdle: vi.fn(),
      tombstone: vi.fn(),
      isRevocationPending: vi.fn().mockReturnValue(false),
      enforceCapIfChanged: vi.fn(),
    } as never,
    { enforceCapIfChanged: vi.fn() } as never,
    { assertOpen: vi.fn() } as never,
    redis as never,
    { assertActive: vi.fn() } as never,
    undefined,
    opts.withRbac === false ? undefined : (rbac as never),
  );
  const http = {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ header: () => 'Bearer t' }) }),
  } as unknown as ExecutionContext;
  return { guard, http, redis, rbac };
}

describe('JwtAuthGuard starts the prefetch', () => {
  it('for a workspace member: the org, gate and grants reads go out before the session read', async () => {
    const { guard, http, redis, rbac } = buildGuard(staff);
    await inRequest(async (ctx) => {
      await guard.canActivate(http);
      expect(redis.get).toHaveBeenCalledWith(AuthKeys.orgSuspended(7));
      expect(redis.get).toHaveBeenCalledWith(AuthKeys.gate(7, 5));
      expect(rbac.startCachedRead).toHaveBeenCalledWith(7, 5);
      expect(ctx.prefetch).toMatchObject({ orgId: 7, userId: 5 });
      const firstGet = Math.min(...redis.get.mock.invocationCallOrder);
      expect(firstGet).toBeLessThan(redis.mget.mock.invocationCallOrder[0]!);
    });
  });

  it('not for a partner agent, an operator or an act-as session', async () => {
    for (const claims of [
      { sub: 9, org: 3, typ: 'partner_agent', uid: 'a', ep: 4 } as TokenClaims,
      { sub: 1, org: 0, typ: 'platform_operator', uid: 'o', sid: 's', ep: 4 } as TokenClaims,
      { ...staff, imp: { sid: 'sess-1' } } as unknown as TokenClaims,
    ]) {
      const { guard, http, redis } = buildGuard(claims);
      await inRequest(async (ctx) => {
        await guard.canActivate(http).catch(() => undefined);
        expect(redis.get).not.toHaveBeenCalled();
        expect(ctx.prefetch).toBeUndefined();
      });
    }
  });

  it('a read that fails becomes the failed marker, never an unhandled rejection', async () => {
    const { guard, http } = buildGuard(staff, {
      get: vi.fn().mockRejectedValue(new Error('down')),
    });
    await inRequest(async (ctx) => {
      await guard.canActivate(http);
      expect(await ctx.prefetch!.orgSuspended).toBe(PREFETCH_FAILED);
      expect(await ctx.prefetch!.gate).toBe(PREFETCH_FAILED);
    });
  });

  it('still refuses a revoked session: the prefetch decides nothing', async () => {
    const { guard, http } = buildGuard(staff, {
      mget: vi.fn().mockResolvedValue(['1', null, null]),
    });
    await inRequest(async () => {
      await expect(guard.canActivate(http)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });

  it('works without the RBAC service and with a redis double that has no get()', async () => {
    const a = buildGuard(staff, { withRbac: false });
    await inRequest(async (ctx) => {
      await a.guard.canActivate(a.http);
      expect(ctx.prefetch!.grants).toBeUndefined();
    });
    const b = buildGuard(staff);
    delete (b.redis as { get?: unknown }).get;
    await inRequest(async (ctx) => {
      await expect(b.guard.canActivate(b.http)).resolves.toBe(true);
      expect(ctx.prefetch).toBeUndefined();
    });
  });
});

describe('takeAuthPrefetch', () => {
  const withPrefetch = () =>
    baseCtx({
      prefetch: {
        orgId: 7,
        userId: 5,
        orgSuspended: Promise.resolve('0'),
        gate: Promise.resolve('{}'),
      },
    });

  it('hands over a matching read once', async () => {
    await inRequest(async () => {
      expect(await takeAuthPrefetch('orgSuspended', 7)).toBe('0');
      expect(takeAuthPrefetch('orgSuspended', 7)).toBeUndefined();
    }, withPrefetch());
  });

  it('refuses another org, another user, and a request with none', async () => {
    await inRequest(async () => {
      expect(takeAuthPrefetch('orgSuspended', 8)).toBeUndefined();
      expect(takeAuthPrefetch('gate', 7, 6)).toBeUndefined();
      expect(await takeAuthPrefetch('gate', 7, 5)).toBe('{}');
    }, withPrefetch());
    expect(takeAuthPrefetch('gate', 7, 5)).toBeUndefined(); // outside any request
  });
});

describe('the services take the prefetched answer, or fall back to their own read', () => {
  const orgsWith = (early: Promise<string | null | symbol> | undefined, live: string | null) => {
    const redis = { get: vi.fn().mockResolvedValue(live), setex: vi.fn().mockResolvedValue('OK') };
    const db = {
      txAs: vi.fn(async (_t: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [{ status: 'active' }] }) }),
      ),
    };
    const svc = new OrgSuspensionService(db as never, redis as never);
    const ctx = baseCtx({ prefetch: { orgId: 7, userId: 5, orgSuspended: early } });
    return { svc, redis, db, ctx };
  };

  it('workspace suspension: uses the prefetched value and does not read again', async () => {
    const { svc, redis, ctx } = orgsWith(Promise.resolve('1'), null);
    await inRequest(async () => expect(await svc.isSuspended(7)).toBe(true), ctx);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('workspace suspension: a prefetched miss goes to the database, not to a second Redis read', async () => {
    const { svc, redis, db, ctx } = orgsWith(Promise.resolve(null), '1');
    await inRequest(async () => expect(await svc.isSuspended(7)).toBe(false), ctx);
    expect(redis.get).not.toHaveBeenCalled();
    expect(db.txAs).toHaveBeenCalledTimes(1);
  });

  it('workspace suspension: a failed prefetch is replaced by a fresh read', async () => {
    const { svc, redis, ctx } = orgsWith(Promise.resolve(PREFETCH_FAILED), '1');
    await inRequest(async () => expect(await svc.isSuspended(7)).toBe(true), ctx);
    expect(redis.get).toHaveBeenCalledTimes(1);
  });

  it('workspace suspension: another org never uses the request’s prefetch', async () => {
    const { svc, redis, ctx } = orgsWith(Promise.resolve('1'), '0');
    await inRequest(async () => expect(await svc.isSuspended(8)).toBe(false), ctx);
    expect(redis.get).toHaveBeenCalledTimes(1);
  });

  const state = {
    suspended: false,
    emailUnverified: false,
    emailBlocking: false,
    mfaEnrolmentRequired: false,
    passwordChangeRequired: false,
    mfaEnabled: false,
    isAdmin: false,
    isOwner: true,
  };

  it('account gate: uses the prefetched state, and reads again after a failed prefetch', async () => {
    const redis = { get: vi.fn().mockResolvedValue(JSON.stringify(state)), setex: vi.fn() };
    const svc = new AccountGateService({} as never, {} as never, redis as never, {} as never);
    await inRequest(
      async () => expect(await svc.stateFor(7, 5, { includeOrgSuspension: false })).toEqual(state),
      baseCtx({
        prefetch: { orgId: 7, userId: 5, gate: Promise.resolve(JSON.stringify(state)) },
      }),
    );
    expect(redis.get).not.toHaveBeenCalled();
    await inRequest(
      async () => expect(await svc.stateFor(7, 5, { includeOrgSuspension: false })).toEqual(state),
      baseCtx({ prefetch: { orgId: 7, userId: 5, gate: Promise.resolve(PREFETCH_FAILED) } }),
    );
    expect(redis.get).toHaveBeenCalledTimes(1);
  });

  it('roles: uses the prefetched cached read, and does the original read when there is none', async () => {
    const grants = JSON.stringify({ 'record.contacts.read': { effect: 'allow', scope: 'all' } });
    const redis = {
      eval: vi.fn().mockResolvedValue(['3', grants]),
      get: vi.fn(),
      setex: vi.fn(),
    };
    const svc = new RbacService({} as never, redis as never);
    const got = await inRequest(
      () => svc.grantsForUser(7, 5),
      baseCtx({
        prefetch: { orgId: 7, userId: 5, grants: Promise.resolve({ version: 3, grants }) },
      }),
    );
    expect(svc.can(got, 'record.contacts.read').allowed).toBe(true);
    expect(redis.eval).not.toHaveBeenCalled();
    await inRequest(() => svc.grantsForUser(7, 5));
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('roles: a prefetched miss takes the original path without a second script call', async () => {
    const redis = {
      eval: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue('OK'),
    };
    const db = {
      privileged: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [{ roles_version: 4 }] }) }),
      ),
      txAs: vi.fn(async (_t: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [] }) }),
      ),
    };
    const svc = new RbacService(db as never, redis as never);
    await inRequest(
      () => svc.grantsForUser(7, 5),
      baseCtx({ prefetch: { orgId: 7, userId: 5, grants: Promise.resolve(null) } }),
    );
    // eval is only the raise-version script now (rolesVersion), never the combined read
    expect(redis.eval.mock.calls.every((c) => String(c[0]).includes('tonumber'))).toBe(true);
    expect(db.privileged).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledWith('rbac:7:v4:u5', 600, expect.any(String));
  });
});
