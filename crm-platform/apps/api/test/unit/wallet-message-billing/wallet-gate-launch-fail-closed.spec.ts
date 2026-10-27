import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { WalletGateService } from '../../../src/modules/wallet-message-billing/wallet-gate.service';
import { BillingWalletGate } from '../../../src/modules/broadcasts/_shims/wallet-gate';

/**
 * A bulk launch (campaign, broadcast, scheduled batch) must not start when the balance cannot be read: the run would create and send
 * every row before any check sees the wallet again. A single send and a group message keep failing open, so a billing read never
 * stops one message.
 */
function build() {
  const gate = new WalletGateService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  Object.assign(gate, {
    evaluate: vi.fn(async () => {
      throw new Error('connection reset');
    }),
  });
  return gate;
}

describe('WalletGateService.assertCanLaunch when the balance lookup fails', () => {
  it('refuses a bulk launch with a retryable 503 so no row is created', async () => {
    const gate = build();
    const err = await gate
      .assertCanLaunch({ orgId: 7, source: 'campaign', recipients: 50_000, failClosed: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect((err as AppError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('still lets a group message through (fail open)', async () => {
    const gate = build();
    await expect(
      gate.assertCanLaunch({ orgId: 7, source: 'group_message', recipients: 3 }),
    ).resolves.toBeUndefined();
  });
});

describe('BillingWalletGate.precheck', () => {
  it('asks the launch gate to fail closed for a broadcast or campaign', async () => {
    const assertCanLaunch = vi.fn(async () => undefined);
    const gate = new BillingWalletGate({ assertCanLaunch } as never);
    await gate.precheck(7, 100, { source: 'campaign' });
    expect(assertCanLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 7,
        source: 'campaign',
        recipients: 100,
        failClosed: true,
      }),
    );
  });
});
