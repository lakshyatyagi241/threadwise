import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '@crm/contracts';
import {
  HISTORY_MAX,
  addNode,
  addOption,
  bezierPath,
  canRedo,
  canUndo,
  clampZoom,
  connect,
  connectionFocus,
  edgeFocus,
  createHistory,
  deleteEdge,
  deleteNode,
  duplicateNode,
  pinStart,
  pushHistory,
  redo,
  removeOption,
  undo,
  updateData,
  zoomAround,
  type CanvasState,
} from './graph-ops';

const node = (
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  extra: Partial<FlowNode> = {},
): FlowNode => ({
  id,
  type,
  x: 0,
  y: 0,
  data,
  ...extra,
});
const edge = (id: string, source: string, sourceHandle: string, target: string): FlowEdge => ({
  id,
  source,
  sourceHandle,
  target,
});
const empty: CanvasState = { nodes: [], edges: [] };

describe('adding nodes (TW-FLB-015)', () => {
  it('the first node on an empty canvas becomes START; later ones do not', () => {
    const a = addNode(empty, 'message', 10, 20);
    expect(a.ok && a.state.nodes[0]).toMatchObject({
      type: 'message',
      x: 10,
      y: 20,
      isStart: true,
    });
    const b = addNode((a as { state: CanvasState }).state, 'end', 0, 0);
    expect(b.ok && b.state.nodes[1]!.isStart).toBeUndefined();
  });

  it('a second Trigger is refused with the toast text', () => {
    const a = addNode(empty, 'trigger', 0, 0);
    const b = addNode((a as { state: CanvasState }).state, 'trigger', 5, 5);
    expect(b).toEqual({ ok: false, message: 'Trigger can only exist once.' });
  });

  it('a node starts with the catalogue defaults and an id of the form n_xxxxxx', () => {
    const r = addNode(empty, 'delay', 0, 0);
    expect(r.ok && r.state.nodes[0]!.data).toEqual({ amount: 5, unit: 'min' });
    expect(r.ok && r.id).toMatch(/^n_[a-z0-9]{6}$/);
  });

  it('an unknown type is refused', () => {
    expect(addNode(empty, 'bogus', 0, 0).ok).toBe(false);
  });
});

describe('duplicate, delete, pin (TW-FLB-015 rules 4, 5)', () => {
  const s: CanvasState = {
    nodes: [
      node('a', 'trigger', {}, { isStart: true }),
      node('b', 'message', { text: 'hi', nested: { k: 1 } }, { x: 100, y: 100, isStart: false }),
    ],
    edges: [edge('e1', 'a', 'out', 'b')],
  };

  it('Ctrl+D copies data deeply, offsets by 40, copies no edge and never the start flag', () => {
    const r = duplicateNode(s, 'b');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const copy = r.state.nodes[2]!;
    expect(copy).toMatchObject({
      type: 'message',
      x: 140,
      y: 140,
      data: { text: 'hi', nested: { k: 1 } },
    });
    expect(copy.isStart).toBeUndefined();
    expect(copy.id).not.toBe('b');
    expect(r.state.edges).toHaveLength(1);
    (copy.data.nested as { k: number }).k = 2;
    expect((s.nodes[1]!.data.nested as { k: number }).k).toBe(1);
  });

  it('the Trigger cannot be duplicated', () => {
    expect(duplicateNode(s, 'a')).toEqual({
      ok: false,
      message: 'Trigger can only exist once — can’t duplicate.',
    });
  });

  it('deleting a node removes all its incident edges', () => {
    const r = deleteNode(s, 'b');
    expect(r.nodes.map((n) => n.id)).toEqual(['a']);
    expect(r.edges).toEqual([]);
  });

  it('pinning moves START (one at a time); pinning the current start unpins it', () => {
    const pinned = pinStart(s, 'b');
    expect(pinned.nodes.map((n) => n.isStart)).toEqual([false, true]);
    expect(pinStart(pinned, 'b').nodes.map((n) => n.isStart)).toEqual([false, false]);
  });

  it('an edge is deleted by id', () => {
    expect(deleteEdge(s, 'e1').edges).toEqual([]);
  });
});

