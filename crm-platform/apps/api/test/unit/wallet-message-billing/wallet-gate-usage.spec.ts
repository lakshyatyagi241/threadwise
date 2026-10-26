import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { WalletGateService } from '../../../src/modules/wallet-message-billing/wallet-gate.service';
import { usageKindOf } from '../../../src/modules/campaigns/email-campaign-rules';

/**
 * The launch check of an SMS or email run is priced by usage billing: the balance must cover one message per recipient at the SMS or
 * email price, before any row exists. Nothing to send passes.
 */
function build(assertCanAfford = vi.fn(async () => undefined)) {
  const gate = new WalletGateService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { assertCanAfford } as never,
  );
  return { gate, assertCanAfford };
}

describe('WalletGateService.assertCanLaunchUsage', () => {
  it('asks usage billing for one unit per recipient at the given kind', async () => {
    const { gate, assertCanAfford } = build();
    await gate.assertCanLaunchUsage(7, 'sms', 250);
    expect(assertCanAfford).toHaveBeenCalledWith(7, 'sms', 250);
  });

  it('lets the usage refusal through (WALLET_EMPTY) so nothing is created', async () => {
    const refusal = new AppError(ERROR_CODES.WALLET_EMPTY, 'too low', 422);
    const { gate } = build(
      vi.fn(async () => {
        throw refusal;
      }),
    );
    await expect(gate.assertCanLaunchUsage(7, 'email', 3)).rejects.toBe(refusal);
  });

  it('asks nothing for zero recipients', async () => {
    const { gate, assertCanAfford } = build();
    await gate.assertCanLaunchUsage(7, 'email', 0);
    expect(assertCanAfford).not.toHaveBeenCalled();
  });
});

describe('usageKindOf', () => {
  it('prices an SMS run as sms and every other usage-billed run as email', () => {
    expect(usageKindOf('sms')).toBe('sms');
    expect(usageKindOf('email')).toBe('email');
  });
});
