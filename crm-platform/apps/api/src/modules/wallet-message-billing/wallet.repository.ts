import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { walletExactAmount } from '@crm/contracts';
import type { Tx } from '@crm/db';

export interface WalletRow {
  id: number;
  unit: string;
  balanceMinor: number;
  /** The balance to the ledger's four decimals, trimmed ("192.999"). */
  balanceExact: string;
  lowBalanceAlertedAt: Date | null;
}

export interface LedgerRow {
  id: number;
  uuid: string;
  type: string;
  direction: 'in' | 'out';
  amountMinor: number;
  /** Signed, to the ledger's four decimals, trimmed ("-0.958"). */
  amountExact: string;
  balanceAfterMinor: number;
  balanceAfterExact: string;
  source: string | null;
  description: string | null;
  note: string | null;
  actorType: string;
  actorLabel: string | null;
  createdAt: Date;
}

/**
 * Narrows a query on `wallet_transactions` to one wallet's entries. A row without a unit predates per-currency billing, when the
 * only wallet was in the platform currency, so it belongs to that currency's wallet.
 */
export const inUnit = (unit: string, platformCurrency: string) =>
  sql`(unit = ${unit} OR (unit IS NULL AND ${unit} = ${platformCurrency}))`;

/** Hundredths from the database's decimal text ("12.3400" -> 1234). Exact: split on the dot, no float. */
export function decimalToMinor(text: string | number | null | undefined): number {
  if (text === null || text === undefined) return 0;
  const s = String(text);
  const neg = s.startsWith('-');
  const [whole = '0', frac = ''] = (neg ? s.slice(1) : s).split('.');
  const minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -minor : minor;
}

