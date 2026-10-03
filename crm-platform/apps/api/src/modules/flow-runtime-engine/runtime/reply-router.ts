import { edgeFrom, nodeById, type RuntimeGraph } from '../graph/runtime-graph';
import { askItems, buttonItems, renderedListRows, listRows } from './menus';
import type { InboundReply, MenuItem, RunState, WaitSpec } from './types';
import { interpolate } from './variables';

/** What the channel's inbound message looks like to the flow engine (the subset of `NormalisedInbound` it reads). */
export interface InboundInput {
  kind: 'text' | 'media' | 'location' | 'contact' | 'reaction' | 'interactive' | 'unsupported';
  body?: string | null;
  location?: { latitude: number; longitude: number; name?: string; address?: string } | null;
  meta?: Record<string, unknown> | null;
  /** A stored link to a file the customer sent. */
  mediaUrl?: string | null;
}

/**
 * The one place a provider's message becomes a reply (TW-FLR-018 rule 1): a tap carries the option id and its visible label, a
 * shared location becomes a maps link (prefixed by the place name), a file is a media reply, anything else is its text. A reaction
 * or an unsupported message is not an answer: null.
 */
export function decodeInbound(m: InboundInput): InboundReply | null {
  if (m.kind === 'reaction' || m.kind === 'unsupported' || m.kind === 'contact') return null;
  if (m.kind === 'interactive') {
    const i = (m.meta?.interactive ?? {}) as { id?: unknown; title?: unknown };
    const id = String(i.id ?? '');
    const text = String(i.title ?? '') || id;
    if (!id && !text) return null;
    return { kind: 'tap', id, text };
  }
  if (m.kind === 'location' && m.location) {
    const link = `https://www.google.com/maps?q=${m.location.latitude},${m.location.longitude}`;
    const name = String(m.location.name || m.location.address || '').trim();
    return { kind: 'location', id: '', text: name ? `${name} ${link}` : link };
  }
  if (m.kind === 'media') {
    return {
      kind: 'media',
      id: '',
      text: String(m.body ?? '').trim(),
      ...(m.mediaUrl ? { mediaUrl: m.mediaUrl } : {}),
    };
  }
  const text = String(m.body ?? '').trim();
  return text ? { kind: 'text', id: '', text } : null;
}

/** What the engine does with a reply. */
export type ReplyDecision =
  /** Not an answer to anything the run waits for: stay parked, change nothing. */
  | { action: 'ignore' }
  /** Matched nothing and nothing is wired for "no match": stay on the same wait. `wait` may be re-armed as persistent. */
  | { action: 'stay'; setVars: Record<string, unknown>; wait: WaitSpec }
  /** Leave `fromNodeId` by `port`; the node may be an older menu than the one waiting. */
  | { action: 'route'; fromNodeId: string; port: number; setVars: Record<string, unknown> }
  /** The branch picked has nothing after it (or the target is gone): park on the last menu or end. */
  | { action: 'dead_end'; setVars: Record<string, unknown> };

const lc = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .trim();

function menuItemsOf(graph: RuntimeGraph, run: RunState, nodeId: string): MenuItem[] {
  const remembered = run.menus.byNode[nodeId];
  if (remembered) return remembered;
  const node = nodeById(graph, nodeId);
  if (!node) return [];
  const render = (t: unknown) => interpolate(t, run.vars);
  if (node.type === 'InteractiveButtons') return buttonItems(node, render);
  if (node.type === 'Question') return askItems(node, render);
  return [];
}

