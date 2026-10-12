import { describe, expect, it } from 'vitest';
import type { FlowRunStep } from '@crm/contracts';
import { formatMs, nodeNames, pathOf, stepFacts, timelineRows, waitStates } from './timeline-model';

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
  input: [],
  output: [],
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

describe('stepFacts', () => {
  const names = nodeNames({
    graph: { nodes: [{ id: 'n2', type: 'Message', label: 'Hours' }], edges: [] },
    log: [],
  });
  it('words the next node by its name, never its id or raw keys', () => {
    expect(stepFacts(step({ detail: { next: 'n2' } }), names)).toEqual([
      { kind: 'next', node: 'Hours' },
    ]);
    expect(stepFacts(step({ detail: { next: 'gone' } }), names)).toEqual([
      { kind: 'next', node: 'gone' },
    ]);
  });
  it('knows replies, waits, delays and why a run ended', () => {
    expect(stepFacts(step({ event: 'reply', detail: { text: 'yes', tap: 'b1' } }), names)).toEqual([
      { kind: 'replied', text: 'yes' },
    ]);
    expect(
      stepFacts(step({ nodeId: 'n2', detail: { waitingOn: 'n2', seconds: 5 } }), names),
    ).toEqual([
      { kind: 'waitingAt', node: 'Hours' },
      { kind: 'delay', seconds: 5 },
    ]);
    expect(
      stepFacts(step({ event: 'end', detail: { reason: 'dead_end', status: 'completed' } }), names),
    ).toEqual([{ kind: 'ended', reason: 'dead_end' }]);
  });
  it('says nothing for a step with no detail', () => {
    expect(stepFacts(step({}), names)).toEqual([]);
  });
});

describe('waitStates', () => {
  const ask = step({ seq: 1, event: 'wait', outcome: 'waiting', at: '2026-01-01T00:00:00Z' });
  const answer = step({ seq: 2, event: 'reply', at: '2026-01-01T00:00:23Z' });
  it('settles a wait with the next customer reply and says how long it took', () => {
    const w = waitStates([ask, answer], true);
    expect(w.get(ask)).toEqual({ state: 'answered', ms: 23000 });
  });
  it('leaves the last wait waiting while the run is live, and gave up once it is over', () => {
    expect(waitStates([ask], true).get(ask)).toEqual({ state: 'waiting' });
    expect(waitStates([ask], false).get(ask)).toEqual({ state: 'gaveUp' });
  });
  it('settles each wait by its own reply (a re-prompt is a new wait)', () => {
    const again = step({ seq: 3, event: 'wait', outcome: 'waiting', at: '2026-01-01T00:00:30Z' });
    const second = step({ seq: 4, event: 'reply', at: '2026-01-01T00:00:40Z' });
    const w = waitStates([ask, answer, again, second], true);
    expect(w.get(ask)).toMatchObject({ state: 'answered', ms: 23000 });
    expect(w.get(again)).toMatchObject({ state: 'answered', ms: 10000 });
  });
  it('ignores rows that are not waits', () => {
    expect(waitStates([answer], true).size).toBe(0);
  });
});

describe('a menu kept alive after a dead end', () => {
  const names = (id: string) => id;
  it('says the options stay active, not that this node is waiting', () => {
    const row = step({ nodeId: 'num', event: 'wait', detail: { waitingOn: 'menu' } });
    expect(stepFacts(row, names)).toEqual([{ kind: 'menuKept', node: 'menu' }]);
  });
  it('still says a node waits at itself', () => {
    const row = step({ nodeId: 'q', event: 'wait', detail: { waitingOn: 'q' } });
    expect(stepFacts(row, names)).toEqual([{ kind: 'waitingAt', node: 'q' }]);
  });
});
