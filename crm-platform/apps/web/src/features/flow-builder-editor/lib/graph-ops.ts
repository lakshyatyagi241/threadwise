import {
  FLB_NODE_TYPES,
  flbDefaultNodeData,
  flbListOption,
  flbNewEdgeId,
  flbNewNodeId,
  type FlowEdge,
  type FlowNode,
  type FlbNodeData,
} from '@crm/contracts';

/**
 * The canvas operations (TW-FLB-015) as pure functions over `{ nodes, edges }`: add, duplicate, delete, connect, pin the
 * start node, add and remove an option. The builder holds the state and the undo history; these hold the rules, so each
 * rule has a test and none depends on React.
 */
export interface CanvasState {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type OpResult = { ok: true; state: CanvasState; id?: string } | { ok: false; message: string };

export const NODE_W = 280;
export const OPTION_CAPS: Record<string, { max: number; message: string; label: string }> = {
  buttons: { max: 3, message: 'Max 3 quick reply buttons', label: 'Button ' },
  ask: { max: 3, message: 'Max 3 expected answers', label: 'Answer ' },
  poll: { max: 3, message: 'Max 3 poll options', label: 'Option ' },
};
const OPTION_HARD_MAX = 10;

/** A fresh node at (x, y). The Trigger can exist once; the first node on an empty canvas becomes START. */
export function addNode(s: CanvasState, type: string, x: number, y: number): OpResult {
  const def = FLB_NODE_TYPES[type];
  if (!def) return { ok: false, message: `Unknown node type "${type}".` };
  if (def.singleton && s.nodes.some((n) => n.type === type)) {
    return { ok: false, message: `${def.label} can only exist once.` };
  }
  const id = flbNewNodeId();
  const node: FlowNode = {
    id,
    type,
    x,
    y,
    data: flbDefaultNodeData(type),
    ...(s.nodes.length === 0 ? { isStart: true } : {}),
  };
  return { ok: true, state: { ...s, nodes: [...s.nodes, node] }, id };
}

/** Pins a node as START (only one; pinning the current start unpins it). */
export function pinStart(s: CanvasState, id: string): CanvasState {
  return { ...s, nodes: s.nodes.map((n) => ({ ...n, isStart: n.id === id ? !n.isStart : false })) };
}

/** A disconnected copy 40 px down-right; never the start; the Trigger cannot be copied. */
export function duplicateNode(s: CanvasState, id: string): OpResult {
  const src = s.nodes.find((n) => n.id === id);
  if (!src) return { ok: false, message: 'Node not found.' };
  const def = FLB_NODE_TYPES[src.type];
  if (def?.singleton) {
    return { ok: false, message: `${def.label || 'This node'} can only exist once — can’t duplicate.` };
  }
  const copy: FlowNode = {
    id: flbNewNodeId(),
    type: src.type,
    x: (src.x || 0) + 40,
    y: (src.y || 0) + 40,
    data: JSON.parse(JSON.stringify(src.data ?? {})) as FlbNodeData,
  };
  return { ok: true, state: { ...s, nodes: [...s.nodes, copy] }, id: copy.id };
}

/** Deleting a node also removes every edge that touches it. */
export function deleteNode(s: CanvasState, id: string): CanvasState {
  return {
    nodes: s.nodes.filter((n) => n.id !== id),
    edges: s.edges.filter((e) => e.source !== id && e.target !== id),
  };
}

export function deleteEdge(s: CanvasState, id: string): CanvasState {
  return { ...s, edges: s.edges.filter((e) => e.id !== id) };
}

/**
 * Connect an output port to a node. A self connection is ignored; an identical (source, handle, target) edge replaces
 * itself; the same handle may fan out to several targets; there is no cycle check (Reference has none).
 */
export function connect(
  s: CanvasState,
  from: { nodeId: string; handleId: string },
  targetId: string,
): CanvasState {
  if (!from.nodeId || !targetId || from.nodeId === targetId) return s;
  const filtered = s.edges.filter(
    (e) => !(e.source === from.nodeId && e.sourceHandle === from.handleId && e.target === targetId),
  );
  const edge: FlowEdge = {
    id: flbNewEdgeId(),
    source: from.nodeId,
    sourceHandle: from.handleId,
    target: targetId,
    kind: from.handleId === 'no' ? 'no' : null,
  };
  return { ...s, edges: [...filtered, edge] };
}

export function updateData(s: CanvasState, id: string, patch: Record<string, unknown>): CanvasState {
  return { ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) };
}

