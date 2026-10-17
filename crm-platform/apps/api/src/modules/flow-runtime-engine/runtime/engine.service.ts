import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Tx } from '@crm/db';
import type { FlowRunEndReason } from '@crm/contracts';
import { ContactsService } from '../../crm';
import { DatabaseService } from '../../../infra/db/database.service';
import { compileGraph } from '../graph/compile-graph';
import { nodeById, type RuntimeNode } from '../graph/runtime-graph';
import { profileOf } from './channel-render';
import {
  applyCustomReply,
  applyReply,
  advanceFrom,
  executeCurrent,
  wakeFromSleep,
  type StepDeps,
  type StepOutcome,
  type Transition,
} from './engine-core';
import { FlowRunPublisher } from './flow-run.publisher';
import { FlowSender } from './flow-sender.service';
import { haltDelayMs } from './halt';
import { RunRepository, type RunPatch } from './run.repository';
import {
  MAX_LOGGED_STEPS,
  finishIo,
  nodeLabel,
  shouldLog,
  stepFields,
  varsChanged,
  type StepOutcomeKind,
} from './step-log';
import { SubscriberRepository } from './subscriber.repository';
import type { InboundReply, NodeExecutor, RunState } from './types';
import { FLOW_NODE_EXECUTORS } from './node-executors';

const DAY_MS = 86_400_000;
/** How deep Sub-flows may nest in one run. Each swap resets the visit counters, so the node loop guard alone cannot stop a flow that calls itself. */
export const MAX_SUBFLOW_DEPTH = 10;
const SUBFLOW_DEPTH_VAR = '__subflow_depth';

/** What a call did, for the worker's log and the tests. */
export type AdvanceResult = 'stepped' | 'stale' | 'ended' | 'lost' | 'not_due';
export type ReplyResult = 'routed' | 'ignored' | 'not_waiting';

/** What the commit needs to write the node's log row: how long it took and the node as it was when it ran. */
interface StepMeta {
  durationMs: number | null;
  node: RuntimeNode | null;
  /** Overrides the outcome the transition implies (a wait that gave up is a `timeout`). */
  outcome?: StepOutcomeKind;
}

interface Committed {
  /** The step number to queue, and when; null when nothing is queued (a wait, an end). */
  next: { seq: number; delayMs: number } | null;
}

/**
 * The run engine (TW-FLR-014 to 016, 018): one step of a run per call, everything it needs in the database.
 *
 * Reference kept a run in the memory of one process and walked it with awaited timers, so a restart, a deploy or its hourly sweeper
 * ended runs silently, and a Delay longer than an hour never finished. Here a run is a row and a step is a job:
 *
 *   advance   read the run, run its node outside any transaction (a send is slow), then write the result only if the run is still
 *             at the step it read (compare-and-set on `step_seq`). A reply, a cancel or a duplicate job that got there first wins and
 *             this step's write is dropped; its sends were idempotent, so nothing doubled.
 *   reply     lock the run, route the customer's answer to the node it waits on, write, queue the next step.
 *   expire    an idle wait gave up, or the run outlived its absolute limit: end it.
 *
 * A Delay is the run asleep until `resume_at` (a delayed job wakes it, the sweeper backs that up); a channel that is down or capped
 * halts the run for five minutes and it tries again, up to the run's absolute limit.
 */
@Injectable()
export class FlowEngine {
  private readonly logger = new Logger(FlowEngine.name);

  /** Replaceable in tests. */
  now: () => Date = () => new Date();

  constructor(
    private readonly db: DatabaseService,
    private readonly runs: RunRepository,
    private readonly subscribers: SubscriberRepository,
    private readonly publisher: FlowRunPublisher,
    private readonly sender: FlowSender,
    @Optional()
    @Inject(FLOW_NODE_EXECUTORS)
    private readonly executors: readonly NodeExecutor[] = [],
    @Optional() private readonly contacts?: ContactsService,
  ) {}

  private deps(): StepDeps {
    return {
      executors: this.executors,
      send: (run, message, index) => this.sender.send(run, message, index),
      paceMs: (run) => profileOf(run.channelKind ?? '').paceMs,
      now: this.now,
    };
  }

  // --- a step ----------------------------------------------------------------------------------------------------------------

