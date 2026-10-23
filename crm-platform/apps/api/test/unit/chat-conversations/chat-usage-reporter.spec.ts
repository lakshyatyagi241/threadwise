import { describe, expect, it, vi } from 'vitest';
import { ChatUsageReporter } from '../../../src/modules/chat-conversations/chat-usage-reporter';

/**
 * The part of the chat usage reporter a flow's reply relies on: the pre-send check of one message on a billed channel, and the
 * wallet being asked for the real size of a batch.
 */
function make() {
  const assertCanAfford = vi.fn().mockResolvedValue(undefined);
  const txAs = vi.fn(async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}));
  const emit = vi.fn().mockResolvedValue(undefined);
  const reporter = new ChatUsageReporter(
    { txAs } as never,
    { emit } as never,
    { assertCanAfford } as never,
  );
  return { reporter, assertCanAfford, emit };
}

describe('assertSendable: the check before one message on a channel', () => {
  it('asks the wallet for the email fee on an email channel', async () => {
    const { reporter, assertCanAfford } = make();
    await reporter.assertSendable(7, 'email');
    expect(assertCanAfford).toHaveBeenCalledWith(7, 'email', 1);
  });

  it('asks the wallet for the chat fee on Telegram, Messenger, LINE, Viber, Instagram and WeChat', async () => {
    const { reporter, assertCanAfford } = make();
    for (const kind of ['telegram', 'facebook', 'line', 'viber', 'instagram', 'wechat']) {
      await reporter.assertSendable(7, kind);
    }
    expect(assertCanAfford).toHaveBeenCalledTimes(6);
    expect(assertCanAfford.mock.calls.every((c) => c[1] === 'chat_message' && c[2] === 1)).toBe(
      true,
    );
  });

  it('passes the channels that are not billed here without asking the wallet', async () => {
    const { reporter, assertCanAfford } = make();
    for (const kind of ['simulator', 'whatsapp_qr', 'whatsapp_cloud', 'webchat']) {
      await reporter.assertSendable(7, kind);
    }
    expect(assertCanAfford).not.toHaveBeenCalled();
  });

  it('lets the wallet refusal through so the flow can stop its run', async () => {
    const { reporter, assertCanAfford } = make();
    assertCanAfford.mockRejectedValue(new Error('WALLET_EMPTY'));
    await expect(reporter.assertSendable(7, 'telegram')).rejects.toThrow('WALLET_EMPTY');
  });
});

describe('refusal: the check before a batch of a broadcast', () => {
  it('asks for the whole batch, not for one message', async () => {
    const { reporter, assertCanAfford } = make();
    expect(await reporter.refusal(7, 300)).toBeNull();
    expect(assertCanAfford).toHaveBeenCalledWith(7, 'chat_message', 300);
  });
});

describe('reportMessage: the fee of a message a flow sent', () => {
  it('reports one billed unit on the flow, in its own transaction, and nothing for an unbilled channel', async () => {
    const { reporter, emit } = make();
    await reporter.reportMessage(
      7,
      { module: 'flow_runs', id: 3, uuid: 'run-uuid', name: null },
      {
        channelKind: 'telegram',
        peerKey: '555',
        providerMessageId: '555:9',
        scope: '12',
        source: 'flow',
      },
    );
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![1]).toMatchObject({
      orgId: 7,
      aggregateModule: 'flow_runs',
      aggregateId: 3,
      eventType: 'usage.reported',
      payload: { kind: 'chat_message', usageId: 'tg12:555:9', status: 'used', source: 'flow' },
    });
    await reporter.reportMessage(
      7,
      { module: 'flow_runs', id: 3, uuid: 'run-uuid', name: null },
      { channelKind: 'simulator', peerKey: '1', providerMessageId: 'x', source: 'flow' },
    );
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
