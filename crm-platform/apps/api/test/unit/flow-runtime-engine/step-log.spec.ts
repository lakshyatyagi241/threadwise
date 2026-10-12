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
  describeSent,
  finishIo,
  newIo,
  splitIo,
  varsChanged,
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

  it('describes a normal step: ok, the exit taken, no invented summary', () => {
    const f = stepFields(outcome(), node(), { durationMs: 12, attempt: 1 });
    expect(f).toMatchObject({
      outcome: 'ok',
      port: 2,
      durationMs: 12,
      attempt: 1,
      summary: null,
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

  it('describes what a node sent, not the node setting', () => {
    expect(describeSent({ kind: 'text', body: 'Hi Asha' }, { ok: true })).toBe('text: Hi Asha');
    expect(
      describeSent({ kind: 'media', mediaKind: 'image', url: 'https://x/y.png' }, { ok: true }),
    ).toBe('image: https://x/y.png');
    expect(
      describeSent(
        { kind: 'text', body: 'Hi' },
        { ok: false, error: 'channel down', code: 'X', halt: true },
      ),
    ).toBe('text: Hi (not sent: channel down)');
    const f = stepFields(outcome({ sent: ['text: Hi Asha'], notes: [] }), node(), {
      durationMs: 1,
      attempt: 1,
    });
    expect(f.summary).toBe('text: Hi Asha');
  });

  it('labels a Message node by the text of its first reply', () => {
    const m = node({ props: { replies: [{ type: 'Text', data: 'We are open 9 to 5.' }] } });
    expect(nodeLabel(m, null)).toBe('We are open 9 to 5.');
  });

  it('finds the variables a step changed, without internal keys or flattened children', () => {
    expect(
      varsChanged(
        { a: '1', keep: 'x' },
        { a: '2', keep: 'x', resp: '{"id":1}', 'resp.id': 1, __subflow_depth: 1, fresh: 'y' },
      ),
    ).toEqual([
      { kind: 'variable', name: 'a', value: '2' },
      { kind: 'variable', name: 'resp', value: '{"id":1}' },
      { kind: 'variable', name: 'fresh', value: 'y' },
    ]);
  });

  it('keeps input and output small: clipped, capped, secrets masked', () => {
    const io = newIo();
    io.in.push({ kind: 'variable', name: 'api_key', value: 'abc123' });
    io.in.push({ kind: 'variable', name: 'note', value: 'x'.repeat(900) });
    for (let i = 0; i < 30; i++) io.out.push({ kind: 'variable', name: `v${i}`, value: 'v' });
    io.out.push({ kind: 'message', name: 'text', value: 'Bearer abc.def hi' });
    const done = finishIo(io)!;
    expect(done.in[0]!.value).toBe('***');
    expect(done.in[1]!.value.length).toBeLessThanOrEqual(300);
    expect(done.out.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(done).length).toBeLessThan(4600);
    expect(finishIo(newIo())).toBeNull();
  });

  it('splits stored io off a row detail and ignores malformed items', () => {
    const r = splitIo({
      next: 'n2',
      io: {
        in: [
          { kind: 'reply', name: null, value: 'yes' },
          { kind: 'bogus', value: 1 },
        ],
        out: [],
      },
    });
    expect(r.detail).toEqual({ next: 'n2' });
    expect(r.input).toEqual([{ kind: 'reply', name: null, value: 'yes' }]);
    expect(r.output).toEqual([]);
  });

  it('marks a node whose message never reached the customer as an error, though the run went on', () => {
    const f = stepFields(
      outcome({ sent: ['image: x (not sent: bad link)'], sendFailed: true }),
      node(),
      { durationMs: 1, attempt: 1 },
    );
    expect(f.outcome).toBe('error');
    expect(f.summary).toContain('not sent');
    // A wait that failed to send keeps its own state.
    const w = stepFields(
      outcome({
        transition: { t: 'wait', wait: { nodeId: 'n1', variable: 'x', kind: 'Question' } },
        sendFailed: true,
      }),
      node(),
      { durationMs: 1, attempt: 1 },
    );
    expect(w.outcome).toBe('waiting');
  });
});
