import { describe, expect, it } from 'vitest';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import { applyReply } from '../../../src/modules/flow-runtime-engine/runtime/engine-core';
import type {
  InboundReply,
  RunState,
} from '../../../src/modules/flow-runtime-engine/runtime/types';

// "Also save to a contact attribute" on List, Quick replies and Ask question: compile, then resume a parked run with a reply.

const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data });
const e = (source: string, target: string, sourceHandle = 'out') => ({
  source,
  sourceHandle,
  target,
});
const save = { saveProperty: true, propertyKey: 'plan' };

function parked(nodes: unknown[], edges: unknown[], waitOn: string, kind: 'List' | 'Question') {
  const graph = compileGraph({ flowNodes: nodes, flowEdges: edges });
  const node = graph.nodes.find((x) => x.id === waitOn)!;
  const run = {
    id: 1,
    uuid: 'r',
    orgId: 1,
    flowId: 1,
    contactId: 7,
    status: 'waiting',
    graph,
    currentNodeId: waitOn,
    vars: {},
    visits: {},
    menus: { latest: null, byNode: {} },
    wait: {
      nodeId: waitOn,
      variable: String(node.props.variable ?? 'choice'),
      kind,
      ...(kind === 'Question' ? { answerItems: [], persistent: false } : {}),
    },
  } as unknown as RunState;
  return run;
}

const tap = (id: string, text: string): InboundReply => ({ kind: 'tap', id, text });
const text = (t: string): InboundReply => ({ kind: 'text', id: '', text: t });

describe('compile: savePropertyKey', () => {
  const key = (type: string, data: Record<string, unknown>) =>
    compileGraph({ flowNodes: [n('x', type, { options: ['A'], ...data })], flowEdges: [] })
      .nodes[0]!.props.savePropertyKey;

  it('list and buttons carry the key only when the box is on', () => {
    for (const type of ['list', 'buttons']) {
      expect(key(type, save)).toBe('plan');
      expect(key(type, { saveProperty: false, propertyKey: 'plan' })).toBe('');
      expect(key(type, {})).toBe('');
    }
  });

  it('keeps the variable name', () => {
    const g = compileGraph({
      flowNodes: [n('l', 'list', { options: ['A'], var: 'size', ...save })],
      flowEdges: [],
    });
    expect(g.nodes[0]!.props.variable).toBe('size');
  });
});

describe('resume: the picked title is handed to the engine to save', () => {
  it('list tap saves the row title', () => {
    const run = parked(
      [
        n('l', 'list', { options: [{ title: 'Alpha' }, { title: 'Beta' }], ...save }),
        n('m', 'message', { text: 'x' }),
      ],
      [e('l', 'm', 'p1')],
      'l',
      'List',
    );
    const out = applyReply(run, tap('list_l_p1', 'Beta'));
    expect(out.saveProperty).toEqual({ key: 'plan', value: 'Beta' });
    expect(run.vars.choice).toBe('Beta');
  });

  it('list typed digit saves the title, not the digit', () => {
    const run = parked(
      [
        n('l', 'list', { options: [{ title: 'Alpha' }, { title: 'Beta' }], ...save }),
        n('m', 'message', { text: 'x' }),
      ],
      [e('l', 'm', 'p1')],
      'l',
      'List',
    );
    expect(applyReply(run, text('2')).saveProperty).toEqual({ key: 'plan', value: 'Beta' });
  });

  it('list: a branch left empty still saves; no match saves nothing', () => {
    const mk = () =>
      parked([n('l', 'list', { options: [{ title: 'Alpha' }], ...save })], [], 'l', 'List');
    expect(applyReply(mk(), tap('list_l_p0', 'Alpha')).saveProperty).toEqual({
      key: 'plan',
      value: 'Alpha',
    });
    expect(applyReply(mk(), text('nonsense')).saveProperty).toBeUndefined();
  });

  it('quick replies tap saves the button label', () => {
    const run = parked(
      [
        n('b', 'buttons', { options: ['Docs', 'Price'], ...save }),
        n('m', 'message', { text: 'x' }),
      ],
      [e('b', 'm', 'p1')],
      'b',
      'Question',
    );
    const out = applyReply(run, tap('b_b_p1', 'Price'));
    expect(out.saveProperty).toEqual({ key: 'plan', value: 'Price' });
  });

  it('a list or buttons node without the setting saves nothing (old flows)', () => {
    const run = parked(
      [n('b', 'buttons', { options: ['Docs'] }), n('m', 'message', { text: 'x' })],
      [e('b', 'm', 'p0')],
      'b',
      'Question',
    );
    expect(applyReply(run, tap('b_b_p0', 'Docs')).saveProperty).toBeUndefined();
  });

  it('a free-text Ask saves the answer as typed; fixed answers save the matched label', () => {
    const free = parked(
      [n('a', 'ask', { prompt: 'Name?', ...save }), n('m', 'message', { text: 'x' })],
      [e('a', 'm', 'out')],
      'a',
      'Question',
    );
    expect(applyReply(free, text('Asha')).saveProperty).toEqual({ key: 'plan', value: 'Asha' });
    const fixed = parked(
      [
        n('a', 'ask', { prompt: 'Plan?', options: ['Pro', 'Basic'], ...save }),
        n('m', 'message', { text: 'x' }),
      ],
      [e('a', 'm', 'p0')],
      'a',
      'Question',
    );
    fixed.wait!.answerItems = [
      { id: 'opt_0', text: 'Pro' },
      { id: 'opt_1', text: 'Basic' },
    ];
    expect(applyReply(fixed, text('pro')).saveProperty).toEqual({ key: 'plan', value: 'Pro' });
  });
});
