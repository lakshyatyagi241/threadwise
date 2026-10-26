import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/common/errors/app-error';
import { OutboundService } from '../../../src/modules/chat-conversations/outbound.service';

/**
 * A WhatsApp message to one person is checked against the workspace's wallet before anything is stored or queued. Before this check an
 * inbox or template send with an empty wallet went out and was recorded free. Unbilled channels, reactions and groups are not asked here.
 */
const PEER = '919700000180';
const GROUP = 'g:Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2';

function build(gate = vi.fn(async () => undefined)) {
  const svc = new OutboundService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { assertCanSend: gate } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const run = (kind: string, peer: string, isReaction = false) =>
    (
      svc as unknown as {
        assertMessageAffordable: (...a: unknown[]) => Promise<void>;
      }
    ).assertMessageAffordable(7, kind, peer, isReaction);
  return { run, gate };
}

describe('OutboundService.assertMessageAffordable', () => {
  it('asks the wallet about a WhatsApp Cloud message to one person, as an inbox send', async () => {
    const { run, gate } = build();
    await run('whatsapp_cloud', PEER);
    expect(gate).toHaveBeenCalledWith({ orgId: 7, source: 'inbox', to: PEER });
  });

  it('lets the wallet refusal through (WALLET_EMPTY) so nothing is stored or queued', async () => {
    const refusal = new AppError('WALLET_EMPTY', 'empty', 422);
    const { run } = build(
      vi.fn(async () => {
        throw refusal;
      }),
    );
    await expect(run('whatsapp_cloud', PEER)).rejects.toBe(refusal);
  });

  it('does not ask for an unbilled channel: the simulator and a personal number', async () => {
    const { run, gate } = build();
    await run('simulator', PEER);
    await run('whatsapp_qr', PEER);
    expect(gate).not.toHaveBeenCalled();
  });

  it('does not ask for email or another chat channel: those have their own usage check', async () => {
    const { run, gate } = build();
    await run('email', PEER);
    await run('telegram', PEER);
    expect(gate).not.toHaveBeenCalled();
  });

  it('does not ask for a reaction, which is free', async () => {
    const { run, gate } = build();
    await run('whatsapp_cloud', PEER, true);
    expect(gate).not.toHaveBeenCalled();
  });

  it('leaves a Cloud API group to its own group check', async () => {
    const { run, gate } = build();
    await run('whatsapp_cloud', GROUP);
    expect(gate).not.toHaveBeenCalled();
  });
});
