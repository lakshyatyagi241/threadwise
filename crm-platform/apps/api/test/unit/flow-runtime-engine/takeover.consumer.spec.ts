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
  const takenOverAt = new Date('2026-10-28T10:05:00.000Z');
  const event = (payload: Record<string, unknown>) =>
    ({
      id: 'e1',
      orgId: 7,
      eventType: 'conversation.assigned',
      createdAt: takenOverAt,
      payload,
    }) as never;

  it('ends the run on the channel and peer of the conversation when a person takes it', async () => {
    const h = build({ channelId: 3, peerKey: '919876543210' });
    await h.consumer.handle(
      event({ conversationId: 'conv-uuid', toUserId: 'user-uuid', byUserId: 'user-uuid' }),
    );
    expect(h.conversations.peerOfConversation).toHaveBeenCalledWith(7, 'conv-uuid');
    expect(h.endForPeer).toHaveBeenCalledWith(7, 3, '919876543210', takenOverAt);
  });

  it('ends the run when a person hands the conversation to someone else', async () => {
    const h = build({ channelId: 3, peerKey: '919876543210' });
    await h.consumer.handle(
      event({ conversationId: 'conv-uuid', toUserId: 'agent-uuid', byUserId: 'admin-uuid' }),
    );
    expect(h.endForPeer).toHaveBeenCalledWith(7, 3, '919876543210', takenOverAt);
  });

  it("does not end the run that made the assignment: a flow's Assign agent step (no acting person) lets the flow go on", async () => {
    const h = build({ channelId: 3, peerKey: '919876543210' });
    await h.consumer.handle(
      event({ conversationId: 'conv-uuid', toUserId: 'user-uuid', byUserId: null }),
    );
    expect(h.endForPeer).not.toHaveBeenCalled();
    // An event with no actor at all (an older one, or a system assignment) is not a person taking over either.
    await h.consumer.handle(event({ conversationId: 'conv-uuid', toUserId: 'user-uuid' }));
    expect(h.endForPeer).not.toHaveBeenCalled();
  });

  it('does nothing on an unassignment (no person holds the thread)', async () => {
    const h = build({ channelId: 3, peerKey: '919876543210' });
    await h.consumer.handle(event({ conversationId: 'conv-uuid', toUserId: null }));
    expect(h.endForPeer).not.toHaveBeenCalled();
  });

  it('does nothing when the conversation is not found in this workspace', async () => {
    const h = build(null);
    await h.consumer.handle(
      event({ conversationId: 'conv-uuid', toUserId: 'user-uuid', byUserId: 'user-uuid' }),
    );
    expect(h.endForPeer).not.toHaveBeenCalled();
  });
});
