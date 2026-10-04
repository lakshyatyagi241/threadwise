import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Tx } from '@crm/db';
import type { FlowRunEndReason } from '@crm/contracts';
import { DatabaseService } from '../../../infra/db/database.service';
import { compileGraph } from '../graph/compile-graph';
import { nodeById } from '../graph/runtime-graph';
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
import { FlowSender, HALT_RETRY_MS } from './flow-sender.service';
import { RunRepository, type RunPatch } from './run.repository';
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

interface Committed {
  /** The step number to queue, and when; null when nothing is queued (a wait, an end). */
  next: { seq: number; delayMs: number } | null;
}

/**
 * The run engine (WD-FLR-014 to 016, 018): one step of a run per call, everything it needs in the database.
 *
 * WaDesk kept a run in the memory of one process and walked it with awaited timers, so a restart, a deploy or its hourly sweeper
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
    if (state.status === 'sleeping') {
      const left = (state.resumeAt?.getTime() ?? 0) - now.getTime();
      if (left > 1_000) {
        // Woken early (the sweeper, a duplicate): put the wake-up back where it belongs.
        await this.publisher.schedule(orgId, runId, seq, left).catch(() => undefined);
        return 'not_due';
      }
      outcome = wakeFromSleep(state);
    } else {
      // A halted run that is due simply runs its node again; its sends were never made, so nothing doubles.
      outcome = await executeCurrent(state, this.deps());
      if (outcome.transition.t === 'subflow') {
        outcome = await this.enterSubflow(orgId, state, outcome, outcome.transition.flowId);
      }
    }

    const committed = await this.db.txAs({ orgId }, async (tx) => {
      const saved = await this.commit(tx, state, outcome, seq, 'step');
      return saved;
    });
    if (committed === 'lost') return 'lost';
    if (committed.next) {
      await this.publisher.schedule(orgId, runId, committed.next.seq, committed.next.delayMs);
    }
    return outcome.transition.t === 'end' ? 'ended' : 'stepped';
  }

  /**
   * A Sub-flow node ran (WD-FLR-031): replace the run's graph with another flow's of the same workspace and start at its first node,
   * keeping the variables. Like WaDesk's code (not its docs) the run does not come back to the parent flow. A flow that is missing,
   * another tenant's, or not live is refused the way WaDesk refuses a flow it cannot load: the node is passed by its first exit.
   */
  private async enterSubflow(
    orgId: number,
    state: RunState,
    outcome: StepOutcome,
    flowId: number | string,
  ): Promise<StepOutcome> {
    const nodeId = state.currentNodeId ?? '';
    const pass = (note: string): StepOutcome => ({
      ...outcome,
      transition: advanceFrom(state, nodeId, 1, false, profileOf(state.channelKind ?? '').paceMs),
      notes: [...outcome.notes, note],
    });
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
    const first = graph.nodes[0];
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
    const result = await this.db.txAs({ orgId }, async (tx) => {
      const state = await this.runs.byId(tx, orgId, runId, true);
      if (!state || state.status !== 'waiting' || !state.wait) return 'not_waiting' as const;
      const outcome =
        state.wait.kind === 'Custom'
          ? await applyCustomReply(state, reply, this.deps())
          : applyReply(state, reply);
      if (outcome.transition.t === 'none') return 'ignored' as const;
      const detail = {
        text: reply.text.slice(0, 200),
        ...(reply.id ? { tap: reply.id } : {}),
        ...(reply.kind === 'external' ? { external: true } : {}),
      };
      const committed = await this.commit(tx, state, outcome, state.stepSeq, 'reply', detail);
      return committed;
    });
    if (result === 'not_waiting' || result === 'ignored') return result;
    if (result === 'lost') return 'ignored';
    if (result.next)
      await this.publisher.schedule(orgId, runId, result.next.seq, result.next.delayMs);
    return 'routed';
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
        const c = await this.commit(tx, state, outcome, state.stepSeq, 'step');
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
      });
    }
    return done;
  }

  /**
   * Ends whatever run a customer has on a channel because a person (or an AI agent) took the conversation over (WD-FLR-050): the flow
   * stops cleanly and does not talk over them. Returns whether a run was ended.
   */
  async endForPeer(orgId: number, channelId: number, peerKey: string): Promise<boolean> {
    return this.db.txAs({ orgId }, async (tx) => {
      const live = await this.runs.liveByPeer(tx, orgId, channelId, peerKey, true);
      return live ? this.cancel(tx, orgId, live, 'takeover') : false;
    });
  }

  /**
   * Until when a customer on a channel is in the cooldown a finished flow asked for (WD-FLR-002 rule 2), or null. A flow's cooldown
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
  ): Promise<Committed | 'lost'> {
    const t = outcome.transition;
    const now = this.now();
    const patch = this.patchOf(state, t, now);
    const saved = await this.runs.save(tx, state.orgId, state.id, expectedSeq, patch);
    if (!saved) return 'lost';

    const seq = expectedSeq + 1;
    if (event === 'reply') {
      await this.runs.appendStep(tx, state.orgId, state.id, {
        seq,
        nodeId: outcome.nodeId,
        nodeType: outcome.nodeType,
        event: 'reply',
        detail: replyDetail ?? {},
      });
    }
    const detail: Record<string, unknown> = {};
    if (outcome.notes.length > 0) detail.notes = outcome.notes;
    if (t.t === 'goto') detail.next = t.nodeId;
    if (t.t === 'goto' && t.subflowId !== undefined) detail.flow_id = t.subflowId;
    if (t.t === 'wait') detail.waitingOn = t.wait.nodeId;
    if (t.t === 'sleep') detail.seconds = t.seconds;
    if (t.t === 'halt') detail.reason = t.reason;
    if (t.t === 'end') detail.reason = t.reason;
    await this.runs.appendStep(tx, state.orgId, state.id, {
      seq,
      nodeId: outcome.nodeId,
      nodeType: outcome.nodeType,
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
        return { next: { seq, delayMs: HALT_RETRY_MS } };
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
    };
    switch (t.t) {
      case 'goto':
        return {
          ...base,
          status: 'running',
          currentNodeId: t.nodeId,
          ...(t.subflowId !== undefined ? { graph: state.graph } : {}),
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
          resumeAt: new Date(now.getTime() + HALT_RETRY_MS),
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
