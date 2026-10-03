import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { WabaChannelLinkService } from './waba-channel-link.service';

export const WABA_CONNECTION_EVENTS = [
  'whatsapp.connection.connected',
  'whatsapp.connection.disconnected',
  'whatsapp.connection.removed',
] as const;

/**
 * Keeps the inbox's channel of a WhatsApp number in step with the number's connection (see `WabaChannelLinkService`): a number that was
 * connected (or reconnected, with a new token) has its channel made or brought back, one that was disconnected or removed has its channel
 * shown disconnected. Delivery is at-least-once; every step is idempotent. Runs in the worker process.
 *
 * Events of `aggregateModule` `wa_provider_configs` carry the connection's id as `aggregateId`.
 */
@Injectable()
export class WabaChannelSyncConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'chat-waba-channel-sync';
  readonly eventTypes = WABA_CONNECTION_EVENTS;
  private readonly logger = new Logger(WabaChannelSyncConsumer.name);

  constructor(
    private readonly links: WabaChannelLinkService,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    if (event.eventType === 'whatsapp.connection.removed') {
      const moved = await this.links.connectionRemoved(event.orgId);
      this.logger.debug(
        { orgId: event.orgId, moved },
        'channels of a removed number shown disconnected',
      );
      return;
    }
    const configId = Number(event.aggregateId);
    if (!Number.isInteger(configId)) return;
    const connected = event.eventType === 'whatsapp.connection.connected';
    await this.links.ensure(event.orgId, configId, { create: connected, revive: connected });
  }
}
