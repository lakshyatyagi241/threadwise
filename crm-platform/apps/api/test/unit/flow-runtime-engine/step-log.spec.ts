import { describe, expect, it } from 'vitest';
import type {
  RuntimeGraph,
  RuntimeNode,
} from '../../../src/modules/flow-runtime-engine/graph/runtime-graph';
import type { StepOutcome } from '../../../src/modules/flow-runtime-engine/runtime/engine-core';
import {
  MAX_LOGGED_STEPS,
  clip,
  compactGraph,
  hashGraph,
  maskSecrets,
  nodeLabel,
  shouldLog,
  stepFields,
} from '../../../src/modules/flow-runtime-engine/runtime/step-log';

const node = (over: Partial<RuntimeNode> = {}): RuntimeNode => ({
  id: 'n1',
  type: 'Message',
  props: { text: 'Hello there' },
  ...over,
});
const outcome = (over: Partial<StepOutcome> = {}): StepOutcome => ({
  transition: { t: 'goto', nodeId: 'n2', delayMs: 0, port: 2 },
  nodeId: 'n1',
  nodeType: 'Message',
  notes: [],
  ...over,
});

describe('step log helpers', () => {
  it('clips long text on one line', () => {
    expect(clip('a\n  b', 10)).toBe('a b');
    expect(clip('x'.repeat(50), 10)).toHaveLength(10);
  });

  it('masks tokens and passwords', () => {
    expect(maskSecrets('Authorization: Bearer abc.def-123 sent')).not.toContain('abc.def');
    expect(maskSecrets('token=SECRET123&x=1')).toBe('token=***&x=1');
    expect(maskSecrets('password: hunter2')).not.toContain('hunter2');
    expect(maskSecrets('plain text')).toBe('plain text');
  });

  it('labels a node by its name, then its text, then its type', () => {
    expect(nodeLabel(node({ label: 'Welcome' }), null)).toBe('Welcome');
    expect(nodeLabel(node(), null)).toBe('Hello there');
    expect(nodeLabel(node({ props: {} }), null)).toBe('Message');
    expect(nodeLabel(null, 'Delay')).toBe('Delay');
  });

  it('describes a normal step: ok, the exit taken, the node text as summary', () => {
    const f = stepFields(outcome(), node(), { durationMs: 12, attempt: 1 });
    expect(f).toMatchObject({
      outcome: 'ok',
      port: 2,
      durationMs: 12,
      attempt: 1,
      summary: 'Hello there',
    });
  });

  it('marks a failed end as an error with its code and reason', () => {
    const f = stepFields(
      outcome({
        transition: {
          t: 'end',
          status: 'failed',
          reason: 'send_failed',
          failureCode: 'FLR_X',
          failureReason: 'channel said no',
        },
      }),
      node(),
      { durationMs: 5, attempt: 1 },
    );
    expect(f.outcome).toBe('error');
    expect(f.errorCode).toBe('FLR_X');
    expect(f.summary).toContain('channel said no');
  });

  it('marks a wait, a delay and a missing executor', () => {
    const wait = stepFields(outcome({ transition: { t: 'sleep', seconds: 5 } }), node(), {
      durationMs: 1,
      attempt: 1,
    });
    expect(wait.outcome).toBe('waiting');
    const skipped = stepFields(outcome({ notes: ['no executor for X: moved on'] }), node(), {
      durationMs: 1,
      attempt: 1,
    });
    expect(skipped.outcome).toBe('skipped');
  });

  it('masks and bounds the summary', () => {
    const f = stepFields(
      outcome({ notes: [`call failed token=abc123 ${'x'.repeat(500)}`] }),
      node(),
      {
        durationMs: 1,
        attempt: 1,
      },
    );
    expect(f.summary).not.toContain('abc123');
    expect(f.summary!.length).toBeLessThanOrEqual(240);
  });

  it('stops ordinary steps at the cap but never failures or the end', () => {
    expect(shouldLog(MAX_LOGGED_STEPS - 1, false)).toBe(true);
    expect(shouldLog(MAX_LOGGED_STEPS, false)).toBe(false);
    expect(shouldLog(MAX_LOGGED_STEPS, true)).toBe(true);
  });

  it('hashes equal graphs equally and a changed node differently', () => {
    const g: RuntimeGraph = { nodes: [node()], edges: [{ from: 'n1_1', to: 'n2' }], vars: {} };
    const same: RuntimeGraph = JSON.parse(JSON.stringify(g));
    const edited: RuntimeGraph = JSON.parse(JSON.stringify(g));
    edited.nodes[0]!.props.text = 'Changed';
    expect(hashGraph(g)).toBe(hashGraph(same));
    expect(hashGraph(g)).not.toBe(hashGraph(edited));
  });

  it('hashes a graph the same whatever order its keys come back in', () => {
    const a: RuntimeGraph = {
      nodes: [{ id: 'n1', type: 'End', props: { a: 1, b: 2 } }],
      edges: [],
      vars: {},
    };
    const b: RuntimeGraph = {
      vars: {},
      edges: [],
      nodes: [{ props: { b: 2, a: 1 }, type: 'End', id: 'n1' }],
    };
    expect(hashGraph(a)).toBe(hashGraph(b));
  });

  it('compacts a graph to ids, labels and exits', () => {
    const g: RuntimeGraph = {
      nodes: [node({ label: 'Hi' })],
      edges: [{ from: 'n1_2', to: 'n2' }],
      vars: {},
    };
    expect(compactGraph(g)).toEqual({
      nodes: [{ id: 'n1', type: 'Message', label: 'Hi' }],
      edges: [{ from: 'n1', port: 2, to: 'n2' }],
    });
  });
});
