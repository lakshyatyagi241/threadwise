import { describe, expect, it, vi } from 'vitest';
import { FaqAnswerService } from '../../../src/modules/faq-knowledge/faq-answer.service';

const KINDS = ['whatsapp'];
vi.mock('../../../src/modules/chat-conversations', () => ({
  CONVERSATIONS_FACADE: 'CONVERSATIONS_FACADE',
}));
vi.mock('../../../src/modules/flow-runtime-engine', () => ({
  FlowLaunchService: class {},
  FlowTriggerService: class {},
  KINDS_OF_PROVIDER: { baileys: ['whatsapp'] },
}));

const event = {
  orgId: 7,
  channelId: 5,
  channelKind: KINDS[0],
  peerKey: 'p',
  conversationId: 3,
  conversationUuid: 'c-uuid',
  messageUuid: 'm-uuid',
  contactId: 1,
  peerName: null,
  message: { kind: 'text', body: 'where is the moon' },
};

function build(over: { outcome: string; fallbackMessage: string | null; send?: 'ok' | 'fail' }) {
  const enqueued: Array<{ content: { body: string } }> = [];
  const logs: Array<{ outcome: string; error: string | null }> = [];
  const db = { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) };
  const svc = new FaqAnswerService(
    db as never,
    {
      effective: async () => ({
        enabled: true,
        threshold: 0.45,
        minMargin: 0,
        logQueries: true,
        verifyMode: 'off',
        verifyBand: 0.1,
        fallbackMessage: over.fallbackMessage,
      }),
    } as never,
    {
      match: async () => ({
        outcome: over.outcome,
        score: 0.2,
        secondScore: null,
        tier: 'vector',
        winnerId: null,
        winnerText: null,
        query: 'where is the moon',
        candidates: [],
        embeddingModel: 'm',
        latencyMs: 1,
        note: null,
        verify: null,
      }),
    } as never,
    { answeringFlows: async () => [{ id: 9, triggerChannelId: 5, provider: 'baileys' }] } as never,
    {
      insert: async (_t: unknown, _o: number, w: { outcome: string; error: string | null }) =>
        logs.push(w),
    } as never,
    {} as never,
    { liveFlowId: async () => null } as never,
    { getFresh: async () => ({ engineEnabled: true }) } as never,
    {
      enqueueOutbound: async (m: { content: { body: string } }) => {
        if (over.send === 'fail') throw new Error('window closed');
        enqueued.push(m);
      },
    } as never,
  );
  return { svc, enqueued, logs };
}

describe('the fallback message', () => {
  it.each(['below_threshold', 'low_margin', 'no_faqs'])(
    'is sent exactly as saved when %s, and the message stays in the unanswered log',
    async (outcome) => {
      const text = "Sorry,  we didn't catch that!! ";
      const { svc, enqueued, logs } = build({ outcome, fallbackMessage: text });
      expect(await svc.handleInbound(event as never)).toBe(true);
      expect(enqueued.map((m) => m.content.body)).toEqual([text]);
      expect(logs[0]!.outcome).toBe(outcome);
    },
  );

  it('is not sent when the flow has none, or when the matcher failed for its own reasons', async () => {
    const none = build({ outcome: 'below_threshold', fallbackMessage: null });
    expect(await none.svc.handleInbound(event as never)).toBe(false);
    expect(none.enqueued).toEqual([]);
    const down = build({ outcome: 'provider_error', fallbackMessage: 'Sorry' });
    expect(await down.svc.handleInbound(event as never)).toBe(false);
    expect(down.enqueued).toEqual([]);
  });

  it('leaves the message to others and notes the failure when it cannot be queued', async () => {
    const { svc, logs } = build({
      outcome: 'below_threshold',
      fallbackMessage: 'Sorry',
      send: 'fail',
    });
    expect(await svc.handleInbound(event as never)).toBe(false);
    expect(logs[0]!.error).toContain('fallback message could not be sent');
  });
});
