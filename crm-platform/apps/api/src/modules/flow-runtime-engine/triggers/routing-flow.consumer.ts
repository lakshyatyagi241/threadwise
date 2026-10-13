import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ROUTING_FLOW_REQUESTED } from '@crm/contracts';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../../kernel/outbox/outbox-subscribers';
import { FlowLaunchService } from '../runtime/launch.service';

type Rows = { rows: Array<Record<string, unknown>> };

/** A routing-started run waits this long for an answer, as Reference's Node start did (a typed keyword uses the longer default). */
export const ROUTING_FLOW_TIMEOUT_SECONDS = 600;

/**
 * A routing rule's "start this flow" action (TW-TIB2-017, TW-FLR-010 rule 1). The rule writes `routing.flow_requested` in the
 * transaction in which it fires; this worker starts the flow for the conversation, on the channel and customer of that thread.
 *
 * As in Reference: the flow only has to be switched on (publishing is not required), there is NO subscriber row, and the run waits 600
 * seconds for an answer. Unlike Reference (which handed the intent to the unofficial WhatsApp bot only, so every other channel recorded
 * it and nothing started), it starts on every channel the flow runtime can send through.
 *
 * Idempotent: the reason of the run is the inbound message that made the conversation, so a redelivered event finds the run it already
 * started and does nothing. A flow that was deleted or switched off since the rule was saved is passed over with a warning in the
 * log (and the rule's list row shows it switched off); nothing is started.
 */
@Injectable()
export class RoutingFlowConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'flow-runtime-routing';
  readonly eventTypes = [ROUTING_FLOW_REQUESTED] as const;
  private readonly logger = new Logger(RoutingFlowConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly db: DatabaseService,
    private readonly launch: FlowLaunchService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const { orgId, payload: p } = event;
    const conversationUuid = typeof p.conversationId === 'string' ? p.conversationId : null;
    const flowUuid = typeof p.flowId === 'string' ? p.flowId : null;
    const messageUuid = typeof p.messageUuid === 'string' ? p.messageUuid : null;
    if (!conversationUuid || !flowUuid || !messageUuid) return;
    const ref = `route:${messageUuid}`;

    const found = await this.db.txAs({ orgId }, async (tx) => {
      const conv = (await tx.execute(sql`
        SELECT id, channel_id, peer_key, contact_id, archived FROM conversations
        WHERE org_id = ${orgId} AND uuid = ${conversationUuid}::uuid`)) as unknown as Rows;
      const flow = (await tx.execute(sql`
        SELECT id, is_active FROM flows WHERE org_id = ${orgId} AND uuid = ${flowUuid}::uuid`)) as unknown as Rows;
      const c = conv.rows[0];
      const f = flow.rows[0];
      const started = f
        ? ((await tx.execute(sql`
            SELECT 1 FROM flow_runs
            WHERE org_id = ${orgId} AND flow_id = ${Number(f.id)} AND source = 'routing' AND trigger_ref = ${ref} LIMIT 1`)) as unknown as Rows)
        : null;
      return { c, f, already: (started?.rows.length ?? 0) > 0 };
    });
    const { c, f } = found;
    if (!c || c.archived === true) return;
    if (!f || f.is_active !== true) {
      this.logger.warn(
        { orgId, flow: flowUuid, rule: p.ruleId },
        '[FLR] routing rule names a flow that is switched off or gone: not started',
      );
      return;
    }
    if (found.already) return;

    const out = await this.launch.start(orgId, {
      flowId: Number(f.id),
      contactId: c.contact_id === null ? null : Number(c.contact_id),
      channelId: Number(c.channel_id),
      peerKey: String(c.peer_key),
      conversationId: Number(c.id),
      source: 'routing',
      triggerRef: ref,
      timeoutSeconds: ROUTING_FLOW_TIMEOUT_SECONDS,
      requirePublished: false,
      withSubscriber: false,
    });
    this.logger.log({ orgId, outcome: out.outcome }, '[FLR] routing rule started a flow');
  }
}
