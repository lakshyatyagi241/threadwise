import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { TeamUsageRepository } from './team-usage.repository';

/**
 * `team.deleted`: takes the team out of the places that kept its uuid inside JSON (BL-380, gap 14): the targets of routing rules and the
 * pool of record assignment rules. Everything that holds a real foreign key (conversations, segment shares, reassign batches) is cleaned
 * by the database when the team row goes. Idempotent, so the outbox may deliver it twice. Worker only.
 */
@Injectable()
export class TeamDeletedConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'team-deleted-references';
  readonly eventTypes = ['team.deleted'] as const;
  private readonly logger = new Logger(TeamDeletedConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly db: DatabaseService,
    private readonly refs: TeamUsageRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const uuid = typeof event.payload.uuid === 'string' ? event.payload.uuid : null;
    if (!uuid) return;
    const changed = await this.db.txAs({ orgId: event.orgId }, (tx) =>
      this.refs.dropReferences(tx, event.orgId, uuid),
    );
    this.logger.log(
      { orgId: event.orgId, team: uuid, ...changed },
      'removed a deleted team from rules',
    );
  }
}
