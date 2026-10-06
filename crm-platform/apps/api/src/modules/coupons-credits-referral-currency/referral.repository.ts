import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { REFERRAL_PAYOUT_SOURCE, type ReferralBucket, type ReferralStats } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../common/pagination/cursor';

/** Whose referrals: every query below filters on BOTH, so one user can never read another's, even inside one workspace. */
export interface Referrer {
  orgId: number;
  userId: number;
}

export interface ReferralListRow {
  id: number;
  uuid: string;
  /** Microsecond-exact, for the cursor. */
  createdAtIso: string;
  createdAt: Date;
  refereeName: string | null;
  refereeEmail: string | null;
  codeUsed: string;
  creditsAwarded: number;
  walletTxUuid: string | null;
}

export interface VolumeRow {
  start: string;
  signups: number;
  creditsMinor: number;
}

export interface PayoutRow {
  uuid: string;
  amountMinor: number;
  createdAt: Date;
  balanceAfterMinor: number;
}

const TRUNC: Readonly<Record<ReferralBucket, string>> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
};

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
const num = (v: unknown) => Number(v ?? 0);

/**
 * SQL of the affiliate screen. `referrals` admits only the privileged transaction, so these run in CpnStore's transaction and the
 * `referrer_org_id` + `referrer_user_id` predicate is the whole tenancy boundary: it is in every statement, never optional.
 * Money is read as the integer hundredths the ledger stores. Pagination is keyset on (created_at, id); there is no OFFSET.
 */
@Injectable()
export class ReferralRepository {
  /** The shared FROM/WHERE of a list: the caller's referrals in a window, optionally matching a search text. */
  private base(who: Referrer, from: Date, q: string | null): SQL {
    const search = q
      ? sql`AND (u.full_name ILIKE ${`%${escapeLike(q)}%`} OR u.email::text ILIKE ${`%${escapeLike(q)}%`} OR r.code_used ILIKE ${`%${escapeLike(q)}%`})`
      : sql``;
    return sql`
      FROM referrals r
      LEFT JOIN users u ON u.org_id = r.referred_org_id AND u.id = r.referred_user_id
      LEFT JOIN wallet_transactions wt ON wt.org_id = r.referrer_org_id AND wt.id = r.award_transaction_id
      WHERE r.referrer_org_id = ${who.orgId} AND r.referrer_user_id = ${who.userId}
        AND r.created_at >= ${from.toISOString()}::timestamptz ${search}`;
  }

  async page(
    tx: Tx,
    who: Referrer,
    opts: { from: Date; q: string | null; cursor?: string; limit: number },
  ): Promise<ListPage> {
    const cur = opts.cursor ? decodeCursor(opts.cursor) : null;
    const after = cur
      ? sql`AND (r.created_at, r.id) < (${cur.createdAtIso ?? cur.createdAt.toISOString()}::timestamptz, ${cur.id})`
      : sql``;
    const res = await tx.execute(sql`
      SELECT r.id, r.uuid, r.created_at, r.code_used, r.credits_awarded, u.full_name, u.email::text AS email, wt.uuid AS wallet_tx_uuid,
             to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_iso
      ${this.base(who, opts.from, opts.q)} ${after}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${opts.limit + 1}`);
    return { rows: res.rows.map(toListRow), limit: opts.limit };
  }

  async total(tx: Tx, who: Referrer, from: Date, q: string | null): Promise<number> {
    const res = await tx.execute(sql`SELECT count(*)::int AS n ${this.base(who, from, q)}`);
    return num((res.rows[0] as { n: unknown }).n);
  }

  /** The newest rows with no window, for the account tab (TW-CPN-037). */
  async recent(tx: Tx, who: Referrer, limit: number): Promise<ReferralListRow[]> {
    const { rows } = await this.page(tx, who, { from: new Date(0), q: null, limit });
    return rows.slice(0, limit);
  }

