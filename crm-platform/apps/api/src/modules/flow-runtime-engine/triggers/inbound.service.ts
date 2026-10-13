import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  InboundMessageHooks,
  type InboundMessageListener,
  type InboundStoredEvent,
} from '../../chat-conversations';
import { DatabaseService } from '../../../infra/db/database.service';
import { FlowEngine } from '../runtime/engine.service';
import { sql } from 'drizzle-orm';
import { FlowLaunchService, KINDS_OF_PROVIDER } from '../runtime/launch.service';
import { decodeInbound } from '../runtime/reply-router';
import { RunRepository } from '../runtime/run.repository';
import { CHAT_MEDIA_PREFIX } from '../runtime/flow-sender.service';
import { FlowTriggerService } from './trigger.service';

const lc = (s: string) => s.trim().toLowerCase();

/**
 * The inbox's inbound message meets the flow runtime (TW-FLR-002, 003, 018). Runs after a customer's message is stored, in the worker,
 * and answers whether a flow took the message (`consumed`), the contract that keeps an auto reply or an AI agent from answering the
 * same message a second time.
 *
 * The order, as Reference's Baileys path decided it:
 *  1. A parked run and the customer typed the very text that started it: restart the flow (no lookup).
 *  2. Typed text (never a button tap) that matches another flow's keyword starts that flow, even mid-run, replacing the old run.
 *     A flow's cooldown never blocks this; it only throttles other canned replies (`FlowCooldown`).
 *  3. A parked run: the reply goes to the node that waits.
 *  4. No run: a default-route flow, then the away and out-of-hours flows.
 *
 * What a run that is NOT parked (a Delay counting down, a halted channel) does with a new message: nothing of its own; the keyword
 * lookup above still applies, the rest of the pipeline answers as usual (`consumed` false).
 */
@Injectable()
export class FlowInboundService implements InboundMessageListener, OnModuleInit {
  readonly name = 'flow-runtime';
  private readonly logger = new Logger(FlowInboundService.name);

