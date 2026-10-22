import { ERROR_CODES, FLOW_MAX_NODE_VISITS } from '@crm/contracts';
import { edgeFrom, nodeById } from '../graph/runtime-graph';
import { CORE_EXECUTORS } from './nodes';
import { propertyToSave, routeReply } from './reply-router';
import type {
  InboundReply,
  NodeContext,
  NodeExecutor,
  NodeResult,
  OutboundMessage,
  RunState,
  SendOutcome,
  StepOutcome,
  Transition,
} from './types';
import { describeSent, finishIo, newIo, outboundWords, tagsRead, varsChanged } from './step-log';
import { interpolate } from './variables';

export type { StepOutcome, Transition } from './types';

export interface StepDeps {
  /** One send; `index` numbers the sends of this step so each has its own stable id. */
  send(run: RunState, message: OutboundMessage, index: number): Promise<SendOutcome>;
  /** Pause between nodes on channels that look more human with one (the unofficial WhatsApp engine). */
  paceMs(run: RunState): number;
  now(): Date;
  /** Executors by node type; the core set is always there. */
  executors?: readonly NodeExecutor[];
}

const registry = (extra: readonly NodeExecutor[] = []): Map<string, NodeExecutor> => {
  const m = new Map<string, NodeExecutor>();
  for (const e of [...CORE_EXECUTORS, ...extra]) for (const t of e.types) m.set(t, e);
  return m;
};

/** Internal run variables (hidden from the run log): did any message reach the customer, and the window refusal that came first. */
const DELIVERED_VAR = '__delivered';
const WINDOW_REFUSED_VAR = '__window_refused';
/** Runs the customer started by writing: their message opened the 24 hour window, so a refusal there is not a missing template. */
const CUSTOMER_STARTED: ReadonlySet<string> = new Set([
  'keyword',
  'any_message',
  'away',
  'out_of_hours',
]);

/** Remembers on the run whether anything was delivered, and the first refusal by the 24 hour window before that. */
function trackSend(run: RunState, out: SendOutcome): void {
  if (out.ok) {
    run.vars[DELIVERED_VAR] = 1;
  } else if (
    out.code === ERROR_CODES.SERVICE_WINDOW_CLOSED &&
    run.vars[DELIVERED_VAR] === undefined
  ) {
    run.vars[WINDOW_REFUSED_VAR] ??= out.error;
  }
}

/**
 * A run that nobody asked for (an order, a lead, a re-subscribe, a routing rule, an enrolment) whose free-form messages were all
 * refused by the 24 hour window ends `failed` with that reason instead of `completed`: the customer received nothing, and a green run
 * would hide it. A message that did get through (a template that opened the conversation) keeps the run `completed`; the refusal of a
 * later plain message stays a note in the log, as before.
 */
function windowFailure(run: RunState, t: Transition): Transition {
  if (t.t !== 'end' || t.status !== 'completed' || CUSTOMER_STARTED.has(run.source)) return t;
  const refused = run.vars[WINDOW_REFUSED_VAR];
  if (typeof refused !== 'string' || run.vars[DELIVERED_VAR] !== undefined) return t;
  return {
    t: 'end',
    status: 'failed',
    reason: 'send_failed',
    failureCode: ERROR_CODES.SERVICE_WINDOW_CLOSED,
    failureReason: `Nothing reached the customer (${refused.replace(/[.\s]+$/, '')}). Open this flow with a Template step.`,
  };
}

/** Leave `from` by `port`. No edge, or an edge to a node that is gone, is a dead end (TW-FLR-016 rule 6). */
export function advanceFrom(
  run: RunState,
  fromNodeId: string,
  port: number,
  branch: boolean,
  paceMs: number,
): Transition {
  const edge = edgeFrom(run.graph, fromNodeId, port);
  if (!edge || !nodeById(run.graph, edge.to)) return parkOrEnd(run);
  return { t: 'goto', nodeId: edge.to, delayMs: branch ? 0 : paceMs, port };
}

/**
 * A branch ran out of nodes without an End node. A flow ends only at an End node or when nothing tappable remains: when the
 * customer was shown a menu, it is re-armed as a persistent wait so its buttons keep working; a purely linear flow ends.
 */
export function parkOrEnd(run: RunState): Transition {
  const menu = run.menus.latest;
  if (menu && menu.listItems && menu.listItems.length > 0) {
    return {
      t: 'wait',
      wait: {
        nodeId: menu.nodeId,
        variable: menu.variable || 'choice',
        kind: 'List',
        listItems: menu.listItems,
        persistent: true,
      },
    };
  }
  if (menu && menu.answerItems.length > 0) {
    return {
      t: 'wait',
      wait: {
        nodeId: menu.nodeId,
        variable: menu.variable || 'choice',
        kind: 'Question',
        answerItems: menu.answerItems,
        persistent: true,
      },
    };
  }
  return { t: 'end', status: 'completed', reason: 'dead_end' };
}

