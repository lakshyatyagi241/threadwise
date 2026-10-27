import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import {
  WALLET_HOLD_TTL_SECONDS,
  WalletGateService,
} from '../../../src/modules/wallet-message-billing/wallet-gate.service';

interface Setup {
  platformOwned?: boolean;
  balanceMinor?: number;
  priceMinor?: number;
  /** What the hold returns: a hold id, or null when the available balance does not cover it. */
  hold?: number | null | Error;
  /** A failed billing lookup (the plan read throws). */
  lookupFails?: boolean;
}

/** The gate with its collaborators stubbed: a workspace on pay-per-message billing with one recipient in its own country. */
function build(s: Setup = {}) {
  const holds: Array<{ orgId: number; unit: string; amountMinor: number; ttl: number }> = [];
  const warnings: unknown[] = [];
  const plans = {
    forOrg: vi.fn(async () => {
      if (s.lookupFails) throw new Error('plan read failed');
      return {
        platformOwned: s.platformOwned ?? false,
        overrides: {},
        planKnown: false,
        planEndsAt: null,
        trialEndsAt: null,
        planLimits: {},
        packLimits: {},
      };
    }),
  };
  const settings = { effective: async () => ({ launchCoveragePercent: 100 }) };
  const repo = {
    peekWallet: async () => ({ balanceMinor: s.balanceMinor ?? 500 }),
    holdMinor: vi.fn(
      async (_tx: unknown, orgId: number, unit: string, amountMinor: number, ttl: number) => {
        holds.push({ orgId, unit, amountMinor, ttl });
        if (s.hold instanceof Error) throw s.hold;
        return s.hold === undefined ? 1 : s.hold;
      },
    ),
  };
  const db = {
    txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => ({ rows: [] }) }),
    retry: { txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}) },
  };
  const billing = { forOrg: async () => 'USD' };
  const mode = { isPayPerMessage: async () => true };
  const rates = { priceFor: async () => ({ priceMinor: s.priceMinor ?? 100, country: 'IN' }) };
  const log = {};
  const usage = {};
  const gate = new WalletGateService(
    db as never,
    repo as never,
    rates as never,
    billing as never,
    settings as never,
    plans as never,
    mode as never,
    log as never,
    usage as never,
  );
  // The gate logs a lookup failure through Nest's logger; capture it so the test output stays clean.
  (gate as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger = {
    warn: (...a: unknown[]) => void warnings.push(a),
  };
  return { gate, holds, repo, warnings };
}

const SEND = { orgId: 7, source: 'campaign', to: '+919876543210', category: 'marketing' };

describe('WalletGateService.assertCanSend: each send holds its price on the balance path', () => {
  it('holds the message price against the wallet, for the configured time', async () => {
    const { gate, holds } = build({ balanceMinor: 500, priceMinor: 100 });
    await gate.assertCanSend(SEND);
    expect(holds).toEqual([
      { orgId: 7, unit: 'USD', amountMinor: 100, ttl: WALLET_HOLD_TTL_SECONDS },
    ]);
  });

  it('holds on every send, with no cached "ok": three sends hold three times', async () => {
    const { gate, holds } = build({ balanceMinor: 500, priceMinor: 100 });
    await gate.assertCanSend(SEND);
    await gate.assertCanSend(SEND);
    await gate.assertCanSend(SEND);
    expect(holds).toHaveLength(3);
  });

  it('refuses a send the held amount cannot cover, with WALLET_EMPTY and no send allowed', async () => {
    const { gate } = build({ balanceMinor: 500, priceMinor: 100, hold: null });
    const err = await gate.assertCanSend(SEND).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ERROR_CODES.WALLET_EMPTY);
  });

  it('refuses an empty wallet before it takes any hold', async () => {
    const { gate, holds } = build({ balanceMinor: 0, priceMinor: 100 });
    await expect(gate.assertCanSend(SEND)).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_EMPTY,
    });
    expect(holds).toHaveLength(0);
  });

  it('lets the send through when the hold itself cannot be written, like the other lookups', async () => {
    const { gate, warnings } = build({
      balanceMinor: 500,
      priceMinor: 100,
      hold: new Error('db down'),
    });
    await expect(gate.assertCanSend(SEND)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('lets the send through when the billing lookup fails', async () => {
    const { gate, holds } = build({ lookupFails: true });
    await expect(gate.assertCanSend(SEND)).resolves.toBeUndefined();
    expect(holds).toHaveLength(0);
  });

  it('takes no hold for a platform-owned workspace', async () => {
    const { gate, holds } = build({ platformOwned: true, balanceMinor: 0 });
    await gate.assertCanSend(SEND);
    expect(holds).toHaveLength(0);
  });
});
