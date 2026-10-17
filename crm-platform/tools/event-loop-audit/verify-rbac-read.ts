// Runs the REAL RbacService cache read (the one-round-trip Lua script) against a real Redis and checks that it behaves exactly like
// the two reads it replaced. Needs a throwaway Redis:
//
//   docker run -d --rm --name el-rbac-redis -p 56383:6379 redis:7-alpine
//   cd apps/api && node node_modules/tsx/dist/cli.mjs ../../tools/event-loop-audit/verify-rbac-read.ts
//   docker stop el-rbac-redis
//
// REDIS_PORT overrides 56383. The database is a stub that counts calls; only the Redis side is real. Exit 1 on a failed check.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { RbacService } from '../../apps/api/src/kernel/rbac/rbac.service';

const require = createRequire(resolve(__dirname, '../../apps/api/package.json'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const IORedis = require('ioredis').default ?? require('ioredis');

const redis = new IORedis({ host: '127.0.0.1', port: Number(process.env.REDIS_PORT ?? 56383) });
const ORG = 910_000 + Math.floor(Math.random() * 1000); // a private org id: nothing else uses these keys
let rolesVersion = 2;
const calls = { version: 0, grants: 0 };
const db = {
  privileged: async (fn: (tx: unknown) => unknown) => {
    calls.version++;
    return fn({
      execute: async (q: { queryChunks?: unknown[] }) =>
        // UPDATE ... RETURNING and SELECT both answer with the current version
        (void q, { rows: [{ roles_version: rolesVersion }] }),
    });
  },
  txAs: async (_t: unknown, fn: (tx: unknown) => unknown) => {
    calls.grants++;
    return fn({
      execute: async () => ({
        rows: [
          { permission_key: 'record.contacts.read', effect: 'allow', record_scope: 'all' },
          { permission_key: 'record.contacts.delete', effect: 'deny', record_scope: 'all' },
        ],
      }),
    });
  },
};
const svc = new RbacService(db as never, redis as never);

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  (${JSON.stringify(detail)})`}`,
  );
};
const snap = () => ({ ...calls });
const delta = (a: { version: number; grants: number }) => ({
  version: calls.version - a.version,
  grants: calls.grants - a.grants,
});

async function main(): Promise<void> {
  await redis.del(`rbac:version:${ORG}`);

  let before = snap();
  const first = await svc.grantsForUser(ORG, 1);
  check(
    'a cold cache reads the version and the grants from the database once',
    delta(before).version === 1 && delta(before).grants === 1,
    delta(before),
  );
  check(
    'and returns the merged set (deny stays a deny)',
    svc.can(first, 'record.contacts.read').allowed &&
      !svc.can(first, 'record.contacts.delete').allowed,
  );
  check('the version is cached', (await redis.get(`rbac:version:${ORG}`)) === '2');
  check(
    'the grant set is cached under that version',
    (await redis.get(`rbac:${ORG}:v2:u1`)) !== null,
  );

  before = snap();
  const second = await svc.grantsForUser(ORG, 1);
  check(
    'a warm cache answers without touching the database',
    delta(before).version === 0 && delta(before).grants === 0,
    delta(before),
  );
  check('and returns the same grants', JSON.stringify([...second]) === JSON.stringify([...first]));

  before = snap();
  await svc.grantsForUser(ORG, 2);
  check(
    'another user in the same org loads only their own grants',
    delta(before).version === 0 && delta(before).grants === 1,
    delta(before),
  );

  rolesVersion = 3;
  await svc.bumpRolesVersion(ORG);
  check('a roles bump moves the cached version', (await redis.get(`rbac:version:${ORG}`)) === '3');
  before = snap();
  await svc.grantsForUser(ORG, 1);
  check(
    'after a bump the old grant set is NOT used (reloaded from the database)',
    delta(before).grants === 1,
    delta(before),
  );
  check('and is cached under the new version', (await redis.get(`rbac:${ORG}:v3:u1`)) !== null);
  before = snap();
  await svc.grantsForUser(ORG, 1);
  check(
    'then served from cache again',
    delta(before).grants === 0 && delta(before).version === 0,
    delta(before),
  );

  // The original reads and the script agree on every key.
  const viaScript = (await redis.eval(
    "local v = redis.call('GET', KEYS[1]) if not v then return {false, false} end return {v, redis.call('GET', 'rbac:' .. ARGV[1] .. ':v' .. v .. ':u' .. ARGV[2])}",
    1,
    `rbac:version:${ORG}`,
    String(ORG),
    '1',
  )) as [string, string | null];
  check(
    'the script reads the same keys a plain GET does',
    viaScript[0] === (await redis.get(`rbac:version:${ORG}`)) &&
      viaScript[1] === (await redis.get(`rbac:${ORG}:v3:u1`)),
  );

  await redis.del(
    `rbac:version:${ORG}`,
    `rbac:${ORG}:v2:u1`,
    `rbac:${ORG}:v2:u2`,
    `rbac:${ORG}:v3:u1`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    redis.disconnect();
    console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  });