  async advance(orgId: number, runId: number, seq: number): Promise<AdvanceResult> {
    const state = await this.db.txAs({ orgId }, (tx) => this.runs.byId(tx, orgId, runId));
    if (!state || state.stepSeq !== seq) return 'stale';
    if (!['running', 'sleeping', 'halted'].includes(state.status)) return 'stale';
    // An operator's pause is not ours to lift.
    if (state.status === 'halted' && state.haltReason === 'paused') return 'stale';

    const now = this.now();
    if (state.maxExpiresAt.getTime() <= now.getTime()) {
      return this.expire(orgId, runId, seq, 'max_lifetime');
    }

    let outcome: StepOutcome;
    let durationMs: number | null = null;
    let node: RuntimeNode | null = null;
    if (state.status === 'sleeping') {
      const left = (state.resumeAt?.getTime() ?? 0) - now.getTime();
      if (left > 1_000) {
        // Woken early (the sweeper, a duplicate): put the wake-up back where it belongs.
        await this.publisher.schedule(orgId, runId, seq, left).catch(() => undefined);
        return 'not_due';
      }
      outcome = wakeFromSleep(state);
      node = outcome.nodeId ? nodeById(state.graph, outcome.nodeId) : null;
    } else {
      // A halted run that is due simply runs its node again; its sends were never made, so nothing doubles.
      const began = Date.now();
      outcome = await executeCurrent(state, this.deps());
      durationMs = Date.now() - began;
      // Read before a Sub-flow swaps the graph: the log keeps the node that ran, not one of the new flow.
      node = outcome.nodeId ? nodeById(state.graph, outcome.nodeId) : null;
      if (outcome.transition.t === 'subflow') {
        outcome = await this.enterSubflow(
          orgId,
          state,
          outcome,
          outcome.transition.flowId,
          outcome.transition.startNodeId,
          outcome.transition.missPort ?? 1,
          outcome.transition.missVars,
        );
      }
    }

    const committed = await this.db.txAs({ orgId }, async (tx) => {
      const saved = await this.commit(tx, state, outcome, seq, 'step', undefined, {
        durationMs,
        node,
      });
      return saved;
    });
    if (committed === 'lost') return 'lost';
    this.logStep(state, outcome, 'step');
    if (committed.next) {
      await this.publisher.schedule(orgId, runId, committed.next.seq, committed.next.delayMs);
    }
    return outcome.transition.t === 'end' ? 'ended' : 'stepped';
  }

  /**
   * A Sub-flow node ran (TW-FLR-031): replace the run's graph with another flow's of the same workspace and start at its first node,
   * keeping the variables. Like Reference's code (not its docs) the run does not come back to the parent flow. A flow that is missing,
   * another tenant's, or not live is refused the way Reference refuses a flow it cannot load: the node is passed by its first exit.
   */
  private async enterSubflow(
    orgId: number,
    state: RunState,
    outcome: StepOutcome,
    flowId: number | string,
    startNodeId?: string,
    missPort = 1,
    missVars?: Record<string, unknown>,
  ): Promise<StepOutcome> {
    const nodeId = state.currentNodeId ?? '';
    // `missPort` is the exit a caller wants when the flow cannot be entered: 1 for a Sub-flow node, `no_match` for the FAQ node.
    const pass = (note: string, port = missPort): StepOutcome => {
      if (missVars) Object.assign(state.vars, missVars);
      return {
        ...outcome,
        transition: advanceFrom(
          state,
          nodeId,
          port,
          false,
          profileOf(state.channelKind ?? '').paceMs,
        ),
        notes: [...outcome.notes, note],
      };
    };
    const depth = Number(state.vars[SUBFLOW_DEPTH_VAR] ?? 0) || 0;
    if (depth >= MAX_SUBFLOW_DEPTH) {
      return {
        ...outcome,
        transition: {
          t: 'end',
          status: 'failed',
          reason: 'loop_guard',
          failureCode: 'FLR_SUBFLOW_DEPTH',
          failureReason: `Sub-flows nested more than ${MAX_SUBFLOW_DEPTH} deep: a flow calls itself without an exit`,
        },
      };
    }
    const flow = await this.db.txAs({ orgId }, (tx) => this.runs.flowForSubflow(tx, orgId, flowId));
    if (!flow) return pass(`sub-flow ${flowId} not found: moved on`);
    if (!flow.isPublished || !flow.isActive) {
      return pass(`sub-flow ${flowId} is not live (publish it and switch it on): moved on`);
    }
    const graph = compileGraph(flow.data);
    if (startNodeId !== undefined && !nodeById(graph, startNodeId)) {
      return pass(`sub-flow ${flowId} has no step ${startNodeId} (it was deleted): moved on`);
    }
    const first = startNodeId !== undefined ? nodeById(graph, startNodeId) : graph.nodes[0];
    if (!first || !nodeById(graph, first.id)) {
      return {
        ...outcome,
        transition: { t: 'end', status: 'completed', reason: 'dead_end' },
        notes: [...outcome.notes, `sub-flow ${flowId} has no steps: the run ended`],
      };
    }
    state.graph = graph;
    state.visits = {};
    state.menus = { latest: null, byNode: {} };
    state.vars[SUBFLOW_DEPTH_VAR] = depth + 1;
    return {
      ...outcome,
      transition: { t: 'goto', nodeId: first.id, delayMs: 0, subflowId: flow.id },
      notes: [...outcome.notes, `entered sub-flow ${flowId}`],
    };
  }

