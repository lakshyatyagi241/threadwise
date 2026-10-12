import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../../src/modules/auth/guards/jwt-auth.guard';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import type { TokenClaims } from '../../../src/modules/auth/token.service';

const base: TokenClaims = { sub: 5, org: 7, typ: 'user', uid: 'owner', sid: 'imp-1', ep: 0 };
const imp = { sid: 'imp-1', oid: 9, ro: false, exp: Math.floor(Date.now() / 1000) + 300 };
const open = {
  sessionId: 'imp-1',
  operatorId: 9,
  operatorUuid: 'op-uuid',
  readOnly: false,
  expiresAt: new Date(Date.now() + 300_000),
};

function build(claims: TokenClaims, assertOpen = vi.fn().mockResolvedValue(open)) {
  const redis = { mget: vi.fn().mockResolvedValue([null, null, null]) };
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
    { current: async () => 0 } as never,
    { policy: async () => ({ sessionTimeoutMinutes: 30, maxConcurrentSessions: 1 }) } as never,
    sessions as never,
    { enforceCapIfChanged: vi.fn() } as never,
    { assertOpen } as never,
    redis as never,
    { assertActive: vi.fn() } as never,
  );
  const http = {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ header: () => 'Bearer t' }) }),
  } as unknown as ExecutionContext;
  return { guard, http, assertOpen, sessions, redis };
}

const run = async <T>(fn: (ctx: RequestContext) => Promise<T>) => {
  const ctx: RequestContext = {
    requestId: 'r',
    orgId: 0,
    actorType: 'system',
    actorId: null,
    userId: null,
  };
  return RequestContextStore.run(ctx, () => fn(ctx));
};

describe('JwtAuthGuard with an act-as token', () => {
  it('opens the impersonation session instead of the owner auth session and puts the operator on the context', async () => {
    const { guard, http, assertOpen, sessions, redis } = build({ ...base, imp });
    await run(async (ctx) => {
      await guard.canActivate(http);
      expect(assertOpen).toHaveBeenCalledOnce();
      expect(ctx).toMatchObject({ orgId: 7, actorType: 'user', userId: 5, impersonation: open });
    });
    // the owner's real sessions are never consulted or touched: no idle timeout, no cap sweep, no activity stamp
    expect(redis.mget).not.toHaveBeenCalled();
    expect(sessions.touchActivity).not.toHaveBeenCalled();
    expect(sessions.enforceCapIfChanged).not.toHaveBeenCalled();
  });

  it('refuses an act-as claim on a token whose session id differs, or on another identity pool', async () => {
    for (const claims of [
      { ...base, imp: { ...imp, sid: 'other' } },
      { ...base, typ: 'partner_agent' as const, imp },
    ]) {
      const { guard, http, assertOpen } = build(claims);
      await run(async () => {
        await expect(guard.canActivate(http)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      });
      expect(assertOpen).not.toHaveBeenCalled();
    }
  });

  it('passes the refusal of an ended session straight through', async () => {
    const ended = Object.assign(new Error('ended'), { code: 'WSP_IMPERSONATION_ENDED' });
    const { guard, http } = build({ ...base, imp }, vi.fn().mockRejectedValue(ended));
    await run(async () => {
      await expect(guard.canActivate(http)).rejects.toMatchObject({
        code: 'WSP_IMPERSONATION_ENDED',
      });
    });
  });

  it('an ordinary token leaves the context without an impersonation', async () => {
    const { guard, http, assertOpen } = build({ ...base });
    await run(async (ctx) => {
      await guard.canActivate(http);
      expect(ctx.impersonation).toBeUndefined();
    });
    expect(assertOpen).not.toHaveBeenCalled();
  });
});
