import { describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENT, realtimeEventSchemas } from '@crm/contracts';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import {
  PERM_GROUPS_READ,
  WabaGroupRealtimeConsumer,
} from '../../../src/modules/whatsapp-cloud-api-waba/waba-group-realtime.consumer';

const G = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';

function setup(
  opts: { feature?: boolean; viewers?: Array<{ userId: number; scope: string | null }> } = {},
) {
  const emitted: Array<{ orgId: number; userIds: number[]; type: string; payload: unknown }> = [];
  const asked: string[] = [];
  const consumer = new WabaGroupRealtimeConsumer(
    new OutboxSubscriberRegistry(),
    {
      viewers: async (_o: number, permission: string) => {
        asked.push(permission);
        return (opts.viewers ?? [{ userId: 1, scope: 'all' }]).map((v) => ({ ...v, teamIds: [] }));
      },
    } as never,
    { featureEnabled: async () => opts.feature ?? true } as never,
    {
      emitToUsers: async (orgId: number, ids: Iterable<number>, type: string, payload: unknown) => {
        emitted.push({ orgId, userIds: [...ids], type, payload });
        return { rooms: [] };
      },
    } as never,
  );
  return { consumer, emitted, asked };
}

const event = (eventType: string, payload: Record<string, unknown> = {}) => ({
  id: '5',
  orgId: 7,
  aggregateModule: 'waba_groups',
  aggregateId: '9',
  eventType,
  payload: { groupUuid: G, connectionId: C, groupId: '1203@g.us', subject: 'Secret', ...payload },
});

describe('the Groups realtime consumer (BL-099)', () => {
  it('listens to all five whatsapp.group events', () => {
    expect(setup().consumer.eventTypes.sort()).toEqual(
      [
        'whatsapp.group.created',
        'whatsapp.group.deleted',
        'whatsapp.group.join_request',
        'whatsapp.group.suspended',
        'whatsapp.group.updated',
      ].sort(),
    );
  });

  it('sends a hint of ids and kind to the people who may read groups, and nothing else', async () => {
    const { consumer, emitted, asked } = setup({
      viewers: [
        { userId: 1, scope: 'all' },
        { userId: 2, scope: null },
        { userId: 3, scope: 'own' },
      ],
    });
    await consumer.handle(event('whatsapp.group.join_request', { handled: null, count: 4 }));
    expect(asked).toEqual([PERM_GROUPS_READ]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      orgId: 7,
      userIds: [1, 3],
      type: REALTIME_EVENT.wabaGroupChanged,
      payload: { groupId: G, connectionId: C, kind: 'join_request' },
    });
    const payload = emitted[0]!.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['connectionId', 'groupId', 'kind']);
    expect(JSON.stringify(payload)).not.toContain('Secret');
    expect(JSON.stringify(payload)).not.toContain('g.us');
    expect(realtimeEventSchemas[REALTIME_EVENT.wabaGroupChanged].safeParse(payload).success).toBe(
      true,
    );
  });

  it('maps every event to its kind', async () => {
    const kinds: string[] = [];
    for (const t of ['created', 'updated', 'deleted', 'join_request', 'suspended']) {
      const { consumer, emitted } = setup();
      await consumer.handle(event(`whatsapp.group.${t}`));
      kinds.push((emitted[0]!.payload as { kind: string }).kind);
    }
    expect(kinds).toEqual(['created', 'updated', 'deleted', 'join_request', 'suspended']);
  });

  it('says nothing for a workspace whose plan lacks waba_groups', async () => {
    const { consumer, emitted, asked } = setup({ feature: false });
    await consumer.handle(event('whatsapp.group.created'));
    expect(emitted).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('drops an event without ids, and a workspace with nobody who may read', async () => {
    const a = setup();
    await a.consumer.handle(event('whatsapp.group.created', { connectionId: 'nope' }));
    await a.consumer.handle(event('whatsapp.group.unknown'));
    expect(a.emitted).toEqual([]);
    const b = setup({ viewers: [{ userId: 1, scope: null }] });
    await b.consumer.handle(event('whatsapp.group.created'));
    expect(b.emitted).toEqual([]);
  });

  it('never throws when the push fails (the drain would retry for nothing)', async () => {
    const consumer = new WabaGroupRealtimeConsumer(
      new OutboxSubscriberRegistry(),
      { viewers: async () => [{ userId: 1, scope: 'all', teamIds: [] }] } as never,
      { featureEnabled: async () => true } as never,
      {
        emitToUsers: vi.fn().mockRejectedValue(new Error('redis down')),
      } as never,
    );
    await expect(consumer.handle(event('whatsapp.group.created'))).resolves.toBeUndefined();
  });
});