  // --- a reply ---------------------------------------------------------------------------------------------------------------

  async deliverReply(orgId: number, runId: number, reply: InboundReply): Promise<ReplyResult> {
    const saved: { v: { contactId: number; key: string; value: string } | null } = { v: null };
    const result = await this.db.txAs({ orgId }, async (tx) => {
      const state = await this.runs.byId(tx, orgId, runId, true);
      if (!state || state.status !== 'waiting' || !state.wait) return 'not_waiting' as const;
      const before = { ...state.vars };
      const outcome =
        state.wait.kind === 'Custom'
          ? await applyCustomReply(state, reply, this.deps())
          : applyReply(state, reply);
      if (outcome.transition.t === 'none') return 'ignored' as const;
      // The reply row: what the customer sent in, and what the answer saved.
      const recorded = finishIo({
        in: [
          {
            kind: 'reply',
            name: reply.id || null,
            value:
              reply.text || (reply.kind === 'external' ? JSON.stringify(reply.data ?? {}) : ''),
          },
        ],
        out: varsChanged(before, state.vars),
      });
      const detail = {
        text: reply.text.slice(0, 200),
        ...(reply.id ? { tap: reply.id } : {}),
        ...(reply.kind === 'external' ? { external: true } : {}),
        ...(recorded ? { io: recorded } : {}),
      };
      const committed = await this.commit(tx, state, outcome, state.stepSeq, 'reply', detail, {
        durationMs: null,
        node: outcome.nodeId ? nodeById(state.graph, outcome.nodeId) : null,
      });
      if (committed !== 'lost' && outcome.saveProperty && state.contactId !== null)
        saved.v = { contactId: state.contactId, ...outcome.saveProperty };
      return committed;
    });
    if (result === 'not_waiting' || result === 'ignored') {
      this.logger.log({ orgId, runId, result }, '[FLR] a reply did not move the run');
      return result;
    }
    if (result === 'lost') return 'ignored';
    this.logger.log(
      { orgId, runId, next: result.next?.seq ?? null },
      '[FLR] a reply moved the run',
    );
    if (saved.v) await this.saveReplyProperty(orgId, runId, saved.v);
    if (result.next)
      await this.publisher.schedule(orgId, runId, result.next.seq, result.next.delayMs);
    return 'routed';
  }

  /**
   * "Also save to a contact attribute" of a List, Quick replies or Ask question: written once the reply is committed, in its own
   * transaction. It never stops the flow: a missing property, a run without a contact or a failed write is logged and the run goes on.
   */
  private async saveReplyProperty(
    orgId: number,
    runId: number,
    save: { contactId: number; key: string; value: string },
  ): Promise<void> {
    if (!this.contacts) return;
    try {
      const done = await this.contacts.setPropertyFromFlow(
        orgId,
        save.contactId,
        save.key,
        save.value,
      );
      if (!done)
        this.logger.warn(
          { orgId, runId, key: save.key },
          '[FLR] no contact property to save the answer on',
        );
    } catch (err) {
      this.logger.warn(
        { err, orgId, runId },
        '[FLR] saving the answer on a contact property failed',
      );
    }
  }

