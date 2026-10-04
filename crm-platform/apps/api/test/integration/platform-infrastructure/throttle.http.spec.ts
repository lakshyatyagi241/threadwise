import { randomUUID } from 'node:crypto';
import { Controller, Get, type NestMiddleware } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { ProblemExceptionFilter } from '../../../src/common/filters/problem-exception.filter';
import { INFRA_ENV, readInfraEnv } from '../../../src/config/domains/platform-infrastructure.env';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import {
  RateLimiter,
  SkipThrottle,
  Throttle,
  ThrottleGuard,
} from '../../../src/modules/platform-infrastructure';

/** Stands in for RequestContextMiddleware + JwtAuthGuard: `x-test-actor: <id>` makes the caller a user of org 1. */
class FakeActor implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const id = req.header('x-test-actor');
    RequestContextStore.run(
      {
        requestId: 'r',
        orgId: id ? 1 : 0,
        actorType: id ? 'user' : 'system',
        actorId: id ? Number(id) : null,
        userId: id ? Number(id) : null,
      },
      next,
    );
  }
}

@Controller('t')
class TestController {
  @Get('login') @Throttle({ limit: 2, windowSeconds: 60, by: 'ip' }) login() {
    return { ok: true };
  }
  @Get('other-login') @Throttle({ limit: 2, windowSeconds: 60, by: 'ip' }) otherLogin() {
    return { ok: true };
  }
  @Get('poll') @Throttle({ limit: 2, windowSeconds: 60, by: 'actor-or-ip' }) poll() {
    return { ok: true };
  }
  @Get('free') free() {
    return { ok: true };
  }
  @Get('probe') @SkipThrottle() probe() {
    return { ok: true };
  }
}

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
// Each run counts in its own keys: the route names are fixed, the callers are not.
const run = randomUUID().slice(0, 8);
const ip = (n: number) => `10.99.${n}.${Number.parseInt(run, 16) % 250}`;

async function boot(env: Record<string, string>, redis: Redis): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [TestController],
    providers: [
      { provide: REDIS_CLIENT, useValue: redis },
      { provide: INFRA_ENV, useValue: readInfraEnv(env) },
      RateLimiter,
      ThrottleGuard,
      { provide: APP_GUARD, useExisting: ThrottleGuard },
      { provide: APP_FILTER, useClass: ProblemExceptionFilter },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', true);
  app.use((req: Request, res: Response, next: NextFunction) => new FakeActor().use(req, res, next));
  await app.init();
  return app;
}

let redis: Redis;
let app: NestExpressApplication;

beforeAll(async () => {
  redis = new Redis(url, { maxRetriesPerRequest: 1 });
  app = await boot({}, redis);
});

afterAll(async () => {
  await app.close();
  const keys = await redis.keys('rl:*TestController*');
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

const http = () => request(app.getHttpServer());

describe('request throttle over HTTP', () => {
  it('serves up to the limit with quota headers, then answers 429 problem+json with Retry-After', async () => {
    const from = ip(1);
    const first = await http().get('/t/login').set('x-forwarded-for', from);
    expect(first.status).toBe(200);
    expect(first.headers['x-ratelimit-limit']).toBe('2');
    expect(first.headers['x-ratelimit-remaining']).toBe('1');

    await http().get('/t/login').set('x-forwarded-for', from).expect(200);
    const refused = await http().get('/t/login').set('x-forwarded-for', from);

    expect(refused.status).toBe(429);
    expect(refused.headers['content-type']).toContain('application/problem+json');
    expect(refused.body).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(refused.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('counts per address: another client is unaffected', async () => {
    await http().get('/t/login').set('x-forwarded-for', ip(2)).expect(200);
    await http().get('/t/login').set('x-forwarded-for', ip(2)).expect(200);
    await http().get('/t/login').set('x-forwarded-for', ip(2)).expect(429);
    await http().get('/t/login').set('x-forwarded-for', ip(3)).expect(200);
  });

  it('counts per route: exhausting one does not touch another with the same limit', async () => {
    const from = ip(4);
    await http().get('/t/login').set('x-forwarded-for', from).expect(200);
    await http().get('/t/login').set('x-forwarded-for', from).expect(200);
    await http().get('/t/login').set('x-forwarded-for', from).expect(429);
    await http().get('/t/other-login').set('x-forwarded-for', from).expect(200);
  });

  it('counts an authenticated caller on their own, even from a shared address', async () => {
    const office = ip(5);
    const as = (id: number) =>
      http().get('/t/poll').set('x-forwarded-for', office).set('x-test-actor', String(id));
    await as(1001).expect(200);
    await as(1001).expect(200);
    await as(1001).expect(429);
    await as(1002).expect(200); // a colleague behind the same NAT
  });

  it('does not touch routes with no limit, or ones that opt out', async () => {
    const res = await http().get('/t/free').set('x-forwarded-for', ip(6));
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    for (let i = 0; i < 5; i++)
      await http().get('/t/probe').set('x-forwarded-for', ip(6)).expect(200);
  });
});

describe('request throttle configuration', () => {
  it('limits undecorated routes when the environment sets a default, and not before', async () => {
    const limited = await boot({ INFRA_RATE_LIMIT_DEFAULT_PER_MINUTE: '2' }, redis);
    try {
      const get = () =>
        request(limited.getHttpServer()).get('/t/free').set('x-forwarded-for', ip(7));
      await get().expect(200);
      await get().expect(200);
      await get().expect(429);
    } finally {
      await limited.close();
    }
  });

  it('is fully off when the master switch is off', async () => {
    const off = await boot({ INFRA_RATE_LIMIT_ENABLED: 'false' }, redis);
    try {
      for (let i = 0; i < 5; i++) {
        const res = await request(off.getHttpServer())
          .get('/t/login')
          .set('x-forwarded-for', ip(8));
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBeUndefined();
      }
    } finally {
      await off.close();
    }
  });

  it('serves requests normally when Redis is down (fail open)', async () => {
    const dead = new Redis({
      host: '127.0.0.1',
      port: 1,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.on('error', () => undefined);
    const degraded = await boot({}, dead);
    try {
      for (let i = 0; i < 4; i++) {
        await request(degraded.getHttpServer())
          .get('/t/login')
          .set('x-forwarded-for', ip(9))
          .expect(200);
      }
    } finally {
      await degraded.close();
      dead.disconnect();
    }
  });
});
