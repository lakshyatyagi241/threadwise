import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import {
  readInfraEnv,
  type InfraEnv,
} from '../../../src/config/domains/platform-infrastructure.env';
import {
  RATE_POLICIES,
  SkipThrottle,
  Throttle,
  ThrottleGuard,
  type ConsumeResult,
  type RateLimiter,
} from '../../../src/modules/platform-infrastructure';
import { resolveThrottle } from '../../../src/modules/platform-infrastructure/rate-limit/rate-limit.policies';

@Controller()
class Plain {
  @Get() open() {
    return undefined;
  }
  @Get() @Throttle('auth') login() {
    return undefined;
  }
  @Get() @Throttle({ limit: 3, windowSeconds: 10, by: 'actor' }) custom() {
    return undefined;
  }
  @Get() @SkipThrottle() probe() {
    return undefined;
  }
}

@Throttle({ limit: 7, windowSeconds: 60, by: 'ip' })
@Controller()
class Limited {
  @Get() inherits() {
    return undefined;
  }
  @Get() @Throttle('webhook') overrides() {
    return undefined;
  }
}

const ok = (over: Partial<ConsumeResult> = {}): ConsumeResult => ({
  allowed: true,
  limit: 10,
  remaining: 9,
  retryAfterSeconds: 60,
  degraded: false,
  ...over,
});

function setup(env: Partial<InfraEnv> = {}, result: ConsumeResult = ok()) {
  const consume = vi.fn(async () => result);
  const guard = new ThrottleGuard(new Reflector(), { consume } as unknown as RateLimiter, {
    ...readInfraEnv({}),
    ...env,
  });
  const headers: Record<string, string> = {};
  const run = (
    controller: new () => object,
    handler: string,
    req: { ip?: string } = { ip: '203.0.113.9' },
    type = 'http',
  ) => {
    const ctx = {
      getType: () => type,
      getClass: () => controller,
      getHandler: () => (controller.prototype as Record<string, () => void>)[handler],
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ setHeader: (k: string, v: string) => (headers[k] = v) }),
      }),
    } as unknown as ExecutionContext;
    return guard.canActivate(ctx);
  };
  return { run, consume, headers };
}

const actor = (over: Partial<RequestContext>): RequestContext => ({
  requestId: 'r',
  orgId: 4,
  actorType: 'user',
  actorId: 12,
  userId: 12,
  ...over,
});

