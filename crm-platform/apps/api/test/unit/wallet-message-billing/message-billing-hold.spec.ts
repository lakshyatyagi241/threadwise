import { describe, expect, it, vi } from 'vitest';
import { MessageBillingService } from '../../../src/modules/wallet-message-billing/message-billing.service';

interface Setup {
  /** The price the delivered message is charged at (0 = free). */
  priceMinor?: number;
  balanceMinor?: number;
}

/** The settlement of one delivered message with its collaborators stubbed; the transaction answers the four statements in order. */
function build(s: Setup = {}) {
  const repo = {
    lockWallet: vi.fn(async () => ({
      id: 3,
      unit: 'USD',
      balanceMinor: s.balanceMinor ?? 500,
      lowBalanceAlertedAt: null,
    })),
    settleHold: vi.fn(async () => undefined),
    capReserved: vi.fn(async () => undefined),
  };
  const answers: Array<Array<Record<string, unknown>>> = [
    [{ id: 5 }], // the message claim
    [{ messages: 1 }], // the month's counter
    [{ id: 9, created_at: '2026-10-27 10:00:00+00' }], // the charge row
    [], // the claim is closed
  ];
  const tx = {
    execute: vi.fn(async () => ({ rows: answers.shift() ?? [] })),
  };
  const ledger = {
    post: vi.fn(async () => ({
      appliedMinor: s.priceMinor ?? 100,
      transactionRowId: 4,
      balanceAfterMinor: 400,
    })),
  };
  const rates = {
    price: async () => ({
      priceMinor: s.priceMinor ?? 100,
      country: 'IN',
      metaCostMicros: 0,
      matched: true,
      basis: 'rate card',
      margin: 0,
    }),
    costMinor: () => 0,
  };
  const db = { retry: { txAs: async (_ctx: unknown, fn: (t: unknown) => unknown) => fn(tx) } };
  const plans = {
    forOrg: async () => ({
      platformOwned: false,
      overrides: {},
      planKnown: false,
      planEndsAt: null,
      trialEndsAt: null,
      planLimits: {},
      packLimits: {},
    }),
  };
  const settings = { effective: async () => ({ lowBalanceThresholdMinor: 0 }) };
  const billing = { forOrg: async () => 'USD', fromPlatform: async () => 0 };
  const mode = { isPayPerMessage: async () => true };
  const log = { event: async () => undefined, line: () => undefined };
  const service = new MessageBillingService(
    db as never,
    repo as never,
    ledger as never,
    rates as never,
    billing as never,
    settings as never,
    plans as never,
    mode as never,
    log as never,
    {} as never,
  );
  return { service, repo, ledger };
}

const DELIVERED = {
  orgId: 7,
  provider: 'whatsapp_cloud',
  providerMessageId: 'wamid.HBgN1',
  recipient: '+919876543210',
  category: 'marketing',
  source: 'campaign',
} as const;

describe('MessageBillingService.settleDelivered: a charged delivery settles its hold', () => {
  it('consumes the oldest hold before the ledger post lowers the balance, and caps reserved after it, in the same transaction', async () => {
    const { service, repo, ledger } = build({ priceMinor: 100, balanceMinor: 500 });
    const out = await service.settleDelivered({ ...DELIVERED } as never);
    expect(out).toMatchObject({ status: 'charged' });
    expect(ledger.post).toHaveBeenCalledTimes(1);
    expect(repo.settleHold).toHaveBeenCalledWith(expect.anything(), 7, 'USD');
    expect(repo.capReserved).toHaveBeenCalledWith(expect.anything(), 7, 'USD');
    // The hold leaves `reserved` first: the balance check is per statement, so the post must not lower the balance under `reserved`.
    const postAt = ledger.post.mock.invocationCallOrder[0]!;
    const settleAt = repo.settleHold.mock.invocationCallOrder[0]!;
    expect(settleAt).toBeLessThan(postAt);
    expect(repo.capReserved.mock.invocationCallOrder[0]!).toBeGreaterThan(postAt);
  });

  it('settles nothing for a delivery the empty wallet could not pay: it was never held', async () => {
    const { service, repo, ledger } = build({ priceMinor: 100, balanceMinor: 0 });
    const out = await service.settleDelivered({ ...DELIVERED } as never);
    expect(out).toMatchObject({ status: 'free' });
    expect(ledger.post).not.toHaveBeenCalled();
    expect(repo.settleHold).not.toHaveBeenCalled();
    expect(repo.capReserved).not.toHaveBeenCalled();
  });
});
