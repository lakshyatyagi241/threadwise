import { createHash } from 'node:crypto';
import { FLOW_RUN_LOG_MAX_STEPS, type FlowStepIoItem } from '@crm/contracts';
import type { RuntimeGraph, RuntimeNode } from '../graph/runtime-graph';
import type { OutboundMessage, SendOutcome, StepOutcome } from './types';

/**
 * What one node execution leaves in the run log (TW-FLR-054, 083). Pure: no database, no clock.
 *
 * The log must stay small. A row holds a label, a short summary and a few numbers, never a payload: text is clipped, anything that
 * looks like a secret is masked, and a run stops logging ordinary steps after MAX_LOGGED_STEPS (failures and the end still log).
 */
export const MAX_LOGGED_STEPS = FLOW_RUN_LOG_MAX_STEPS;
const LABEL_MAX = 80;
const SUMMARY_MAX = 240;

export type StepOutcomeKind = 'ok' | 'error' | 'skipped' | 'waiting' | 'timeout';

const BEARER = /(bearer\s+)[^\s"',;&}]+/gi;
const SECRET =
  /((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|authorization)["'\s:=]+)(?!\*\*\*)[^\s"',;&}]+/gi;

export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Masks tokens and passwords that a note or a setting may quote. */
export function maskSecrets(text: string): string {
  return text
    .replace(BEARER, (_m, head: string) => `${head}***`)
    .replace(SECRET, (_m, head: string) => `${head}***`);
}

/** Text of a Message or Sequence node lives in its replies. */
function firstReplyText(node: RuntimeNode): string {
  const replies = node.props.replies;
  if (!Array.isArray(replies)) return '';
  for (const r of replies) {
    const d = (r as { type?: unknown; data?: unknown } | null)?.data;
    if ((r as { type?: unknown })?.type === 'Text' && typeof d === 'string' && d.trim() !== '')
      return d;
  }
  return '';
}

const TEXT_KEYS = [
  'text',
  'body',
  'message',
  'prompt',
  'question',
  'caption',
  'title',
  'url',
] as const;

/** The setting that tells nodes of one type apart in a log: what a message says, what a question asks. */
function mainText(node: RuntimeNode | null): string {
  if (!node) return '';
  const reply = firstReplyText(node);
  if (reply) return reply;
  for (const k of TEXT_KEYS) {
    const v = node.props[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return '';
}

/** The name the user gave the node, else its main text, else its type. Copied into the log so an edit later cannot change it. */
export function nodeLabel(node: RuntimeNode | null, fallbackType: string | null): string {
  if (node?.label) return clip(node.label, LABEL_MAX);
  const text = mainText(node);
  if (text) return clip(text, 40);
  return node?.type ?? fallbackType ?? '';
}

/** The words of a message as the customer reads them: its text, and the buttons or list rows it offers. */
export function outboundWords(m: OutboundMessage): string {
  switch (m.kind) {
    case 'text':
      return m.body;
    case 'media':
      return m.caption ? `${m.mediaKind}: ${m.caption}` : `${m.mediaKind}: ${m.url}`;
    case 'buttons':
      return `${m.body} [${m.buttons.map((b) => b.text).join(' | ')}]`;
    case 'list':
      return `${m.body} [${m.sections
        .flatMap((sec) => sec.rows.map((r) => r.title))
        .slice(0, 10)
        .join(' | ')}]`;
    case 'location_request':
    case 'form':
      return m.body;
    case 'cta_url':
      return `${m.body} (${m.text}: ${m.url})`;
    case 'location':
      return m.name ?? m.address ?? 'location';
    case 'template':
      return m.text || m.name;
  }
}

const SENT_MAX = 120;

/** One line for a message that went to the customer: its kind and the words, never a variable dump. */
export function describeSent(message: OutboundMessage, outcome: SendOutcome): string {
  const body = clip(maskSecrets(outboundWords(message)), SENT_MAX);
  // A media line already starts with its kind (image, video...).
  const line = message.kind === 'media' ? body : `${message.kind}: ${body}`;
  return outcome.ok ? line : `${line} (not sent: ${clip(outcome.error, 80)})`;
}

// --- input and output of a node ----------------------------------------------------------------------------------------------
// What a node took in and produced, kept small: values are clipped, secrets masked, a side holds at most IO_MAX_ITEMS items and a row
// at most IO_MAX_CHARS characters. A message keeps more room than a variable: it is what the customer read.

const IO_MAX_ITEMS = 12;
const IO_MAX_CHARS = 4000;
const IO_VALUE_MAX = 300;
const IO_MESSAGE_MAX = 1000;
const SENSITIVE_NAME = /pass(word)?|secret|token|api[_-]?key|otp|pin|authorization/i;

const plain = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return String(v);
  }
};

export interface IoCollector {
  in: FlowStepIoItem[];
  out: FlowStepIoItem[];
}
export const newIo = (): IoCollector => ({ in: [], out: [] });

/** Variables whose value changed or appeared in a step: what the node saved. Flattened children (`a.b`) of a changed `a` are left out. */
export function varsChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FlowStepIoItem[] {
  const changed = Object.keys(after).filter(
    (k) => !k.startsWith('__') && plain(after[k]) !== plain(before[k]),
  );
  const roots = changed.filter((k) => !changed.some((p) => p !== k && k.startsWith(`${p}.`)));
  return roots.map((k) => ({ kind: 'variable' as const, name: k, value: plain(after[k]) }));
}

/** The `{{names}}` a template reads, with their current values: what the node took in from the run. */
export function tagsRead(template: unknown, vars: Record<string, unknown>): FlowStepIoItem[] {
  if (typeof template !== 'string' || !template.includes('{{')) return [];
  const seen = new Set<string>();
  const out: FlowStepIoItem[] = [];
  for (const m of template.matchAll(/\{\{\s*@?([\w.]+)[^{}]*\}\}/g)) {
    const name = m[1]!;
    if (seen.has(name) || vars[name] === undefined) continue;
    seen.add(name);
    out.push({ kind: 'variable', name, value: plain(vars[name]) });
  }
  return out;
}

const merge = (items: FlowStepIoItem[]): FlowStepIoItem[] => {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.kind}:${i.name ?? ''}:${i.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function bounded(items: FlowStepIoItem[], budget: { left: number }): FlowStepIoItem[] {
  const out: FlowStepIoItem[] = [];
  for (const i of merge(items)) {
    if (out.length >= IO_MAX_ITEMS || budget.left <= 0) break;
    const max = i.kind === 'message' ? IO_MESSAGE_MAX : IO_VALUE_MAX;
    const raw = SENSITIVE_NAME.test(i.name ?? '') && i.kind === 'variable' ? '***' : i.value;
    const value = clip(maskSecrets(raw), Math.min(max, budget.left));
    budget.left -= value.length;
    out.push({ kind: i.kind, name: i.name ? clip(i.name, 60) : null, value });
  }
  return out;
}

/** The input and output to store with a log row, or null when the node took in and produced nothing. */
export function finishIo(io: IoCollector): { in: FlowStepIoItem[]; out: FlowStepIoItem[] } | null {
  const budget = { left: IO_MAX_CHARS };
  const input = bounded(io.in, budget);
  const output = bounded(io.out, budget);
  return input.length + output.length === 0 ? null : { in: input, out: output };
}

export interface StepFields {
  nodeLabel: string | null;
  outcome: StepOutcomeKind;
  port: number | null;
  durationMs: number | null;
  attempt: number | null;
  summary: string | null;
  errorCode: string | null;
}

/** The log columns of one executed node. `node` is read before a Sub-flow swaps the graph, so it is the node that actually ran. */
export function stepFields(
  outcome: StepOutcome,
  node: RuntimeNode | null,
  meta: { durationMs: number | null; attempt: number | null },
): StepFields {
  const t = outcome.transition;
  let kind: StepOutcomeKind = 'ok';
  let errorCode: string | null = null;
  if (t.t === 'end' && t.status === 'failed') {
    kind = 'error';
    errorCode = t.failureCode ?? null;
  } else if (t.t === 'halt') kind = 'error';
  else if (t.t === 'wait' || t.t === 'sleep') kind = 'waiting';
  else if (outcome.notes.some((n) => n.startsWith('no executor'))) kind = 'skipped';
  // The node carried on but its message never reached the customer: that is a failure of the node, not an OK.
  if (kind === 'ok' && outcome.sendFailed) kind = 'error';

  const bits = [...(outcome.sent ?? []), ...outcome.notes];
  if (t.t === 'halt') bits.push(t.reason);
  if (t.t === 'end' && t.status === 'failed' && t.failureReason) bits.push(t.failureReason);
  const summary = bits.length > 0 ? clip(maskSecrets(bits.join('; ')), SUMMARY_MAX) : null;
  const label = nodeLabel(node, outcome.nodeType);

  return {
    nodeLabel: label || null,
    outcome: kind,
    port: t.t === 'goto' ? (t.port ?? null) : null,
    durationMs: meta.durationMs,
    attempt: meta.attempt,
    summary,
    errorCode,
  };
}

/** Whether a step may still be written: ordinary steps stop at the cap; failures, waits that end a run and the end itself never do. */
export function shouldLog(alreadyLogged: number, important: boolean): boolean {
  return important || alreadyLogged < MAX_LOGGED_STEPS;
}

/** JSON with the keys of every object sorted: Postgres jsonb does not keep key order, so a graph read back must hash like the one written. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** The id a graph is stored under: the same graph of a flow is stored once, however many runs use it. */
export function hashGraph(graph: RuntimeGraph): string {
  return createHash('sha256').update(canonical(graph)).digest('hex');
}

/** What the screen needs of a graph: no settings, no message text. */
export function compactGraph(graph: RuntimeGraph): {
  nodes: Array<{ id: string; type: string; label: string }>;
  edges: Array<{ from: string; port: number; to: string }>;
} {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, label: nodeLabel(n, n.type) })),
    edges: graph.edges.map((e) => {
      const cut = e.from.lastIndexOf('_');
      return { from: e.from.slice(0, cut), port: Number(e.from.slice(cut + 1)) || 0, to: e.to };
    }),
  };
}

const IO_KINDS = new Set(['message', 'reply', 'variable', 'request', 'response', 'result']);
const itemsOf = (v: unknown): FlowStepIoItem[] =>
  Array.isArray(v)
    ? v.flatMap((i) => {
        const o = i as { kind?: unknown; name?: unknown; value?: unknown } | null;
        return o &&
          typeof o.kind === 'string' &&
          IO_KINDS.has(o.kind) &&
          typeof o.value === 'string'
          ? [
              {
                kind: o.kind as FlowStepIoItem['kind'],
                name: typeof o.name === 'string' ? o.name : null,
                value: o.value,
              },
            ]
          : [];
      })
    : [];

/** A stored row's `detail` split into what the screen shows (`input`, `output`) and the rest of the detail. */
export function splitIo(detail: Record<string, unknown>): {
  detail: Record<string, unknown>;
  input: FlowStepIoItem[];
  output: FlowStepIoItem[];
} {
  const { io, ...rest } = detail;
  const o = (io ?? {}) as { in?: unknown; out?: unknown };
  return { detail: rest, input: itemsOf(o.in), output: itemsOf(o.out) };
}
