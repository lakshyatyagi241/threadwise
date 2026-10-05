import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { ShopsService } from './shops/shops.service';

/**
 * The channel events that mean "this workspace now has a WhatsApp number". WaDesk created the default shop in the connect
 * code of each channel (Baileys device paired, official number saved); here the channel domains announce the connection on the
 * outbox and this consumer reacts (WD-STORE-029). The device domain adds its own event type here when it lands.
 */
export const DEFAULT_SHOP_EVENTS = ['whatsapp.connection.connected'] as const;

/**
 * Creates the workspace's default shop the first time a number connects. Idempotent: `ensureDefaultShop` does nothing when the
 * workspace already owns a shop, so the drain's at-least-once delivery and a reconnect are harmless. Runs in the worker under
 * the event's own tenant.
 */
@Injectable()
export class DefaultShopConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'store-default-shop';
  readonly eventTypes = DEFAULT_SHOP_EVENTS;
  private readonly logger = new Logger(DefaultShopConsumer.name);

  constructor(
    private readonly shops: ShopsService,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const created = await this.shops.ensureDefaultShop(event.orgId);
    if (created) this.logger.debug({ orgId: event.orgId }, 'default shop created on connect');
  }
}
