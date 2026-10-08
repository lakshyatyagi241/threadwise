import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../../../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../../../../kernel/outbox/outbox-subscribers';
import { CONTACT_RESOLVER, type ContactResolverPort } from '../../../../crm';
import { FlowLaunchService } from '../../launch.service';
import { RunRepository } from '../../run.repository';
import { parseFlowRef } from '../flow-refs';
import { WHATSAPP_HANDOFF_EVENT } from './social-handoff-node';

/**
 * Direct hand-off from an Instagram or Messenger flow to a WhatsApp flow (WD-FLR-010 rule 6). Finds the workspace's contact that owns the
 * captured number, or creates a light one named "WhatsApp <digits>" like WaDesk, then starts the chosen flow for it with the Instagram
 * flow's variables. WaDesk only enrolled; a flow that is gone or switched off, a number the plan has no room for or a contact already
 * in that flow is logged and left alone (the launch itself reports an already-enrolled contact). Worker process only.
 */
@Injectable()
export class SocialHandoffConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'flow-whatsapp-handoff';
  readonly eventTypes = [WHATSAPP_HANDOFF_EVENT] as const;
  private readonly logger = new Logger(SocialHandoffConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly db: DatabaseService,
    private readonly runs: RunRepository,
    private readonly launch: FlowLaunchService,
    @Inject(CONTACT_RESOLVER) private readonly contacts: ContactResolverPort,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const orgId = event.orgId;
    const p = event.payload;
    const number = typeof p.number === 'string' ? p.number.replace(/\D+/g, '') : '';
    const ref = parseFlowRef(p.flowRef);
    if (number === '' || !ref) return;

    const flow = await this.db.txAs({ orgId }, (tx) =>
      this.runs.flowForSubflow(tx, orgId, ref.kind === 'id' ? ref.id : ref.uuid),
    );
    if (!flow || !flow.isActive) {
      this.logger.log({ orgId }, '[FLR] hand-off: the WhatsApp flow is missing or off');
      return;
    }
    const link = await this.db.txAs({ orgId }, (tx) =>
      this.contacts.findOrCreateByPhone(tx, orgId, {
        phone: `+${number}`,
        name: `WhatsApp ${number}`,
        source: 'flow_handoff',
      }),
    );
    if (link.outcome === 'skipped') {
      this.logger.log({ orgId, reason: link.reason }, '[FLR] hand-off: no contact for the number');
      return;
    }
    const variables =
      p.variables !== null && typeof p.variables === 'object' && !Array.isArray(p.variables)
        ? (p.variables as Record<string, unknown>)
        : {};
    const out = await this.launch.start(orgId, {
      flowId: flow.id,
      contactId: link.contactId,
      source: 'handoff',
      requirePublished: false,
      withSubscriber: true,
      variables,
    });
    this.logger.log({ orgId, outcome: out.outcome }, '[FLR] hand-off: WhatsApp flow launched');
  }
}
