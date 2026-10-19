import type { Redis } from 'ioredis';

/**
 * INCR a counter and make sure it expires, in one transaction. `INCR` then a separate `EXPIRE` (only when the count came back as 1)
 * leaves a counter that never expires if the second command is lost: a dropped connection, a crash or a timeout between the two.
 * For a counter whose name has no time bucket in it (a per-address failure count) that is a permanent lockout; for the others it is
 * a key that stays in Redis for ever. `EXPIRE ... NX` sets the time only when the key has none, so the window still starts at the
 * first hit and later hits do not extend it. Returns the count after this hit. Throws like any Redis call when Redis is unreachable.
 */
export async function incrWithTtl(redis: Redis, key: string, ttlSeconds: number): Promise<number> {
  const res = await redis.multi().incr(key).expire(key, ttlSeconds, 'NX').exec();
  const [err, count] = res?.[0] ?? [new Error('redis transaction returned nothing'), null];
  if (err) throw err;
  return Number(count);
}
