import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  walletExactAmount,
  walletExactSubtract,
  type ExpenseEvent,
  type ExpenseFilter,
  type ExpenseFreeReason,
  type ExpenseGroup,
  type ExpenseGroupBy,
  type ExpenseListQuery,
  type ExpenseListResponse,
  type ExpenseStatus,
  type ExpenseSummaryQuery,
  type ExpenseSummaryResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { BillingCurrencyService } from './billing-currency.service';
import { decimalToMinor } from './wallet.repository';
import { WalletSettingsService } from './wallet-settings.service';

/** The summary shows this many groups, largest first; the response says when there were more. */
const MAX_GROUPS = 200;

/** The team inbox's sends are "chat" to the customer, so one group and one filter cover both sources. */
const CHANNEL = sql`CASE WHEN uc.source = 'inbox' THEN 'chat' ELSE uc.source END`;

/**
 * What each summary groups by (`group`) and the value it shows (`label`). Fixed here, never taken from the request, so the SQL is not
 * built from input. A template is grouped case-insensitively, as its filter matches it, and shown as one of its spellings.
 */
const GROUP_KEY: Record<ExpenseGroupBy, { group: SQL; label: SQL }> = {
  template: {
    group: sql`lower(COALESCE(uc.template_name, legacy.template_name))`,
    label: sql`min(COALESCE(uc.template_name, legacy.template_name))`,
  },
  source: { group: CHANNEL, label: CHANNEL },
  category: { group: sql`uc.category`, label: sql`uc.category` },
  country: { group: sql`uc.to_country`, label: sql`uc.to_country` },
  kind: { group: sql`uc.kind`, label: sql`uc.kind` },
};

/**
 * The customer's message expense log (one row per billable message) and its summary by template, channel, category or country.
 * Both read `usage_charges`, the same rows the statement's per-message lines come from, so a message shows the same amount in both.
 * Charged and refunded amounts are read from the ledger, not the charge row: the ledger keeps three and four decimals (5.956), the
 * charge row only hundredths.
 */