  /** One line per node that ran: which flow, which node, what it decided. No message text or variable values. */
  private logStep(state: RunState, outcome: StepOutcome, event: 'step'): void {
    const t = outcome.transition;
    this.logger.log(
      {
        orgId: state.orgId,
        runId: state.id,
        flowId: state.flowId,
        nodeId: outcome.nodeId,
        nodeType: outcome.nodeType,
        event,
        transition: t.t,
        ...(t.t === 'goto' ? { next: t.nodeId } : {}),
        ...(t.t === 'wait' ? { waitingOn: t.wait.nodeId } : {}),
        ...(t.t === 'end' ? { status: t.status, reason: t.reason } : {}),
        ...(t.t === 'halt' ? { reason: t.reason } : {}),
      },
      `[FLR] node ${outcome.nodeType} ran`,
    );
  }

  // --- giving up -------------------------------------------------------------------------------------------------------------

  /**
   * An idle wait whose time is up, or a run past its absolute limit. Checks the run is still in the state the sweeper saw: a reply
   * that arrived a moment ago keeps the run alive.
   */
  async expire(
    orgId: number,
    runId: number,
    seq: number | null,
    reason: Extract<FlowRunEndReason, 'idle_timeout' | 'max_lifetime'>,
  ): Promise<AdvanceResult> {
    const ended = await this.db.txAs({ orgId }, async (tx) => {
      const state = await this.runs.byId(tx, orgId, runId, true);
      if (!state) return false;
      if (seq !== null && state.stepSeq !== seq) return false;
      const now = this.now().getTime();
      const idle = reason === 'idle_timeout';
      if (
        idle &&
        !(state.status === 'waiting' && state.expiresAt && state.expiresAt.getTime() <= now)
      )
        return false;
      if (!idle && state.maxExpiresAt.getTime() > now) return false;
      if (idle && state.wait?.timeoutPort !== undefined) {
        // A wait that has a timeout branch (a form not filled in, a cart abandoned) leaves by it instead of ending the run.
        state.currentNodeId = state.wait.nodeId;
        const outcome: StepOutcome = {
          transition: advanceFrom(state, state.wait.nodeId, state.wait.timeoutPort, true, 0),
          nodeId: state.wait.nodeId,
          nodeType: null,
          notes: ['the wait timed out: left by the timeout branch'],
        };
        const c = await this.commit(tx, state, outcome, state.stepSeq, 'step', undefined, {
          durationMs: null,
          node: nodeById(state.graph, state.wait.nodeId),
          outcome: 'timeout',
        });
        return c === 'lost' ? false : c;
      }
      const done = await this.runs.endLive(tx, orgId, runId, 'expired', reason);
      if (done) {
        await this.runs.appendStep(tx, orgId, runId, {
          seq: state.stepSeq + 1,
          nodeId: state.currentNodeId,
          nodeType: null,
          event: 'end',
          detail: { status: 'expired', reason },
          nodeLabel: nodeLabel(
            state.currentNodeId ? nodeById(state.graph, state.currentNodeId) : null,
            null,
          ),
          outcome: 'timeout',
          summary: reason,
        });
      }
      return done;
    });
    if (ended && typeof ended === 'object') {
      if (ended.next)
        await this.publisher.schedule(orgId, runId, ended.next.seq, ended.next.delayMs);
      return 'stepped';
    }
    return ended ? 'ended' : 'stale';
  }

  /**
   * An outside event answers a `Custom` wait (a form submission, a payment, a webhook): the node that parked decodes it like a
   * reply. Returns not_waiting when the run moved on or waits for something else (`handler` guards a stale event).
   */
  async deliverExternal(
    orgId: number,
    runId: number,
    handler: string,
    data: Record<string, unknown>,
  ): Promise<ReplyResult> {
    const wanted = await this.db.txAs({ orgId }, async (tx) => {
      const s = await this.runs.byId(tx, orgId, runId);
      return s?.status === 'waiting' && s.wait?.kind === 'Custom' && s.wait.handler === handler;
    });
    if (!wanted) return 'not_waiting';
    return this.deliverReply(orgId, runId, { kind: 'external', id: '', text: '', data });
  }