describe('ThrottleGuard', () => {
  it('lets a route with no limit through without touching Redis (default 0)', async () => {
    const { run, consume } = setup();
    await expect(run(Plain, 'open')).resolves.toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });

  it('is a no-op when the master switch is off, even on a decorated route', async () => {
    const { run, consume, headers } = setup({ INFRA_RATE_LIMIT_ENABLED: false });
    await expect(run(Plain, 'login')).resolves.toBe(true);
    expect(consume).not.toHaveBeenCalled();
    expect(headers).toEqual({});
  });

  it('ignores non-HTTP contexts', async () => {
    const { run, consume } = setup();
    await expect(run(Plain, 'login', {}, 'ws')).resolves.toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });

  it('applies a named policy, counted per address for by:ip', async () => {
    const { run, consume } = setup();
    await run(Plain, 'login', { ip: '198.51.100.7' });
    expect(consume).toHaveBeenCalledWith(
      'rl:10/60s:Plain.login:ip:198.51.100.7',
      RATE_POLICIES.auth.limit,
      RATE_POLICIES.auth.windowSeconds,
    );
  });

  it('counts each route separately even under the same policy', async () => {
    const { run, consume } = setup();
    await run(Limited, 'inherits');
    await run(Limited, 'overrides');
    const keys = consume.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(new Set(keys).size).toBe(2);
  });

  it('lets the handler decorator override the controller one', async () => {
    const { run, consume } = setup();
    await run(Limited, 'inherits');
    await run(Limited, 'overrides');
    expect(consume.mock.calls[0]?.slice(1)).toEqual([7, 60]);
    expect(consume.mock.calls[1]?.slice(1)).toEqual([300, 60]);
  });

  it('puts the limit and window in the key so a changed number starts a fresh counter', async () => {
    const { run, consume } = setup();
    await run(Plain, 'custom');
    expect((consume.mock.calls[0] as unknown as [string])[0]).toContain(':3/10s:');
  });

  it('counts an authenticated caller by pool, org and id, not by address', async () => {
    const { run, consume } = setup();
    await RequestContextStore.run(actor({}), () => run(Plain, 'custom'));
    expect((consume.mock.calls[0] as unknown as [string])[0]).toBe(
      'rl:3/10s:Plain.custom:user:4:12',
    );
  });

  it('keeps two callers in one org on separate counters', async () => {
    const { run, consume } = setup();
    await RequestContextStore.run(actor({ actorId: 1 }), () => run(Plain, 'custom'));
    await RequestContextStore.run(actor({ actorId: 2 }), () => run(Plain, 'custom'));
    const [a, b] = consume.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(a).not.toBe(b);
  });

  it('falls back to the address when an actor limit meets an anonymous request', async () => {
    const { run, consume } = setup();
    await RequestContextStore.run(actor({ actorId: null, actorType: 'system', orgId: 0 }), () =>
      run(Plain, 'custom', { ip: '192.0.2.5' }),
    );
    expect((consume.mock.calls[0] as unknown as [string])[0]).toBe(
      'rl:3/10s:Plain.custom:ip:192.0.2.5',
    );
  });

  it('by:ip ignores a known actor (a login limit must not be dodged by holding a token)', async () => {
    const { run, consume } = setup();
    await RequestContextStore.run(actor({}), () => run(Plain, 'login', { ip: '192.0.2.5' }));
    expect((consume.mock.calls[0] as unknown as [string])[0]).toBe(
      'rl:10/60s:Plain.login:ip:192.0.2.5',
    );
  });

  it('applies the environment default to an undecorated route, per caller', async () => {
    const { run, consume } = setup({ INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE: 600 });
    await run(Plain, 'open');
    expect(consume.mock.calls[0]?.slice(1)).toEqual([600, 60]);
  });

  it('@SkipThrottle beats both a decorator and the environment default', async () => {
    const { run, consume } = setup({ INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE: 1 });
    await expect(run(Plain, 'probe')).resolves.toBe(true);
    expect(consume).not.toHaveBeenCalled();
  });

  it('reports the quota in headers on an allowed request', async () => {
    const { run, headers } = setup({}, ok({ limit: 10, remaining: 4, retryAfterSeconds: 33 }));
    await run(Plain, 'login');
    expect(headers).toEqual({
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': '4',
      'X-RateLimit-Reset': '33',
    });
  });

  it('refuses with 429 RATE_LIMITED and Retry-After when over the limit', async () => {
    const { run, headers } = setup({}, ok({ allowed: false, remaining: 0, retryAfterSeconds: 42 }));
    const err = await run(Plain, 'login').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ERROR_CODES.RATE_LIMITED);
    expect((err as AppError).getStatus()).toBe(429);
    expect(headers['Retry-After']).toBe('42');
    expect(headers['X-RateLimit-Remaining']).toBe('0');
  });

  it('lets the request through and sends no quota headers when Redis is down', async () => {
    const { run, headers } = setup({}, ok({ degraded: true }));
    await expect(run(Plain, 'login')).resolves.toBe(true);
    expect(headers).toEqual({});
  });
});

describe('resolveThrottle', () => {
  it('fills defaults for an explicit spec', () => {
    expect(resolveThrottle({ limit: 5, windowSeconds: 30 })).toEqual({
      limit: 5,
      windowSeconds: 30,
      by: 'actor-or-ip',
    });
  });

  it.each([
    [{ limit: 0, windowSeconds: 60 }, /positive integer/],
    [{ limit: 1.5, windowSeconds: 60 }, /positive integer/],
    [{ limit: 5, windowSeconds: 0 }, /window/],
    [{ limit: 5, windowSeconds: -1 }, /window/],
  ])('rejects %j at decoration time', (input, message) => {
    expect(() => resolveThrottle(input)).toThrow(message);
  });

  it('rejects an unknown policy name', () => {
    expect(() => resolveThrottle('nope' as never)).toThrow(/Unknown rate-limit policy/);
  });

  it('rejects names that exist only on Object.prototype', () => {
    expect(() => resolveThrottle('constructor' as never)).toThrow(/Unknown rate-limit policy/);
  });
});

describe('readInfraEnv', () => {
  it('defaults to enabled with no default limit', () => {
    expect(readInfraEnv({})).toMatchObject({
      INFRA_RATE_LIMIT_ENABLED: true,
      INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE: 0,
    });
  });

  it('treats empty strings (an unset compose variable) as not set', () => {
    expect(
      readInfraEnv({ INFRA_RATE_LIMIT_ENABLED: '', INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE: '' }),
    ).toMatchObject({ INFRA_RATE_LIMIT_ENABLED: true, INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE: 0 });
  });

  it('parses switches and numbers', () => {
    expect(
      readInfraEnv({
        INFRA_RATE_LIMIT_ENABLED: 'false',
        INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE: '900',
      }),
    ).toMatchObject({ INFRA_RATE_LIMIT_ENABLED: false, INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE: 900 });
  });

  it.each([['-1'], ['abc'], ['1.5']])('refuses a malformed limit %s at boot', (value) => {
    expect(() => readInfraEnv({ INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE: value })).toThrow();
  });
});