@Injectable()
export class WalletExpensesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly billing: BillingCurrencyService,
    private readonly settings: WalletSettingsService,
  ) {}

  async list(query: ExpenseListQuery): Promise<ExpenseListResponse> {
    const orgId = RequestContextStore.require().orgId;
    const cur = decodeCursor(query.cursor);
    const platform = await this.settings.currency();
    return this.db.tx(async (tx) => {
      const unit = await this.billing.forOrg(tx, orgId);
      const where = filterSql(orgId, query, unit, platform);
      const res = await tx.execute(sql`
        SELECT uc.id, uc.kind, uc.units, uc.created_at::text AS cursor_at, to_char(uc.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_iso, uc.wamid, uc.status,
               uc.billing_mode, uc.free_reason, uc.source, uc.provider, uc.to_country, uc.category,
               COALESCE(uc.template_name, legacy.template_name) AS template_name,
               COALESCE(uc.subject_name, legacy.subject_name) AS subject_name, uc.shortfall_credits, to_char(uc.refunded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS refunded_iso,
               (-ch.amount)::text AS charged_exact, rf.amount::text AS refunded_exact
          ${fromSql(where)}
          ${cur ? sql`AND (uc.created_at, uc.id) < (${cur.at}::timestamptz, ${cur.id})` : sql``}
         ORDER BY uc.created_at DESC, uc.id DESC
         LIMIT ${query.limit + 1}`);
      const rows = res.rows as unknown as ExpenseRow[];
      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        currency: unit,
        data: page.map(toEvent),
        page: {
          nextCursor: hasMore && last ? encodeCursor(last.cursor_at, last.id) : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  async summary(query: ExpenseSummaryQuery): Promise<ExpenseSummaryResponse> {
    const orgId = RequestContextStore.require().orgId;
    const platform = await this.settings.currency();
    return this.db.tx(async (tx) => {
      const unit = await this.billing.forOrg(tx, orgId);
      const from = fromSql(filterSql(orgId, query, unit, platform));
      const { group, label } = GROUP_KEY[query.groupBy];
      const res = await tx.execute(sql`
        SELECT ${label} AS key, ${countsSql}, ${totalsSql} ${from}
         GROUP BY ${group}
         ORDER BY COALESCE(sum(-ch.amount), 0) DESC, count(*) DESC, ${group} NULLS LAST
         LIMIT ${MAX_GROUPS + 1}`);
      const rows = res.rows as unknown as (GroupRow & TotalsRow)[];
      return {
        currency: unit,
        groupBy: query.groupBy,
        totals: toGroup(rows[0] ? totalsOf(rows[0]) : NO_TOTALS),
        groups: rows.slice(0, MAX_GROUPS).map((r) => ({ key: r.key, ...toGroup(r) })),
        truncated: rows.length > MAX_GROUPS,
      };
    });
  }
}

interface ExpenseRow {
  id: string | number;
  kind: ExpenseEvent['kind'];
  units: number;
  cursor_at: string;
  created_iso: string;
  wamid: string;
  status: ExpenseStatus;
  billing_mode: 'plan' | 'wallet';
  free_reason: ExpenseFreeReason | null;
  source: string | null;
  provider: string | null;
  to_country: string | null;
  category: string | null;
  template_name: string | null;
  subject_name: string | null;
  shortfall_credits: number;
  refunded_iso: string | null;
  charged_exact: string | null;
  refunded_exact: string | null;
}

interface GroupRow {
  key: string | null;
  messages: number;
  charged: number;
  refunded: number;
  free: number;
  charged_sum: string;
  refunded_sum: string;
}

interface TotalsRow {
  all_messages: number;
  all_charged: number;
  all_refunded: number;
  all_free: number;
  all_charged_sum: string;
  all_refunded_sum: string;
}

const NO_TOTALS: GroupRow = {
  key: null,
  messages: 0,
  charged: 0,
  refunded: 0,
  free: 0,
  charged_sum: '0',
  refunded_sum: '0',
};

function totalsOf(r: TotalsRow): GroupRow {
  return {
    key: null,
    messages: r.all_messages,
    charged: r.all_charged,
    refunded: r.all_refunded,
    free: r.all_free,
    charged_sum: r.all_charged_sum,
    refunded_sum: r.all_refunded_sum,
  };
}

/** The filters as SQL on `usage_charges` (alias `uc`). A charge with no currency predates per-currency billing: the platform's. */
function filterSql(orgId: number, q: ExpenseFilter, unit: string, platform: string): SQL {
  const parts: SQL[] = [
    sql`uc.org_id = ${orgId}`,
    sql`(uc.currency = ${unit} OR (uc.currency IS NULL AND ${unit} = ${platform}))`,
  ];
  if (q.status !== 'all') parts.push(sql`uc.status = ${q.status}`);
  if (q.from) parts.push(sql`uc.created_at >= ${q.from}::date`);
  if (q.to) parts.push(sql`uc.created_at < (${q.to}::date + 1)`);
  if (q.template)
    parts.push(sql`lower(COALESCE(uc.template_name, legacy.template_name)) = lower(${q.template})`);
  // Stored lowercased by the settle path, so the filter is too: an API caller's "Campaign" matches "campaign".
  if (q.source) parts.push(sourceSql(q.source.toLowerCase()));
  if (q.category) parts.push(sql`uc.category = ${q.category.toLowerCase()}`);
  if (q.kind) parts.push(sql`uc.kind = ${q.kind}`);
  return sql.join(parts, sql` AND `);
}

/** The team inbox's sends are "chat" to the customer (see GROUP_KEY), so the Chat filter takes both. */
function sourceSql(source: string): SQL {
  return source === 'chat' ? sql`uc.source IN ('chat', 'inbox')` : sql`uc.source = ${source}`;
}

/**
 * The charge with its ledger lines: the money out (shown positive) and the money back. Both joins are by the wallet row, not by id alone.
 * `legacy` is the name the statement shows for a message: the broadcast or campaign that holds it, found by its provider message id. It
 * is read only for a charge with no name on it (sent before the name was copied onto the charge).
 */
function fromSql(where: SQL): SQL {
  return sql`FROM usage_charges uc
    LEFT JOIN wallet_transactions ch ON ch.org_id = uc.org_id AND ch.id = uc.wallet_tx_id
    LEFT JOIN wallet_transactions rf ON rf.org_id = uc.org_id AND rf.id = uc.refund_tx_id
    LEFT JOIN LATERAL (
      SELECT n.template_name, n.subject_name FROM (
        SELECT t.template_name, b.name AS subject_name, 0 AS pref
          FROM broadcast_contacts bc
          JOIN broadcasts b ON b.org_id = bc.org_id AND b.id = bc.broadcast_id
          LEFT JOIN wa_templates t ON t.org_id = b.org_id AND t.id = b.template_id
         WHERE bc.org_id = uc.org_id AND bc.whatsapp_message_id = uc.wamid
        UNION ALL
        SELECT t.template_name, w.campaign_name, 1
          FROM wp_campaign_contacts cc
          JOIN wpcampaigns w ON w.org_id = cc.org_id AND w.id = cc.campaign_id
          LEFT JOIN wa_templates t ON t.org_id = w.org_id AND t.id = w.template_id
         WHERE cc.org_id = uc.org_id AND cc.whatsapp_message_id = uc.wamid
      ) n
      ORDER BY n.pref
      LIMIT 1
    ) legacy ON uc.kind = 'whatsapp_message' AND (uc.template_name IS NULL OR uc.subject_name IS NULL)
    WHERE ${where}`;
}

const countsSql = sql`
  count(*)::int AS messages,
  count(*) FILTER (WHERE uc.status <> 'free')::int AS charged,
  count(*) FILTER (WHERE uc.status = 'refunded')::int AS refunded,
  count(*) FILTER (WHERE uc.status = 'free')::int AS free,
  COALESCE(sum(-ch.amount), 0)::text AS charged_sum,
  COALESCE(sum(rf.amount), 0)::text AS refunded_sum`;

const totalsSql = sql`
  (sum(count(*)) OVER ())::int AS all_messages,
  (sum(count(*) FILTER (WHERE uc.status <> 'free')) OVER ())::int AS all_charged,
  (sum(count(*) FILTER (WHERE uc.status = 'refunded')) OVER ())::int AS all_refunded,
  (sum(count(*) FILTER (WHERE uc.status = 'free')) OVER ())::int AS all_free,
  (sum(COALESCE(sum(-ch.amount), 0)) OVER ())::text AS all_charged_sum,
  (sum(COALESCE(sum(rf.amount), 0)) OVER ())::text AS all_refunded_sum`;

function toEvent(r: ExpenseRow): ExpenseEvent {
  const charged = walletExactAmount(r.charged_exact);
  const refunded = walletExactAmount(r.refunded_exact);
  return {
    id: r.wamid,
    kind: r.kind,
    units: r.units,
    createdAt: r.created_iso,
    status: r.status,
    billingMode: r.billing_mode,
    freeReason: r.free_reason,
    source: r.source,
    engine: r.provider,
    country: r.to_country,
    category: r.category,
    template: r.template_name,
    subjectName: r.subject_name,
    chargedMinor: decimalToMinor(charged),
    chargedExact: charged,
    refundedMinor: decimalToMinor(refunded),
    refundedExact: refunded,
    netMinor: decimalToMinor(walletExactSubtract(charged, refunded)),
    netExact: walletExactSubtract(charged, refunded),
    uncollectedMinor: r.shortfall_credits,
    refundedAt: r.refunded_iso,
  };
}

function toGroup(r: GroupRow): Omit<ExpenseGroup, 'key'> {
  const charged = walletExactAmount(r.charged_sum);
  const refunded = walletExactAmount(r.refunded_sum);
  const net = walletExactSubtract(charged, refunded);
  return {
    messages: r.messages,
    charged: r.charged,
    refunded: r.refunded,
    free: r.free,
    chargedMinor: decimalToMinor(charged),
    chargedExact: charged,
    refundedMinor: decimalToMinor(refunded),
    refundedExact: refunded,
    netMinor: decimalToMinor(net),
    netExact: net,
  };
}

/**
 * Keyset cursor over (created_at, id). The timestamp is kept as the database's own text: a JS Date drops the microseconds the
 * partition key has, so a page boundary could skip or repeat a message. Same idea as the statement's cursor, which can use a Date
 * because its ledger rows are stored at millisecond precision.
 */
function encodeCursor(at: string, id: string | number): string {
  return Buffer.from(`${at}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: string; id: number } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!at || !id || !/^\d+$/.test(id)) return null;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:?\d{2})?$/.test(at)) return null;
  return { at, id: Number(id) };
}