  /** The KPI numbers: lifetime, last 30 days, the selected window and the one before it, in one pass. */
  async stats(
    tx: Tx,
    who: Referrer,
    w: { start: Date; previousStart: Date; since30d: Date },
  ): Promise<Omit<ReferralStats, 'deltaPercent'>> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS lifetime,
             coalesce(sum(credits_awarded), 0)::bigint AS earned,
             count(*) FILTER (WHERE created_at >= ${w.since30d.toISOString()}::timestamptz)::int AS c30,
             coalesce(sum(credits_awarded) FILTER (WHERE created_at >= ${w.since30d.toISOString()}::timestamptz), 0)::bigint AS cr30,
             count(*) FILTER (WHERE created_at >= ${w.start.toISOString()}::timestamptz)::int AS in_range,
             count(*) FILTER (WHERE created_at >= ${w.previousStart.toISOString()}::timestamptz
                                AND created_at < ${w.start.toISOString()}::timestamptz)::int AS prev
      FROM referrals WHERE referrer_org_id = ${who.orgId} AND referrer_user_id = ${who.userId}`);
    const r = res.rows[0] as Record<string, unknown>;
    const lifetime = num(r.lifetime);
    const earned = num(r.earned);
    return {
      signupsInRange: num(r.in_range),
      signupsPrevious: num(r.prev),
      signupsLifetime: lifetime,
      signups30d: num(r.c30),
      creditsEarnedMinor: earned,
      credits30dMinor: num(r.cr30),
      avgPerSignupMinor: lifetime > 0 ? Math.round(earned / lifetime) : 0,
    };
  }

  async volume(tx: Tx, who: Referrer, bucket: ReferralBucket, from: string): Promise<VolumeRow[]> {
    // A bound parameter from the TRUNC map above (never request text): date_trunc takes its unit as a value.
    const unit = TRUNC[bucket];
    const res = await tx.execute(sql`
      SELECT to_char(date_trunc(${unit}::text, created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS start,
             count(*)::int AS signups, coalesce(sum(credits_awarded), 0)::bigint AS credits
      FROM referrals
      WHERE referrer_org_id = ${who.orgId} AND referrer_user_id = ${who.userId}
        AND created_at >= (${from}::date)::timestamp AT TIME ZONE 'UTC'
      GROUP BY 1`);
    return res.rows.map((r) => ({
      start: String((r as { start: string }).start),
      signups: num((r as { signups: unknown }).signups),
      creditsMinor: num((r as { credits: unknown }).credits),
    }));
  }

  async topCodes(tx: Tx, who: Referrer, from: Date, limit: number) {
    const res = await tx.execute(sql`
      SELECT code_used AS code, count(*)::int AS signups, coalesce(sum(credits_awarded), 0)::bigint AS credits
      FROM referrals
      WHERE referrer_org_id = ${who.orgId} AND referrer_user_id = ${who.userId}
        AND created_at >= ${from.toISOString()}::timestamptz
      GROUP BY code_used
      ORDER BY signups DESC, credits DESC, code_used
      LIMIT ${limit}`);
    return res.rows.map((r) => ({
      code: String((r as { code: string }).code),
      signups: num((r as { signups: unknown }).signups),
      creditsMinor: num((r as { credits: unknown }).credits),
    }));
  }

  /**
   * The caller's latest payouts. Reference filtered the ledger on the retired source `referral.signup`, so new payouts never showed;
   * the source is the one the reward writes, and the join to the caller's own referrals keeps another member's payout out.
   */
  async payouts(tx: Tx, who: Referrer, limit: number): Promise<PayoutRow[]> {
    const res = await tx.execute(sql`
      SELECT wt.uuid, wt.amount::text AS amount, wt.balance_after::text AS balance_after, wt.created_at
      FROM referrals r
      JOIN wallet_transactions wt ON wt.org_id = r.referrer_org_id AND wt.id = r.award_transaction_id
      WHERE r.referrer_org_id = ${who.orgId} AND r.referrer_user_id = ${who.userId}
        AND wt.source = ${REFERRAL_PAYOUT_SOURCE}
      ORDER BY wt.created_at DESC, wt.id DESC
      LIMIT ${limit}`);
    return res.rows.map((r) => {
      const x = r as { uuid: string; amount: string; balance_after: string; created_at: Date };
      return {
        uuid: x.uuid,
        amountMinor: hundredths(x.amount),
        balanceAfterMinor: hundredths(x.balance_after),
        createdAt: new Date(x.created_at),
      };
    });
  }
}

export interface ListPage {
  /** `limit + 1` rows at most: the extra one says there is a next page. */
  rows: ReferralListRow[];
  limit: number;
}

function toListRow(r: unknown): ReferralListRow {
  const x = r as {
    id: string | number;
    uuid: string;
    created_at: Date;
    created_iso: string;
    code_used: string;
    credits_awarded: number;
    full_name: string | null;
    email: string | null;
    wallet_tx_uuid: string | null;
  };
  return {
    id: Number(x.id),
    uuid: x.uuid,
    createdAt: new Date(x.created_at),
    createdAtIso: x.created_iso,
    refereeName: x.full_name,
    refereeEmail: x.email,
    codeUsed: x.code_used,
    creditsAwarded: num(x.credits_awarded),
    walletTxUuid: x.wallet_tx_uuid,
  };
}

/** Hundredths from the decimal text the wallet's numeric columns come back as ("2.50" -> 250). Exact: no float. */
function hundredths(text: string): number {
  const neg = text.startsWith('-');
  const [whole = '0', frac = ''] = (neg ? text.slice(1) : text).split('.');
  const v = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -v : v;
}
