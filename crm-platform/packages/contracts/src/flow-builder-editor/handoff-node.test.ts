import { describe, expect, it } from 'vitest';
import { flbNormalizeGraph } from './graph';
import { flbDefaultNodeData, flbPortsFor } from './node-catalogue';

const graph = (assignData?: Record<string, unknown>) => ({
  flowNodes: [
    { id: 't', type: 'trigger', x: 0, y: 0, data: { kind: 'keyword', keywords: 'hi' } },
    { id: 'a', type: 'assign', x: 300, y: 0, data: assignData },
    { id: 'm', type: 'message', x: 600, y: 0, data: { text: 'bye' } },
  ],
  flowEdges: [
    { id: 'e1', source: 't', sourceHandle: 'out', target: 'a' },
    { id: 'e2', source: 'a', sourceHandle: 'out', target: 'm' },
  ],
  vars: [],
});

describe('opening a flow that has an Assign agent step (BL-398)', () => {
  it('keeps the step as the old Assign agent: its fields, its single exit and its wire', () => {
    const g = flbNormalizeGraph(graph({ team: 'team-1', userId: '', message: 'old note' }));
    const node = g.flowNodes.find((n) => n.id === 'a')!;
    expect(node.data).toEqual({ team: 'team-1', userId: '', message: 'old note' });
    expect(node.data.handoff).toBeUndefined();
    expect(flbPortsFor(node)).toHaveLength(1);
    // the wire on the old `out` exit survives
    expect(g.flowEdges.map((e) => `${e.source}:${e.sourceHandle}`)).toContain('a:out');
  });

  it('a step saved with no data at all is the old step too (empty fields, one exit)', () => {
    const node = flbNormalizeGraph(graph(undefined)).flowNodes.find((n) => n.id === 'a')!;
    expect(node.data).toEqual({ team: '', userId: '', message: '' });
    expect(flbPortsFor(node)).toHaveLength(1);
  });

  it('a step saved as the Human handoff keeps its marker and its three exits', () => {
    const node = flbNormalizeGraph(
      graph({ handoff: 2, destination: 'rules', reason: 'complaint' }),
    ).flowNodes.find((n) => n.id === 'a')!;
    expect(node.data).toMatchObject({ handoff: 2, destination: 'rules', reason: 'complaint' });
    expect(flbPortsFor(node).map((p) => p.id)).toEqual(['assigned', 'waiting', 'unavailable']);
  });

  it('only a NEW step starts as the Human handoff', () => {
    expect(flbDefaultNodeData('assign')).toMatchObject({ handoff: 2, destination: 'team' });
  });
});