describe('connecting (TW-FLB-015 rule 3)', () => {
  const s: CanvasState = {
    nodes: [node('a', 'message'), node('b', 'message'), node('c', 'message')],
    edges: [],
  };

  it('a self connection is ignored', () => {
    expect(connect(s, { nodeId: 'a', handleId: 'out' }, 'a')).toBe(s);
  });

  it('an identical edge replaces itself (no duplicates)', () => {
    const once = connect(s, { nodeId: 'a', handleId: 'out' }, 'b');
    const twice = connect(once, { nodeId: 'a', handleId: 'out' }, 'b');
    expect(twice.edges).toHaveLength(1);
    expect(twice.edges[0]!.id).not.toBe(once.edges[0]!.id);
  });

  it('the same handle may fan out to several targets; a `no` handle marks the edge', () => {
    let r = connect(s, { nodeId: 'a', handleId: 'out' }, 'b');
    r = connect(r, { nodeId: 'a', handleId: 'out' }, 'c');
    expect(r.edges.map((e) => e.target)).toEqual(['b', 'c']);
    expect(connect(s, { nodeId: 'a', handleId: 'no' }, 'b').edges[0]!.kind).toBe('no');
    expect(connect(s, { nodeId: 'a', handleId: 'yes' }, 'b').edges[0]!.kind).toBeNull();
  });
});

describe('options (TW-FLB-015 rule 9, TW-FLB-035..050)', () => {
  const buttons = (n: number): CanvasState => ({
    nodes: [
      node('b', 'buttons', { options: Array.from({ length: n }, (_, i) => `O${i}`) }),
      node('x', 'end'),
      node('y', 'end'),
      node('z', 'end'),
    ],
    edges: [edge('e0', 'b', 'p0', 'x'), edge('e1', 'b', 'p1', 'y'), edge('e2', 'b', 'p2', 'z')],
  });

  it('removing option 2 of 3 deletes its edge and option 3 now hangs off p1', () => {
    const r = removeOption(buttons(3), 'b', 1);
    expect(r.nodes[0]!.data.options).toEqual(['O0', 'O2']);
    expect(r.edges.map((e) => [e.id, e.sourceHandle])).toEqual([
      ['e0', 'p0'],
      ['e2', 'p1'],
    ]);
  });

  it("removing an option never touches another node's edges", () => {
    const s = { ...buttons(3), edges: [...buttons(3).edges, edge('e9', 'x', 'p2', 'y')] };
    expect(removeOption(s, 'b', 0).edges.find((e) => e.id === 'e9')!.sourceHandle).toBe('p2');
  });

  it('buttons, ask and poll stop at 3 with their own message; lists go to 10', () => {
    expect(addOption(buttons(3), 'b')).toEqual({ ok: false, message: 'Max 3 quick reply buttons' });
    const ask: CanvasState = { nodes: [node('a', 'ask', { options: ['1', '2', '3'] })], edges: [] };
    expect(addOption(ask, 'a')).toEqual({ ok: false, message: 'Max 3 expected answers' });
    const poll: CanvasState = {
      nodes: [node('p', 'poll', { options: ['1', '2', '3'] })],
      edges: [],
    };
    expect(addOption(poll, 'p')).toEqual({ ok: false, message: 'Max 3 poll options' });
    const list: CanvasState = {
      nodes: [
        node('l', 'list', {
          options: Array.from({ length: 10 }, (_, i) => ({
            title: `i${i}`,
            description: '',
            section: '',
          })),
        }),
      ],
      edges: [],
    };
    expect(addOption(list, 'l')).toEqual({ ok: false, message: 'Max 10 items' });
  });

  it("a new option gets the type's default label; a list item inherits the last section", () => {
    const r = addOption(buttons(2), 'b');
    expect(r.ok && r.state.nodes[0]!.data.options).toEqual(['O0', 'O1', 'Button 3']);
    const list: CanvasState = {
      nodes: [node('l', 'list', { options: [{ title: 'A', description: '', section: 'Menu' }] })],
      edges: [],
    };
    const l = addOption(list, 'l');
    expect(l.ok && l.state.nodes[0]!.data.options).toEqual([
      { title: 'A', description: '', section: 'Menu' },
      { title: 'Item 2', description: '', section: 'Menu' },
    ]);
  });

  it('data updates merge into the node only', () => {
    const r = updateData(buttons(1), 'b', { prompt: 'Hi' });
    expect(r.nodes[0]!.data).toMatchObject({ prompt: 'Hi', options: ['O0'] });
    expect(r.nodes[1]!.data).toEqual({});
  });
});

