import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, HANDOFF_RETURNED_TO_BOT, flbHandoffReturnPlan } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../../kernel/outbox/outbox-subscribers';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../../chat-conversations';
import { ConversationEventsRepository } from '../../team-inbox-conversations';
import { FlowRunPublisher } from '../runtime/flow-run.publisher';
import { FlowLaunchService } from '../runtime/launch.service';
import { seedVariables } from '../runtime/seed';
import { interpolate } from '../runtime/variables';

type Rows = { rows: Array<Record<string, unknown>> };

/** The words the thread line and the timeline use for what happened to the message to the customer. */
export type ReturnCustomerOutcome =
  'sent' | 'window_closed' | 'no_consent' | 'failed' | 'channel_unavailable';
export type ReturnResult = 'continued' | 'claimed_again' | 'flow_not_live' | 'start_failed';

const deterministicUuid = (seed: string): string => {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** Why the normal outbound path refused the message to the customer, in the few words the staff line has. */
export function customerOutcomeOf(err: unknown): ReturnCustomerOutcome {
  const code = err instanceof AppError ? String(err.code) : '';
  if (code === ERROR_CODES.SERVICE_WINDOW_CLOSED) return 'window_closed';
  if (code.startsWith('CONSENT_')) return 'no_consent';
  if (code === 'CHANNEL_DISCONNECTED' || code === 'CHANNEL_CAPABILITY_UNSUPPORTED')
    return 'channel_unavailable';
  return 'failed';
}

/**
 * Return to bot continues the flow (BL-410). A person pressed Return to bot on a chat that a flow's Human handoff step handed over;
 * the API wrote `handoff.returned_to_bot` in the same transaction that gave the chat back. This worker then:
 *
 *  1. leaves everything alone when a person has taken the chat again meanwhile (re-checked under the conversation's row lock, in the
 *     transaction that starts the run, so a claim and a resume can never both win),
 *  2. sends the optional "message to the customer when the bot is back" written on the step, once, as the business, through the
 *     normal outbound path (the 24 hour window and the contact's consent are enforced there; a refusal is reported, never thrown),
 *  3. starts the flow at the step the step's `returned` exit leads to, carrying the variables the paused run had collected, and
 *  4. writes what happened, for the staff: a line in the thread and a timeline event.
 *
 * Idempotent: the run's `trigger_ref` is `return:<handoff>`, the customer message has a deterministic id, and the result line has a
 * fixed provider id, so a redelivered event neither starts a second run nor sends a second message nor writes a second line.
 */
@Injectable()
export class HandoffReturnConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'flow-runtime-handoff-return';
  readonly eventTypes = [HANDOFF_RETURNED_TO_BOT] as const;
  private readonly logger = new Logger(HandoffReturnConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly db: DatabaseService,
    private readonly launch: FlowLaunchService,
    private readonly publisher: FlowRunPublisher,
    private readonly events: ConversationEventsRepository,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const p = event.payload;
    const conversationUuid = typeof p.conversationId === 'string' ? p.conversationId : null;
    const handoffUuid = typeof p.handoffId === 'string' ? p.handoffId : null;
    const flowUuid = typeof p.flowId === 'string' ? p.flowId : null;
    const nodeId = typeof p.nodeId === 'string' ? p.nodeId : null;
    const flowRunId = typeof p.flowRunId === 'number' ? p.flowRunId : null;
    if (!conversationUuid || !handoffUuid || !flowUuid || !nodeId) return;
    await RequestContextStore.run(
      {
        requestId: `handoff-return-${event.id}`,
        orgId: event.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.resume(event.orgId, { conversationUuid, handoffUuid, flowUuid, nodeId, flowRunId }),
    );
  }

  async resume(
    orgId: number,
    a: {
      conversationUuid: string;
      handoffUuid: string;
      flowUuid: string;
      nodeId: string;
      flowRunId: number | null;
    },
  ): Promise<ReturnResult | 'duplicate' | 'gone'> {
    const ref = `return:${a.handoffUuid}`;
    const seen = await this.db.txAs({ orgId }, async (tx) => {
      const conv = (await tx.execute(sql`
        SELECT c.id, c.channel_id, c.peer_key, c.contact_id, c.archived, c.handling, c.assignee_user_id, ch.uuid AS channel_uuid
        FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
        WHERE c.org_id = ${orgId} AND c.uuid = ${a.conversationUuid}::uuid`)) as unknown as Rows;
      const flow = (await tx.execute(sql`
        SELECT id, is_active, is_published, flow_data FROM flows WHERE org_id = ${orgId} AND uuid = ${a.flowUuid}::uuid`)) as unknown as Rows;
      const f = flow.rows[0];
      const started = f
        ? ((await tx.execute(sql`
            SELECT 1 FROM flow_runs WHERE org_id = ${orgId} AND flow_id = ${Number(f.id)} AND source = 'handoff' AND trigger_ref = ${ref} LIMIT 1`)) as unknown as Rows)
        : null;
      const run =
        a.flowRunId !== null
          ? ((await tx.execute(sql`
              SELECT vars FROM flow_runs WHERE org_id = ${orgId} AND id = ${a.flowRunId}`)) as unknown as Rows)
          : null;
      return {
        c: conv.rows[0],
        f,
        already: (started?.rows.length ?? 0) > 0,
        vars: (run?.rows[0]?.vars ?? {}) as Record<string, unknown>,
      };
    });
    const { c, f } = seen;
    if (!c || c.archived === true) return 'gone';
    if (seen.already) return 'duplicate';
    const thread = { channelUuid: String(c.channel_uuid), peerKey: String(c.peer_key) };
    const done = (result: ReturnResult, customer: ReturnCustomerOutcome | null) =>
      this.report(orgId, a, Number(c.id), thread, result, customer);

    const claimed = (row: Record<string, unknown>) =>
      row.handling !== 'with_bot' || row.assignee_user_id !== null;
    if (claimed(c)) return done('claimed_again', null);
    const plan =
      f && f.is_active === true && f.is_published === true
        ? flbHandoffReturnPlan(f.flow_data, a.nodeId)
        : null;
    if (!f || !plan || !plan.ok) return done('flow_not_live', null);

    // The optional message to the customer, before the flow carries on. A refusal is reported on the staff line, never thrown.
    let customer: ReturnCustomerOutcome | null = null;
    if (plan.message !== '') {
      const bag = await this.db.txAs({ orgId }, (tx) =>
        seedVariables(
          tx,
          orgId,
          c.contact_id === null ? null : Number(c.contact_id),
          String(c.peer_key),
          { variables: seen.vars },
        ),
      );
      const body = interpolate(plan.message, bag).trim();
      if (body !== '') {
        try {
          await this.conversations.enqueueOutbound({
            conversationId: a.conversationUuid,
            clientMessageId: deterministicUuid(`handoff-return-message:${a.handoffUuid}`),
            content: { kind: 'text', body },
            sender: { kind: 'bot' },
          });
          customer = 'sent';
        } catch (err) {
          customer = customerOutcomeOf(err);
          this.logger.warn(
            { orgId, conversation: a.conversationUuid, outcome: customer },
            '[FLR] the "bot is back" message to the customer was not sent',
          );
        }
      }
    }

    // Start under the conversation's row lock: a person who claims the chat takes the same lock, so exactly one of us wins.
    let outcome: ReturnResult;
    try {
      const started = await this.db.txAs({ orgId }, async (tx) => {
        const lock = (await tx.execute(sql`
          SELECT handling, assignee_user_id FROM conversations WHERE org_id = ${orgId} AND id = ${Number(c.id)} FOR UPDATE`)) as unknown as Rows;
        if (!lock.rows[0] || claimed(lock.rows[0])) return 'claimed' as const;
        const again = (await tx.execute(sql`
          SELECT 1 FROM flow_runs WHERE org_id = ${orgId} AND flow_id = ${Number(f.id)} AND source = 'handoff' AND trigger_ref = ${ref} LIMIT 1`)) as unknown as Rows;
        if (again.rows.length > 0) return 'duplicate' as const;
        return this.launch.startIn(tx, orgId, {
          flowId: Number(f.id),
          contactId: c.contact_id === null ? null : Number(c.contact_id),
          channelId: Number(c.channel_id),
          peerKey: String(c.peer_key),
          conversationId: Number(c.id),
          source: 'handoff',
          triggerRef: ref,
          variables: seen.vars,
          requirePublished: true,
          withSubscriber: false,
          startNodeId: plan.targetNodeId,
        });
      });
      if (started === 'duplicate') return 'duplicate';
      if (started === 'claimed') outcome = 'claimed_again';
      else if (started.outcome === 'started') {
        await this.publisher.schedule(orgId, started.runId, 0, 0);
        outcome = 'continued';
      } else outcome = 'start_failed';
    } catch (err) {
      this.logger.warn(
        { orgId, flow: a.flowUuid, err: err instanceof Error ? err.message : String(err) },
        '[FLR] Return to bot could not continue the flow',
      );
      outcome = err instanceof AppError ? 'flow_not_live' : 'start_failed';
    }
    return done(outcome, customer);
  }

  /** What happened, for the staff: a line in the thread (realtime) and a timeline event. Best effort; the ledger and the run are the truth. */
  private async report(
    orgId: number,
    a: { conversationUuid: string; handoffUuid: string },
    conversationId: number,
    thread: { channelUuid: string; peerKey: string },
    result: ReturnResult,
    customer: ReturnCustomerOutcome | null,
  ): Promise<ReturnResult> {
    try {
      await this.db.txAs({ orgId }, (tx) =>
        this.events.append(tx, orgId, {
          conversationId,
          type: 'bot_resumed',
          actorKind: 'flow',
          payload: { result, ...(customer ? { customer } : {}) },
        }),
      );
      await this.conversations.recordOutbound({
        channelId: thread.channelUuid,
        peerKey: thread.peerKey,
        source: 'handoff',
        kind: 'system',
        direction: 'in',
        body: `${RESULT_TEXT[result]}${customer ? ` ${CUSTOMER_TEXT[customer]}` : ''}`,
        providerMessageId: `bot-back-result:${a.handoffUuid}`,
        meta: {
          event: 'bot_returned',
          botStage: 'result',
          botResult: result,
          ...(customer ? { botCustomer: customer } : {}),
        },
      });
    } catch (err) {
      this.logger.warn({ err, orgId }, '[FLR] the Return to bot result could not be written');
    }
    return result;
  }
}

/** English text of the result line (exports, old clients); the web words it in the reader's language from `systemEvent`. */
const RESULT_TEXT: Record<ReturnResult, string> = {
  continued: 'The flow continued from the "returned" exit.',
  claimed_again: 'The flow was not resumed: a person took the chat again.',
  flow_not_live: 'The flow was not resumed: it is no longer live.',
  start_failed: 'The flow could not be resumed.',
};
const CUSTOMER_TEXT: Record<ReturnCustomerOutcome, string> = {
  sent: 'The message to the customer was sent.',
  window_closed: 'The message to the customer was skipped: the 24 hour window is closed.',
  no_consent: 'The message to the customer was skipped: no consent.',
  failed: 'The message to the customer could not be sent.',
  channel_unavailable: 'The message to the customer was skipped: the channel is unavailable.',
};