/** Hundredths to the decimal text the numeric column takes. */
export function minorToDecimal(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Tenant-scoped SQL of the wallet. Every method runs inside the transaction its caller opened for ONE organization and still names
 * the org: RLS is the guarantee, the predicate keeps the plan indexed. The balance lives in a decimal column in whole units;
 * everything above this file speaks hundredths (integers).
 */
@Injectable()
export class WalletRepository {
  /**
   * The workspace's wallet IN THIS CURRENCY, created on first use, LOCKED for the rest of the transaction. A workspace can hold a
   * wallet per currency, so the unit picks the wallet (it used to be the org's only one).
   *
   * Every movement takes this lock first, so Every movement takes this lock first, so
   * concurrent charges to one wallet queue instead of overspending (TW-WALLET-001 acceptance 1) and the quota counter is read
   * under it (TW-WALLET-010 rule 3).
   */
  async lockWallet(tx: Tx, orgId: number, unit: string): Promise<WalletRow> {
    const find = () =>
      tx.execute(sql`
        SELECT id, unit, balance::text AS balance, low_balance_alerted_at
        FROM wallets WHERE org_id = ${orgId} AND unit = ${unit} FOR UPDATE`);
    let res = await find();
    if (res.rows.length === 0) {
      await tx.execute(sql`
        INSERT INTO wallets (org_id, unit) VALUES (${orgId}, ${unit}) ON CONFLICT (org_id, unit) DO NOTHING`);
      res = await find();
    }
    const r = res.rows[0] as unknown as {
      id: string | number;
      unit: string;
      balance: string;
      low_balance_alerted_at: Date | null;
    };
    return {
      id: Number(r.id),
      unit: r.unit,
      balanceMinor: decimalToMinor(r.balance),
      balanceExact: walletExactAmount(r.balance),
      lowBalanceAlertedAt: r.low_balance_alerted_at ? new Date(r.low_balance_alerted_at) : null,
    };
  }

  /** The workspace's wallet in `unit`, without creating or locking it (reads). */
  async peekWallet(tx: Tx, orgId: number, unit: string): Promise<WalletRow | null> {
    const res = await tx.execute(sql`
      SELECT id, unit, balance::text AS balance, low_balance_alerted_at
      FROM wallets WHERE org_id = ${orgId} AND unit = ${unit}`);
    const r = res.rows[0] as unknown as
      | { id: string | number; unit: string; balance: string; low_balance_alerted_at: Date | null }
      | undefined;
    if (!r) return null;
    return {
      id: Number(r.id),
      unit: r.unit,
      balanceMinor: decimalToMinor(r.balance),
      balanceExact: walletExactAmount(r.balance),
      lowBalanceAlertedAt: r.low_balance_alerted_at ? new Date(r.low_balance_alerted_at) : null,
    };
  }

  /** Every wallet the workspace holds, one per currency, oldest first. */
  async wallets(tx: Tx, orgId: number): Promise<WalletRow[]> {
    const res = await tx.execute(sql`
      SELECT id, unit, balance::text AS balance, low_balance_alerted_at
      FROM wallets WHERE org_id = ${orgId} ORDER BY id`);
    return (
      res.rows as unknown as Array<{
        id: string | number;
        unit: string;
        balance: string;
        low_balance_alerted_at: Date | null;
      }>
    ).map((r) => ({
      id: Number(r.id),
      unit: r.unit,
      balanceMinor: decimalToMinor(r.balance),
      balanceExact: walletExactAmount(r.balance),
      lowBalanceAlertedAt: r.low_balance_alerted_at ? new Date(r.low_balance_alerted_at) : null,
    }));
  }

  async setBalance(
    tx: Tx,
    orgId: number,
    walletId: number,
    balanceMinor: number,
    alertedAt: 'keep' | 'clear' | Date,
  ): Promise<void> {
    const balance = minorToDecimal(balanceMinor);
    if (alertedAt === 'keep') {
      await tx.execute(
        sql`UPDATE wallets SET balance = ${balance}::numeric WHERE org_id = ${orgId} AND id = ${walletId}`,
      );
    } else if (alertedAt === 'clear') {
      await tx.execute(sql`
        UPDATE wallets SET balance = ${balance}::numeric, low_balance_alerted_at = NULL
        WHERE org_id = ${orgId} AND id = ${walletId}`);
    } else {
      await tx.execute(sql`
        UPDATE wallets SET balance = ${balance}::numeric, low_balance_alerted_at = ${alertedAt.toISOString()}::timestamptz
        WHERE org_id = ${orgId} AND id = ${walletId}`);
    }
  }

  async markAlerted(tx: Tx, orgId: number, walletId: number, at: Date): Promise<void> {
    await tx.execute(sql`
      UPDATE wallets SET low_balance_alerted_at = ${at.toISOString()}::timestamptz
      WHERE org_id = ${orgId} AND id = ${walletId}`);
  }

  async findByKey(tx: Tx, orgId: number, key: string): Promise<LedgerRow | null> {
    const res = await tx.execute(sql`
      SELECT ${LEDGER_COLUMNS} FROM wallet_transactions WHERE org_id = ${orgId} AND idempotency_key = ${key}`);
    return res.rows[0] ? toLedger(res.rows[0] as unknown as RawLedger) : null;
  }

  async insertTransaction(
    tx: Tx,
    v: {
      orgId: number;
      userId: number | null;
      /** The currency of the wallet this entry moves. */
      unit: string;
      type: string;
      direction: 'in' | 'out';
      amountMinor: number;
      balanceAfterMinor: number;
      source: string | null;
      subjectType: string | null;
      subjectId: number | null;
      description: string | null;
      note: string | null;
      meta: Record<string, unknown> | null;
      idempotencyKey: string;
      actorType: string;
      actorLabel: string | null;
      operatorId: number | null;
      requestId: string | null;
    },
  ): Promise<LedgerRow | null> {
    const signed = v.direction === 'out' ? -v.amountMinor : v.amountMinor;
    const res = await tx.execute(sql`
      INSERT INTO wallet_transactions
        (org_id, user_id, unit, kind, type, direction, amount, balance_after, source, subject_type, subject_id, description, note, meta,
         idempotency_key, actor_type, actor_label, operator_id, request_id)
      VALUES (${v.orgId}, ${v.userId}, ${v.unit}, 'credit', ${v.type}, ${v.direction}, ${minorToDecimal(signed)}::numeric,
              ${minorToDecimal(v.balanceAfterMinor)}::numeric, ${v.source}, ${v.subjectType}, ${v.subjectId}, ${v.description},
              ${v.note}, ${v.meta ? JSON.stringify(v.meta) : null}::jsonb, ${v.idempotencyKey}, ${v.actorType}, ${v.actorLabel},
              ${v.operatorId}, ${v.requestId})
      ON CONFLICT (org_id, idempotency_key) DO NOTHING
      RETURNING ${LEDGER_COLUMNS}`);
    return res.rows[0] ? toLedger(res.rows[0] as unknown as RawLedger) : null;
  }
}

interface RawLedger {
  id: string | number;
  uuid: string;
  type: string;
  direction: 'in' | 'out';
  amount: string;
  balance_after: string;
  source: string | null;
  description: string | null;
  note: string | null;
  actor_type: string;
  actor_label: string | null;
  created_at: Date;
}

export const LEDGER_COLUMNS = sql`id, uuid, type, direction, amount::text AS amount, balance_after::text AS balance_after, source,
  description, note, actor_type, actor_label, created_at`;

export function toLedger(r: RawLedger): LedgerRow {
  return {
    id: Number(r.id),
    uuid: r.uuid,
    type: r.type,
    direction: r.direction,
    amountMinor: decimalToMinor(r.amount),
    amountExact: walletExactAmount(r.amount),
    balanceAfterMinor: decimalToMinor(r.balance_after),
    balanceAfterExact: walletExactAmount(r.balance_after),
    source: r.source,
    description: r.description,
    note: r.note,
    actorType: r.actor_type,
    actorLabel: r.actor_label,
    createdAt: new Date(r.created_at),
  };
}
