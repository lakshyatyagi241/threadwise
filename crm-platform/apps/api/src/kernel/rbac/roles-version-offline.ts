import { Redis } from 'ioredis';
import type { Client } from 'pg';

/**
 * For command-line tools that write roles, grants or role links straight into Postgres (seed-auth, seed-demo-members): the
 * running API caches each person's grant set under the workspace's roles version, so without this a new role link stays unseen for
 * up to 600 s (R-64-04). Call it after the tool's COMMIT. It raises `organizations.roles_version` and, when a Redis URL is known,
 * deletes the cached version so every API process re-reads it at once. Redis being unreachable is not an error for an offline
 * tool: the result says so and the API catches up when the cached version expires (at most 600 s).
 *
 * `client` must already run with the privileged flag, as both tools do.
 */
export async function bumpRolesVersionOffline(
  client: Pick<Client, 'query'>,
  orgIds: number[],
  redisUrl: string | undefined = process.env.REDIS_URL,
): Promise<{ bumped: number; redisCleared: boolean }> {
  if (orgIds.length === 0) return { bumped: 0, redisCleared: true };
  const res = await client.query(
    `UPDATE organizations SET roles_version = roles_version + 1 WHERE id = ANY($1::bigint[])`,
    [orgIds],
  );
  if (!redisUrl) return { bumped: res.rowCount ?? 0, redisCleared: false };
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    await redis.del(...orgIds.map((id) => `rbac:version:${id}`));
    return { bumped: res.rowCount ?? 0, redisCleared: true };
  } catch {
    return { bumped: res.rowCount ?? 0, redisCleared: false };
  } finally {
    redis.disconnect();
  }
}
