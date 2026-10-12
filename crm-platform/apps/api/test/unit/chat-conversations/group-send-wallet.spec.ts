import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/common/errors/app-error';
import { OutboundService } from '../../../src/modules/chat-conversations/outbound.service';

/**
 * A send to a Cloud API group is checked against the workspace's own wallet for one message per member (D8) and refused for a
 * suspended group (D10), before anything is stored or queued.
 */
const GROUP = 'g:Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2';
const cloud = { kind: 'whatsapp_cloud' } as never;

function build(row: Record<string, unknown> | undefined, gate = vi.fn(async () => undefined)) {
  const svc = new OutboundService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { assertCanLaunch: gate } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const tx = { execute: vi.fn(async () => ({ rows: row ? [row] : [] })) };
  const run = (peer: string, runtime = cloud) =>
    (
      svc as unknown as {
        assertGroupSendable: (...a: unknown[]) => Promise<void>;
      }
    ).assertGroupSendable(tx, 7, runtime, peer);
  return { run, gate, tx };
}

describe('OutboundService.assertGroupSendable', () => {
  it("asks the workspace's wallet to cover one message per member", async () => {
    const { run, gate } = build({ suspended: false, participant_count: 40 });
    await run(GROUP);
    expect(gate).toHaveBeenCalledWith({ orgId: 7, source: 'group_message', recipients: 40 });
  });

  it('counts at least one recipient while Meta has not told us the member count', async () => {
    const { run, gate } = build(undefined);
    await run(GROUP);
    expect(gate).toHaveBeenCalledWith({ orgId: 7, source: 'group_message', recipients: 1 });
  });

  it('lets the wallet refusal through (WALLET_EMPTY) so nothing is queued', async () => {
    const refusal = new AppError('WALLET_EMPTY', 'empty', 422);
    const { run } = build({ suspended: false, participant_count: 5 }, vi.fn(async () => {
      throw refusal;
    }));
    await expect(run(GROUP)).rejects.toBe(refusal);
  });

  it('refuses a suspended group with 422 WABA_GROUP_SUSPENDED and never asks the wallet', async () => {
    const { run, gate } = build({ suspended: true, participant_count: 5 });
    const err = (await run(GROUP).catch((e: unknown) => e)) as AppError;
    expect(err.code).toBe('WABA_GROUP_SUSPENDED');
    expect(err.getStatus()).toBe(422);
    expect(gate).not.toHaveBeenCalled();
  });

  it('ignores a phone thread and any channel that is not the Cloud API', async () => {
    const a = build({ suspended: true, participant_count: 5 });
    await a.run('919876543210');
    await a.run(GROUP, { kind: 'whatsapp_qr' } as never);
    expect(a.tx.execute).not.toHaveBeenCalled();
    expect(a.gate).not.toHaveBeenCalled();
  });
});
