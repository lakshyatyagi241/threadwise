import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildInstance, seedWorkspace, startEnv, type Env, type Instance } from './harness';

describe('bench smoke', () => {
  let env: Env;
  let a: Instance;
  beforeAll(async () => {
    env = await startEnv();
    a = buildInstance(env, 'A');
  }, 240_000);
  afterAll(async () => {
    await a?.close();
    await env?.stop();
  });
  it('reads real rows through the real classes', async () => {
    const w = await seedWorkspace(env);
    const g = await a.rbac.grantsForUser(w.orgId, w.userId);
    expect(g.size).toBe(0);
    const s = await a.gates.stateFor(w.orgId, w.userId);
    expect(s.suspended).toBe(false);
    expect(await a.partner.isActive(w.orgId, w.agentId)).toBe(true);
    expect(await a.epoch.current()).toBe(0);
  });
});