  /** Ends a live run from outside: a new start replaced it, an operator took over, someone cancelled it. */
  async cancel(
    tx: Tx,
    orgId: number,
    state: RunState,
    reason: Extract<FlowRunEndReason, 'replaced' | 'takeover' | 'channel_removed' | 'cancelled'>,
  ): Promise<boolean> {
    const done = await this.runs.endLive(tx, orgId, state.id, 'cancelled', reason);
    if (done) {
      await this.runs.appendStep(tx, orgId, state.id, {
        seq: state.stepSeq + 1,
        nodeId: state.currentNodeId,
        nodeType: null,
        event: 'end',
        detail: { status: 'cancelled', reason },
        nodeLabel: nodeLabel(
          state.currentNodeId ? nodeById(state.graph, state.currentNodeId) : null,
          null,
        ),
        outcome: 'skipped',
        summary: reason,
      });
    }
    return done;
  }

  /**
   * Ends whatever run a customer has on a channel because a person (or an AI agent) took the conversation over (TW-FLR-050): the flow
   * stops cleanly and does not talk over them. Returns whether a run was ended.
   */
  async endForPeer(orgId: number, channelId: number, peerKey: string): Promise<boolean> {
    return this.db.txAs({ orgId }, async (tx) => {
      const live = await this.runs.liveByPeer(tx, orgId, channelId, peerKey, true);
      return live ? this.cancel(tx, orgId, live, 'takeover') : false;
    });
  }

  /**
   * Until when a customer on a channel is in the cooldown a finished flow asked for (TW-FLR-002 rule 2), or null. A flow's cooldown
   * never stops a flow from starting; it throttles the other canned replies, which is for the Auto reply domain to ask.
   */
  async cooldownUntil(orgId: number, channelId: number, peerKey: string): Promise<Date | null> {
    return this.db.txAs({ orgId }, (tx) => this.runs.cooldownUntil(tx, orgId, channelId, peerKey));
  }

  // --- writing a transition --------------------------------------------------------------------------------------------------

