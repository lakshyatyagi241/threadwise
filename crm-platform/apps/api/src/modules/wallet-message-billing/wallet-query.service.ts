import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { WALLET_CATEGORIES } from '@crm/contracts';
import type {
  MessagePricing,
  StatementQuery,
  StatementResponse,
  StatementRow,
  WalletLedgerQuery,
  WalletLedgerResponse,
  WalletSnapshot,
  WalletSummary,
  WalletTransaction,
  WalletTxType,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { BillingModeService } from '../bsp-billing-engine';
import { PlanEntitlementService, resolveLimit } from '../plans-subscriptions-trials';
import { pgArray } from './pg-array';
import { BillingCurrencyService } from './billing-currency.service';
import { RateCardService } from './rate-card.service';
import {
  LEDGER_COLUMNS,
  WalletRepository,
  decimalToMinor,
  inUnit,
  toLedger,
  type LedgerRow,
} from './wallet.repository';
import { WalletSettingsService } from './wallet-settings.service';
import { CHANNEL_LABELS, ENGINE_LABELS, monthStart, planIsActive } from './wallet-rules';

const TOPUP_URL = '/billing/checkout/wallet';

/** Keyset cursor over (created_at, id), newest first. */
export function encodeCursor(at: Date, id: number): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}
export function decodeCursor(cursor: string | undefined): { at: string; id: number } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!at || !id || Number.isNaN(Date.parse(at)) || !/^\d+$/.test(id)) return null;
    return { at, id: Number(id) };
  } catch {
    return null;
  }
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export function toTransaction(r: LedgerRow): WalletTransaction {
  return {
    id: r.uuid,
    type: r.type as WalletTxType,
    direction: r.direction,
    amountMinor: r.amountMinor,
    balanceAfterMinor: r.balanceAfterMinor,
    source: r.source,
    description: r.description,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  };
}

interface ChargeContext {
  wamid: string;
  provider: string | null;
  country: string | null;
  category: string | null;
  source: string | null;
}

/**
 * The customer's reads of their own wallet: the summary behind the balance chip and the wallet tab, the ledger, the statement
 * with its totals and per-message context, and the price panel (WD-WALLET-020, -021, -023, -024, -025). The wallet is the
 * WORKSPACE's, not the signed-in user's (WaDesk showed each member their personal balance in some places and the owner's in
 * others, WD-WALLET-023 rule 2): every member sees the same number.
 */
