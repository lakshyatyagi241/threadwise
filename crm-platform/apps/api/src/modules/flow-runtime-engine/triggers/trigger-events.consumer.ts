import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../../kernel/outbox/outbox-subscribers';
import { DatabaseService } from '../../../infra/db/database.service';
import { FlowTriggerService } from './trigger.service';

export const FLOW_TRIGGER_EVENTS = [
  'contact.created',
  'contact.tag_added',
  'contact.group_added',
  'contact.opt_in',
  'deal.stage_changed',
  'order.placed',
] as const;

type Rows = { rows: Array<{ id: number | string }> };

/**
 * Turns domain events into flow triggers (TW-FLR-005, 006). Reference called these from model hooks inside the request that caused them
 * (a slow tag import held the page); here the event is committed with its cause and a worker reacts, so a failure to launch never
 * touches the tag, the contact or the deal, and delivery is at-least-once (enrolment is idempotent per flow and contact).
 *
 * - `contact.created`: not for an import (`via: import`): a bulk import does not blast a flow to everyone (TW-FLR-005 rule 3).
 * - `contact.tag_added` / `contact.group_added`: the tag or group the flow is bound to.
 * - `contact.opt_in`: only a person coming back (`optedIn: true`).
 * - `deal.stage_changed`: only a move into a stage; a deal created in a stage does not fire (TW-FLR-006 rule 3).
 * - `order.placed`: the commerce domain's event; see `OrderPlaced` for its payload.
 */
@Injectable()
export class FlowTriggerEventsConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'flow-runtime-triggers';
  readonly eventTypes = FLOW_TRIGGER_EVENTS;
  private readonly logger = new Logger(FlowTriggerEventsConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly db: DatabaseService,
    private readonly triggers: FlowTriggerService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const { orgId, payload: p } = event;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    switch (event.eventType) {
      case 'contact.created': {
        if (p.via === 'import') return;
        await this.triggers.onContactCreated(orgId, Number(event.aggregateId));
        return;
      }
      case 'contact.tag_added': {
        const tagId = await this.idOf(orgId, 'tags', str(p.tagId));
        if (tagId !== null) await this.triggers.onTagAdded(orgId, Number(event.aggregateId), tagId);
        return;
      }
      case 'contact.group_added': {
        const groupId = await this.idOf(orgId, 'contact_groups', str(p.groupId));
        if (groupId !== null)
          await this.triggers.onGroupJoin(orgId, Number(event.aggregateId), groupId);
        return;
      }
      case 'contact.opt_in': {
        if (p.optedIn !== true) return;
        const contactId =
          typeof p.contactId === 'number'
            ? p.contactId
            : await this.idOf(orgId, 'contacts', str(p.contactId));
        if (contactId !== null) await this.triggers.onOptIn(orgId, contactId);
        return;
      }
      case 'deal.stage_changed': {
        if (!str(p.fromStageId)) return;
        const contactId = await this.idOf(orgId, 'contacts', str(p.contactId));
        const stageId = await this.idOf(orgId, 'pipeline_stages', str(p.toStageId));
        const deal = str(p.uuid);
        if (contactId !== null && stageId !== null && deal) {
          await this.triggers.onDealStageChanged(orgId, contactId, stageId, deal);
        }
        return;
      }
      case 'order.placed': {
        await this.triggers.onOrderPlaced(orgId, {
          orderId: String(p.orderId ?? event.aggregateId),
          contactId: typeof p.contactId === 'number' ? p.contactId : null,
          phone: str(p.phone),
          name: str(p.name),
          email: str(p.email),
          orderNumber: str(p.orderNumber),
          totalMinor: typeof p.totalMinor === 'number' ? p.totalMinor : null,
          currency: str(p.currency),
          status: str(p.status),
          invoiceUrl: str(p.invoiceUrl),
          orderUrl: str(p.orderUrl),
          paymentLink: str(p.paymentLink),
        });
        return;
      }
    }
  }

  /** A uuid on the wire to the id inside the tenant; null when it is not there (deleted since). */
  private async idOf(
    orgId: number,
    table: 'tags' | 'contact_groups' | 'contacts' | 'pipeline_stages',
    uuid: string | null,
  ): Promise<number | null> {
    if (!uuid) return null;
    return this.db.txAs({ orgId }, async (tx) => {
      const res = (await tx.execute(
        sql`SELECT id FROM ${sql.raw(table)} WHERE org_id = ${orgId} AND uuid = ${uuid}`,
      )) as unknown as Rows;
      const r = res.rows[0];
      return r ? Number(r.id) : null;
    });
  }
}
