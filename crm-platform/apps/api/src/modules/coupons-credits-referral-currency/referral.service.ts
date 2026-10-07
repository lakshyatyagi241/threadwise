import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import {
  REFERRAL_CSV_COLUMNS,
  REFERRAL_PAYOUTS_LIMIT,
  REFERRAL_RECENT_LIMIT,
  REFERRAL_TOP_CODES_LIMIT,
  type ReferralExportQuery,
  type ReferralListParams,
  type ReferralListResponse,
  type ReferralOverview,
  type ReferralRow,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { encodeCursor } from '../../common/pagination/cursor';
import type { Env } from '../../config/env.schema';
import { WalletSettingsService } from '../wallet-message-billing';
import { CpnStore } from './cpn-store';
import { ReferralCodeService } from './referral-code.service';
import { ReferralRepository, type ReferralListRow, type Referrer } from './referral.repository';
import {
  bucketStarts,
  defaultBucket,
  deltaPercent,
  fillSeries,
  rangeWindow,
} from './referral-windows';

/** Excel needs this at the start of a UTF-8 CSV to read accents and non-Latin names correctly. */
const BOM = String.fromCharCode(0xfeff);
const EXPORT_BATCH = 1000;
/** A user's referrals are counted in the dozens; the cap only keeps a runaway account from holding a stream open forever. */
export const EXPORT_MAX_ROWS = 100_000;
const DAY_MS = 86_400_000;

/** A CSV cell that cannot run as a spreadsheet formula (a referee chose their own name) and is quoted when it must be. */
export function csvCell(value: string | number | null | undefined, formulaSafe = false): string {
  let v = value === null || value === undefined ? '' : String(value);
  if (formulaSafe && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toReferralRow(r: ReferralListRow): ReferralRow {
  const paid = r.creditsAwarded > 0;
  return {
    id: r.uuid,
    createdAt: r.createdAt.toISOString(),
    refereeName: r.refereeName,
    refereeEmail: r.refereeEmail,
    codeUsed: r.codeUsed,
    creditsAwardedMinor: r.creditsAwarded,
    status: paid ? 'paid' : 'pending',
    walletTxId: r.walletTxUuid,
  };
}

/**
 * The signed-in user's affiliate data (WD-CPN-029, 035, 036, 037): their code and link, the referrals they brought, what those
 * paid out, and the dashboard over a range. Own data only (the route has no permission key, like `/me/locale`): every query is
 * scoped to the caller's workspace AND user, taken from the request context and never from the request.
 */
@Injectable()
export class ReferralService {
  private readonly webUrl: string;

  constructor(
    private readonly store: CpnStore,
    private readonly codes: ReferralCodeService,
    private readonly repo: ReferralRepository,
    private readonly settings: WalletSettingsService,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  private caller(): Referrer {
    const ctx = RequestContextStore.require();
    return { orgId: ctx.orgId, userId: ctx.userId as number };
  }

  private link(code: string): string {
    return `${this.webUrl}/register?ref=${encodeURIComponent(code)}`;
  }

  /** GET /me/referral (the account tab): code, link, reward, true lifetime and 30-day counts, and the 50 newest. */
  async overview(now = new Date()): Promise<ReferralOverview> {
    const who = this.caller();
    const eco = await this.settings.effective();
    const since30d = new Date(now.getTime() - 30 * DAY_MS);
    return this.store.tx(async (tx) => {
      const { code } = await this.codes.ensureIn(tx, who.orgId, who.userId);
      const [stats, recent] = await Promise.all([
        this.repo.stats(tx, who, { start: since30d, previousStart: since30d, since30d }),
        this.repo.recent(tx, who, REFERRAL_RECENT_LIMIT),
      ]);
      return {
        currency: eco.currency,
        code,
        link: this.link(code),
        rewardMinor: eco.referralSignupMinor,
        messagePriceMinor: eco.flatPriceMinor,
        payPerMessage: eco.payPerMessage,
        lifetimeCount: stats.signupsLifetime,
        last30dCount: stats.signups30d,
        earnedMinor: stats.creditsEarnedMinor,
        recent: recent.map(toReferralRow),
      };
    });
  }

  /** GET /me/referrals (the history dashboard): one page of the table plus stats, chart, top codes and payouts. */
  async list(q: ReferralListParams, now = new Date()): Promise<ReferralListResponse> {
    const who = this.caller();
    const eco = await this.settings.effective();
    const window = rangeWindow(q.range, now);
    // A bucket the request names is always honoured: WaDesk's page left it out for "daily" and the server then answered with
    // its own default, so choosing Daily on 90 days returned weekly data.
    const bucket = q.bucket ?? defaultBucket(q.range);
    const starts = bucketStarts(bucket, q.range, now);
    const search = q.q && q.q.length > 0 ? q.q : null;

    return this.store.tx(async (tx) => {
      const { code } = await this.codes.ensureIn(tx, who.orgId, who.userId);
      const [page, total, stats, volume, topCodes, payouts] = await Promise.all([
        this.repo.page(tx, who, {
          from: window.start,
          q: search,
          cursor: q.cursor,
          limit: q.limit,
        }),
        this.repo.total(tx, who, window.start, search),
        this.repo.stats(tx, who, {
          start: window.start,
          previousStart: window.previousStart,
          since30d: new Date(now.getTime() - 30 * DAY_MS),
        }),
        this.repo.volume(tx, who, bucket, starts[0]!),
        this.repo.topCodes(tx, who, window.start, REFERRAL_TOP_CODES_LIMIT),
        this.repo.payouts(tx, who, REFERRAL_PAYOUTS_LIMIT),
      ]);
      const hasMore = page.rows.length > q.limit;
      const rows = hasMore ? page.rows.slice(0, q.limit) : page.rows;
      const last = rows[rows.length - 1];
      return {
        currency: eco.currency,
        code,
        link: this.link(code),
        rewardMinor: eco.referralSignupMinor,
        messagePriceMinor: eco.flatPriceMinor,
        payPerMessage: eco.payPerMessage,
        filters: { range: q.range, bucket, q: search },
        data: rows.map(toReferralRow),
        page: {
          nextCursor:
            hasMore && last
              ? encodeCursor({
                  createdAt: last.createdAt,
                  id: last.id,
                  createdAtIso: last.createdAtIso,
                })
              : null,
          hasMore,
          limit: q.limit,
          total,
        },
        stats: {
          ...stats,
          deltaPercent: deltaPercent(stats.signupsInRange, stats.signupsPrevious),
        },
        volume: fillSeries(starts, volume),
        topCodes,
        payouts: payouts.map((p) => ({
          id: p.uuid,
          amountMinor: p.amountMinor,
          createdAt: p.createdAt.toISOString(),
          balanceAfterMinor: p.balanceAfterMinor,
        })),
      };
    });
  }

  /**
   * GET /me/referrals/export (WD-CPN-036): the range as a CSV, newest first, UTF-8 with a BOM. The search text is NOT applied
   * (WaDesk's export ignored it as well). Streamed in keyset batches so a big account never sits in memory.
   */
  exportCsv(q: ReferralExportQuery, now = new Date()): { stream: Readable; fileName: string } {
    const who = this.caller();
    const from = rangeWindow(q.range, now).start;
    const store = this.store;
    const repo = this.repo;
    async function* lines(): AsyncGenerator<string> {
      yield `${BOM}${REFERRAL_CSV_COLUMNS.join(',')}\r\n`;
      let cursor: string | undefined;
      let sent = 0;
      while (sent < EXPORT_MAX_ROWS) {
        const page = await store.tx((tx) =>
          repo.page(tx, who, { from, q: null, cursor, limit: EXPORT_BATCH }),
        );
        const hasMore = page.rows.length > EXPORT_BATCH;
        const rows = hasMore ? page.rows.slice(0, EXPORT_BATCH) : page.rows;
        if (rows.length > 0) {
          yield rows
            .map((r) =>
              [
                csvCell(r.uuid),
                csvCell(r.createdAt.toISOString()),
                csvCell(r.refereeName, true),
                csvCell(r.refereeEmail, true),
                csvCell(r.codeUsed, true),
                csvCell(r.creditsAwarded),
                csvCell(r.walletTxUuid),
              ].join(','),
            )
            .join('\r\n')
            .concat('\r\n');
        }
        sent += rows.length;
        const last = rows[rows.length - 1];
        if (!hasMore || !last) return;
        cursor = encodeCursor({
          createdAt: last.createdAt,
          id: last.id,
          createdAtIso: last.createdAtIso,
        });
      }
    }
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return { stream: Readable.from(lines()), fileName: `affiliate-history-${stamp}.csv` };
  }
}
