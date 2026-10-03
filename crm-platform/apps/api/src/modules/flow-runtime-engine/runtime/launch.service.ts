import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { ERROR_CODES, FLOW_DEFAULT_TIMEOUT_SECONDS, type FlowRunSource } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { isPhoneChannel, normalizePeerKey } from '../../chat-conversations';
import { compileGraph } from '../graph/compile-graph';
import type { RuntimeGraph } from '../graph/runtime-graph';
import { FlowEngine } from './engine.service';
import { FlowRunPublisher } from './flow-run.publisher';
import { RunRepository } from './run.repository';
import { seedVariables } from './seed';
import { SubscriberRepository, type SubscriberRow } from './subscriber.repository';

const HOUR_MS = 3_600_000;
/** How long a run may live whatever it does, unless a Delay needs longer (then it is the wake-up plus a day). */
export const MAX_RUN_LIFETIME_MS = 7 * 24 * HOUR_MS;
/** Runs started by something other than a typed keyword wait a day for an answer: nobody is at the keyboard when they begin. */
export const PROACTIVE_TIMEOUT_SECONDS = 24 * 3600;
/** A flow that fires on every inbound while the workspace is away may run again for the same person after this long. */
export const AWAY_REARM_MS = 12 * HOUR_MS;

/** Sources whose flows may run again for the same contact (WD-FLR-006 port notes, WD-FLR-007): the reason differs each time. */
const REENTRY_BY_REF: ReadonlySet<FlowRunSource> = new Set(['order_placed', 'deal_stage_changed']);
const REENTRY_AFTER_QUIET: ReadonlySet<FlowRunSource> = new Set(['away', 'out_of_hours']);

/** Which channel kinds carry a flow of each engine stamp. Twilio and the other-channel engines have no inbox channel here yet. */
export const KINDS_OF_PROVIDER: Readonly<Record<string, readonly string[]>> = {
  baileys: ['whatsapp_qr'],
  waba: ['whatsapp_cloud'],
  telegram: ['telegram'],
  webchat: ['webchat'],
  simulator: ['simulator'],
};

export interface FlowRow {
  id: number;
  uuid: string;
  name: string;
  data: unknown;
  isPublished: boolean;
  isActive: boolean;
  provider: string;
  triggerChannelId: number | null;
}

export interface LaunchInput {
  flowId: number;
  contactId?: number | null;
  /** The channel the customer wrote to (an inbound start). Otherwise the flow's own sender is resolved. */
  channelId?: number | null;
  peerKey?: string | null;
  source: FlowRunSource;
  /** What this launch is about (an order id, a deal and stage): lets a flow run again for a new reason. */
  triggerRef?: string | null;
  triggerText?: string | null;
  pushName?: string | null;
  variables?: Record<string, unknown>;
  timeoutSeconds?: number;
  cooldownSeconds?: number;
  variant?: string | null;
  campaignId?: number | null;
  /** Automatic triggers need a flow that is published AND active; manual and API enrollment only need it active (WD-FLR-008 rule 2). */
  requirePublished: boolean;
  /** Create (or reuse) the flow_subscribers row. False for a run on a customer who is not a contact yet (a keyword start). */
  withSubscriber: boolean;
  /** A retry of a failed run: the same subscriber row, a new run. */
  retry?: boolean;
  conversationId?: number | null;
}

export type LaunchOutcome =
  | {
      outcome: 'started';
      runId: number;
      runUuid: string;
      subscriberId: number | null;
      replacedRunId: number | null;
    }
  | { outcome: 'already_enrolled'; subscriberId: number | null }
  | { outcome: 'failed'; reason: string; code: string; subscriberId: number | null };

class NoSender extends Error {}

/**
 * Starts a run: the one door for every launch path (WD-FLR-010, 011). WaDesk had six, and only some wrote a run row, so analytics
 * and retry missed the rest; here every path ends in `start`, which always writes the run with its `source`.
 *
 * What it does, in one transaction: loads the flow and refuses one that is not live enough for the path; compiles its graph (the run
 * keeps that copy); finds the sender (the channel the customer wrote to, the flow's own channel, or the first connected channel of
 * the flow's engine); reads the contact into the variables; takes a lock on the (channel, customer) pair and ends any run already
 * there (`replaced`, a new start always wins, WD-FLR-015 rule 1); writes the run and its subscriber row. The first step is queued
 * after the commit.
 *
 * A subscriber row launches a run once (a new row, or a failed one), plus a run per new reason for the sources that have one
 * (`REENTRY_BY_REF`) and again after a quiet period for away flows. A launch that finds no sender or no number does not throw: it
 * marks the subscriber `failed` with the reason, where an operator sees it and can retry.
 */