describe('undo and redo (TW-FLB-015 rules 6, 7)', () => {
  const at = (n: number): CanvasState => ({
    nodes: [node('n', 'message', {}, { x: n })],
    edges: [],
  });

  it('three moves then two undos returns to the state after the first move; redo re-applies', () => {
    let h = createHistory(at(0));
    h = pushHistory(h, at(1));
    h = pushHistory(h, at(2));
    h = pushHistory(h, at(3));
    const u1 = undo(h)!;
    const u2 = undo(u1.history)!;
    expect(u2.state.nodes[0]!.x).toBe(1);
    expect(redo(u2.history)!.state.nodes[0]!.x).toBe(2);
  });

  it('a new change after an undo drops the redo tail', () => {
    let h = pushHistory(createHistory(at(0)), at(1));
    h = undo(h)!.history;
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, at(9));
    expect(canRedo(h)).toBe(false);
    expect(undo(h)!.state.nodes[0]!.x).toBe(0);
  });

  it('keeps at most 60 snapshots', () => {
    let h = createHistory(at(0));
    for (let i = 1; i <= 100; i++) h = pushHistory(h, at(i));
    expect(h.stack).toHaveLength(HISTORY_MAX);
    expect(h.index).toBe(HISTORY_MAX - 1);
    expect(JSON.parse(h.stack[HISTORY_MAX - 1]!).nodes[0].x).toBe(100);
  });

  it('nothing to undo or redo at the ends', () => {
    const h = createHistory(at(0));
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBeNull();
    expect(redo(h)).toBeNull();
  });
});

describe('geometry', () => {
  it('the bezier uses at least 40 px of control offset, half the horizontal distance otherwise', () => {
    expect(bezierPath(0, 0, 10, 0)).toBe('M 0 0 C 40 0, -30 0, 10 0');
    expect(bezierPath(0, 0, 200, 50)).toBe('M 0 0 C 100 0, 100 50, 200 50');
  });

  it('zoom is clamped to 0.4..1.8 and keeps the world point under the pointer', () => {
    expect(clampZoom(0.1)).toBe(0.4);
    expect(clampZoom(5)).toBe(1.8);
    const r = zoomAround({ x: 40, y: 40 }, 1, 1.5, 240, 140);
    expect(r.zoom).toBe(1.5);
    expect((240 - r.pan.x) / r.zoom).toBeCloseTo((240 - 40) / 1);
    expect((140 - r.pan.y) / r.zoom).toBeCloseTo((140 - 40) / 1);
  });
});

describe('connection focus', () => {
  const edges = [
    edge('e1', 'a', 'out', 'b'),
    edge('e2', 'b', 'p0', 'c'),
    edge('e3', 'b', 'p1', 'd'),
    edge('e4', 'x', 'out', 'y'),
    edge('e5', 'b', 'p2', 'b'),
  ];

  it('nothing is selected: no focus, so nothing is faded', () => {
    expect(connectionFocus(edges, null)).toBeNull();
  });

  it('a selected node highlights its edges, the nodes leading into it and the nodes it leads to', () => {
    const f = connectionFocus(edges, 'b')!;
    expect([...f.edgeIds].sort()).toEqual(['e1', 'e2', 'e3', 'e5']);
    expect([...f.upstream]).toEqual(['a']);
    expect([...f.downstream].sort()).toEqual(['c', 'd']);
  });

  it('a self-loop is highlighted but the node is not its own neighbour', () => {
    const f = connectionFocus(edges, 'b')!;
    expect(f.upstream.has('b') || f.downstream.has('b')).toBe(false);
  });

  it('a node with no wires has an empty focus (everything else still fades)', () => {
    const f = connectionFocus(edges, 'z')!;
    expect(f.edgeIds.size + f.upstream.size + f.downstream.size).toBe(0);
  });

  it('a clicked wire highlights itself, the node it leaves and the node it enters', () => {
    const f = edgeFocus(edges, 'e2')!;
    expect([...f.edgeIds]).toEqual(['e2']);
    expect([...f.upstream]).toEqual(['b']);
    expect([...f.downstream]).toEqual(['c']);
  });

  it('a wire that no longer exists has no focus', () => {
    expect(edgeFocus(edges, 'gone')).toBeNull();
    expect(edgeFocus(edges, null)).toBeNull();
  });
});
