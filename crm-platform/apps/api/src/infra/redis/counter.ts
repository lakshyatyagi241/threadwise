import type { Redis } from 'ioredis';

/**
 * INCR a counter and make sure it has a lifetime, in ONE round trip.
 *
 * The older pattern was `INCR key` then, when the answer was 1, `EXPIRE key`. If the second command never arrives (a dropped connection,
 * a command timeout, the process ending between the two) the counter lives for ever: a failed-login throttle then locks one address out
 * permanently and a version counter is never freed. `EXPIRE ... NX` inside the same MULTI cannot be separated from the INCR, only sets a
 * lifetime when there is none (a fixed window: later hits do not extend it) and also gives one to a counter an older version left behind.
 * Needs Redis 7 (`NX`), which the compose files pin.
 */
export async function incrWithTtl(redis: Redis, key: string, seconds: number): Promise<number> {
  const res = await redis.multi().incr(key).expire(key, seconds, 'NX').exec();
  const [err, n] = res?.[0] ?? [new Error('counter transaction was discarded'), null];
  if (err) throw err;
  return Number(n);
}
