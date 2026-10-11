import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { JwtAuthGuard } from '../../../src/modules/auth/guards/jwt-auth.guard';
import type { TokenClaims } from '../../../src/modules/auth/token.service';

const saved = { mode: process.env.AUTH_REDIS_FAILURE_MODE, env: process.env.NODE_ENV };
afterEach(() => {
  if (saved.mode === undefined) delete process.env.AUTH_REDIS_FAILURE_MODE;
  else process.env.AUTH_REDIS_FAILURE_MODE = saved.mode;
  process.env.NODE_ENV = saved.env;
});

const agent: TokenClaims = { sub: 9, org: 3, typ: 'partner_agent', uid: 'agent-uuid', ep: 4 };
const staff: TokenClaims = { sub: 5, org: 7, typ: 'user', uid: 'owner', sid: 'sess-1', ep: 4 };

function build(
  claims: TokenClaims,
  opts: {
    epoch?: number;
    assertActive?: ReturnType<typeof vi.fn>;
    mget?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const assertActive = opts.assertActive ?? vi.fn().mockResolvedValue(undefined);
  const redis = { mget: opts.mget ?? vi.fn().mockResolvedValue([null, null, null]) };
  const sessions = {
    touchActivity: vi.fn(),
    expireIdle: vi.fn(),
    tombstone: vi.fn(),
    isRevocationPending: vi.fn().mockReturnValue(false),
    enforceCapIfChanged: vi.fn(),
  };
  const guard = new JwtAuthGuard(
    new Reflector(),
    { verifyAccess: async () => claims } as never,
    { current: async () => opts.epoch ?? 4 } as never,
    { policy: async () => ({ sessionTimeoutMinutes: 30, maxConcurrentSessions: 1 }) } as never,
    sessions as never,
    { enforceCapIfChanged: vi.fn() } as never,
    { assertOpen: vi.fn() } as never,
    redis as never,
    { assertActive } as never,
  );
  const http = {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ header: () => 'Bearer t' }) }),
  } as unknown as ExecutionContext;
  return { guard, http, assertActive, redis };
}

const run = <T>(fn: (ctx: RequestContext) => Promise<T>) =>
  RequestContextStore.run(
    {
      requestId: 'r',
      orgId: 0,
      actorType: 'system',
      actorId: null,
      userId: null,
    } as RequestContext,
    () => fn(RequestContextStore.require()),
  );

describe('partner agents are revocable', () => {
  it('checks the agent is still active on every request', async () => {
    const { guard, http, assertActive } = build(agent);
    await run(async (ctx) => {
      await guard.canActivate(http);
      expect(assertActive).toHaveBeenCalledWith(3, 9);
      expect(ctx).toMatchObject({ orgId: 3, actorType: 'partner_agent', actorId: 9 });
    });
  });

  it('refuses a suspended agent', async () => {
    const denied = Object.assign(new Error('x'), { code: 'UNAUTHENTICATED' });
    const { guard, http } = build(agent, { assertActive: vi.fn().mockRejectedValue(denied) });
    await run(async () => {
      await expect(guard.canActivate(http)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });

  it('"revoke everything" (the platform epoch) reaches partner agents too, and tokens minted before it', async () => {
    const { guard, http, assertActive } = build(agent, { epoch: 5 });
    await run(async () => {
      await expect(guard.canActivate(http)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
    expect(assertActive).not.toHaveBeenCalled();
    const legacy = build({ ...agent, ep: undefined }, { epoch: 1 });
    await run(async () => {
      await expect(legacy.guard.canActivate(legacy.http)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });
  });

  it('does not ask staff sessions anything about partner status', async () => {
    const { guard, http, assertActive } = build(staff);
    await run(async () => {
      await guard.canActivate(http);
    });
    expect(assertActive).not.toHaveBeenCalled();
  });
});

describe('the session check when Redis is down', () => {
  const down = () => vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

  it('lets the short-lived token through in open mode', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AUTH_REDIS_FAILURE_MODE;
    const { guard, http } = build(staff, { mget: down() });
    await run(async () => {
      await expect(guard.canActivate(http)).resolves.toBe(true);
    });
  });

  it('refuses with a retryable 503 in closed mode, so a revoked session never works because a cache was down', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_REDIS_FAILURE_MODE;
    const { guard, http } = build(staff, { mget: down() });
    await run(async () => {
      await expect(guard.canActivate(http)).rejects.toMatchObject({
        code: 'AUTH_SERVICE_DEGRADED',
      });
    });
  });

  it('still refuses a revoked session when Redis answers', async () => {
    const { guard, http } = build(staff, { mget: vi.fn().mockResolvedValue(['1', null, null]) });
    await run(async () => {
      await expect(guard.canActivate(http)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });
});
