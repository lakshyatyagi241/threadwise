import {
  FLB_NODE_TYPES,
  flbNodeInMode,
  flbValidateGraph,
  type FlbValidationContext,
  type FlbValidationEdge,
  type FlbValidationNode,
  type FlowType,
} from '@crm/contracts';
import { nodeLabelMsg } from './contract-text';
import { msg, type Msg } from './msg';

export interface ValidationResult {
  ok: boolean;
  items: Msg[];
  badNodeIds: string[];
}

/** The channel word of the "does not work on …" line. QUIRK kept from the contracts: any other channel reads "WhatsApp". */
const MODE_TYPE: Partial<Record<FlowType, FlowType>> = {
  instagram: 'instagram',
  facebook: 'facebook',
  call: 'call',
};

/**
 * `flbValidateGraph` for the screen: the same verdict and the same nodes to outline (the contracts decide those), with the
 * popup's lines as catalogue messages instead of the contracts' English sentences. The lines follow the contracts' rules
 * one for one; `validation-text.test.ts` renders them in English and compares them with the contracts' own.
 */
export function validateGraph(
  nodes: readonly FlbValidationNode[],
  edges: readonly FlbValidationEdge[],
  ctx: FlbValidationContext,
): ValidationResult {
  const verdict = flbValidateGraph(nodes, edges, ctx);
  if (verdict.ok) return { ok: true, items: [], badNodeIds: [] };

  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const e of edges) {
    if (e?.source) outgoing.add(e.source);
    if (e?.target) incoming.add(e.target);
  }
  const startNode = nodes.find((n) => n.isStart) ?? nodes.find((n) => n.type === 'trigger');
  const items: Msg[] = [];
  for (const n of nodes) {
    const isStart = (startNode && n.id === startNode.id) || n.type === 'trigger';
    if (isStart || incoming.has(n.id)) continue;
    items.push(
      msg(
        outgoing.has(n.id)
          ? 'contracts.validation.noIncoming'
          : 'contracts.validation.notConnected',
        {
          node: nodeLabelMsg(n.type),
        },
      ),
    );
  }
  for (const n of nodes) {
    const def = FLB_NODE_TYPES[n.type];
    if (!def || def.hidden || flbNodeInMode(def, ctx.mode)) continue;
    items.push(
      msg('contracts.validation.wrongChannel', {
        node: nodeLabelMsg(n.type),
        channel: msg(`contracts.flowTypes.${MODE_TYPE[ctx.mode] ?? 'chat'}`),
      }),
    );
  }
  const trig = nodes.find((n) => n.type === 'trigger');
  if (trig && !String(trig.data?.deviceId ?? '').trim() && ctx.senderAvailable) {
    items.push(
      msg(
        ctx.mode === 'instagram'
          ? 'contracts.validation.noSenderInstagram'
          : ctx.mode === 'facebook'
            ? 'contracts.validation.noSenderFacebook'
            : 'contracts.validation.noSenderNumber',
      ),
    );
  }
  const seen = new Set<string>();
  const unique = items.filter((m) => {
    const k = JSON.stringify(m);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ok: false, items: unique, badNodeIds: verdict.badNodeIds };
}
