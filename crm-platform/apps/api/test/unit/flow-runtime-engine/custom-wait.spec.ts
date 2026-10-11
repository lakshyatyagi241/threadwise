import { describe, expect, it } from 'vitest';
import type { RuntimeGraph } from '../../../src/modules/flow-runtime-engine/graph/runtime-graph';
import {
  applyCustomReply,
  executeCurrent,
  type StepDeps,
} from '../../../src/modules/flow-runtime-engine/runtime/engine-core';
import type {
  CustomDecision,
  NodeExecutor,
  OutboundMessage,
  RunState,
} from '../../../src/modules/flow-runtime-engine/runtime/types';

const graph: RuntimeGraph = {
  nodes: [
    { id: 'a', type: 'Probe', props: {} },
    { id: 'yes', type: 'End', props: {} },
    { id: 'no', type: 'End', props: {} },
  ],
  edges: [
    { from: 'a_1', to: 'yes' },
    { from: 'a_2', to: 'no' },
  ],
  vars: {},
};

function run(): RunState {
  return {
    id: 1,
    uuid: 'run-uuid',
    orgId: 1,
    flowId: 1,
    subscriberId: null,
    contactId: null,
    channelId: 1,
    channelUuid: 'c',
    channelKind: 'simulator',
    contactUuid: null,
    peerKey: '1',
    conversationId: null,
    source: 'keyword',
    triggerText: null,
    status: 'running',
    graph,
    graphVersionId: null,
    nodeCount: 0,
    currentNodeId: 'a',
    stepSeq: 7,
    vars: {},
    visits: {},
    wait: null,
    menus: { latest: null, byNode: {} },
    lastOut: null,
    timeoutSeconds: 600,
    cooldownSeconds: 0,
    haltReason: null,
    startedAt: new Date(0),
    expiresAt: null,
    maxExpiresAt: new Date(1e13),
    resumeAt: null,
  };
}

/** A node that parks a Custom wait and decides the answer by what the reply carries. */
function probe(decide: (d: Record<string, unknown>) => CustomDecision): NodeExecutor {
  return {
    types: ['Probe'],
    async execute(ctx) {
      return {
        kind: 'wait',
        wait: {
          nodeId: ctx.node.id,
          variable: 'x',
          kind: 'Custom',
          handler: 'Probe',
          data: { stepKey: ctx.stepKey },
          timeoutSeconds: 120,
          timeoutPort: 2,
        },
      };
    },
    async onReply(ctx, reply) {
      await ctx.send({ kind: 'text', body: 'got it' });
      return decide({ ...(reply.data ?? {}), key: ctx.stepKey });
    },
  };
}

function deps(executor: NodeExecutor, sent: Array<{ m: OutboundMessage; index: number }> = []) {
  const d: StepDeps = {
    send: async (_r, m, index) => {
      sent.push({ m, index });
      return { ok: true };
    },
    paceMs: () => 0,
    now: () => new Date(0),
    executors: [executor],
  };
  return d;
}

describe('a node that waits and decodes its own answer', () => {
  it('parks a Custom wait carrying its handler, data, timeout and timeout port, with a stable step key', async () => {
    const r = run();
    const out = await executeCurrent(r, deps(probe(() => ({ action: 'ignore' }))));
    expect(out.transition).toMatchObject({
      t: 'wait',
      wait: {
        kind: 'Custom',
        handler: 'Probe',
        timeoutSeconds: 120,
        timeoutPort: 2,
        data: { stepKey: 'flow:run-uuid:7:a' },
      },
    });
  });

  it('routes by the port the node picks and stores the variables it returns', async () => {
    const r = run();
    const sent: Array<{ m: OutboundMessage; index: number }> = [];
    const ex = probe((d) => ({ action: 'route', port: d.paid ? 1 : 2, setVars: { paid: d.paid } }));
    r.wait = {
      nodeId: 'a',
      variable: 'x',
      kind: 'Custom',
      handler: 'Probe',
    };
    const out = await applyCustomReply(
      r,
      { kind: 'external', id: '', text: '', data: { paid: true } },
      deps(ex, sent),
    );
    expect(out.transition).toEqual({ t: 'goto', nodeId: 'yes', delayMs: 0, port: 1 });
    expect(r.vars.paid).toBe(true);
    // The answer's sends are numbered from 1000 so they never share a client reference with the step that asked.
    expect(sent[0]!.index).toBe(1000);
  });

  it('stays parked when the node says the answer is not complete, keeping updated data', async () => {
    const r = run();
    r.wait = { nodeId: 'a', variable: 'x', kind: 'Custom', handler: 'Probe', data: { n: 1 } };
    const out = await applyCustomReply(
      r,
      { kind: 'text', id: '', text: 'hm' },
      deps(probe(() => ({ action: 'stay', data: { n: 2 } }))),
    );
    expect(out.transition).toMatchObject({ t: 'wait', wait: { data: { n: 2 }, handler: 'Probe' } });
  });

  it('ignore changes nothing; a missing handler is ignored too', async () => {
    const r = run();
    r.wait = { nodeId: 'a', variable: 'x', kind: 'Custom', handler: 'Probe' };
    const ignored = await applyCustomReply(
      r,
      { kind: 'text', id: '', text: 'hm' },
      deps(probe(() => ({ action: 'ignore' }))),
    );
    expect(ignored.transition).toEqual({ t: 'none' });
    r.wait = { nodeId: 'a', variable: 'x', kind: 'Custom', handler: 'Nobody' };
    const lost = await applyCustomReply(
      r,
      { kind: 'text', id: '', text: 'hm' },
      deps(probe(() => ({ action: 'route', port: 1 }))),
    );
    expect(lost.transition).toEqual({ t: 'none' });
  });

  it('can fail or end the run', async () => {
    const r = run();
    r.wait = { nodeId: 'a', variable: 'x', kind: 'Custom', handler: 'Probe' };
    const failed = await applyCustomReply(
      r,
      { kind: 'text', id: '', text: 'x' },
      deps(probe(() => ({ action: 'fail', code: 'BAD', reason: 'It broke' }))),
    );
    expect(failed.transition).toMatchObject({
      t: 'end',
      status: 'failed',
      failureCode: 'BAD',
      failureReason: 'It broke',
    });
    const ended = await applyCustomReply(
      r,
      { kind: 'text', id: '', text: 'x' },
      deps(probe(() => ({ action: 'end', reason: 'end_node' }))),
    );
    expect(ended.transition).toMatchObject({ t: 'end', status: 'completed' });
  });
});
