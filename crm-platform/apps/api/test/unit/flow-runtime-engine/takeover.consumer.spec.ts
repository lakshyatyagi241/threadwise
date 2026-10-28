import { describe, expect, it, vi } from 'vitest';
import { FlowTakeoverConsumer } from '../../../src/modules/flow-runtime-engine/triggers/takeover.consumer';

/**
 * Issue #1174: when a person takes a conversation over, the customer's live flow run on that channel must end. Nothing called
 * `endForPeer`, so the flow kept talking over the agent.
 */
describe('a person taking a conversation ends the live flow run (#1174)', () => {
  const build = (peer: { channelId: number; peerKey: string } | null) => {
    const endForPeer = vi.fn(async () => true);
    const conversations = { peerOfConversation: vi.fn(async () => peer) };
    const registry = { register: vi.fn() };
    const consumer = new FlowTakeoverConsumer(
      registry as never,
      { endForPeer } as never,
      conversations as never,
    );
    return { consumer, endForPeer, conversations };
  };
  const event = (payload: Record<string, unknown>) =>
    ({ id: 'e1', orgId: 7, eventType: 'conversation.assigned', payload }) as never;

  it('ends the run on the channel and peer of the conversation when a person takes it', async () => {
    const h = build({ channelId: 3, peerKey: '919876543210' });
    await h.consumer.handle(event({ conversationId: 'conv-uuid', toUserId: 'user-uuid' }));
    expect(h.conversations.peerOfConversation).toHaveBeenCalledWith(7, 'conv-uuid');
    expect(h.endForPeer).toHaveBeenCalledWith(7, 3, '919876543210', null);
  });

  it('ends only the runs that started before the takeover, so a redelivered event cannot stop a later flow (#1299)', async () => {
    const h = build({ channelId: 3, peerKey: '919876543210' });
    await h.consumer.handle(
      event({
        conversationId: 'conv-uuid',
        toUserId: 'user-uuid',
        assignedAt: '2026-10-27T10:00:00.000Z',
      }),
    );
    expect(h.endForPeer).toHaveBeenCalledWith(
      7,
      3,
      '919876543210',
      new Date('2026-10-27T10:00:00.000Z'),
    );
  });

  it('keeps the old behaviour for an event written before assignedAt existed', async () => {
    const h = build({ channelId: 3, peerKey: '919876543210' });
    await h.consumer.handle(
      event({ conversationId: 'conv-uuid', toUserId: 'user-uuid', assignedAt: 'not a date' }),
    );
    expect(h.endForPeer).toHaveBeenCalledWith(7, 3, '919876543210', null);
  });

  it('does nothing on an unassignment (no person holds the thread)', async () => {
    const h = build({ channelId: 3, peerKey: '919876543210' });
    await h.consumer.handle(event({ conversationId: 'conv-uuid', toUserId: null }));
    expect(h.endForPeer).not.toHaveBeenCalled();
  });

  it('does nothing when the conversation is not found in this workspace', async () => {
    const h = build(null);
    await h.consumer.handle(event({ conversationId: 'conv-uuid', toUserId: 'user-uuid' }));
    expect(h.endForPeer).not.toHaveBeenCalled();
  });
});
