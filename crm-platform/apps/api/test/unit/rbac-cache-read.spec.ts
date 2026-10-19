import { describe, expect, it, vi } from 'vitest';
import { RbacService } from '../../src/kernel/rbac/rbac.service';

/**
 * grantsForUser reads the cached roles version and the grant set stored under it in ONE Redis round trip (a script), and falls
 * back to the original two-step path on a miss or an error. The script itself is exercised against a real Redis in
 * test/e2e/authz/cache-and-races.e2e.spec.ts; these tests pin the service's decisions around it.
 */
const GRANTS_JSON = JSON.stringify({ 'record.contacts.read': { effect: 'allow', scope: 'all' } });

function build(opts: {
  /** What the read script answers: [version, grants], or a function to throw. */
  script: () => unknown;
  store?: Record<string, string>;
}) {
  const store = new Map(Object.entries(opts.store ?? {}));
  const redis = {
    eval: vi.fn(async (script: string, _n: number, ..._args: string[]) => {
      // The raise-version script (used by rolesVersion) is not the read script.
      if (script.includes('tonumber')) return 1;
      return opts.script();
    }),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    setex: vi.fn(async (k: string, _t: number, v: string) => void store.set(k, v)),
  };
  const db = {
    privileged: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => ({ rows: [{ roles_version: 4 }] }) }),
    ),
    txAs: vi.fn(async (_t: unknown, fn: (tx: unknown) => unknown) =>
      fn({
        execute: async () => ({
          rows: [{ permission_key: 'record.contacts.read', effect: 'allow', record_scope: 'all' }],
        }),
      }),
    ),
  };
  return { svc: new RbacService(db as never, redis as never), redis, db };
}

describe('RbacService.grantsForUser cache read', () => {
  it('answers a full hit from one script call, touching nothing else', async () => {
    const { svc, redis, db } = build({ script: () => ['3', GRANTS_JSON] });
    const grants = await svc.grantsForUser(7, 1);
    expect(svc.can(grants, 'record.contacts.read')).toEqual({ allowed: true, scope: 'all' });
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval.mock.calls[0]).toEqual([expect.any(String), 1, 'rbac:version:7', '7', '1']);
    expect(redis.get).not.toHaveBeenCalled();
    expect(db.txAs).not.toHaveBeenCalled();
    expect(db.privileged).not.toHaveBeenCalled();
  });

  it('loads from the database and caches under the version it read when the grant set is missing', async () => {
    const { svc, redis, db } = build({ script: () => ['3', null] });
    const grants = await svc.grantsForUser(7, 1);
    expect(svc.can(grants, 'record.contacts.read').allowed).toBe(true);
    expect(db.txAs).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled(); // the script already said the key is empty
    expect(redis.setex).toHaveBeenCalledWith('rbac:7:v3:u1', 600, expect.any(String));
  });

  it('reads the version from the database when it is not cached, then uses that version for the key', async () => {
    const { svc, redis, db } = build({ script: () => [null, null] });
    await svc.grantsForUser(7, 1);
    expect(db.privileged).toHaveBeenCalledTimes(1); // roles_version = 4
    expect(redis.get).toHaveBeenCalledWith('rbac:version:7');
    expect(redis.get).toHaveBeenCalledWith('rbac:7:v4:u1');
    expect(redis.setex).toHaveBeenCalledWith('rbac:7:v4:u1', 600, expect.any(String));
  });

  it('falls back to the original two reads when the script fails', async () => {
    const { svc, redis, db } = build({
      script: () => {
        throw new Error('NOSCRIPT or connection reset');
      },
      store: { 'rbac:version:7': '5', 'rbac:7:v5:u1': GRANTS_JSON },
    });
    const grants = await svc.grantsForUser(7, 1);
    expect(svc.can(grants, 'record.contacts.read').allowed).toBe(true);
    expect(redis.get).toHaveBeenCalledWith('rbac:version:7');
    expect(redis.get).toHaveBeenCalledWith('rbac:7:v5:u1');
    expect(db.txAs).not.toHaveBeenCalled();
  });

  it('never reads a grant set cached under another version', async () => {
    // The script returns the grants it found under ITS version; the service must key everything it writes by that same version.
    const { svc, redis } = build({ script: () => ['9', null] });
    await svc.grantsForUser(7, 1);
    expect(redis.setex.mock.calls.every((c) => String(c[0]).startsWith('rbac:7:v9:'))).toBe(true);
  });
});