  constructor(
    private readonly hooks: InboundMessageHooks,
    private readonly db: DatabaseService,
    private readonly runs: RunRepository,
    private readonly engine: FlowEngine,
    private readonly launch: FlowLaunchService,
    private readonly triggers: FlowTriggerService,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async onStored(e: InboundStoredEvent): Promise<{ consumed: boolean }> {
    const reply = decodeInbound({
      kind: e.message.kind,
      body: e.message.body,
      meta: e.message.meta,
      location: e.message.location,
      mediaUrl: e.message.mediaKey ? `${CHAT_MEDIA_PREFIX}${e.message.mediaKey}` : null,
      media: e.message.media ?? null,
    });
    const live = await this.db.txAs({ orgId: e.orgId }, (tx) =>
      this.runs.liveByPeer(tx, e.orgId, e.channelId, e.peerKey),
    );

    // A tap on a button the author tied to a step of the bot (a quick reply, a menu entry or a banner): start the bot from that step.
    if (reply?.kind === 'tap') {
      const jump = /^go:([0-9a-f-]{36}):([\w-]{1,64})$/i.exec(reply.id);
      if (jump && (await this.startAt(e, jump[1]!, jump[2]!))) return { consumed: true };
    }

    // Typed text, never a tap: a tap is an answer to a menu, not a keyword.
    const typed = reply && reply.kind !== 'tap' ? reply.text.trim() : '';
    // What the customer typed is not logged, only its shape: enough to tell whether a trigger could have fired.
    this.logger.log(
      {
        orgId: e.orgId,
        channelId: e.channelId,
        channelKind: e.channelKind,
        messageKind: e.message.kind,
        typedLength: typed.length,
        liveRunId: live?.id ?? null,
        liveStatus: live?.status ?? null,
      },
      '[FLR] inbound message received',
    );

    if (typed !== '') {
      if (live && live.status === 'waiting' && live.triggerText && lc(typed) === live.triggerText) {
        const restarted = await this.startKeyword(e, live.flowId, typed, 'keyword');
        if (restarted) return { consumed: true };
      }
      const flow = await this.triggers.keywordFlow(e.orgId, e.channelId, e.channelKind, typed);
      this.logger.log(
        flow
          ? { orgId: e.orgId, flowId: flow.id, keywords: flow.keywords }
          : { orgId: e.orgId, channelId: e.channelId, channelKind: e.channelKind },
        flow
          ? '[FLR] keyword trigger matched a published flow'
          : '[FLR] no published flow matches this keyword on this channel',
      );
      if (flow) {
        const catchAll = /^(\*|\.\*|\.\+|any)$/.test(flow.keywords.trim());
        // The default route fires only when nothing else is going on: it never interrupts a run the customer is answering.
        if (!(catchAll && live)) {
          const started = await this.startKeyword(
            e,
            flow.id,
            typed,
            catchAll ? 'any_message' : 'keyword',
          );
          if (started) return { consumed: true };
        }
      }
    }

    if (live) {
      if (live.status !== 'waiting' || !reply) return { consumed: false };
      const r = await this.engine.deliverReply(e.orgId, live.id, reply);
      // A message the wait ignored (a file nobody asked for) still belongs to the flow while it waits: not answered twice.
      return { consumed: r !== 'not_waiting' };
    }

    if (!reply) return { consumed: false };
    // No run: the workspace's away and out-of-hours flows (TW-FLR-007).
    const started = await this.triggers.onInboundCondition(
      e.orgId,
      e.channelId,
      e.contactId,
      e.peerKey,
    );
    return { consumed: started > 0 };
  }

  /**
   * Starts the bot named by a jump tap at the step the tap names, replacing any run in progress. Only a live bot of this workspace that
   * runs on this channel can be jumped into; anything else is left to the normal handling of the message.
   */
  private async startAt(e: InboundStoredEvent, flowUuid: string, nodeId: string): Promise<boolean> {
    try {
      const flow = await this.db.txAs({ orgId: e.orgId }, async (tx) => {
        const res = (await tx.execute(
          sql`SELECT id, provider, trigger_channel_id, is_published, is_active FROM flows WHERE org_id = ${e.orgId} AND uuid = ${flowUuid}::uuid`,
        )) as unknown as { rows: Array<Record<string, unknown>> };
        return res.rows[0] ?? null;
      });
      if (!flow || !flow.is_published || !flow.is_active) return false;
      const kinds = KINDS_OF_PROVIDER[String(flow.provider)] ?? [];
      const tied = flow.trigger_channel_id === null ? null : Number(flow.trigger_channel_id);
      if (tied !== null ? tied !== e.channelId : !kinds.includes(e.channelKind)) return false;
      const out = await this.launch.start(e.orgId, {
        flowId: Number(flow.id),
        contactId: e.contactId,
        channelId: e.channelId,
        peerKey: e.peerKey,
        source: 'any_message',
        pushName: e.peerName,
        conversationId: e.conversationId,
        requirePublished: true,
        withSubscriber: false,
        startNodeId: nodeId,
      });
      return out.outcome === 'started';
    } catch (err) {
      this.logger.warn(
        { orgId: e.orgId, flowUuid, err: (err as Error).message },
        '[FLR] a jump to a step failed',
      );
      return false;
    }
  }

  private async startKeyword(
    e: InboundStoredEvent,
    flowId: number,
    typed: string,
    source: 'keyword' | 'any_message',
  ): Promise<boolean> {
    try {
      const out = await this.launch.start(e.orgId, {
        flowId,
        contactId: e.contactId,
        channelId: e.channelId,
        peerKey: e.peerKey,
        source,
        triggerText: typed,
        pushName: e.peerName,
        conversationId: e.conversationId,
        requirePublished: true,
        withSubscriber: false,
      });
      this.logger.log(
        {
          orgId: e.orgId,
          flowId,
          source,
          outcome: out.outcome,
          ...(out.outcome === 'started' ? { runId: out.runId } : {}),
          ...(out.outcome === 'failed' ? { code: out.code, reason: out.reason } : {}),
        },
        '[FLR] flow start requested by a trigger',
      );
      return out.outcome === 'started';
    } catch (err) {
      this.logger.warn(
        { orgId: e.orgId, flowId, err: (err as Error).message },
        '[FLR] keyword start failed',
      );
      return false;
    }
  }
}