function transitionOf(run: RunState, nodeId: string, r: NodeResult, deps: StepDeps): Transition {
  switch (r.kind) {
    case 'advance':
      return advanceFrom(run, nodeId, r.port, r.branch === true, deps.paceMs(run));
    case 'wait':
      return { t: 'wait', wait: r.wait };
    case 'sleep':
      return { t: 'sleep', seconds: r.seconds };
    case 'park':
      return parkOrEnd(run);
    case 'end':
      return { t: 'end', status: 'completed', reason: r.reason };
    case 'subflow':
      return {
        t: 'subflow',
        flowId: r.flowId,
        startNodeId: r.startNodeId,
        missPort: r.missPort,
        missVars: r.missVars,
      };
    case 'halt':
      return {
        t: 'halt',
        reason: r.reason,
        ...(r.retryAt !== undefined ? { retryAt: r.retryAt } : {}),
      };
    case 'fail':
      return {
        t: 'end',
        status: 'failed',
        reason: 'send_failed',
        failureCode: r.code,
        failureReason: r.reason,
      };
  }
}

/**
 * Runs the run's current node once (TW-FLR-016). The loop guard counts every execution of a node, including a re-run after a
 * reply: past 20 the run stops without a word to the customer. A node type nobody built an executor for is noted and passed.
 * Mutates `run` (variables, visits, menus, last message); the caller persists it when the transition is applied.
 */
export async function executeCurrent(run: RunState, deps: StepDeps): Promise<StepOutcome> {
  const notes: string[] = [];
  const node = run.currentNodeId ? nodeById(run.graph, run.currentNodeId) : null;
  if (!node) {
    return { transition: parkOrEnd(run), nodeId: run.currentNodeId, nodeType: null, notes };
  }

  run.visits[node.id] = (run.visits[node.id] ?? 0) + 1;
  if (run.visits[node.id]! > FLOW_MAX_NODE_VISITS) {
    return {
      transition: {
        t: 'end',
        status: 'failed',
        reason: 'loop_guard',
        failureCode: 'FLR_LOOP_GUARD',
        failureReason: `Node ${node.id} ran more than ${FLOW_MAX_NODE_VISITS} times: its branch loops back without an exit`,
      },
      nodeId: node.id,
      nodeType: node.type,
      notes,
    };
  }

  const executor = registry(deps.executors).get(node.type);
  if (!executor) {
    notes.push(`no executor for ${node.type}: moved on`);
    return {
      transition: advanceFrom(run, node.id, 1, false, deps.paceMs(run)),
      nodeId: node.id,
      nodeType: node.type,
      notes,
    };
  }

  let sends = 0;
  const sent: string[] = [];
  const io = newIo();
  let sendFailed = false;
  const before = { ...run.vars };
  const ctx: NodeContext = {
    run,
    node,
    stepKey: `flow:${run.uuid}:${run.stepSeq}:${node.id}`,
    send: async (message) => {
      const out = await deps.send(run, message, sends++);
      trackSend(run, out);
      if (!out.ok) sendFailed = true;
      sent.push(describeSent(message, out));
      io.out.push({ kind: 'message', name: message.kind, value: outboundWords(message) });
      return out;
    },
    render: (t) => {
      io.in.push(...tagsRead(t, run.vars));
      return interpolate(t, run.vars);
    },
    io: (side, item) => io[side].push(item),
    note: (text) => notes.push(text),
    now: deps.now,
  };
  const result = await executor.execute(ctx);
  io.out.push(...varsChanged(before, run.vars));
  const recorded = finishIo(io);
  return {
    transition: windowFailure(run, transitionOf(run, node.id, result, deps)),
    nodeId: node.id,
    nodeType: node.type,
    notes,
    sent,
    ...(sendFailed ? { sendFailed } : {}),
    ...(recorded ? { io: recorded } : {}),
  };
}

/**
 * Applies an answer to a `Custom` wait (a node that decodes its own reply: a booked slot, a form, a payment). The parked node's
 * executor decides; sends in this step number from 1000 so they never share a client reference with the sends of the step that asked.
 */
