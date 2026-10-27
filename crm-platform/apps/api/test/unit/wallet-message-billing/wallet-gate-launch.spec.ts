import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { WalletGateService } from '../../../src/modules/wallet-message-billing/wallet-gate.service';

/**
 * The gate with its billing lookups stubbed. `lookupFails` makes the plan read throw, which is what a failed wallet lookup looks
 * like to the gate.
 */
function build(opts: { lookupFails?: boolean; balanceMinor?: number } = {}) {
  const plans = {
    forOrg: async () => {
      if (opts.lookupFails) throw new Error('billing database unreachable');
      return {
        platformOwned: false,
        overrides: {},
        planKnown: false,
        planEndsAt: null,
        trialEndsAt: null,
        planLimits: {},
        packLimits: {},
      };
    },
  };
  const settings = { effective: async () => ({ launchCoveragePercent: 100 }) };
  const repo = { peekWallet: async () => ({ balanceMinor: opts.balanceMinor ?? 500 }) };
  const db = {
    txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => ({ rows: [] }) }),
    retry: { txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}) },
  };
  const gate = new WalletGateService(
    db as never,
    repo as never,
    { priceFor: async () => ({ priceMinor: 100, country: 'IN' }) } as never,
    { forOrg: async () => 'USD' } as never,
    settings as never,
    plans as never,
    { isPayPerMessage: async () => true } as never,
    {} as never,
    {} as never,
  );
  // The gate logs through Nest's logger; keep the test output clean.
  (gate as unknown as { logger: { warn: () => void } }).logger = { warn: () => undefined };
  return gate;
}

const LAUNCH = { orgId: 7, source: 'broadcast', recipients: 50, category: 'marketing' };

describe('bulk launch when the wallet cannot be read (#1067): refused, retryable', () => {
  it('refuses the launch with a retryable 503 instead of letting it run unchecked', async () => {
    const gate = build({ lookupFails: true });
    const err = await gate.assertCanLaunch(LAUNCH).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ERROR_CODES.SERVICE_UNAVAILABLE);
    expect((err as AppError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect((err as AppError).expected).toBe(true);
  });

  it('still lets a launch through when the wallet can be read and covers it', async () => {
    const gate = build({ balanceMinor: 100_000 });
    await expect(gate.assertCanLaunch(LAUNCH)).resolves.toBeUndefined();
  });

  it('single sends stay fail open when the wallet cannot be read', async () => {
    const gate = build({ lookupFails: true });
    await expect(
      gate.assertCanSend({ orgId: 7, source: 'inbox', to: '+919876543210' }),
    ).resolves.toBeUndefined();
  });
});