/** A choice answer against a menu's options (TW-FLR-022). null: nothing matched. */
function matchOption(items: MenuItem[], replyId: string, text: string): number {
  let idx = -1;
  if (replyId) idx = items.findIndex((it) => it.id === replyId);
  if (idx === -1) idx = items.findIndex((it) => lc(it.text) === lc(text));
  // Meta shows a button title cut to 20 characters, so the label echoed back can be shorter than the option.
  if (idx === -1 && lc(text) !== '')
    idx = items.findIndex((it) => lc(it.text).slice(0, 20) === lc(text));
  if (idx === -1) {
    const tail = /(\d+)\s*$/.exec(replyId);
    if (tail) {
      const k = Number(tail[1]);
      if (k >= 0 && k < items.length) idx = k;
    }
  }
  if (idx === -1) {
    const typed = parseInt(text.trim(), 10);
    if (!Number.isNaN(typed) && typed >= 1 && typed <= items.length) idx = typed - 1;
  }
  return idx;
}

function routeQuestion(
  graph: RuntimeGraph,
  run: RunState,
  nodeId: string,
  items: MenuItem[],
  replyId: string,
  text: string,
  variable: string,
  setVars: Record<string, unknown>,
  persistent: boolean,
): ReplyDecision {
  let port: number | null = null;
  if (items.length > 0) {
    const idx = matchOption(items, replyId, text);
    if (idx !== -1) {
      port = idx + 1;
      // The human label, not the id WhatsApp echoes, is what later nodes should see under the node id.
      if (items[idx]!.text.trim()) setVars[nodeId] = items[idx]!.text.trim();
    }
  } else {
    port = 1; // a free-text Ask: any answer is valid
  }

  if (port === null) {
    // Nothing matched a choice: the "no match" branch if it is wired, else stay and keep the menu tappable. Never take port 1.
    if (edgeFrom(graph, nodeId, 0)) port = 0;
    else {
      return {
        action: 'stay',
        setVars,
        wait: { nodeId, variable, kind: 'Question', answerItems: items, persistent },
      };
    }
  }

  const edge = edgeFrom(graph, nodeId, port);
  if (edge && nodeById(graph, edge.to))
    return { action: 'route', fromNodeId: nodeId, port, setVars };
  if (!edge && items.length > 0) {
    // A real option whose branch the author left empty: stay on the menu so another option can be picked.
    return {
      action: 'stay',
      setVars,
      wait: { nodeId, variable, kind: 'Question', answerItems: items, persistent: true },
    };
  }
  return { action: 'dead_end', setVars };
}

function routeList(
  graph: RuntimeGraph,
  run: RunState,
  nodeId: string,
  reply: InboundReply,
  setVars: Record<string, unknown>,
): ReplyDecision {
  const node = nodeById(graph, nodeId);
  const text = lc(reply.text);
  let port = 0;
  const tail = /_p(\d+)$/.exec(reply.id);
  if (tail) port = Number(tail[1]) + 1;
  else if (/^\d+$/.test(text) && node) {
    // A digit is a position in the RENDERED, section-grouped order.
    const rendered = renderedListRows(node);
    const pick = parseInt(text, 10);
    port = rendered[pick - 1] ? rendered[pick - 1]!.port : pick;
  } else if (node) {
    const row = listRows(node).find((r) => lc(r.title) === text);
    if (row) port = row.port;
  }

  const variable = String((nodeById(graph, nodeId)?.props.variable as string) || 'choice');
  if (port <= 0) {
    if (edgeFrom(graph, nodeId, 0)) port = 0;
    else {
      return {
        action: 'stay',
        setVars,
        wait: {
          nodeId,
          variable,
          kind: 'List',
          listItems: node ? listRows(node) : [],
        },
      };
    }
  }
  const edge = edgeFrom(graph, nodeId, port);
  if (edge && nodeById(graph, edge.to))
    return { action: 'route', fromNodeId: nodeId, port, setVars };
  return { action: 'dead_end', setVars };
}

