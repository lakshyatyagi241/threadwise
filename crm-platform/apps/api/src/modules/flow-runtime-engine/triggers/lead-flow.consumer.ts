import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../../kernel/outbox/outbox-subscribers';
import { FlowLaunchService } from '../runtime/launch.service';

type Rows = { rows: Array<Record<string, unknown>> };

/**
 * The flow of a lead source (TW-FLR-010 rule 4; Reference's incoming webhook "enroll the captured lead in a flow"). The lead pipeline
 * writes `lead.created` or `lead.updated` with the source's `flowId`; this worker puts the lead's contact into that flow, as an
 * enrolment: the contact gets a subscriber row, and is in the flow once, so a returning lead (`lead.updated`) and a redelivered event
 * start nothing more.
 *
 * As in Reference the flow only has to be switched on (publishing is not required). A flow that is switched off or deleted since the
 * source was saved is passed over with a warning. A lead the flow cannot reach (no connected sender, no mobile number) is not dropped:
 * the launch marks the subscriber failed with the reason, where the Subscribers screen shows it and can retry. A test lead
 * (`test: true`, the admin's "send a test lead") is quiet and starts nothing. `lead_source` and `lead_platform` are set on the run in
 * addition to the contact's own fields.
 */
@Injectable()
export class LeadFlowConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'flow-runtime-leads';
  readonly eventTypes = ['lead.created', 'lead.updated'] as const;
  private readonly logger = new Logger(LeadFlowConsumer.name);

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
    const flowUuid = typeof p.flowId === 'string' ? p.flowId : null;
    const contactUuid = typeof p.contactId === 'string' ? p.contactId : null;
    if (!flowUuid || !contactUuid || p.test === true) return;

    const found = await this.db.txAs({ orgId }, async (tx) => {
      const flow = (await tx.execute(sql`
        SELECT id, is_active FROM flows WHERE org_id = ${orgId} AND uuid = ${flowUuid}::uuid`)) as unknown as Rows;
      const contact = (await tx.execute(sql`
        SELECT id FROM contacts WHERE org_id = ${orgId} AND uuid = ${contactUuid}::uuid`)) as unknown as Rows;
      return { flow: flow.rows[0], contact: contact.rows[0] };
    });
    if (!found.contact) return;
    if (!found.flow || found.flow.is_active !== true) {
      this.logger.warn(
        { orgId, flow: flowUuid, source: p.leadSourceId },
        '[FLR] lead source names a flow that is switched off or gone: the lead was not put into it',
      );
      return;
    }

    const out = await this.launch.start(orgId, {
      flowId: Number(found.flow.id),
      contactId: Number(found.contact.id),
      source: 'webhook_lead',
      triggerRef: typeof p.leadEventId === 'string' ? `lead:${p.leadEventId}` : null,
      requirePublished: false,
      withSubscriber: true,
      variables: {
        lead_source: typeof p.sourceName === 'string' ? p.sourceName : undefined,
        lead_platform: typeof p.platform === 'string' ? p.platform : undefined,
      },
    });
    this.logger.log({ orgId, outcome: out.outcome }, '[FLR] lead put into its source flow');
  }
}
