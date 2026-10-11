import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { TemplateConnectSyncConsumer } from '../../../src/modules/message-templates/template-connect-sync.consumer';

const event = (payload: Record<string, unknown>) => ({
  id: '7',
  orgId: 3,
  aggregateModule: 'whatsapp_connections',
  aggregateId: '1',
  eventType: 'whatsapp.connection.connected',
  payload,
});

function make(sync: ReturnType<typeof vi.fn>) {
  const registry = { register: vi.fn() };
  const consumer = new TemplateConnectSyncConsumer(registry as never, { sync } as never);
  return { consumer, registry };
}

describe('TemplateConnectSyncConsumer', () => {
  it('registers itself for the connected event', () => {
    const { consumer, registry } = make(vi.fn());
    consumer.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(consumer);
    expect(consumer.eventTypes).toContain('whatsapp.connection.connected');
  });

  it('syncs the connected number under a system context for the event org', async () => {
    let seen: { orgId: number; actorType: string } | undefined;
    const sync = vi.fn(async () => {
      seen = RequestContextStore.require();
      return { created: 2, updated: 0 };
    });
    await make(sync).consumer.handle(event({ connectionId: 'abc' }));
    expect(sync).toHaveBeenCalledWith({ connectionId: 'abc' });
    expect(seen).toMatchObject({ orgId: 3, actorType: 'system' });
  });

  it('ignores an event without a connection id', async () => {
    const sync = vi.fn();
    await make(sync).consumer.handle(event({}));
    expect(sync).not.toHaveBeenCalled();
  });

  it('skips a number with no Meta connection but rethrows other failures for retry', async () => {
    const none = vi.fn().mockRejectedValue(new AppError(ERROR_CODES.TPL_NO_CONNECTION, 'x', 409));
    await expect(make(none).consumer.handle(event({ connectionId: 'a' }))).resolves.toBeUndefined();
    const boom = vi.fn().mockRejectedValue(new Error('meta down'));
    await expect(make(boom).consumer.handle(event({ connectionId: 'a' }))).rejects.toThrow(
      'meta down',
    );
  });
});
