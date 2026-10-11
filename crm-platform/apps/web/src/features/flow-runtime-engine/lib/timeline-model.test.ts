import { describe, expect, it } from 'vitest';
import type { FlowRunStep } from '@crm/contracts';
import { formatMs, pathOf, timelineRows } from './timeline-model';

const step = (over: Partial<FlowRunStep>): FlowRunStep => ({
  seq: 1,
  nodeId: 'a',
  nodeType: 'Message',
  event: 'advance',
  detail: {},
  error: null,
  at: '2026-01-01T00:00:00Z',
  nodeLabel: 'Greeting',
  outcome: 'ok',
  port: 1,
  durationMs: 10,
  attempt: 1,
  summary: null,
  errorCode: null,
  ...over,
});

describe('formatMs', () => {
  it('keeps milliseconds under a second, then seconds, then minutes', () => {
    expect(formatMs(null)).toBe('');
    expect(formatMs(640)).toBe('640 ms');
    expect(formatMs(1200)).toBe('1.2 s');
    expect(formatMs(24_000)).toBe('24 s');
    expect(formatMs(125_000)).toBe('2 min 5 s');
  });
});

describe('timelineRows', () => {
  const log = [
    step({}),
    step({ seq: 2, outcome: 'error', nodeId: 'b' }),
    step({ seq: 3, event: 'truncated' }),
  ];
  it('lists node rows, never the truncation marker', () => {
    expect(timelineRows(log, 'all').map((s) => s.seq)).toEqual([1, 2]);
  });
  it('can show only the failures', () => {
    expect(timelineRows(log, 'errors').map((s) => s.seq)).toEqual([2]);
  });
});

describe('pathOf', () => {
  const graph = {
    nodes: [
      { id: 'a', type: 'Message', label: 'Greeting v2' },
      { id: 'c', type: 'Message', label: 'Never' },
    ],
    edges: [],
  };
  it('puts reached nodes in run order with their logged label, then the unreached', () => {
    const p = pathOf({
      graph,
      removedNodeIds: ['b'],
      log: [
        step({}),
        step({ seq: 2, event: 'reply' }),
        step({ seq: 3, nodeId: 'b', nodeLabel: 'Hours', attempt: 1 }),
        step({ seq: 4, attempt: 2 }),
      ],
    });
    expect(p.reached.map((n) => [n.id, n.label, n.visits, n.removed])).toEqual([
      ['a', 'Greeting', 2, false],
      ['b', 'Hours', 1, true],
    ]);
    expect(p.unreached.map((n) => n.id)).toEqual(['c']);
  });
  it('is empty when the run has no graph', () => {
    expect(pathOf({ graph: null, removedNodeIds: [], log: [] })).toEqual({
      reached: [],
      unreached: [],
    });
  });
});
