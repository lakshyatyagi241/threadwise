/** The pure half of the run timeline (TW-FLR-083): which log rows show, how long a node took, which nodes the run reached. */
import type { FlowRunDetail, FlowRunStep, FlowStepOutcome } from '@crm/contracts';

export type TimelineFilter = 'all' | 'errors';

/** 640 ms, 1.2 s, 2 min 5 s: node times are short, so milliseconds stay visible below a second. */
export function formatMs(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

/** The rows the timeline lists: the node executions, not the engine's own bookkeeping row (`truncated` is told apart by a notice). */
export function timelineRows(log: FlowRunStep[], filter: TimelineFilter): FlowRunStep[] {
  const rows = log.filter((s) => s.event !== 'truncated');
  return filter === 'errors' ? rows.filter((s) => s.outcome === 'error' || s.error) : rows;
}

export const outcomeTone = (
  o: FlowStepOutcome | null,
): 'success' | 'danger' | 'warning' | 'neutral' =>
  o === 'error'
    ? 'danger'
    : o === 'ok'
      ? 'success'
      : o === 'waiting' || o === 'timeout'
        ? 'warning'
        : 'neutral';

export interface PathNode {
  id: string;
  label: string;
  type: string;
  /** How many times the run executed it (a loop shows more than 1). */
  visits: number;
  /** The flow no longer has this node. */
  removed: boolean;
}

/** The flow's nodes as the run walked them: reached ones first in the order they ran, then the ones it never reached. */
export function pathOf(run: Pick<FlowRunDetail, 'graph' | 'log' | 'removedNodeIds'>): {
  reached: PathNode[];
  unreached: PathNode[];
} {
  if (!run.graph) return { reached: [], unreached: [] };
  const removed = new Set(run.removedNodeIds);
  const byId = new Map(run.graph.nodes.map((n) => [n.id, n]));
  const order: string[] = [];
  const visits = new Map<string, number>();
  for (const s of run.log) {
    if (!s.nodeId || s.event === 'reply' || s.event === 'truncated') continue;
    if (!visits.has(s.nodeId)) order.push(s.nodeId);
    visits.set(s.nodeId, (visits.get(s.nodeId) ?? 0) + 1);
  }
  const make = (id: string, label: string, type: string): PathNode => ({
    id,
    label,
    type,
    visits: visits.get(id) ?? 0,
    removed: removed.has(id),
  });
  const reached = order.map((id) => {
    const g = byId.get(id);
    const logged = run.log.find((s) => s.nodeId === id);
    return make(id, logged?.nodeLabel ?? g?.label ?? id, g?.type ?? logged?.nodeType ?? '');
  });
  const unreached = run.graph.nodes
    .filter((n) => !visits.has(n.id))
    .map((n) => make(n.id, n.label, n.type));
  return { reached, unreached };
}

/** What a log row says beyond its summary, as facts the screen words in the viewer's language. No raw `detail` keys reach the screen. */
export type StepFact =
  | { kind: 'next'; node: string }
  | { kind: 'waitingAt'; node: string }
  | { kind: 'delay'; seconds: number }
  | { kind: 'ended'; reason: string }
  | { kind: 'replied'; text: string };

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The node's name for a step: the flow's current graph for the run, else what the log itself copied at run time. */
export function nodeNames(run: Pick<FlowRunDetail, 'graph' | 'log'>): (id: string) => string {
  const names = new Map<string, string>();
  for (const s of run.log) if (s.nodeId && s.nodeLabel) names.set(s.nodeId, s.nodeLabel);
  for (const n of run.graph?.nodes ?? []) if (!names.has(n.id)) names.set(n.id, n.label);
  return (id) => names.get(id) ?? id;
}

export function stepFacts(s: FlowRunStep, nameOf: (id: string) => string): StepFact[] {
  const d = s.detail;
  const facts: StepFact[] = [];
  if (s.event === 'reply' && text(d.text)) facts.push({ kind: 'replied', text: text(d.text) });
  if (text(d.next)) facts.push({ kind: 'next', node: nameOf(text(d.next)) });
  if (text(d.waitingOn)) facts.push({ kind: 'waitingAt', node: nameOf(text(d.waitingOn)) });
  if (typeof d.seconds === 'number') facts.push({ kind: 'delay', seconds: d.seconds });
  if (s.event === 'end' && text(d.reason)) facts.push({ kind: 'ended', reason: text(d.reason) });
  return facts;
}
