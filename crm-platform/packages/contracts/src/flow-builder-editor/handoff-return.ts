/**
 * Return to bot, as the flow sees it (docs/specs/conversation-handoff-and-assignment.md, BL-410). The Human handoff node has an optional
 * fourth exit `returned`: when a person gives the conversation back, the flow continues at the node that exit leads to. These pure
 * readers are used by the API (to say whether the flow will continue, and to start it) and by the builder (to warn about a message that
 * has no exit to ride on), so both agree on what "connected" means. They read the stored builder graph (`flowNodes`, `flowEdges`).
 */

/** The longest "bot is back" message to the customer (a plain WhatsApp text; the handoff messages share it). */
export const HANDOFF_RETURN_MESSAGE_MAX = 1000;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export type HandoffReturnPlan =
  | { ok: true; targetNodeId: string; message: string }
  | { ok: false; why: 'node_gone' | 'no_returned_exit' };

/**
 * Where the flow continues when the handoff node `nodeId` is given back: the target of its `returned` wire, and the optional message
 * to the customer written on the node. A node that is gone (or is not a Human handoff) is `node_gone`; a handoff node whose `returned`
 * exit leads nowhere (or to a node that no longer exists) is `no_returned_exit`: the bot then simply waits for the next message.
 */
export function flbHandoffReturnPlan(flowData: unknown, nodeId: string): HandoffReturnPlan {
  const g = rec(flowData);
  const nodes = list(g.flowNodes).map(rec);
  const node = nodes.find((n) => text(n.id) === nodeId);
  if (!node || text(node.type) !== 'assign' || rec(node.data).handoff !== 2)
    return { ok: false, why: 'node_gone' };
  const wire = list(g.flowEdges)
    .map(rec)
    .find((e) => text(e.source) === nodeId && text(e.sourceHandle) === 'returned');
  const target = wire ? text(wire.target) : '';
  if (target === '' || target === nodeId || !nodes.some((n) => text(n.id) === target))
    return { ok: false, why: 'no_returned_exit' };
  return {
    ok: true,
    targetNodeId: target,
    message: text(rec(node.data).returnMessage).trim().slice(0, HANDOFF_RETURN_MESSAGE_MAX),
  };
}
