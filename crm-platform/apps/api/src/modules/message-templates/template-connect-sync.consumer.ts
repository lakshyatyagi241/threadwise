import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { TemplateSyncService } from './template-sync.service';

/**
 * Pulls the account's templates from Meta as soon as a WhatsApp number is connected (or reconnected), so the library is filled
 * without anyone pressing "Sync". It runs in a worker on the committed event, so a Meta failure never undoes the connection.
 * The sync is an upsert by Meta template id, so a redelivered event is harmless. A number with no Meta route (nothing to read)
 * is skipped; any other failure is thrown so the drain retries with backoff.
 */
@Injectable()
export class TemplateConnectSyncConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'template-connect-sync';
  readonly eventTypes = ['whatsapp.connection.connected'] as const;
  private readonly logger = new Logger(TemplateConnectSyncConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly sync: TemplateSyncService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const connectionId =
      typeof event.payload.connectionId === 'string' ? event.payload.connectionId : null;
    if (!connectionId) return;
    try {
      const result = await RequestContextStore.run(
        {
          requestId: `tpl-connect-sync-${event.id}`,
          orgId: event.orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
        },
        () => this.sync.sync({ connectionId }),
      );
      this.logger.log({ connectionId, ...result }, '[TPL] synced templates after connect');
    } catch (err) {
      if (
        err instanceof AppError &&
        (err.code === ERROR_CODES.TPL_NO_CONNECTION || err.code === ERROR_CODES.NOT_FOUND)
      ) {
        this.logger.debug({ connectionId }, 'no Meta connection to sync templates from');
        return;
      }
      throw err;
    }
  }
}
