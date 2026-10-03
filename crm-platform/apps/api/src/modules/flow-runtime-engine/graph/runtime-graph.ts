/**
 * The graph the executor walks (TW-FLR-013). The editor (FLB) saves a builder graph; `compileGraph` turns it into this, once, when
 * a run starts, and the run keeps that copy. Ports are numbers: 1 is the normal exit, 2.. the options of a choice node, 0 the
 * "nothing matched" branch of a choice node, and a Condition's yes is 1 and no is 2.
 */
export interface RuntimeNode {
  id: string;
  /** PascalCase executor name: Message, Media, Question, InteractiveButtons, List, Poll, Condition, TimeDelay, CTA, Location, End, ... */
  type: string;
  /** Everything the executor reads, shaped by the compiler. Merge tags are left as written and resolved when the node runs. */
  props: Record<string, unknown>;
}

export interface RuntimeEdge {
  /** `<nodeId>_<port>`. */
  from: string;
  /** The target node id, without any port suffix. */
  to: string;
}

export interface RuntimeGraph {
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  vars: Record<string, unknown>;
}

/** The edge leaving a node by a port: the first one in edge order (extra edges on a port are ignored, TW-FLR-016 rule 1). */
export function edgeFrom(graph: RuntimeGraph, nodeId: string, port: number): RuntimeEdge | null {
  const key = `${nodeId}_${port}`;
  return graph.edges.find((e) => e.from === key) ?? null;
}

export function nodeById(graph: RuntimeGraph, id: string): RuntimeNode | null {
  return graph.nodes.find((n) => n.id === id) ?? null;
}
