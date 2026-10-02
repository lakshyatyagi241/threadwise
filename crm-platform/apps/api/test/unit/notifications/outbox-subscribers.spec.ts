import { describe, expect, it, vi } from 'vitest';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../../src/kernel/outbox/outbox-subscribers';

const event = (eventType: string): OutboxEvent => ({
  id: '1',
  orgId: 7,
  aggregateModule: 'tasks',
  aggregateId: '3',
  eventType,
  payload: {},
});
const sub = (
  name: string,
  types: string[],
  handle: OutboxSubscriber['handle'],
): OutboxSubscriber => ({ name, eventTypes: types, handle });

describe('OutboxSubscriberRegistry', () => {
  it('hands an event only to the subscribers that asked for its type', async () => {
    const reg = new OutboxSubscriberRegistry();
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    reg.register(sub('a', ['task.assigned'], a));
    reg.register(sub('b', ['task.due'], b));
    await reg.dispatch(event('task.assigned'));
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    await reg.dispatch(event('contact.created'));
    expect(a).toHaveBeenCalledOnce();
  });

  it('one failing subscriber does not stop the others, and the event is reported failed so it is retried', async () => {
    const reg = new OutboxSubscriberRegistry();
    const ok = vi.fn().mockResolvedValue(undefined);
    reg.register(sub('bad', ['task.due'], () => Promise.reject(new Error('boom'))));
    reg.register(sub('good', ['task.due'], ok));
    await expect(reg.dispatch(event('task.due'))).rejects.toThrow(/bad: boom/);
    expect(ok).toHaveBeenCalledOnce();
  });

  it('registering the same name twice keeps the first (a module imported twice must not double-handle)', async () => {
    const reg = new OutboxSubscriberRegistry();
    const h = vi.fn().mockResolvedValue(undefined);
    reg.register(sub('x', ['task.due'], h));
    reg.register(sub('x', ['task.due'], h));
    await reg.dispatch(event('task.due'));
    expect(h).toHaveBeenCalledOnce();
  });
});
