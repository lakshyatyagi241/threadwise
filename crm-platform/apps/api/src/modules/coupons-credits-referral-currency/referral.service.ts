import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type {
  ReferralHistoryQuery,
  ReferralHistoryResponse,
  ReferralMeResponse,
  ReferralRow,
  ReferralSummaryResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { PlatformStore } from '../auth';
import { WalletLedgerService, WalletSettingsService } from '../wallet-message-billing';
import { ReferralCodeService } from './referral-code.service';
import { csvCell, defaultBucket, deltaPct, resolveRange, volumeSeries } from './referral-rules';
import { decodeKey, encodeKey, escapeLike } from './operator';

interface RowDb {
  uuid: string;
  id: string;
  created_at: string | Date;
  created_at_iso: string;
  full_name: string | null;
  email: string | null;
  referred_user_id: string;
  code_used: string;
  credits_awarded: string;
  tx_uuid: string | null;
}

/** Spreadsheets need this at the start of a UTF-8 CSV to read non-Latin names. */
const BOM = String.fromCharCode(0xfeff);

const ISO = sql.raw(`to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

const toRow = (r: RowDb): ReferralRow => {
  const awarded = Number(r.credits_awarded);
  return {
    id: r.uuid,
    createdAt: new Date(r.created_at).toISOString(),
    refereeName: r.full_name || `User #${r.referred_user_id}`,
    refereeEmail: r.email,
    codeUsed: r.code_used,
    creditsAwardedMinor: awarded,
    walletTxId: r.tx_uuid,
    status: awarded > 0 ? 'paid' : 'no-payout',
  };
};

/** The caller: the workspace and the person asking. Referral data is the PERSON's, not the workspace's (TW-CPN-035). */
function me(): { orgId: number; userId: number } {
  const ctx = RequestContextStore.require();
  if (!ctx.userId) throw AppError.unauthenticated();
  return { orgId: ctx.orgId, userId: ctx.userId };
}

/**
 * Referral attribution, the first-payment reward and the affiliate screens (TW-CPN-032..037).
 *
 * Attribution is written from the sign-up's `referral.attributed` event; the reward from `paygw.order.paid`, in the worker, each
 * idempotent. The referee lives in another workspace than the referrer, so the reads join across tenants on the privileged
 * connection with the caller's org and user in every statement (the same pattern as the payment receivers).
 */
