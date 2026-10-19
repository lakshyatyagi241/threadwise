import { createDbClient } from '@crm/db';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { queueRedisOptions } from '../../../src/infra/queue/queue.module';

/**
 * Encryption audit E6 (data in transit): TLS to Postgres and Redis is switched on by the connection URL alone, so a move to a managed
 * service needs a changed env value and no code. Nothing connects here: the clients are built lazily and inspected.
 */
describe('Postgres TLS comes from DATABASE_URL', () => {
  // The pool hands the URL to pg unchanged, and pg reads sslmode when a connection is opened; both halves are pinned.
  const tls = (url: string) => {
    const { pool } = createDbClient({ url });
    expect(
      (pool as unknown as { options: { connectionString: string } }).options.connectionString,
    ).toBe(url);
    return (
      new Client({ connectionString: url }) as unknown as { connectionParameters: { ssl: unknown } }
    ).connectionParameters.ssl;
  };

  it('sslmode=verify-full turns on certificate-checked TLS', () => {
    const ssl = tls('postgres://u:p@db.example.com/crm?sslmode=verify-full');
    expect(ssl).toBeTruthy();
    expect(ssl).not.toMatchObject({ rejectUnauthorized: false });
  });

  it("no sslmode keeps today's behaviour (plain TCP, for the private Docker network)", () => {
    expect(tls('postgres://u:p@db/crm')).toBeFalsy();
  });
});

describe('Redis TLS comes from REDIS_URL', () => {
  it('rediss:// enables TLS on the shared client and the socket.io adapter (ioredis)', () => {
    const c = new Redis('rediss://:pw@cache.example.com:6380/1', { lazyConnect: true });
    expect(c.options.tls).toBeDefined();
    c.disconnect();
  });

  it('rediss:// enables TLS on the BullMQ connection too, and redis:// does not', () => {
    expect(queueRedisOptions('rediss://:pw@cache.example.com:6380/1')).toHaveProperty('tls');
    expect(queueRedisOptions('redis://:pw@cache:6379/1')).not.toHaveProperty('tls');
  });
});