@Injectable()
export class FlowLaunchService {
  private readonly logger = new Logger(FlowLaunchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly runs: RunRepository,
    private readonly subscribers: SubscriberRepository,
    private readonly publisher: FlowRunPublisher,
    private readonly engine: FlowEngine,
  ) {}

  /** Starts in its own transaction and queues the first step. */
  async start(orgId: number, input: LaunchInput): Promise<LaunchOutcome> {
    const result = await this.db.txAs({ orgId }, (tx) => this.startIn(tx, orgId, input));
    if (result.outcome === 'started') await this.publisher.schedule(orgId, result.runId, 0, 0);
    return result;
  }

  /** Starts inside the caller's transaction. The caller must queue step 0 of a `started` run after it commits (`publisher.schedule`). */
  async startIn(tx: Tx, orgId: number, input: LaunchInput): Promise<LaunchOutcome> {
    const flow = await this.loadFlow(tx, orgId, input.flowId);
    if (!flow) {
      throw new AppError(ERROR_CODES.FLR_FLOW_NOT_FOUND, 'Flow not found', HttpStatus.NOT_FOUND);
    }
    if (!flow.isActive || (input.requirePublished && !flow.isPublished)) {
      throw new AppError(
        ERROR_CODES.FLR_FLOW_INACTIVE,
        'This flow is not live: publish and switch it on first',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const graph = compileGraph(flow.data);
    if (graph.nodes.length === 0) {
      throw new AppError(
        ERROR_CODES.FLR_FLOW_EMPTY,
        'This flow has no steps',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // The subscriber row decides whether anything launches.
    let subscriber: SubscriberRow | null = null;
    if (input.withSubscriber && input.contactId) {
      const got = await this.subscribers.firstOrCreate(
        tx,
        orgId,
        flow.id,
        input.contactId,
        input.source,
      );
      subscriber = got.row;
      if (!got.created && !(await this.mayRelaunch(tx, orgId, got.row, input))) {
        return { outcome: 'already_enrolled', subscriberId: got.row.id };
      }
      if (!got.created)
        await this.subscribers.reactivate(
          tx,
          orgId,
          got.row.id,
          input.source,
          input.retry === true,
        );
    }

    let sender: { channelId: number; kind: string; peerKey: string };
    try {
      sender = await this.resolveSender(tx, orgId, flow, input);
    } catch (err) {
      if (!(err instanceof NoSender)) throw err;
      if (subscriber) await this.subscribers.markFailed(tx, orgId, subscriber.id, err.message);
      return {
        outcome: 'failed',
        reason: err.message,
        code: 'FLR_NO_SENDER',
        subscriberId: subscriber?.id ?? null,
      };
    }

    // Two starts for one customer at the same moment must not both create a live run.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`flr:${orgId}:${sender.channelId}:${sender.peerKey}`}, 0))`,
    );
    const live = await this.runs.liveByPeer(tx, orgId, sender.channelId, sender.peerKey, true);
    if (live) await this.engine.cancel(tx, orgId, live, 'replaced');

    const keywordStart = input.source === 'keyword' || input.source === 'any_message';
    const vars = await seedVariables(tx, orgId, input.contactId ?? null, sender.peerKey, {
      userMessage: keywordStart ? input.triggerText : null,
      pushName: input.pushName,
      variables: { ...(graph.vars ?? {}), ...(input.variables ?? {}) },
    });
    const run = await this.runs.insert(tx, orgId, {
      flowId: flow.id,
      subscriberId: subscriber?.id ?? null,
      contactId: input.contactId ?? null,
      channelId: sender.channelId,
      peerKey: sender.peerKey,
      conversationId: input.conversationId ?? null,
      source: input.source,
      triggerRef: input.triggerRef ?? null,
      triggerText: input.triggerText ? input.triggerText.trim().toLowerCase() : null,
      graph: graph as RuntimeGraph,
      currentNodeId: graph.nodes[0]!.id,
      vars,
      timeoutSeconds:
        input.timeoutSeconds ??
        (keywordStart ? FLOW_DEFAULT_TIMEOUT_SECONDS : PROACTIVE_TIMEOUT_SECONDS),
      cooldownSeconds: input.cooldownSeconds ?? 0,
      variant: input.variant ?? null,
      campaignId: input.campaignId ?? null,
      maxExpiresAt: new Date(Date.now() + MAX_RUN_LIFETIME_MS),
    });
    if (subscriber) await this.subscribers.attachRun(tx, orgId, subscriber.id, run.id);
    return {
      outcome: 'started',
      runId: run.id,
      runUuid: run.uuid,
      subscriberId: subscriber?.id ?? null,
      replacedRunId: live?.id ?? null,
    };
  }

  // --- pieces ----------------------------------------------------------------------------------------------------------------

  async loadFlow(tx: Tx, orgId: number, flowId: number): Promise<FlowRow | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, flow_name, flow_data, is_published, is_active, provider, trigger_channel_id
      FROM flows WHERE org_id = ${orgId} AND id = ${flowId}`);
    const r = (res as unknown as { rows: Array<Record<string, unknown>> }).rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      uuid: String(r.uuid),
      name: String(r.flow_name),
      data: r.flow_data,
      isPublished: Boolean(r.is_published),
      isActive: Boolean(r.is_active),
      provider: String(r.provider),
      triggerChannelId: r.trigger_channel_id === null ? null : Number(r.trigger_channel_id),
    };
  }

  /** A contact already in the flow starts again only after a failure, or (per source) for a new reason or after a quiet period. */
  private async mayRelaunch(
    tx: Tx,
    orgId: number,
    sub: SubscriberRow,
    input: LaunchInput,
  ): Promise<boolean> {
    if (sub.status === 'failed') return true;
    if (input.retry) return true;
    if (sub.status === 'paused') return false;
    if (!REENTRY_BY_REF.has(input.source) && !REENTRY_AFTER_QUIET.has(input.source)) return false;
    if (sub.lastRunId === null) return false;
    const res = await tx.execute(sql`
      SELECT status, trigger_ref, ended_at FROM flow_runs WHERE org_id = ${orgId} AND id = ${sub.lastRunId}`);
    const last = (
      res as unknown as {
        rows: Array<{ status: string; trigger_ref: string | null; ended_at: string | null }>;
      }
    ).rows[0];
    if (!last) return true;
    if (['running', 'waiting', 'sleeping', 'halted'].includes(last.status)) return false;
    if (REENTRY_BY_REF.has(input.source)) {
      return input.triggerRef != null && input.triggerRef !== last.trigger_ref;
    }
    return (
      last.ended_at !== null && Date.now() - new Date(last.ended_at).getTime() >= AWAY_REARM_MS
    );
  }

  /** The channel a run sends through and the customer's key on it. */
  private async resolveSender(
    tx: Tx,
    orgId: number,
    flow: FlowRow,
    input: LaunchInput,
  ): Promise<{ channelId: number; kind: string; peerKey: string }> {
    const q = async (cond: ReturnType<typeof sql>) => {
      const res = await tx.execute(
        sql`SELECT id, kind FROM channels WHERE org_id = ${orgId} AND ${cond} ORDER BY id LIMIT 1`,
      );
      return (res as unknown as { rows: Array<{ id: number | string; kind: string }> }).rows[0];
    };
    let ch: { id: number | string; kind: string } | undefined;
    if (input.channelId) {
      ch = await q(sql`id = ${input.channelId}`);
    } else {
      if (flow.triggerChannelId)
        ch = await q(sql`id = ${flow.triggerChannelId} AND status = 'connected'`);
      if (!ch) {
        const kinds = KINDS_OF_PROVIDER[flow.provider] ?? [];
        if (kinds.length > 0)
          ch = await q(
            sql`status = 'connected' AND kind IN (${sql.join(
              kinds.map((k) => sql`${k}`),
              sql`, `,
            )})`,
          );
      }
    }
    if (!ch) {
      throw new NoSender(`No connected ${flow.provider} sender for this workspace`);
    }
    const kind = ch.kind;
    let peerKey = input.peerKey ? normalizePeerKey(kind, input.peerKey) : null;
    if (!peerKey && input.contactId) {
      if (isPhoneChannel(kind)) {
        const res = await tx.execute(
          sql`SELECT phone FROM contacts WHERE org_id = ${orgId} AND id = ${input.contactId}`,
        );
        const phone = (res as unknown as { rows: Array<{ phone: string | null }> }).rows[0]?.phone;
        peerKey = normalizePeerKey(kind, phone);
        if (!peerKey) throw new NoSender('Contact has no usable mobile number');
      } else {
        const res = await tx.execute(sql`
          SELECT peer_key FROM conversations WHERE org_id = ${orgId} AND channel_id = ${ch.id} AND contact_id = ${input.contactId}
          ORDER BY id DESC LIMIT 1`);
        peerKey =
          (res as unknown as { rows: Array<{ peer_key: string }> }).rows[0]?.peer_key ?? null;
        if (!peerKey) throw new NoSender('This contact has not written to the channel yet');
      }
    }
    if (!peerKey) throw new NoSender('The customer has no key on the channel');
    return { channelId: Number(ch.id), kind, peerKey };
  }
}
