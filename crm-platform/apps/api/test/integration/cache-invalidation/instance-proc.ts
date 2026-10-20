/**
 * A second (third, ...) application process for the cross-process tests: a real OS process with its own memory, its own Redis and
 * Postgres connections, running the real cache-owning classes. The parent sends `{id, op, args}` over IPC and gets `{id, ok, value}`.
 * Started by `spawnInstance` in cross-process.ts with `node --import tsx`.
 */
import { buildInstance, type Instance } from './instance';

const inst: Instance = buildInstance(
  { appUrl: process.env.CI66_APP_URL!, redis: { url: process.env.CI66_REDIS_URL! } },
  process.env.CI66_NAME ?? 'child',
);

const ops: Record<string, (...a: any[]) => Promise<unknown>> = {
  'epoch.current': () => inst.epoch.current(),
  'epoch.bump': (by: number) => inst.epoch.bump(by),
  'settings.get': (key: string) => inst.settings.get(key),
  'settings.set': (key: string, v: unknown) => inst.settings.set(key, v, null),
  'halt.is': () => inst.halt.isHalted(),
  'halt.set': (v: boolean) => inst.halt.set(v, 1),
  'org.suspended': (org: number) => inst.orgs.isSuspended(org),
  'org.invalidate': (org: number) => inst.orgs.invalidate(org),
  'gate.state': (org: number, user: number) => inst.gates.stateFor(org, user),
  'gate.invalidate': (org: number, user: number) => inst.gates.invalidate(org, user),
  'rbac.can': async (org: number, user: number, perm: string) =>
    inst.rbac.can(await inst.rbac.grantsForUser(org, user), perm).allowed,
  'rbac.bump': (org: number) => inst.rbac.bumpRolesVersion(org),
  'partner.active': (org: number, agent: number) => inst.partner.isActive(org, agent),
  'prefs.stored': (org: number) => inst.prefs.stored(org),
  'prefs.forget': async (org: number) => inst.prefs.forget(org),
  ping: async () => process.pid,
};

process.on('message', async (m: { id: number; op: string; args?: unknown[] }) => {
  try {
    const fn = ops[m.op];
    if (!fn) throw new Error(`unknown op ${m.op}`);
    const value = await fn(...(m.args ?? []));
    process.send!({ id: m.id, ok: true, value });
  } catch (e) {
    process.send!({ id: m.id, ok: false, error: String((e as Error).message ?? e) });
  }
});
process.send!({ id: 0, ok: true, value: 'ready' });