export function moveNode(s: CanvasState, id: string, x: number, y: number): CanvasState {
  return { ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) };
}

/** Adds an option to buttons / list / ask / poll with Reference's caps; a list item inherits the last item's section. */
export function addOption(s: CanvasState, id: string): OpResult {
  const node = s.nodes.find((n) => n.id === id);
  if (!node) return { ok: false, message: 'Node not found.' };
  const opts = Array.isArray(node.data.options) ? [...(node.data.options as unknown[])] : [];
  const cap = OPTION_CAPS[node.type];
  if (cap && opts.length >= cap.max) return { ok: false, message: cap.message };
  if (opts.length >= OPTION_HARD_MAX) return { ok: false, message: 'Max 10 items' };
  const label = cap?.label ?? 'Item ';
  if (node.type === 'list') {
    const last = opts.length ? flbListOption(opts[opts.length - 1], opts.length - 1).section : '';
    opts.push({ title: `${label}${opts.length + 1}`, description: '', section: last });
  } else {
    opts.push(`${label}${opts.length + 1}`);
  }
  return { ok: true, state: updateData(s, id, { options: opts }) };
}

/**
 * Removes option `i`: the edge on that option's port goes, and every higher `p<n>` handle of the node shifts down by one
 * so the remaining edges stay attached to the right option.
 */
export function removeOption(s: CanvasState, id: string, i: number): CanvasState {
  const node = s.nodes.find((n) => n.id === id);
  if (!node) return s;
  const opts = Array.isArray(node.data.options) ? [...(node.data.options as unknown[])] : [];
  opts.splice(i, 1);
  const withData = updateData(s, id, { options: opts });
  const edges = withData.edges
    .filter((e) => !(e.source === id && e.sourceHandle === `p${i}`))
    .map((e) => {
      if (e.source === id && /^p\d+$/.test(e.sourceHandle)) {
        const idx = parseInt(e.sourceHandle.slice(1), 10);
        if (idx > i) return { ...e, sourceHandle: `p${idx - 1}` };
      }
      return e;
    });
  return { ...withData, edges };
}

// --- undo history ---------------------------------------------------------------------------------------------------

export const HISTORY_MAX = 60;

export interface History {
  /** JSON snapshots of `{ nodes, edges }`. */
  stack: string[];
  index: number;
}

export const snapshot = (s: CanvasState): string => JSON.stringify({ nodes: s.nodes, edges: s.edges });
export const createHistory = (s: CanvasState): History => ({ stack: [snapshot(s)], index: 0 });

/** Records a state after the current index (dropping any redo tail), keeping at most 60 snapshots. */
export function pushHistory(h: History, s: CanvasState): History {
  const next = h.stack.slice(0, h.index + 1);
  next.push(snapshot(s));
  const trimmed = next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
  return { stack: trimmed, index: trimmed.length - 1 };
}

export const canUndo = (h: History): boolean => h.index > 0;
export const canRedo = (h: History): boolean => h.index < h.stack.length - 1;

export function undo(h: History): { history: History; state: CanvasState } | null {
  if (!canUndo(h)) return null;
  const index = h.index - 1;
  return { history: { ...h, index }, state: JSON.parse(h.stack[index]!) as CanvasState };
}

export function redo(h: History): { history: History; state: CanvasState } | null {
  if (!canRedo(h)) return null;
  const index = h.index + 1;
  return { history: { ...h, index }, state: JSON.parse(h.stack[index]!) as CanvasState };
}

// --- geometry -------------------------------------------------------------------------------------------------------

/** The bezier of an edge between two port centres (Reference's control-point rule). */
export const bezierPath = (x1: number, y1: number, x2: number, y2: number): string => {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
};

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.8;
export const ZOOM_DEFAULT = 0.95;
export const clampZoom = (z: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

/** Zoom around a point so the world position under the pointer stays put. */
export function zoomAround(
  pan: { x: number; y: number },
  zoom: number,
  next: number,
  mx: number,
  my: number,
): { pan: { x: number; y: number }; zoom: number } {
  const nz = clampZoom(next);
  const wx = (mx - pan.x) / zoom;
  const wy = (my - pan.y) / zoom;
  return { pan: { x: mx - wx * nz, y: my - wy * nz }, zoom: nz };
}
