import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { ExternalOrderBillingService } from '../../../src/modules/crm/invoicing/external-order-billing.service';

/**
 * A store order reopened after its sales order was cancelled (issue #1530): the invoice path must record a skip reason,
 * not throw SO_CANCELLED, which the outbox would retry until it dead-letters.
 */
function build() {
  const salesOrders = {
    invoiceRowIn: vi.fn(async () => {
      throw new AppError(ERROR_CODES.SO_CANCELLED, 'The order is cancelled', 409);
    }),
  };
  const salesRepo = {
    findById: vi.fn(async () => ({ id: 70, uuid: 'so-uuid' })),
    findByUuid: vi.fn(async () => ({ id: 70, uuid: 'so-uuid' })),
  };
  const invoices = { zone: vi.fn(async () => 'default') };
  const invoicesRepo = { liveIdByWaOrder: vi.fn(async () => undefined) };
  const planUsage = { assertCanAdd: vi.fn(async () => undefined) };
  const svc = new ExternalOrderBillingService(
    salesOrders as never,
    salesRepo as never,
    invoices as never,
    invoicesRepo as never,
    {} as never,
    planUsage as never,
  );
  return { svc };
}

const input = {
  waOrderId: 'WA-1',
  orderTotalMinor: 10000n,
  docType: 'invoice',
  buyer: { address: null },
  meta: {},
} as never;

describe('ExternalOrderBillingService.invoiceSalesOrderIn on a cancelled sales order', () => {
  it('returns a skip with the reason instead of throwing SO_CANCELLED', async () => {
    const { svc } = build();
    const out = await svc.invoiceSalesOrderIn({} as never, 1, 70, input);
    expect(out).toEqual({ outcome: 'skipped', reason: 'sales_order_cancelled' });
  });

  it('still throws any other billing error', async () => {
    const { svc } = build();
    const other = new AppError(ERROR_CODES.SO_NOT_CONFIRMED, 'Confirm the order first', 409);
    (
      svc as unknown as { salesOrders: { invoiceRowIn: () => Promise<never> } }
    ).salesOrders.invoiceRowIn = async () => {
      throw other;
    };
    await expect(svc.invoiceSalesOrderIn({} as never, 1, 70, input)).rejects.toBe(other);
  });
});
