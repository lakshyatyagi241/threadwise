import { describe, expect, it, vi } from 'vitest';
import { ScheduledReceiptsService } from '../../../src/modules/scheduled-queue-warmer/scheduled-receipts.service';

const report = (orgId: number) => ({
  orgId,
  deviceId: 1,
  providerMessageId: 'wamid.SAME',
  status: 'delivered' as const,
  occurredAt: new Date('2026-10-11T10:00:00Z'),
});

const outbox = { emit: vi.fn(async () => undefined) };

/** A db whose transactions record the SQL they run; `privileged` must never be used by a receipt. */
function fakeDb(rows: unknown[]) {
  const seen: Array<{ orgId: number; sql: string }> = [];
  const db = {
    privileged: vi.fn(() => {
      throw new Error('a delivery receipt must not lift row-level security');
    }),
    txAs: vi.fn(async (ctx: { orgId: number }, fn: (tx: unknown) => unknown) =>
      fn({
        execute: async (q: unknown) => {
          seen.push({ orgId: ctx.orgId, sql: JSON.stringify(q) });
          return { rows };
        },
      }),
    ),
  };
  return { db, seen };
}

// TI-014 (tenancy audit): the receipt lookup ran as privileged() and matched on the provider message id alone, so it relied on that
// id being unique across every workspace. It now runs in the reporting device's workspace and filters by org_id.
describe('scheduled-message delivery receipts are claimed per workspace', () => {
  it('looks the message up inside the reporting workspace, filtered by org_id, without lifting RLS', async () => {
    const { db, seen } = fakeDb([]);
    const handled = await new ScheduledReceiptsService(db as never, outbox as never).handle(report(7));
    expect(handled).toBe(false);
    expect(db.privileged).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.orgId).toBe(7);
    expect(seen[0]!.sql).toContain('org_id');
  });

  it('still applies a report for its own recipient, and every statement runs in that workspace', async () => {
    const { db, seen } = fakeDb([{ org_id: 7, id: 11, scheduled_message_id: 5, status: 'sent' }]);
    const handled = await new ScheduledReceiptsService(db as never, outbox as never).handle(report(7));
    expect(handled).toBe(true);
    expect(db.privileged).not.toHaveBeenCalled();
    expect(seen.length).toBeGreaterThanOrEqual(2); // the lookup, then the status update
    expect(new Set(seen.map((s) => s.orgId))).toEqual(new Set([7]));
  });
});
