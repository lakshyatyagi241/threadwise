import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/**
 * SHIM for the WALLET domain, which has no service yet. Posts a top-up to the org's `credits` wallet and to the ledger with an
 * idempotency key (the order id), so replaying the fulfilment can never credit twice: the ledger's UNIQUE (org_id,
 * idempotency_key) is the guard. Reference keeps the wallet per user; this schema keeps it per workspace (decision recorded in
 * port-map). Delete this file when WALLET exposes its own `topup()` and call that instead.
 *
 * Runs inside the caller's (privileged) transaction. Returns true when this call credited, false when it was a replay.
 */
export async function creditWallet(
  tx: Tx,
  input: {
    orgId: number;
    userId: number | null;
    minor: number;
    idempotencyKey: string;
    orderNumber: string;
  },
): Promise<boolean> {
  await tx.execute(
    sql`INSERT INTO wallets (org_id, unit) VALUES (${input.orgId}, 'credits') ON CONFLICT (org_id, unit) DO NOTHING`,
  );
  const locked = await tx.execute(
    sql`SELECT balance::text AS balance FROM wallets WHERE org_id = ${input.orgId} AND unit = 'credits' FOR UPDATE`,
  );
  const balance = BigInt(String((locked.rows[0] as { balance: string }).balance).split('.')[0]!);
  const after = balance + BigInt(input.minor);
  const ins = await tx.execute(sql`
    INSERT INTO wallet_transactions (org_id, user_id, kind, type, amount, balance_after, source, description, meta, idempotency_key)
    VALUES (${input.orgId}, ${input.userId}, 'credit', 'wallet.topup', ${input.minor}, ${after.toString()}, 'topup.conversion',
      'Wallet top-up', ${JSON.stringify({ order: input.orderNumber })}::jsonb, ${input.idempotencyKey})
    ON CONFLICT (org_id, idempotency_key) DO NOTHING
    RETURNING id`);
  if (ins.rows.length === 0) return false;
  await tx.execute(
    sql`UPDATE wallets SET balance = ${after.toString()} WHERE org_id = ${input.orgId} AND unit = 'credits'`,
  );
  return true;
}
