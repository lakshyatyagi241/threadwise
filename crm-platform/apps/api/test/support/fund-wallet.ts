import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../../src/infra/db/database.service';
import {
  BillingCurrencyService,
  WalletLedgerService,
} from '../../src/modules/wallet-message-billing';

/**
 * Puts money in a workspace's wallet through the ledger, the way a paid top-up does (hundredths of the workspace's billing currency).
 * For a suite that exercises a feature the wallet pays for (an AI reply, a flow's AI step, a contact lookup on the platform's key): a
 * workspace with an empty wallet is refused those before the vendor is called, which is the behaviour, not a failure to work around.
 */
export async function fundWallet(
  app: INestApplication,
  orgId: number,
  minor = 1_000_000,
): Promise<void> {
  const opts = { strict: false } as const;
  const db = app.get(DatabaseService, opts);
  const ledger = app.get(WalletLedgerService, opts);
  const billing = app.get(BillingCurrencyService, opts);
  await db.txAs({ orgId, userId: null }, async (tx) => {
    await ledger.post(tx, {
      orgId,
      unit: await billing.forOrg(tx, orgId),
      type: 'topup',
      direction: 'in',
      amountMinor: minor,
      idempotencyKey: `test-fund:${orgId}:${Math.random()}`,
      source: 'topup.conversion',
      description: 'Wallet top-up',
    });
  });
}
