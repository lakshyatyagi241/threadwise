import { z } from 'zod';
import { flbDefaultNodeData, flbIsFlowType, type FlowType, type FlbNodeData } from './node-catalogue';

/**
 * The flow graph as the builder stores it (WD-FLB-015, 019, 029): `{ flowNodes, flowEdges, vars }`. The vocabulary is
 * WaDesk's (so exports and templates written there import here unchanged); this file owns turning loose JSON into a
 * well-formed graph.
 */

export const FLB_NODE_WIDTH = 280;
export const FLB_MAX_FLOW_NODES = 500;
export const FLB_MAX_FLOW_EDGES = 2000;

export interface FlowNode {
  id: string;
  type: string;
  x: number;
  y: number;
  data: FlbNodeData;
  isStart?: boolean;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  /** Session-only styling (`no` edges are red); never persisted. */
  kind?: 'no' | null;
}

export interface FlowVar {
  name: string;
  desc?: string;
  default?: string;
}

export interface FlowGraph {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  vars: FlowVar[];
}

export const flbEmptyGraph = (): FlowGraph => ({ flowNodes: [], flowEdges: [], vars: [] });

/** Loose input: what a saved row, an import file or a template may hold. Strict shape comes from `flbNormalizeGraph`. */
export const flbLooseGraphSchema = z
  .object({
    flowNodes: z.array(z.record(z.unknown())).max(FLB_MAX_FLOW_NODES),
    flowEdges: z.array(z.record(z.unknown())).max(FLB_MAX_FLOW_EDGES).optional(),
    vars: z.array(z.unknown()).optional(),
  })
  .passthrough();

const rand = (): string => Math.random().toString(36).slice(2, 8).padEnd(6, '0');
export const flbNewNodeId = (): string => `n_${rand()}`;
export const flbNewEdgeId = (): string => `e_${rand()}`;