  private async commit(
    tx: Tx,
    state: RunState,
    outcome: StepOutcome,
    expectedSeq: number,
    event: 'step' | 'reply',
    replyDetail?: Record<string, unknown>,
    meta: StepMeta = { durationMs: null, node: null },
  ): Promise<Committed | 'lost'> {
    const t = outcome.transition;
    const now = this.now();
    const patch = this.patchOf(state, t, now);
    const fields = stepFields(outcome, meta.node, {
      durationMs: meta.durationMs,
      attempt: event === 'step' && outcome.nodeId ? (state.visits[outcome.nodeId] ?? null) : null,
    });
    if (meta.outcome) fields.outcome = meta.outcome;
    patch.log = {
      nodes: 1,
      errors: fields.outcome === 'error' ? 1 : 0,
      ms: meta.durationMs ?? 0,
    };
    // A Sub-flow swapped the graph: store the new flow's graph once and point the run at it.
    if (t.t === 'goto' && t.subflowId !== undefined) {
      patch.graphVersionId = await this.runs.upsertGraphVersion(
        tx,
        state.orgId,
        t.subflowId,
        state.graph,
      );
    }
    const saved = await this.runs.save(tx, state.orgId, state.id, expectedSeq, patch);
    if (!saved) return 'lost';

    const seq = expectedSeq + 1;
    // Ordinary steps stop being logged at the cap (a loop or a long halt would otherwise grow the log without end); a failure and the
    // end of the run always are. The step that reaches the cap leaves one marker row so the screen can say the log was cut.
    const important = fields.outcome === 'error' || t.t === 'end';
    const logIt = shouldLog(state.nodeCount, important);
    if (!logIt && state.nodeCount === MAX_LOGGED_STEPS) {
      await this.runs.appendStep(tx, state.orgId, state.id, {
        seq,
        nodeId: null,
        nodeType: null,
        event: 'truncated',
        summary: `log limit of ${MAX_LOGGED_STEPS} steps reached`,
      });
    }
    if (logIt && event === 'reply') {
      await this.runs.appendStep(tx, state.orgId, state.id, {
        seq,
        nodeId: outcome.nodeId,
        nodeType: outcome.nodeType,
        event: 'reply',
        detail: replyDetail ?? {},
        nodeLabel: fields.nodeLabel,
        outcome: 'ok',
      });
    }
    const detail: Record<string, unknown> = {};
    if (outcome.notes.length > 0) detail.notes = outcome.notes;
    if (outcome.io) detail.io = outcome.io;
    if (t.t === 'goto') detail.next = t.nodeId;
    if (t.t === 'goto' && t.subflowId !== undefined) detail.flow_id = t.subflowId;
    if (t.t === 'wait') detail.waitingOn = t.wait.nodeId;
    if (t.t === 'sleep') detail.seconds = t.seconds;
    if (t.t === 'halt') detail.reason = t.reason;
    if (t.t === 'end') detail.reason = t.reason;
    if (logIt)
      await this.runs.appendStep(tx, state.orgId, state.id, {
        seq,
        nodeId: outcome.nodeId,
        nodeType: outcome.nodeType,
        ...fields,
        event:
          t.t === 'goto'
            ? 'advance'
            : t.t === 'end'
              ? 'end'
              : t.t === 'wait'
                ? 'wait'
                : t.t === 'sleep'
                  ? 'sleep'
                  : t.t === 'halt'
                    ? 'halt'
                    : 'exec',
        detail,
        error: t.t === 'end' && t.status === 'failed' ? (t.failureReason ?? null) : null,
      });

    if (t.t === 'end' && state.subscriberId !== null) {
      if (t.status === 'completed')
        await this.subscribers.markCompleted(tx, state.orgId, state.subscriberId);
      else
        await this.subscribers.markFailed(
          tx,
          state.orgId,
          state.subscriberId,
          t.failureReason ?? 'The flow failed',
        );
    }

    switch (t.t) {
      case 'goto':
        return { next: { seq, delayMs: t.delayMs } };
      case 'sleep':
        return { next: { seq, delayMs: t.seconds * 1000 } };
      case 'halt':
        return { next: { seq, delayMs: haltDelayMs(t.retryAt, this.now()) } };
      default:
        return { next: null };
    }
  }

  private patchOf(state: RunState, t: Transition, now: Date): RunPatch {
    const base: RunPatch = {
      status: 'running',
      currentNodeId: state.currentNodeId,
      vars: state.vars,
      visits: state.visits,
      wait: null,
      menus: state.menus,
      lastOut: state.lastOut,
      haltReason: null,
      expiresAt: null,
      maxExpiresAt: state.maxExpiresAt,
      resumeAt: null,
      endedAt: null,
      endReason: null,
      failureCode: null,
      failureReason: null,
      log: { nodes: 0, errors: 0, ms: 0 },
    };
    switch (t.t) {
      case 'goto':
        return {
          ...base,
          status: 'running',
          currentNodeId: t.nodeId,
        };
      case 'wait':
        return {
          ...base,
          status: 'waiting',
          currentNodeId: t.wait.nodeId,
          wait: t.wait,
          expiresAt: new Date(
            now.getTime() + (t.wait.timeoutSeconds ?? state.timeoutSeconds) * 1000,
          ),
        };
      case 'sleep': {
        const wake = new Date(now.getTime() + t.seconds * 1000);
        // A Delay may outlast the usual limit: the run keeps a day beyond its wake-up.
        const limit = Math.max(state.maxExpiresAt.getTime(), wake.getTime() + DAY_MS);
        return { ...base, status: 'sleeping', resumeAt: wake, maxExpiresAt: new Date(limit) };
      }
      case 'halt':
        return {
          ...base,
          status: 'halted',
          haltReason: t.reason.slice(0, 500),
          resumeAt: new Date(now.getTime() + haltDelayMs(t.retryAt, now)),
        };
      case 'end':
        return {
          ...base,
          status: t.status,
          endedAt: now,
          endReason: t.reason,
          failureCode: t.failureCode ?? null,
          failureReason: t.failureReason?.slice(0, 500) ?? null,
        };
      case 'none':
      case 'subflow': // resolved into a goto before it is written
        return base;
    }
  }
}