@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly store: PlatformStore,
    private readonly codes: ReferralCodeService,
    private readonly ledger: WalletLedgerService,
    private readonly walletSettings: WalletSettingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---- attribution ---------------------------------------------------------------------------------------------------

  /**
   * Links a new user to the referrer whose code they arrived with, once (TW-CPN-032). No reward yet: it is paid on the referee's
   * first paid order. A repeat for the same referee, or a referrer who is the referee, changes nothing.
   */
  async attribute(p: {
    referrerUserUuid: string;
    referrerOrgUuid: string;
    referredUserUuid: string;
    referredOrgUuid: string;
    codeUsed: string;
  }): Promise<'attributed' | 'already' | 'ignored'> {
    return this.store.tx(async (tx) => {
      const find = async (user: string, org: string) => {
        const res = await tx.execute(sql`
          SELECT u.org_id, u.id FROM users u JOIN organizations o ON o.id = u.org_id
          WHERE u.uuid = ${user}::uuid AND o.uuid = ${org}::uuid`);
        return res.rows[0] as { org_id: string; id: string } | undefined;
      };
      const referrer = await find(p.referrerUserUuid, p.referrerOrgUuid);
      const referee = await find(p.referredUserUuid, p.referredOrgUuid);
      if (!referrer || !referee) return 'ignored';
      if (referrer.org_id === referee.org_id && referrer.id === referee.id) return 'ignored';
      const res = await tx.execute(sql`
        INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used)
        VALUES (${referrer.org_id}, ${referrer.id}, ${referee.org_id}, ${referee.id}, ${p.codeUsed.toUpperCase().slice(0, 16)})
        ON CONFLICT (referred_org_id, referred_user_id) DO NOTHING RETURNING id`);
      return res.rows.length > 0 ? 'attributed' : 'already';
    });
  }

  // ---- reward --------------------------------------------------------------------------------------------------------

  /**
   * Pays the referrer when the referee's order is paid (TW-CPN-033). Idempotent three times over: the referral is stamped with the
   * ledger row, the referral row is locked so two orders paid at once cannot both pay (Reference could double-credit), and the ledger
   * posting carries a key made from the referral. ANY paid order counts, as in Reference (plan, add-on, top-up, offline approval).
   */
  async rewardOnPaidOrder(orgId: number, orderId: number): Promise<'paid' | 'nothing'> {
    return this.store.tx(async (tx) => {
      const order = await tx.execute(
        sql`SELECT user_id, status FROM orders WHERE org_id = ${orgId} AND id = ${orderId}`,
      );
      const o = order.rows[0] as { user_id: string | null; status: string } | undefined;
      if (!o || o.status !== 'paid' || o.user_id === null) return 'nothing';

      const ref = await tx.execute(sql`
        SELECT r.id, r.uuid, r.referrer_org_id, r.referrer_user_id, r.code_used, u.email
        FROM referrals r JOIN users u ON u.org_id = r.referred_org_id AND u.id = r.referred_user_id
        WHERE r.referred_org_id = ${orgId} AND r.referred_user_id = ${o.user_id} AND r.award_transaction_id IS NULL
        FOR UPDATE OF r`);
      const referral = ref.rows[0] as
        | {
            id: string;
            uuid: string;
            referrer_org_id: string;
            referrer_user_id: string;
            code_used: string;
            email: string;
          }
        | undefined;
      if (!referral) return 'nothing';

      const payout = Math.max(0, (await this.walletSettings.effective()).referralSignupMinor);
      if (payout <= 0) return 'nothing';
      const posted = await this.ledger.post(tx, {
        orgId: Number(referral.referrer_org_id),
        unit: await this.walletSettings.currency(),
        type: 'earn',
        direction: 'in',
        amountMinor: payout,
        idempotencyKey: `referral:${referral.uuid}`,
        source: 'referral.paid',
        description: `Referral bonus — ${referral.email} started a paid plan with your code`,
        userId: Number(referral.referrer_user_id),
        meta: { refereeId: Number(o.user_id), codeUsed: referral.code_used },
      });
      await tx.execute(sql`
        UPDATE referrals SET credits_awarded = ${posted.appliedMinor}, award_transaction_id = ${posted.transactionRowId}
        WHERE id = ${referral.id}`);
      return 'paid';
    });
  }

  // ---- the caller's own program --------------------------------------------------------------------------------------

  async mine(): Promise<ReferralMeResponse> {
    const { orgId, userId } = me();
    const code = await this.codes.ensure(orgId, userId);
    const s = await this.walletSettings.effective();
    const web = (this.config.get('WEB_APP_URL', { infer: true }) ?? '').replace(/\/+$/, '');
    return {
      code,
      link: `${web}/register?ref=${encodeURIComponent(code)}`,
      rewardMinor: s.referralSignupMinor,
      currency: s.currency,
      creditsPerMessage: Math.max(1, s.flatPriceMinor),
      payPerMessage: s.payPerMessage,
    };
  }

  /** The Account page's Affiliate tab (TW-CPN-037): the code, true lifetime counters, the 50 newest referrals. */
  async summary(): Promise<ReferralSummaryResponse> {
    const { orgId, userId } = me();
    const mine = await this.mine();
    return this.store.tx(async (tx) => {
      const agg = await tx.execute(sql`
        SELECT count(*)::int AS lifetime, count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS last30,
               coalesce(sum(credits_awarded), 0)::bigint AS earned
        FROM referrals WHERE referrer_org_id = ${orgId} AND referrer_user_id = ${userId}`);
      const a = agg.rows[0] as { lifetime: number; last30: number; earned: string };
      const rows = await tx.execute(sql`
        SELECT r.uuid, r.id, r.created_at, ${ISO} AS created_at_iso, u.full_name, u.email, r.referred_user_id, r.code_used,
               r.credits_awarded, w.uuid AS tx_uuid
        FROM referrals r
        JOIN users u ON u.org_id = r.referred_org_id AND u.id = r.referred_user_id
        LEFT JOIN wallet_transactions w ON w.org_id = r.referrer_org_id AND w.id = r.award_transaction_id
        WHERE r.referrer_org_id = ${orgId} AND r.referrer_user_id = ${userId}
        ORDER BY r.created_at DESC, r.id DESC LIMIT 50`);
      return {
        me: mine,
        signupsLifetime: a.lifetime,
        signups30d: a.last30,
        earnedMinor: Number(a.earned),
        recent: (rows.rows as unknown as RowDb[]).map(toRow),
      };
    });
  }

  /** The dashboard (TW-CPN-035): KPIs, chart series, top codes, recent payouts and one page of the table, all in SQL. */
  async history(q: ReferralHistoryQuery, now = new Date()): Promise<ReferralHistoryResponse> {
    const { orgId, userId } = me();
    const range = resolveRange(q.range, now);
    const bucket = q.bucket ?? defaultBucket(range.days);
    return this.store.tx(async (tx) => {
      const mineFilter = sql`r.referrer_org_id = ${orgId} AND r.referrer_user_id = ${userId}`;
      const inRange = sql`${mineFilter} AND r.created_at >= ${range.from} AND r.created_at < ${range.to}`;
      const search = q.q
        ? (() => {
            const like = `%${escapeLike(q.q)}%`;
            return sql` AND (u.full_name ILIKE ${like} OR u.email ILIKE ${like} OR r.code_used ILIKE ${like})`;
          })()
        : sql``;
      const cursor = q.cursor
        ? (() => {
            const [iso, id] = decodeKey(q.cursor).split('|');
            if (!iso || !id) throw AppError.validation('Invalid pagination cursor');
            return sql` AND (r.created_at, r.id) < (${iso}::timestamptz, ${Number(id)})`;
          })()
        : sql``;

      const page = await tx.execute(sql`
        SELECT r.uuid, r.id, r.created_at, ${ISO} AS created_at_iso, u.full_name, u.email, r.referred_user_id, r.code_used,
               r.credits_awarded, w.uuid AS tx_uuid
        FROM referrals r
        JOIN users u ON u.org_id = r.referred_org_id AND u.id = r.referred_user_id
        LEFT JOIN wallet_transactions w ON w.org_id = r.referrer_org_id AND w.id = r.award_transaction_id
        WHERE ${inRange}${search}${cursor}
        ORDER BY r.created_at DESC, r.id DESC LIMIT ${q.limit + 1}`);
      const all = page.rows as unknown as RowDb[];
      const hasMore = all.length > q.limit;
      const items = hasMore ? all.slice(0, q.limit) : all;
      const last = items[items.length - 1];

      const total = await tx.execute(sql`
        SELECT count(*)::int AS n FROM referrals r
        JOIN users u ON u.org_id = r.referred_org_id AND u.id = r.referred_user_id
        WHERE ${inRange}${search}`);

      // KPIs over the range alone: the search never changes them.
      const prevFrom = new Date(range.from.getTime() - range.days * 86_400_000);
      const stats = await tx.execute(sql`
        SELECT count(*)::int AS lifetime, coalesce(sum(r.credits_awarded), 0)::bigint AS lifetime_credits,
          count(*) FILTER (WHERE r.created_at >= ${range.from} AND r.created_at < ${range.to})::int AS in_range,
          coalesce(sum(r.credits_awarded) FILTER (WHERE r.created_at >= ${range.from} AND r.created_at < ${range.to}), 0)::bigint AS range_credits,
          count(*) FILTER (WHERE r.created_at >= ${new Date(now.getTime() - 30 * 86_400_000)})::int AS last30,
          coalesce(sum(r.credits_awarded) FILTER (WHERE r.created_at >= ${new Date(now.getTime() - 30 * 86_400_000)}), 0)::bigint AS last30_credits,
          count(*) FILTER (WHERE r.created_at >= ${prevFrom} AND r.created_at < ${range.from})::int AS previous
        FROM referrals r WHERE ${mineFilter}`);
      const s = stats.rows[0] as Record<string, string | number>;
      const lifetime = Number(s.lifetime);
      const lifetimeCredits = Number(s.lifetime_credits);

      const points = await tx.execute(
        sql`SELECT r.created_at, r.credits_awarded FROM referrals r WHERE ${inRange}`,
      );
      const volume = volumeSeries(
        (points.rows as Array<{ created_at: string | Date; credits_awarded: string }>).map((p) => ({
          at: new Date(p.created_at),
          creditsMinor: Number(p.credits_awarded),
        })),
        range.days,
        bucket,
        now,
      );

      const top = await tx.execute(sql`
        SELECT r.code_used, count(*)::int AS signups, coalesce(sum(r.credits_awarded), 0)::bigint AS credits
        FROM referrals r WHERE ${inRange} GROUP BY r.code_used ORDER BY signups DESC, r.code_used LIMIT 5`);
      const topRows = top.rows as Array<{ code_used: string; signups: number; credits: string }>;
      const maxSignups = Math.max(1, ...topRows.map((t) => t.signups));

      // The payouts panel reads the CURRENT payout source and the legacy one: Reference filtered on the legacy name only, so a
      // payout never appeared (TW-CPN-035 rule 4).
      const payouts = await tx.execute(sql`
        SELECT w.uuid, (w.amount * 100)::bigint AS amount_minor, (w.balance_after * 100)::bigint AS balance_minor,
               coalesce(w.description, 'Referral bonus') AS description, w.created_at
        FROM wallet_transactions w
        WHERE w.org_id = ${orgId} AND w.user_id = ${userId} AND w.source IN ('referral.paid', 'referral.signup')
        ORDER BY w.created_at DESC, w.id DESC LIMIT 8`);

      return {
        data: items.map(toRow),
        page: {
          nextCursor: hasMore && last ? encodeKey(`${last.created_at_iso}|${last.id}`) : null,
          hasMore,
          limit: q.limit,
        },
        total: (total.rows[0] as { n: number }).n,
        stats: {
          signupsLifetime: lifetime,
          creditsLifetimeMinor: lifetimeCredits,
          signupsRange: Number(s.in_range),
          creditsRangeMinor: Number(s.range_credits),
          signups30d: Number(s.last30),
          credits30dMinor: Number(s.last30_credits),
          avgPerSignupMinor: lifetime > 0 ? Math.round(lifetimeCredits / lifetime) : 0,
          deltaPct: deltaPct(Number(s.in_range), Number(s.previous)),
        },
        volume,
        topCodes: topRows.map((t) => ({
          code: t.code_used,
          signups: t.signups,
          creditsMinor: Number(t.credits),
          pct: Math.max(2, Math.round((t.signups / maxSignups) * 100)),
        })),
        payouts: (
          payouts.rows as Array<{
            uuid: string;
            amount_minor: string;
            balance_minor: string;
            description: string;
            created_at: string | Date;
          }>
        ).map((p) => ({
          id: p.uuid,
          amountMinor: Number(p.amount_minor),
          balanceAfterMinor: Number(p.balance_minor),
          description: p.description,
          createdAt: new Date(p.created_at).toISOString(),
        })),
        range: range.key,
      };
    });
  }

  /** The CSV of the range (TW-CPN-036): every referral newest first, with a BOM so spreadsheets read UTF-8 names. */
  async exportCsv(rangeKey: string, now = new Date()): Promise<{ body: string; fileName: string }> {
    const { orgId, userId } = me();
    const range = resolveRange(rangeKey, now);
    const rows = await this.store.tx((tx: Tx) =>
      tx.execute(sql`
        SELECT r.uuid, r.id, r.created_at, ${ISO} AS created_at_iso, u.full_name, u.email, r.referred_user_id, r.code_used,
               r.credits_awarded, w.uuid AS tx_uuid
        FROM referrals r
        JOIN users u ON u.org_id = r.referred_org_id AND u.id = r.referred_user_id
        LEFT JOIN wallet_transactions w ON w.org_id = r.referrer_org_id AND w.id = r.award_transaction_id
        WHERE r.referrer_org_id = ${orgId} AND r.referrer_user_id = ${userId}
          AND r.created_at >= ${range.from} AND r.created_at < ${range.to}
        ORDER BY r.created_at DESC, r.id DESC`),
    );
    const head = [
      'id',
      'created_at',
      'referee_name',
      'referee_email',
      'code_used',
      'credits_awarded',
      'wallet_tx_id',
    ];
    const lines = [head.join(',')];
    for (const r of rows.rows as unknown as RowDb[]) {
      lines.push(
        [
          r.uuid,
          new Date(r.created_at).toISOString(),
          r.full_name,
          r.email,
          r.code_used,
          Number(r.credits_awarded),
          r.tx_uuid,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return {
      body: `${BOM}${lines.join('\r\n')}\r\n`,
      fileName: `affiliate-history-${stamp}.csv`,
    };
  }
}
