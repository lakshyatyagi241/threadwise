import { FLOW_TYPE_LABELS, type FlowType } from './node-catalogue';

/**
 * Flow-to-flow links: the places a step hands the conversation to another bot. The Run sub-flow step (`data.flow`) and the
 * "Button pressed action > start another flow" of a Quick replies / List step (`data.optionActions[i] = { type: 'flow', flow }`).
 *
 * A conversation lives on one channel, so a bot may only start bots of its own channel (a WhatsApp bot cannot start a website
 * chat bot, and the other way round). The builder only offers same-channel bots and the server refuses anything else, so a
 * hand-edited graph, an import or an older save cannot hold a cross-channel link either.
 *
 * Not covered on purpose: the Instagram / Messenger "hand off to WhatsApp" steps, whose whole point is crossing channels.
 */
export interface FlbFlowLinkNode {
  id: string;
  type: string;
  data?: Record<string, unknown> | null;
}

export interface FlbFlowLink {
  nodeId: string;
  nodeType: string;
  /** The flow uuid the step points at (trimmed, never empty). */
  flowId: string;
}

export interface FlbLinkableFlow {
  id: string;
  flowType: string;
  isPublished?: boolean;
}

export type FlbFlowLinkProblemKind = 'self' | 'channel' | 'missing';

export interface FlbFlowLinkProblem extends FlbFlowLink {
  kind: FlbFlowLinkProblemKind;
  message: string;
}

const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Every flow a graph's steps point at, in node order (an unset picker is not a link). */
export function flbFlowLinks(nodes: readonly FlbFlowLinkNode[]): FlbFlowLink[] {
  const out: FlbFlowLink[] = [];
  for (const n of nodes) {
    const d = rec(n.data);
    if (n.type === 'subflow' && typeof d.flow === 'string' && d.flow.trim() !== '')
      out.push({ nodeId: n.id, nodeType: n.type, flowId: d.flow.trim() });
    for (const a of Object.values(rec(d.optionActions))) {
      const act = rec(a);
      if (act.type === 'flow' && typeof act.flow === 'string' && act.flow.trim() !== '')
        out.push({ nodeId: n.id, nodeType: n.type, flowId: act.flow.trim() });
    }
  }
  return out;
}

/** The flows a step of a `channel` bot may start: the same channel, never the bot being edited. */
export function flbLinkableFlows<T extends FlbLinkableFlow>(
  flows: readonly T[],
  channel: FlowType | string,
  selfId?: string | null,
): T[] {
  return flows.filter((f) => f.flowType === channel && f.id !== selfId);
}

const label = (t: string): string => FLOW_TYPE_LABELS[t as FlowType] ?? t;

/**
 * What is wrong with the links of a `channel` bot's graph. `self` and `channel` are always a problem; `missing` (the target was
 * deleted, or is not this workspace's) only matters when the bot goes live, so callers decide whether to ask for it.
 */
export function flbFlowLinkProblems(
  nodes: readonly FlbFlowLinkNode[],
  ctx: { channel: FlowType | string; selfId?: string | null; flows: readonly FlbLinkableFlow[] },
  opts: { missing?: boolean } = {},
): FlbFlowLinkProblem[] {
  const byId = new Map(ctx.flows.map((f) => [f.id, f]));
  const out: FlbFlowLinkProblem[] = [];
  for (const l of flbFlowLinks(nodes)) {
    const target = byId.get(l.flowId);
    if (ctx.selfId && l.flowId === ctx.selfId) {
      out.push({ ...l, kind: 'self', message: 'A bot cannot start itself — pick another bot.' });
    } else if (!target) {
      if (opts.missing)
        out.push({
          ...l,
          kind: 'missing',
          message:
            'A step starts a bot that no longer exists — pick another bot or remove the action.',
        });
    } else if (target.flowType !== ctx.channel) {
      out.push({
        ...l,
        kind: 'channel',
        message: `A ${label(ctx.channel)} bot cannot start a ${label(target.flowType)} bot — pick a ${label(ctx.channel)} bot.`,
      });
    }
  }
  return out;
}
