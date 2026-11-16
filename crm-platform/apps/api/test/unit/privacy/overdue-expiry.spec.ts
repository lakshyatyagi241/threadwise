import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { PrivacyMaintenanceService } from '../../../src/modules/privacy/requests/privacy-maintenance.service';

/**
 * A data-rights request that the overdue sweep expires leaves the same trail as any other closure: an event row, an audit row and an
 * outbox event, in the transaction that expires it.
 */
describe('PrivacyMaintenanceService overdue expiry', () => {
  it('writes the event, the audit row and the outbox event for each expired request', async () => {
    const tx = {};
    const db = { privileged: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
    const repo = {
      expireExports: vi.fn(async () => 0),
      failStuckExports: vi.fn(async () => 0),
      expireOverdue: vi.fn(async () => [{ orgId: 7, id: 42, fromStatus: 'received' }]),
      addEvent: vi.fn(async () => undefined),
    };
    // Like the real AuditService, this refuses to run without a request context (the cron has none of its own).
    const audit = {
      record: vi.fn(async () => {
        RequestContextStore.require();
      }),
    };
    const outbox = { emit: vi.fn(async () => undefined) };
    const svc = new PrivacyMaintenanceService(
      db as never,
      repo as never,
      audit as never,
      outbox as never,
    );

    const result = await svc.sweep();

    expect(result.expiredRequests).toBe(1);
    expect(repo.addEvent).toHaveBeenCalledWith(
      tx,
      7,
      42,
      expect.objectContaining({ type: 'expired', from: 'received', to: 'expired' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ recordId: 42, action: 'update' }),
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(outbox.emit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orgId: 7,
        aggregateId: 42,
        eventType: 'privacy_request.expired',
      }),
    );
  });
});