@Injectable()
export class WalletQueryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WalletRepository,
    private readonly settings: WalletSettingsService,
    private readonly rates: RateCardService,
    private readonly billing: BillingCurrencyService,
    private readonly plans: PlanEntitlementService,
    private readonly mode: BillingModeService,
  ) {}

  async summary(): Promise<WalletSummary> {
    const orgId = RequestContextStore.require().orgId;
    const [s, entitlements] = await Promise.all([
      this.settings.effective(),
      this.plans.forOrg(orgId),
    ]);
    const now = new Date();
    const data = await this.db.tx(async (tx) => {
      // The workspace's wallet is the one in its billing currency (USD, INR, ...); everything below is read in that currency.
      const unit = await this.billing.forOrg(tx, orgId);
      const wallet = await this.repo.peekWallet(tx, orgId, unit);
      const totals = await tx.execute(sql`
        SELECT
          COALESCE(-sum(amount) FILTER (WHERE type = 'spend'), 0)::text AS spent,
          COALESCE(sum(amount) FILTER (WHERE type = 'earn'), 0)::text AS earned,
          COALESCE(sum(amount) FILTER (WHERE type = 'topup'), 0)::text AS topped,
          COALESCE(sum(amount) FILTER (WHERE type = 'refund'), 0)::text AS refunded
        FROM wallet_transactions
        WHERE org_id = ${orgId} AND ${inUnit(unit, s.currency)} AND created_at >= now() - interval '30 days'`);
      const used = await tx.execute(sql`
        SELECT messages FROM wallet_usage_months WHERE org_id = ${orgId} AND month = ${monthStart(now)}::date`);
      const t = totals.rows[0] as {
        spent: string;
        earned: string;
        topped: string;
        refunded: string;
      };
      return {
        balance: wallet?.balanceMinor ?? 0,
        spent: decimalToMinor(t.spent),
        earned: decimalToMinor(t.earned),
        topped: decimalToMinor(t.topped),
        refunded: decimalToMinor(t.refunded),
        used: Number((used.rows[0] as { messages?: number } | undefined)?.messages ?? 0),
        payPerMessage: await this.mode.isPayPerMessage(tx, orgId),
        unit,
        // The flat price and the low-balance threshold are set in the platform currency.
        flat: await this.billing.fromPlatform(s.flatPriceMinor, unit),
        threshold: await this.billing.fromPlatform(s.lowBalanceThresholdMinor, unit),
      };
    });
    const flat = data.flat;
    return {
      currency: data.unit,
      balanceMinor: data.balance,
      billingMode: data.payPerMessage ? 'wallet' : 'plan',
      perCountryEnabled: s.perCountryEnabled,
      flatPriceMinor: flat,
      approxMessages: !s.perCountryEnabled && flat > 0 ? Math.floor(data.balance / flat) : null,
      spent30dMinor: data.spent,
      earned30dMinor: data.earned,
      toppedUp30dMinor: data.topped,
      refunded30dMinor: data.refunded,
      lowBalanceThresholdMinor: data.threshold,
      lowBalance: data.threshold > 0 && data.balance <= data.threshold,
      plan: {
        monthlyMessagesLimit: entitlements ? resolveLimit(entitlements, 'monthly_messages') : 0,
        usedThisMonth: data.used,
        active: entitlements ? planIsActive(entitlements, now) : true,
        endsAt:
          entitlements?.planEndsAt?.toISOString() ??
          entitlements?.trialEndsAt?.toISOString() ??
          null,
      },
      topupUrl: TOPUP_URL,
    };
  }

  /** The currency this workspace is billed in, which is the currency of every figure on its wallet screens and exports. */
  async billingCurrency(): Promise<string> {
    const orgId = RequestContextStore.require().orgId;
    return this.db.tx((tx) => this.billing.forOrg(tx, orgId));
  }

  async ledger(query: WalletLedgerQuery): Promise<WalletLedgerResponse> {
    const orgId = RequestContextStore.require().orgId;
    const cur = decodeCursor(query.cursor);
    const platform = await this.settings.currency();
    const rows = await this.db.tx(async (tx) => {
      const unit = await this.billing.forOrg(tx, orgId);
      const res = await tx.execute(sql`
        SELECT ${LEDGER_COLUMNS} FROM wallet_transactions
        WHERE org_id = ${orgId} AND ${inUnit(unit, platform)}
          ${cur ? sql`AND (created_at, id) < (${cur.at}::timestamptz, ${cur.id})` : sql``}
        ORDER BY created_at DESC, id DESC LIMIT ${query.limit + 1}`);
      return (res.rows as unknown as Parameters<typeof toLedger>[0][]).map(toLedger);
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      data: page.map(toTransaction),
      page: {
        nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        hasMore,
        limit: query.limit,
      },
    };
  }

  /** The mobile app's and the extension's one-call view (WD-WALLET-025, -029). */
  async snapshot(): Promise<WalletSnapshot> {
    const orgId = RequestContextStore.require().orgId;
    const s = await this.summary();
    const platform = await this.settings.currency();
    const spent = await this.db.tx((tx) =>
      tx.execute(sql`
        SELECT COALESCE(sum(revenue_minor), 0)::text AS spent FROM usage_charges
        WHERE org_id = ${orgId} AND status = 'charged' AND COALESCE(currency, ${platform}) = ${s.currency}
          AND created_at >= ${monthStart(new Date())}::date`),
    );
    const buffer = s.flatPriceMinor > 0 ? Math.floor(s.balanceMinor / s.flatPriceMinor) : 0;
    const limit = s.plan.monthlyMessagesLimit;
    const unlimited = limit <= 0;
    return {
      billingMode: s.billingMode,
      currency: s.currency,
      balanceMinor: s.balanceMinor,
      flatPriceMinor: s.flatPriceMinor,
      messagesRemaining:
        s.billingMode === 'wallet'
          ? buffer
          : unlimited
            ? -1
            : Math.max(0, limit - s.plan.usedThisMonth),
      walletBufferMessages: s.billingMode === 'plan' ? buffer : null,
      spentThisMonthMinor: Number((spent.rows[0] as { spent: string }).spent),
      planActive: s.plan.active,
      monthlyMessagesLimit: limit,
      usedThisMonth: s.plan.usedThisMonth,
    };
  }

  // --- the statement ---------------------------------------------------------------------------------------------------------

  private filter(orgId: number, q: StatementQuery, unitScope: ReturnType<typeof inUnit>) {
    const parts = [sql`org_id = ${orgId}`, unitScope];
    if (q.type !== 'all') parts.push(sql`type = ${q.type}`);
    // Inclusive day boundaries (UTC), as WaDesk's start-of-from-day and end-of-to-day.
    if (q.from) parts.push(sql`created_at >= ${q.from}::date`);
    if (q.to) parts.push(sql`created_at < (${q.to}::date + 1)`);
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      parts.push(sql`(description ILIKE ${like} OR source ILIKE ${like} OR note ILIKE ${like})`);
    }
    return sql.join(parts, sql` AND `);
  }

  async statement(query: StatementQuery): Promise<StatementResponse> {
    const orgId = RequestContextStore.require().orgId;
    const cur = decodeCursor(query.cursor);
    const s = await this.settings.effective();
    return this.db.tx(async (tx) => {
      const unit = await this.billing.forOrg(tx, orgId);
      const where = this.filter(orgId, query, inUnit(unit, s.currency));
      const wallet = await this.repo.peekWallet(tx, orgId, unit);
      const sums = await tx.execute(sql`
        SELECT count(*)::int AS n,
               COALESCE(sum(amount) FILTER (WHERE amount > 0), 0)::text AS money_in,
               COALESCE(-sum(amount) FILTER (WHERE amount < 0), 0)::text AS money_out
        FROM wallet_transactions WHERE ${where}`);
      const t = sums.rows[0] as { n: number; money_in: string; money_out: string };
      const res = await tx.execute(sql`
        SELECT ${LEDGER_COLUMNS} FROM wallet_transactions
        WHERE ${where} ${cur ? sql`AND (created_at, id) < (${cur.at}::timestamptz, ${cur.id})` : sql``}
        ORDER BY created_at DESC, id DESC LIMIT ${query.limit + 1}`);
      const rows = (res.rows as unknown as Parameters<typeof toLedger>[0][]).map(toLedger);
      const hasMore = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit);
      const contexts = await this.contexts(tx, orgId, pageRows);
      const moneyIn = decimalToMinor(t.money_in);
      const moneyOut = decimalToMinor(t.money_out);
      const last = pageRows[pageRows.length - 1];
      return {
        currency: unit,
        summary: {
          currentBalanceMinor: wallet?.balanceMinor ?? 0,
          moneyInMinor: moneyIn,
          moneyOutMinor: moneyOut,
          netMinor: moneyIn - moneyOut,
          count: t.n,
        },
        data: pageRows.map<StatementRow>((r) => ({
          ...toTransaction(r),
          moneyInMinor: r.amountMinor > 0 ? r.amountMinor : 0,
          moneyOutMinor: r.amountMinor < 0 ? -r.amountMinor : 0,
          context: contexts.get(r.id) ?? null,
        })),
        page: {
          nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  /** Oldest first, in chunks, for the CSV (WD-WALLET-022). Rows are plain; money formatting is the caller's. */
  async *exportRows(query: StatementQuery, maxRows: number): AsyncGenerator<StatementRow[]> {
    const orgId = RequestContextStore.require().orgId;
    const platform = await this.settings.currency();
    const unit = await this.db.tx((tx) => this.billing.forOrg(tx, orgId));
    const where = this.filter(orgId, query, inUnit(unit, platform));
    let after: { at: string; id: number } | null = null;
    let sent = 0;
    while (sent < maxRows) {
      const take = Math.min(500, maxRows - sent);
      const rows: LedgerRow[] = await this.db.tx(async (tx) => {
        const res = await tx.execute(sql`
          SELECT ${LEDGER_COLUMNS} FROM wallet_transactions
          WHERE ${where} ${after ? sql`AND (created_at, id) > (${after.at}::timestamptz, ${after.id})` : sql``}
          ORDER BY created_at ASC, id ASC LIMIT ${take}`);
        return (res.rows as unknown as Parameters<typeof toLedger>[0][]).map(toLedger);
      });
      if (rows.length === 0) return;
      const contexts = await this.db.tx((tx) => this.contexts(tx, orgId, rows));
      yield rows.map<StatementRow>((r) => ({
        ...toTransaction(r),
        moneyInMinor: r.amountMinor > 0 ? r.amountMinor : 0,
        moneyOutMinor: r.amountMinor < 0 ? -r.amountMinor : 0,
        context: contexts.get(r.id) ?? null,
      }));
      sent += rows.length;
      const last = rows[rows.length - 1]!;
      after = { at: last.createdAt.toISOString(), id: last.id };
      if (rows.length < take) return;
    }
  }

  /** Channel, campaign/broadcast, recipient and template of each message charge or refund. Never fails the page. */
  private async contexts(
    tx: Tx,
    orgId: number,
    rows: LedgerRow[],
  ): Promise<Map<number, StatementRow['context']>> {
    const out = new Map<number, StatementRow['context']>();
    const spendIds = rows.filter((r) => r.type === 'spend').map((r) => r.id);
    const refundIds = rows.filter((r) => r.type === 'refund').map((r) => r.id);
    if (spendIds.length === 0 && refundIds.length === 0) return out;
    try {
      const res = await tx.execute(sql`
        SELECT c.wallet_tx_id AS tx_id, NULL::bigint AS refund_tx_id, c.wamid, c.provider, c.to_country AS country, c.category, c.source
        FROM usage_charges c WHERE c.org_id = ${orgId} AND c.wallet_tx_id = ANY(${pgArray(spendIds, 'bigint')})
        UNION ALL
        SELECT NULL, c.refund_tx_id, c.wamid, c.provider, c.to_country, c.category, c.source
        FROM usage_charges c WHERE c.org_id = ${orgId} AND c.refund_tx_id = ANY(${pgArray(refundIds, 'bigint')})`);
      const byTx = new Map<number, ChargeContext>();
      for (const r of res.rows as unknown as Array<
        ChargeContext & { tx_id: string | null; refund_tx_id: string | null }
      >) {
        byTx.set(Number(r.tx_id ?? r.refund_tx_id), r);
      }
      const wamids = [...byTx.values()].map((c) => c.wamid);
      const names = await this.names(tx, orgId, wamids);
      for (const [txId, c] of byTx) {
        const n = names.get(c.wamid);
        out.set(txId, {
          channel: c.source ? (CHANNEL_LABELS[c.source] ?? c.source) : null,
          campaignName: n?.name ?? null,
          recipient: n?.phone ?? null,
          template: n?.template ?? null,
          country: c.country,
          category: c.category,
          engine: c.provider ? (ENGINE_LABELS[c.provider] ?? c.provider) : null,
        });
      }
    } catch {
      // Context is a nicety: a missing table or a bad row never breaks the statement.
    }
    return out;
  }

  private async names(
    tx: Tx,
    orgId: number,
    wamids: string[],
  ): Promise<Map<string, { name: string | null; phone: string | null; template: string | null }>> {
    const out = new Map<
      string,
      { name: string | null; phone: string | null; template: string | null }
    >();
    if (wamids.length === 0) return out;
    const bc = await tx.execute(sql`
      SELECT bc.whatsapp_message_id AS wamid, b.name, c.phone, t.template_name AS template
      FROM broadcast_contacts bc
      JOIN broadcasts b ON b.org_id = bc.org_id AND b.id = bc.broadcast_id
      LEFT JOIN contacts c ON c.org_id = bc.org_id AND c.id = bc.contact_id
      LEFT JOIN wa_templates t ON t.org_id = b.org_id AND t.id = b.template_id
      WHERE bc.org_id = ${orgId} AND bc.whatsapp_message_id = ANY(${pgArray(wamids, 'text')})`);
    for (const r of bc.rows as unknown as Array<{
      wamid: string;
      name: string;
      phone: string | null;
      template: string | null;
    }>) {
      out.set(r.wamid, { name: r.name, phone: r.phone, template: r.template });
    }
    const cc = await tx.execute(sql`
      SELECT cc.whatsapp_message_id AS wamid, w.campaign_name AS name, COALESCE(cc.phone_number, c.phone) AS phone, t.template_name AS template
      FROM wp_campaign_contacts cc
      JOIN wpcampaigns w ON w.org_id = cc.org_id AND w.id = cc.campaign_id
      LEFT JOIN contacts c ON c.org_id = cc.org_id AND c.id = cc.contact_id
      LEFT JOIN wa_templates t ON t.org_id = w.org_id AND t.id = w.template_id
      WHERE cc.org_id = ${orgId} AND cc.whatsapp_message_id = ANY(${pgArray(wamids, 'text')})`);
    for (const r of cc.rows as unknown as Array<{
      wamid: string;
      name: string;
      phone: string | null;
      template: string | null;
    }>) {
      if (!out.has(r.wamid))
        out.set(r.wamid, { name: r.name, phone: r.phone, template: r.template });
    }
    return out;
  }

  // --- prices ----------------------------------------------------------------------------------------------------------------

  async pricing(country: string | undefined): Promise<MessagePricing> {
    const orgId = RequestContextStore.require().orgId;
    const s = await this.settings.effective();
    return this.db.tx(async (tx) => {
      const unit = await this.billing.forOrg(tx, orgId);
      const payPerMessage = await this.mode.isPayPerMessage(tx, orgId);
      // The price of each category in the workspace's own currency, by the same resolver that charges a message.
      const categories = [];
      for (const category of WALLET_CATEGORIES) {
        const { priceMinor } = await this.rates.priceFor(
          tx,
          orgId,
          country ?? null,
          category,
          unit,
        );
        categories.push({ category, priceMinor, free: priceMinor <= 0 });
      }
      return {
        billingMode: payPerMessage ? 'wallet' : 'plan',
        perCountryEnabled: s.perCountryEnabled,
        currency: unit,
        categories,
        country: country ?? null,
      };
    });
  }
}