function routePoll(
  graph: RuntimeGraph,
  nodeId: string,
  wait: WaitSpec,
  reply: InboundReply,
  setVars: Record<string, unknown>,
): ReplyDecision {
  const options = (nodeById(graph, nodeId)?.props.options as string[] | undefined) ?? [];
  const answer = reply.text;
  let selected: string[];
  if (wait.allowMultiple) {
    selected = answer
      .split(/[,\s]+/)
      .map((p) => parseInt(p.trim(), 10))
      .filter((n) => !Number.isNaN(n) && n >= 1 && n <= options.length)
      .map((n) => options[n - 1]!);
  } else {
    const n = parseInt(answer, 10);
    selected = !Number.isNaN(n) && n >= 1 && n <= options.length ? [options[n - 1]!] : [answer];
  }
  setVars['poll_response'] = selected;
  let port = 1;
  if (!wait.allowMultiple && selected.length > 0) {
    const i = options.findIndex((o) => lc(o) === lc(selected[0]));
    if (i !== -1) port = i + 1;
  }
  const edge = edgeFrom(graph, nodeId, port);
  if (edge && nodeById(graph, edge.to))
    return { action: 'route', fromNodeId: nodeId, port, setVars };
  return { action: 'dead_end', setVars };
}

/**
 * Where a customer's reply sends a parked run (TW-FLR-018). Pure: reads the run, returns a decision, writes nothing.
 *
 * Order: a media-only message is not an answer unless the wait accepts files; a tap is routed to the menu it belongs to even when
 * that is not the menu now waiting (an old message's buttons stay tappable); otherwise the answer goes to the waiting node by kind.
 */
export function routeReply(run: RunState, reply: InboundReply): ReplyDecision {
  const wait = run.wait;
  if (!wait) return { action: 'ignore' };
  const graph = run.graph;

  let text = reply.text;
  if (!text.trim() && !reply.id && reply.kind === 'media' && !wait.acceptMedia)
    return { action: 'ignore' };
  if (wait.acceptMedia && reply.mediaUrl) text = reply.mediaUrl;

  // The tap router: list rows and scoped button ids name their own node.
  const listTap = /^list_(.+)_p(\d+)$/.exec(reply.id);
  if (listTap) {
    const n = nodeById(graph, listTap[1]!);
    if (n && n.type === 'List') {
      return routeList(
        graph,
        run,
        n.id,
        { ...reply, text },
        { [String(n.props.variable ?? 'choice')]: text },
      );
    }
  }
  let source = null as ReturnType<typeof nodeById>;
  const btnTap = /^b_(.+)_p(\d+)$/.exec(reply.id);
  if (btnTap) source = nodeById(graph, btnTap[1]!);
  if (!source && text.trim() !== '') {
    // Meta truncates a button title to 20 characters, so compare the first 20 too. Only a label that names exactly ONE menu counts.
    const t = lc(text);
    const hits = graph.nodes.filter(
      (n) =>
        n.type === 'InteractiveButtons' &&
        menuItemsOf(graph, run, n.id).some(
          (it) => lc(it.text) === t || lc(it.text).slice(0, 20) === t,
        ),
    );
    if (hits.length === 1) source = hits[0]!;
  }
  if (source && source.type === 'InteractiveButtons') {
    const items = menuItemsOf(graph, run, source.id);
    if (items.length > 0 && (reply.id || text)) {
      const variable = String(source.props.variable ?? 'choice');
      return routeQuestion(
        graph,
        run,
        source.id,
        items,
        reply.id,
        text,
        variable,
        { [variable]: text, [source.id]: text },
        source.props.keepMenuOpen !== false,
      );
    }
  }

  const setVars: Record<string, unknown> = { [wait.variable]: text, [wait.nodeId]: text };
  switch (wait.kind) {
    case 'List':
      return routeList(graph, run, wait.nodeId, { ...reply, text }, setVars);
    case 'Poll':
      return routePoll(graph, wait.nodeId, wait, { ...reply, text }, setVars);
    default:
      // The shared `user_message` follows the latest answer, so a node after an Ask never reads the stale trigger text.
      setVars['user_message'] = text;
      return routeQuestion(
        graph,
        run,
        wait.nodeId,
        wait.answerItems ?? [],
        reply.id,
        text,
        wait.variable,
        setVars,
        wait.persistent === true,
      );
  }
}
