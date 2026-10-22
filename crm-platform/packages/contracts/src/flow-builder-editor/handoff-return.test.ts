import { describe, expect, it } from 'vitest';
import { flbHandoffReturnPlan } from './handoff-return';

const flow = (edges: Array<[string, string, string]>, data: Record<string, unknown> = {}) => ({
  flowNodes: [
    { id: 't', type: 'trigger', data: {} },
    { id: 'h', type: 'assign', data: { handoff: 2, ...data } },
    { id: 'm', type: 'message', data: { text: 'back' } },
  ],
  flowEdges: edges.map(([source, sourceHandle, target], i) => ({
    id: `e${i}`,
    source,
    sourceHandle,
    target,
  })),
});

describe('flbHandoffReturnPlan', () => {
  it('follows the returned wire and carries the trimmed message', () => {
    expect(
      flbHandoffReturnPlan(
        flow([['h', 'returned', 'm']], { returnMessage: '  Hi {{name}}, I am back  ' }),
        'h',
      ),
    ).toEqual({ ok: true, targetNodeId: 'm', message: 'Hi {{name}}, I am back' });
  });

  it('an unwired returned exit, or one leading to a missing node or to itself, means no exit', () => {
    for (const edges of [
      [['h', 'assigned', 'm']],
      [['h', 'returned', 'gone']],
      [['h', 'returned', 'h']],
    ] as Array<Array<[string, string, string]>>) {
      expect(flbHandoffReturnPlan(flow(edges), 'h')).toEqual({
        ok: false,
        why: 'no_returned_exit',
      });
    }
  });

  it('a node that is gone, or the older Assign agent step, is node_gone', () => {
    expect(flbHandoffReturnPlan(flow([['h', 'returned', 'm']]), 'zzz')).toEqual({
      ok: false,
      why: 'node_gone',
    });
    const old = flow([['h', 'returned', 'm']]);
    old.flowNodes[1]!.data = { team: 'x' };
    expect(flbHandoffReturnPlan(old, 'h')).toEqual({ ok: false, why: 'node_gone' });
    expect(flbHandoffReturnPlan(null, 'h')).toEqual({ ok: false, why: 'node_gone' });
  });
});
