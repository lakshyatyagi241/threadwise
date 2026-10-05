import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { listContactStoreOrdersQuerySchema } from '@crm/contracts';
import { ACTOR_KINDS_KEY, REQUIRED_PERMISSION_KEY } from '../../../src/common/decorators';
import { ContactStoreOrdersController } from '../../../src/modules/store-orders-sales/contact-store-orders.controller';

describe('GET /v2/contacts/:contactId/store-orders', () => {
  it('is a staff-only read gated by the same permission as every other contact read', () => {
    const handler = ContactStoreOrdersController.prototype.list;
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, handler)).toEqual(['record.contacts.read']);
    expect(Reflect.getMetadata(ACTOR_KINDS_KEY, ContactStoreOrdersController)).toEqual(['user']);
    expect(Reflect.getMetadata('path', ContactStoreOrdersController)).toBe(
      'contacts/:contactId/store-orders',
    );
  });

  it('hands the contact and the validated limit to the service and returns its page untouched', async () => {
    const page = { data: [], hasMore: false };
    const sales = { listForContact: vi.fn(async () => page) };
    const controller = new ContactStoreOrdersController(sales as never);
    const query = listContactStoreOrdersQuerySchema.parse({ limit: '7' });
    await expect(controller.list('11111111-1111-4111-8111-111111111111', query)).resolves.toBe(
      page,
    );
    expect(sales.listForContact).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 7);
  });

  it('the query defaults to 20 and refuses 0 and more than 50', () => {
    expect(listContactStoreOrdersQuerySchema.parse({}).limit).toBe(20);
    expect(listContactStoreOrdersQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listContactStoreOrdersQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });
});
