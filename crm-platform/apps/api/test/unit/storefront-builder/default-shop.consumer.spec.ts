import { describe, expect, it, vi } from 'vitest';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import {
  DEFAULT_SHOP_EVENTS,
  DefaultShopConsumer,
} from '../../../src/modules/storefront-builder/default-shop.consumer';
import type { ShopsService } from '../../../src/modules/storefront-builder/shops/shops.service';

const event = (eventType: string, orgId = 7) => ({
  id: '1',
  orgId,
  aggregateModule: 'whatsapp',
  aggregateId: '9',
  eventType,
  payload: {},
});

describe('default shop on connect (TW-STORE-029)', () => {
  it('registers itself for the connection event only', () => {
    const registry = new OutboxSubscriberRegistry();
    const consumer = new DefaultShopConsumer({} as ShopsService, registry);
    consumer.onModuleInit();
    consumer.onModuleInit();
    expect(DEFAULT_SHOP_EVENTS).toEqual(['whatsapp.connection.connected']);
    expect(consumer.eventTypes).toEqual(DEFAULT_SHOP_EVENTS);
  });

  it('asks the shop service for the default shop of the event tenant', async () => {
    const ensureDefaultShop = vi.fn().mockResolvedValue('uuid-1');
    const registry = new OutboxSubscriberRegistry();
    const consumer = new DefaultShopConsumer(
      { ensureDefaultShop } as unknown as ShopsService,
      registry,
    );
    consumer.onModuleInit();
    await registry.dispatch(event('whatsapp.connection.connected', 42));
    expect(ensureDefaultShop).toHaveBeenCalledWith(42);
  });

  it('ignores other events and survives a workspace that already has a shop', async () => {
    const ensureDefaultShop = vi.fn().mockResolvedValue(null);
    const registry = new OutboxSubscriberRegistry();
    const consumer = new DefaultShopConsumer(
      { ensureDefaultShop } as unknown as ShopsService,
      registry,
    );
    consumer.onModuleInit();
    await registry.dispatch(event('whatsapp.connection.removed'));
    expect(ensureDefaultShop).not.toHaveBeenCalled();
    await registry.dispatch(event('whatsapp.connection.connected'));
    await registry.dispatch(event('whatsapp.connection.connected'));
    expect(ensureDefaultShop).toHaveBeenCalledTimes(2);
  });
});