export async function applyCustomReply(
  run: RunState,
  reply: InboundReply,
  deps: StepDeps,
): Promise<StepOutcome> {
  const wait = run.wait;
  const node = wait ? nodeById(run.graph, wait.nodeId) : null;
  const base = { nodeId: wait?.nodeId ?? null, nodeType: node?.type ?? null };
  const executor = wait?.handler ? registry(deps.executors).get(wait.handler) : undefined;
  if (!wait || !node || !executor?.onReply) {
    return { ...base, transition: { t: 'none' }, notes: ['no handler for this wait'] };
  }
  const notes: string[] = [];
  let sends = 1000;
  const sent: string[] = [];
  const io = newIo();
  let sendFailed = false;
  const ctx: NodeContext = {
    run,
    node,
    stepKey: `flow:${run.uuid}:${run.stepSeq}:${node.id}:reply`,
    send: async (message) => {
      const out = await deps.send(run, message, sends++);
      sent.push(describeSent(message, out));
      io.out.push({ kind: 'message', name: message.kind, value: outboundWords(message) });
      if (!out.ok) sendFailed = true;
      return out;
    },
    render: (t) => interpolate(t, run.vars),
    io: (side, item) => io[side].push(item),
    note: (text) => notes.push(text),
    now: deps.now,
  };
  const before = { ...run.vars };
  const d = await executor.onReply(ctx, reply);
  // What the node said back (a "please enter a valid number") and what its answer saved, for the run log. Called after the decision's
  // variables are applied, so they count as saved.
  const logged = () => {
    const out = [...io.out, ...varsChanged(before, run.vars)];
    const recorded = finishIo({ in: io.in, out });
    return {
      sent,
      ...(sendFailed ? { sendFailed } : {}),
      ...(recorded ? { io: recorded } : {}),
    };
  };
  switch (d.action) {
    case 'ignore':
      return { ...base, transition: { t: 'none' }, notes: ['not an answer: still waiting'] };
    case 'stay':
      Object.assign(run.vars, d.setVars ?? {});
      return {
        ...base,
        transition: { t: 'wait', wait: { ...wait, data: d.data ?? wait.data } },
        notes: [...notes, 'not complete yet: still waiting'],
        ...logged(),
      };
    case 'route':
      Object.assign(run.vars, d.setVars ?? {});
      run.currentNodeId = node.id;
      return {
        ...base,
        transition: advanceFrom(run, node.id, d.port, true, 0),
        notes,
        ...logged(),
      };
    case 'end':
      return {
        ...base,
        transition: { t: 'end', status: 'completed', reason: d.reason },
        notes,
        ...logged(),
      };
    case 'fail':
      return {
        ...base,
        transition: {
          t: 'end',
          status: 'failed',
          reason: 'send_failed',
          failureCode: d.code,
          failureReason: d.reason,
        },
        notes,
        ...logged(),
      };
  }
}

/** A sleeping run woke: leave the Delay node by its exit. */
export function wakeFromSleep(run: RunState): StepOutcome {
  const id = run.currentNodeId;
  const node = id ? nodeById(run.graph, id) : null;
  return {
    transition: id ? advanceFrom(run, id, 1, true, 0) : parkOrEnd(run),
    nodeId: id,
    nodeType: node?.type ?? null,
    notes: ['woke from delay'],
  };
}

/**
 * Applies a customer's reply to a parked run (TW-FLR-018): stores the answer in the variables and decides where the run goes.
 * Mutates `run.vars`; the caller persists the transition.
 */
export function applyReply(run: RunState, reply: InboundReply): StepOutcome {
  const decision = routeReply(run, reply);
  const wait = run.wait;
  const base = { nodeId: wait?.nodeId ?? null, nodeType: null, notes: [] as string[] };
  switch (decision.action) {
    case 'ignore':
      return { ...base, transition: { t: 'none' }, notes: ['not an answer: still waiting'] };
    case 'stay':
      Object.assign(run.vars, decision.setVars);
      return {
        ...base,
        transition: { t: 'wait', wait: decision.wait },
        notes: ['no option matched: still waiting'],
      };
    case 'route': {
      Object.assign(run.vars, decision.setVars);
      run.currentNodeId = decision.fromNodeId;
      const save = propertyToSave(run.graph, decision);
      return {
        ...base,
        nodeId: decision.fromNodeId,
        transition: advanceFrom(run, decision.fromNodeId, decision.port, true, 0),
        ...(save ? { saveProperty: save } : {}),
      };
    }
    case 'dead_end': {
      Object.assign(run.vars, decision.setVars);
      const save = propertyToSave(run.graph, decision);
      return {
        ...base,
        transition: parkOrEnd(run),
        notes: ['the branch picked has no next node'],
        ...(save ? { saveProperty: save } : {}),
      };
    }
  }
}
