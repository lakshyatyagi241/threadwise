import { FLOW_TYPE_LABELS, flbNodeInMode, FLB_NODE_TYPES, type FlowType, type FlbNodeData } from './node-catalogue';

/**
 * Pre-save graph validation (WD-FLB-018): the guard Save and Publish run before anything is stored. Messages are
 * WaDesk's, word for word (the popup lists them), and so are the rules:
 *
 *  - an empty canvas is valid
 *  - a node nothing leads into is broken: "has no incoming connection" when it has outgoing edges, else "is not connected
 *    to anything". The start node and the Trigger are exempt, and a leaf with no outgoing edge is fine (a flow may end on
 *    any node)
 *  - a node whose type does not run on the flow's channel is flagged (hidden / unknown types are left alone)
 *  - the Trigger must name a sender, but only when the workspace has one to pick for chat / Instagram / Facebook (with
 *    none connected a draft must still save)
 *
 * Not checked, on purpose (inventory rule 5): a missing Trigger, empty required fields, dangling edges, cycles, port
 * completeness, node count.
 */
export interface FlbValidationNode {
  id: string;
  type: string;
  data?: FlbNodeData | null;
  isStart?: boolean;
}
export interface FlbValidationEdge {
  source: string;
  target: string;
}

export interface FlbValidationResult {
  ok: boolean;
  /** One line per problem, de-duplicated, in the order they were found. */
  items: string[];
  /** The nodes to outline in red. */
  badNodeIds: string[];
}

export interface FlbValidationContext {
  /** The channel the flow runs as (see `flbFlowTypeOf`). */
  mode: FlowType;
  /**
   * Whether the workspace has a connected sender for this channel to pick. Only chat, Instagram and Facebook are checked
   * (WaDesk consulted its picker cache for those three alone); pass false for the others.
   */
  senderAvailable: boolean;
}

const MODE_WORD: Partial<Record<FlowType, string>> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  call: 'Call',
};

export function flbValidateGraph(
  nodes: readonly FlbValidationNode[],
  edges: readonly FlbValidationEdge[],
  ctx: FlbValidationContext,
): FlbValidationResult {
  if (nodes.length === 0) return { ok: true, items: [], badNodeIds: [] };

  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const e of edges) {
    if (e?.source) outgoing.add(e.source);
    if (e?.target) incoming.add(e.target);
  }
  const startNode = nodes.find((n) => n.isStart) ?? nodes.find((n) => n.type === 'trigger');
  const bad = new Set<string>();
  const items: string[] = [];

  for (const n of nodes) {
    const isStart = (startNode && n.id === startNode.id) || n.type === 'trigger';
    if (isStart) continue;
    if (incoming.has(n.id)) continue;
    const label = FLB_NODE_TYPES[n.type]?.label ?? n.type;
    bad.add(n.id);
    items.push(
      outgoing.has(n.id)
        ? `"${label}" has no incoming connection — nothing leads into it.`
        : `"${label}" is not connected to anything.`,
    );
  }

  for (const n of nodes) {
    const t = FLB_NODE_TYPES[n.type];
    if (!t || t.hidden) continue;
    if (flbNodeInMode(t, ctx.mode)) continue;
    bad.add(n.id);
    // QUIRK kept: any other channel reads "WhatsApp" in this sentence.
    items.push(
      `"${t.label}" does not work on ${MODE_WORD[ctx.mode] ?? 'WhatsApp'} — delete it or switch the channel back on the Trigger node.`,
    );
  }

  const trig = nodes.find((n) => n.type === 'trigger');
  if (trig && !String(trig.data?.deviceId ?? '').trim()) {
    const checked = ctx.mode === 'chat' || ctx.mode === 'instagram' || ctx.mode === 'facebook';
    if (checked && ctx.senderAvailable) {
      bad.add(trig.id);
      const what =
        ctx.mode === 'instagram' ? 'Instagram account' : ctx.mode === 'facebook' ? 'Facebook Page' : 'number';
      items.push(`The Trigger node has no ${what} selected — pick one on the Trigger step.`);
    }
  }

  const unique = Array.from(new Set(items));
  return { ok: bad.size === 0, items: unique, badNodeIds: nodes.filter((n) => bad.has(n.id)).map((n) => n.id) };
}

export const flbChannelLabel = (t: FlowType): string => FLOW_TYPE_LABELS[t];
