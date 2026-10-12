import { describe, expect, it, vi } from 'vitest';
import { WabaGroupsService } from '../../../src/modules/whatsapp-cloud-api-waba/waba-groups.service';

/**
 * A group message is billed once per member that receives it: each billable member reaching delivered/read is reported to the
 * workspace's wallet as its own message; free members and early statuses report nothing.
 */
function build(previous: Record<string, unknown> | null = null) {
  const emitted: Array<{ orgId: number; payload: Record<string, unknown> }> = [];
  const outbox = {
    emit: vi.fn(async (_tx: unknown, e: { orgId: number; payload: Record<string, unknown> }) => {
      emitted.push(e);
    }),
  };
  // The first statement is the lookup of the stored message; the rest are writes.
  let first = true;
  const tx = {
    execute: vi.fn(async () => {
      if (!first) return { rows: [] };
      first = false;
      return {
        rows: [
          {
            id: 5,
            created_at: '2026-10-12T10:00:00Z',
            status: 'sent',
            meta: previous ? { group_delivery: previous } : {},
          },
        ],
      };
    }),
  };
  const db = { txAs: vi.fn(async (_c: unknown, fn: (t: unknown) => unknown) => fn(tx)) };
  return { svc: new WabaGroupsService(db as never, outbox as never), emitted };
}

const status = (s: string, member: string, extra: Record<string, unknown> = {}) => ({
  id: 'wamid.G1',
  status: s,
  recipient_participant_id: member,
  recipient_type: 'group',
  ...extra,
});

describe('group delivery billing', () => {
  it('reports a billable member that was delivered, keyed by message and member', async () => {
    const { svc, emitted } = build();
    expect(await svc.recordDelivery(7, status('delivered', '919900000001'))).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.orgId).toBe(7);
    expect(emitted[0]!.payload).toMatchObject({
      provider: 'waba',
      providerMessageId: 'wamid.G1:919900000001',
      status: 'delivered',
      recipient: '919900000001',
      source: 'inbox',
    });
  });

  it('reports a read member too, and passes no recipient when the member id is not a number', async () => {
    const { svc, emitted } = build();
    await svc.recordDelivery(7, status('read', 'BSUID.abc123'));
    expect(emitted[0]!.payload).toMatchObject({ status: 'read', recipient: null });
  });

  it('reports nothing for a member Meta marks free, or for a status that is not delivered or read', async () => {
    const { svc, emitted } = build();
    await svc.recordDelivery(
      7,
      status('delivered', '919900000002', { pricing: { type: 'free_group_customer_service' } }),
    );
    await svc.recordDelivery(7, status('sent', '919900000003'));
    expect(emitted).toHaveLength(0);
  });
});
