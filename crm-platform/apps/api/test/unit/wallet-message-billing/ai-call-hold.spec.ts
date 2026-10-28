import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { AiChargeService } from '../../../src/modules/wallet-message-billing/ai-charge.service';
import { UsageBillingService } from '../../../src/modules/wallet-message-billing/usage-billing.service';

/**
 * Issue #1164: the AI generator checked the wallet before the vendor call and charged after it, so parallel calls all passed the same
 * balance. A call on the platform's key now holds its price before the vendor is called; the charge settles that hold.
 */
describe('an AI call on the platform key holds its price before the vendor (#1164)', () => {
  it('guards an admin-key call with a hold and leaves a workspace key alone', async () => {
    const holdAiCall = vi.fn(async () => undefined);
    const svc = new AiChargeService({ holdAiCall } as never);
    await svc.guardCall(7, 'admin');
    await svc.guardCall(7, 'workspace');
    expect(holdAiCall).toHaveBeenCalledTimes(1);
    expect(holdAiCall).toHaveBeenCalledWith(7);
  });

  const build = (need: { balance: number; priceMinor: number } | null, held: number | null) => {
    const holdMinor = vi.fn(async () => held);
    const repo = { holdMinor };
    const svc = Object.assign(Object.create(UsageBillingService.prototype), {
      db: { retry: { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) } },
      repo,
      billing: { forOrg: async () => 'USD' },
      balanceAndPrice: async () => need,
    });
    return { svc: svc as unknown as { holdAiCall: (orgId: number) => Promise<void> }, holdMinor };
  };

  it('holds the call price in the workspace currency, for a bounded time', async () => {
    const h = build({ balance: 500, priceMinor: 5 }, 42);
    await h.svc.holdAiCall(7);
    expect(h.holdMinor).toHaveBeenCalledWith(expect.anything(), 7, 'USD', 5, 600);
  });

  it('refuses the call when the hold cannot be taken, with WALLET_EMPTY and no vendor call', async () => {
    const h = build({ balance: 0, priceMinor: 5 }, null);
    const err = await h.svc.holdAiCall(7).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ERROR_CODES.WALLET_EMPTY);
  });

  it('refuses the call when the wallet cannot be read: a retryable 503, nothing held, no vendor call', async () => {
    const holdMinor = vi.fn(async () => 1);
    const svc = Object.assign(Object.create(UsageBillingService.prototype), {
      db: { retry: { txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}) } },
      repo: { holdMinor },
      billing: { forOrg: async () => 'USD' },
      logger: { error: vi.fn() },
      balanceAndPrice: async () => {
        throw new Error('connection reset');
      },
    }) as unknown as { holdAiCall: (orgId: number) => Promise<void> };
    const vendor = vi.fn(async () => 'answer');
    const ai = new AiChargeService({ holdAiCall: (id: number) => svc.holdAiCall(id) } as never);
    const err = await ai.guardCall(7, 'admin').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect((err as AppError).getStatus()).toBe(503);
    expect(holdMinor).not.toHaveBeenCalled();
    if (!err) await vendor();
    expect(vendor).not.toHaveBeenCalled();
  });

  it('holds nothing for a platform-owned workspace (no need to check)', async () => {
    const h = build(null, 1);
    await h.svc.holdAiCall(7);
    expect(h.holdMinor).not.toHaveBeenCalled();
  });
});
