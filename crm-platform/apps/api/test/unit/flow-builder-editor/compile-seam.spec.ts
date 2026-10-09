import { describe, expect, it } from 'vitest';
import {
  FLB_NODE_TYPE_LIST,
  flbDefaultNodeData,
  flbHandleToPort,
  flbNormalizeGraph,
  flbPortsFor,
} from '@crm/contracts';
import {
  TYPE_MAP,
  compileGraph,
} from '../../../src/modules/flow-runtime-engine/graph/compile-graph';

/**
 * The editor / runtime seam (TW-FLB-019 + TW-FLR-013): every node type the editor can save must survive the runtime's graph
 * compiler: not dropped, not mis-ported. The runtime reads the builder vocabulary only through `compileGraph`, so a type it does
 * not know is a node that cannot run.
 */

/**
 * Types the editor saves that the runtime compiler has no executor name for yet: the Call flow family, the Telegram payment node and
 * the Instagram / Messenger nodes that need a channel feature this stack does not have (a card carousel, a public comment reply, a lead
 * capture). FLR keeps their raw data and the runtime warns and moves on (TW-FLR-016 rule 4). Instagram's send, ask, quick replies,
 * link buttons and AI reply run on the shared executors and the two WhatsApp hand-offs have their own. Pinned here so a NEW unmapped
 * type fails this test.
 */
const UNMAPPED = [
  'cf_ai',
  'cf_assistant',
  'cf_hangup',
  'cf_listen',
  'cf_menu',
  'cf_say',
  'cf_search',
  'cf_transfer',
  'fb_gallery',
  'fb_lead',
  'fb_products',
  'fb_reply_comment',
  'ig_lead',
  'ig_products',
  'ig_reply_comment',
  'tg_payment',
];

const graphWith = (type: string) => {
  const data = flbDefaultNodeData(type);
  const node = { id: `n_${type}`, type, x: 0, y: 0, data };
  const trigger = {
    id: 'n_trig',
    type: 'trigger',
    x: 0,
    y: 0,
    data: flbDefaultNodeData('trigger'),
    isStart: true,
  };
  const ports = flbPortsFor(node);
  const sinks = ports.map((p, i) => ({ id: `s${i}`, type: 'end', x: 0, y: 0, data: {} }));
  return {
    node,
    ports,
    graph: flbNormalizeGraph({
      flowNodes: [trigger, node, ...sinks],
      flowEdges: [
        { id: 'e0', source: 'n_trig', sourceHandle: 'out', target: node.id },
        ...ports.map((p, i) => ({
          id: `e${i + 1}`,
          source: node.id,
          sourceHandle: p.id,
          target: `s${i}`,
        })),
      ],
    }),
  };
};

describe('every node type of the catalogue through the runtime compiler (editor/runtime seam)', () => {
  it('the catalogue holds 68 distinct types (every palette entry and the hidden legacy ones)', () => {
    expect(FLB_NODE_TYPE_LIST).toHaveLength(68);
    expect(new Set(FLB_NODE_TYPE_LIST.map((d) => d.id)).size).toBe(FLB_NODE_TYPE_LIST.length);
  });

  it.each(FLB_NODE_TYPE_LIST.map((d) => d.id))(
    '%s: kept by the compiler, start node first, ports numbered as the editor declares',
    (type) => {
      const { node, ports, graph } = graphWith(type);
      const rt = compileGraph(graph);
      // nothing dropped: trigger + node + one sink per declared port
      expect(rt.nodes.map((n) => n.id)).toContain(node.id);
      expect(rt.nodes).toHaveLength(graph.flowNodes.length);
      expect(rt.nodes[0]!.id).toBe('n_trig');
      const compiled = rt.nodes.find((n) => n.id === node.id)!;
      expect(compiled.type).toBeTruthy();
      if (type !== 'trigger') expect(compiled.type).toBe(TYPE_MAP[type] ?? compiled.type);
      // every declared port leaves by the number the editor's own seam (flbHandleToPort) computes, and ends at its sink
      ports.forEach((p, i) => {
        const from = `${node.id}_${flbHandleToPort(type, p.id)}`;
        const edge = rt.edges.find((e) => e.from === from && e.to === `s${i}`);
        expect(edge, `${type} port ${p.id} -> ${from}`).toBeTruthy();
      });
      // the entry edge reaches the node by the trigger's single port
      expect(rt.edges.find((e) => e.from === 'n_trig_1')?.to).toBe(node.id);
    },
  );

  it('the node types without an executor name in the compiler are exactly the pinned list (a new unmapped type fails here)', () => {
    const unmapped = FLB_NODE_TYPE_LIST.map((d) => d.id).filter((t) => !(t in TYPE_MAP));
    expect(unmapped.sort()).toEqual([...UNMAPPED].sort());
  });

  it('a graph holding every node type at once compiles to the same number of nodes and keeps the pinned start', () => {
    const nodes = FLB_NODE_TYPE_LIST.map((d, i) => ({
      id: `all_${d.id}`,
      type: d.id,
      x: i,
      y: 0,
      data: flbDefaultNodeData(d.id),
    }));
    const g = flbNormalizeGraph({ flowNodes: nodes, flowEdges: [] });
    const rt = compileGraph(g);
    expect(rt.nodes).toHaveLength(nodes.length);
    expect(rt.nodes[0]!.id).toBe('all_trigger');
  });

  it('a handle the node does not declare still routes (imported graphs): p<N> by number, else is 0, the rest is 1', () => {
    for (const [type, handle, port] of [
      ['buttons', 'p3', 4],
      ['ask', 'else', 0],
      ['message', 'whatever', 1],
      ['condition', 'no', 2],
    ] as const) {
      const g = flbNormalizeGraph({
        flowNodes: [
          { id: 'a', type, data: flbDefaultNodeData(type) },
          { id: 'b', type: 'end' },
        ],
        flowEdges: [{ source: 'a', sourceHandle: handle, target: 'b' }],
      });
      expect(compileGraph(g).edges).toEqual([{ from: `a_${port}`, to: 'b' }]);
      expect(flbHandleToPort(type, handle)).toBe(port);
    }
  });
});
