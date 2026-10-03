import { describe, expect, it } from 'vitest';
import {
  executeCurrent,
  type StepDeps,
} from '../../../src/modules/flow-runtime-engine/runtime/engine-core';
import type {
  NodeExecutor,
  RunState,
} from '../../../src/modules/flow-runtime-engine/runtime/types';

const probe: NodeExecutor = {
  types: ['Probe'],
  execute: async () => ({ kind: 'subflow', flowId: 42 }),
};

const deps: StepDeps = {
  executors: [probe],
  send: async () => ({ ok: true }),
  paceMs: () => 0,
  now: () => new Date(0),
};

describe('Sub-flow seam (WD-FLR-031)', () => {
  it('a node result of kind subflow becomes a subflow transition for the engine to resolve', async () => {
    const run = {
      uuid: 'u',
      stepSeq: 1,
      graph: { nodes: [{ id: 'a', type: 'Probe', props: {} }], edges: [], vars: {} },
      currentNodeId: 'a',
      visits: {},
      vars: {},
      menus: { latest: null, byNode: {} },
    } as unknown as RunState;
    const out = await executeCurrent(run, deps);
    expect(out.transition).toEqual({ t: 'subflow', flowId: 42 });
    expect(out.nodeType).toBe('Probe');
  });
});
