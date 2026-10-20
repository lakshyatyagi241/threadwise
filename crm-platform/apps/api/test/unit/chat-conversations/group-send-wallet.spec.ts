import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/common/errors/app-error';
import { OutboundService } from '../../../src/modules/chat-conversations/outbound.service';

/**
 * A send to a Cloud API group is checked against the workspace's own wallet for one message per member (D8) and refused for a
 * suspended group (D10), before anything is stored or queued.
 */
const GROUP = 'g:Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2';
const cloud = { kind: 'whatsapp_cloud' } as never;

function build(
  row: Record<string, unknown> | undefined,
  gate = vi.fn(async () => undefined),
  assertFeature = vi.fn(async () => undefined),
) {
  const svc = new OutboundService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { assertFeature } as never,
    { assertCanLaunch: gate } as never,
    {} as never,
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
  return { run, gate, tx, assertFeature };
}

describe('OutboundService.assertGroupSendable', () => {
  it("asks the workspace's wallet to cover one message per member", async () => {
    const { run, gate } = build({ suspended: false, participant_count: 40 });
    expect(await run(GROUP)).toBe(40);
    expect(gate).toHaveBeenCalledWith({ orgId: 7, source: 'group_message', recipients: 40 });
  });

  it('asks the plan for waba_groups first, and a plan without it refuses before the wallet or the group row is read', async () => {
    const locked = new AppError('PLAN_FEATURE_LOCKED', 'locked', 422);
    const { run, gate, tx, assertFeature } = build(
      { suspended: false, participant_count: 5 },
      undefined,
      vi.fn(async () => {
        throw locked;
      }),
    );
    await expect(run(GROUP)).rejects.toBe(locked);
    expect(assertFeature).toHaveBeenCalledWith(7, 'waba_groups');
    expect(tx.execute).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
  });

  it('counts at least one recipient while Meta has not told us the member count', async () => {
    const { run, gate } = build(undefined);
    // The message remembers 0 members (unknown), the wallet is asked for one recipient.
    expect(await run(GROUP)).toBe(0);
    expect(gate).toHaveBeenCalledWith({ orgId: 7, source: 'group_message', recipients: 1 });
  });

  it('lets the wallet refusal through (WALLET_EMPTY) so nothing is queued', async () => {
    const refusal = new AppError('WALLET_EMPTY', 'empty', 422);
    const { run } = build(
      { suspended: false, participant_count: 5 },
      vi.fn(async () => {
        throw refusal;
      }),
    );
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
    expect(await a.run('919876543210')).toBeNull();
    expect(a.assertFeature).not.toHaveBeenCalled();
    expect(a.tx.execute).not.toHaveBeenCalled();
    expect(a.gate).not.toHaveBeenCalled();
  });
});
