import { describe, expect, it } from 'vitest';
import {
  AUTH_FAILURES_PER_MINUTE,
  ApiKeyAccessService,
} from '../../../src/modules/public-api/api-key-access.service';
import { FakeRedis } from './fake-redis';

/**
 * D-64-01: a counter that is created by INCR and given its expiry by a second command is immortal when that second command is lost
 * (a dropped connection, a crash between the two, a timeout). The failed-authentication counter has no time bucket in its name, so
 * an immortal one locks the address out of the API for good. The two commands must reach Redis as one transaction.
 */
function service(redis: FakeRedis): ApiKeyAccessService {
  return new ApiKeyAccessService(
    {} as never,
    redis as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('failed-authentication counter keeps its expiry (D-64-01)', () => {
  it('has a time to live after the first failure', async () => {
    const redis = new FakeRedis();
    await service(redis).recordAuthFailure('bearer', '203.0.113.7');
    expect(redis.pttlSync('apikey:authfail:bearer:203.0.113.7')).toBeGreaterThan(0);
  });

  it('still has a time to live when a separate EXPIRE would have been lost', async () => {
    const redis = new FakeRedis();
    redis.failing.add('expire'); // what a dropped connection between INCR and EXPIRE looks like
    await service(redis).recordAuthFailure('bearer', '203.0.113.7');
    const ttl = redis.pttlSync('apikey:authfail:bearer:203.0.113.7');
    expect(ttl).not.toBe(-1); // -1 = the key never expires
  });

  it('lets the address back in after the window, even when the first attempt lost its expiry', async () => {
    const redis = new FakeRedis();
    redis.failing.add('expire');
    const svc = service(redis);
    for (let i = 0; i < AUTH_FAILURES_PER_MINUTE; i++)
      await svc.recordAuthFailure('bearer', '203.0.113.7');
    await expect(svc.assertNotLockedOut('bearer', '203.0.113.7')).rejects.toMatchObject({
      status: 429,
    });
    redis.clock.advance(61_000);
    await expect(svc.assertNotLockedOut('bearer', '203.0.113.7')).resolves.toBeUndefined();
  });
});