/** Where node `i` goes when it has no coordinates (WaDesk `ensureNodePositions`: a 3-column grid). */
export const flbGridPosition = (i: number): { x: number; y: number } => ({
  x: 120 + (i % 3) * 260,
  y: 120 + Math.floor(i / 3) * 180,
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Boot normalisation (WD-FLB-015 rule "Boot normalisation"): backfill id / type / x / y / data defaults under the saved
 * data, drop edges whose endpoints do not exist, default a missing `sourceHandle` to `out`, and guarantee exactly one
 * start node (the trigger, else the first node). Used on load, on import, on template clone and on AI output so a graph
 * whose nodes lack coordinates still renders.
 *
 * `fallbackXY` is the position for a node with none; the AI path uses (100, 200) like WaDesk, everything else the grid.
 */
export function flbNormalizeGraph(
  raw: unknown,
  opts: { fallbackXY?: 'grid' | { x: number; y: number } } = {},
): FlowGraph {
  const src = isRecord(raw) ? raw : {};
  const rawNodes = Array.isArray(src.flowNodes) ? src.flowNodes.filter(isRecord) : [];
  const rawEdges = Array.isArray(src.flowEdges) ? src.flowEdges.filter(isRecord) : [];
  const fallback = opts.fallbackXY ?? 'grid';

  const seen = new Set<string>();
  const nodes: FlowNode[] = rawNodes.map((nd, i) => {
    let id = nd.id ? String(nd.id) : flbNewNodeId();
    while (seen.has(id)) id = flbNewNodeId();
    seen.add(id);
    const type = String(nd.type || 'message');
    const nx = Number(nd.x);
    const ny = Number(nd.y);
    const pos = fallback === 'grid' ? flbGridPosition(i) : fallback;
    const data = { ...flbDefaultNodeData(type), ...(isRecord(nd.data) ? nd.data : {}) };
    // A legacy Trigger carries `triggerMode` (WD-FLB-020 rule 4); the default `keywordMode` must not hide it.
    if (type === 'trigger' && isRecord(nd.data) && nd.data.keywordMode === undefined && nd.data.triggerMode !== undefined) {
      data.keywordMode = nd.data.triggerMode;
    }
    return {
      id,
      type,
      x: Number.isFinite(nx) ? nx : pos.x,
      y: Number.isFinite(ny) ? ny : pos.y,
      data,
      isStart: !!nd.isStart,
    };
  });

  const ids = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = rawEdges
    .filter((e) => ids.has(String(e.source)) && ids.has(String(e.target)))
    .map((e) => ({
      id: e.id ? String(e.id) : flbNewEdgeId(),
      source: String(e.source),
      sourceHandle: String(e.sourceHandle || 'out'),
      target: String(e.target),
    }));

  // exactly one start anchor
  if (nodes.length) {
    const starts = nodes.filter((n) => n.isStart);
    if (starts.length === 0) {
      const ti = nodes.findIndex((n) => n.type === 'trigger');
      nodes[ti >= 0 ? ti : 0]!.isStart = true;
    } else if (starts.length > 1) {
      starts.slice(1).forEach((n) => (n.isStart = false));
    }
  }

  const vars: FlowVar[] = Array.isArray(src.vars)
    ? src.vars.filter(isRecord).map((v) => ({
        name: String(v.name ?? ''),
        desc: v.desc === undefined ? undefined : String(v.desc),
        default: v.default === undefined ? undefined : String(v.default),
      }))
    : [];

  return { flowNodes: nodes, flowEdges: edges, vars };
}

/**
 * What the AI generator returns is forced into the same shape, with the AI path's extra rule: the start is the first
 * trigger (else the first node), whatever the model marked.
 */
export function flbNormalizeAiGraph(raw: unknown): FlowGraph {
  const g = flbNormalizeGraph(raw, { fallbackXY: { x: 100, y: 200 } });
  const ti = g.flowNodes.findIndex((n) => n.type === 'trigger');
  const start = ti >= 0 ? ti : 0;
  g.flowNodes.forEach((n, i) => (n.isStart = i === start));
  return g;
}

/** The flow type a graph runs as: call flows stay call; otherwise the Trigger's `channel` if it is available, else the type it was opened as. */
export function flbFlowTypeOf(
  nodes: ReadonlyArray<{ type: string; data?: FlbNodeData | null }>,
  opened: FlowType,
  available: readonly FlowType[],
): FlowType {
  if (opened === 'call') return 'call';
  const trig = nodes.find((n) => n.type === 'trigger');
  const c = trig?.data?.channel;
  return flbIsFlowType(c) && available.includes(c) ? c : opened;
}

export interface FlbGraphStats {
  nodes: number;
  edges: number;
  /** Nodes that send customer-visible content. */
  messages: number;
  waitMinutes: number;
}

const MESSAGE_TYPES = new Set(['message', 'template', 'media', 'buttons', 'list', 'cta']);

/** Featured-card numbers (WD-FLB-002 rule 3): message nodes, and the wait total with WaDesk's unit conversion. */
export function flbGraphStats(graph: Pick<FlowGraph, 'flowNodes' | 'flowEdges'>): FlbGraphStats {
  let messages = 0;
  let waitMinutes = 0;
  for (const n of graph.flowNodes) {
    if (MESSAGE_TYPES.has(n.type)) messages++;
    if (n.type === 'delay') {
      // PHP `(int)` cast and an exact `match` on the unit: any other spelling counts as minutes, as WaDesk does.
      const amount = Math.trunc(Number(n.data.amount)) || 0;
      const unit = String(n.data.unit ?? 'min');
      if (unit === 'sec') waitMinutes += Math.max(1, Math.floor(amount / 60));
      else if (unit === 'hour') waitMinutes += amount * 60;
      else if (unit === 'day') waitMinutes += amount * 1440;
      else waitMinutes += amount;
    }
  }
  return { nodes: graph.flowNodes.length, edges: graph.flowEdges.length, messages, waitMinutes };
}

/** "~N min" / "~N.N h total" / "no waits" (WD-FLB-002). */
export function flbWaitLabel(minutes: number): string {
  if (minutes <= 0) return 'no waits';
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const h = Math.round((minutes / 60) * 10) / 10;
  return `~${h} h total`;
}

// --- featured card mini preview (WD-FLB-002) -----------------------------------------------------------------------------

/** WaDesk's `??`: a missing or null key falls back; an empty string does not. */
const orElse = (v: unknown, fallback: string): string => (v === undefined || v === null ? fallback : String(v));

/** `Str::limit($s, 28)`: cut at 28 characters, trim the right edge, add "...". */
const limit28 = (s: string): string => (s.length <= 28 ? s : `${s.slice(0, 28).trimEnd()}...`);

/**
 * The text of one node in the featured card's mini preview, built from the node's data the way WaDesk's card does. QUIRK kept:
 * the Condition label reads the legacy `var` / `op` / `value` fields, so a condition in the current shape reads "If value == ".
 */
export function flbPreviewLabel(node: { type: string; data?: Record<string, unknown> }): string {
  const d = node.data ?? {};
  switch (node.type) {
    case 'trigger':
      return `Trigger / ${orElse(d.kind, 'manual')}`;
    case 'message':
      return limit28(orElse(d.text, 'Send message'));
    case 'template':
      return `Send template ${orElse(d.tpl, '')}`;
    case 'media':
      return `Send ${orElse(d.kind, 'media')}`;
    case 'buttons':
      return 'Quick replies';
    case 'list':
      return 'List message';
    case 'ask':
      return limit28(orElse(d.prompt, 'Ask'));
    case 'condition':
      return `If ${orElse(d.var, 'value')} ${orElse(d.op, '==')} ${orElse(d.value, '')}`;
    case 'delay':
      return `Wait ${orElse(d.amount, '?')} ${orElse(d.unit, 'min')}`;
    case 'webhook':
      return `Webhook ${orElse(d.method, 'POST')}`;
    case 'ai':
      return `AI ${orElse(d.model, '')}`;
    case 'tag':
      return `Tag: ${orElse(d.action, 'add')} ${orElse(d.tag, '')}`;
    case 'assign':
      return `Assign to ${orElse(d.team, 'team')}`;
    case 'end':
      return 'End flow';
    default:
      return node.type.charAt(0).toUpperCase() + node.type.slice(1);
  }
}
