import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { BspAllocationStatus } from '@crm/contracts';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { PlatformStore } from '../auth';
import type { AllocationRow } from './reseller.repository';

/** An allocation as the operator's register sees it: the row plus the workspace it belongs to. */
export interface PlatformAllocationRow extends AllocationRow {
  org_uuid: string;
  org_name: string;
  bills_to_platform: boolean;
}

export interface WabaCandidateRow {
  org_uuid: string;
  org_name: string;
  phone_number: string | null;
  display_label: string | null;
  waba_id: string;
  allocation_status: BspAllocationStatus | null;
  currency: string | null;
}

export interface PendingAttachment {
  orgId: number;
  wabaId: string;
  currency: string | null;
}

export interface DashboardRows {
  totals: {
    billed: number;
    free: number;
    revenue: string;
    cost: string;
    unpriced: number;
    walletFloat: string;
  };
  workspaces: Array<{
    org_uuid: string;
    org_name: string;
    billed: number;
    revenue: string;
    cost: string;
    wallet_balance: string;
  }>;
  /** Every currency with charges in the window or money in a wallet. */
  currencies: string[];
  hasMore: boolean;
  exponent: number;
}

const ALLOCATION_COLUMNS = sql`a.org_id, a.id, a.uuid, a.waba_id, a.allocation_config_id, a.credit_source, a.currency, a.status,
  a.last_error, a.attached_at, a.revoked_at, a.created_by_operator_id, a.created_at, a.updated_at, a.row_version,
  o.uuid AS org_uuid, o.name AS org_name, COALESCE(ws.bill_to_platform_credit, false) AS bills_to_platform,
  to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso`;

/**
 * Every read of this domain that spans organizations: the operator's register, the WABA picker, the attach batches and the
 * reseller P&L. They go through `PlatformStore`, the auth module's single door to cross-tenant data; this file never calls
 * the privileged escape hatch itself (a unit test greps the zone for it) and never writes. Every write the module makes is tenant scoped.
 */
@Injectable()
export class ResellerPlatformReader {
  constructor(private readonly store: PlatformStore) {}

  async allocationCount(): Promise<number> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`SELECT count(*)::int AS n FROM bsp_credit_allocations`);
      return (res.rows[0] as unknown as { n: number }).n;
    });
  }

  async orgByUuid(uuid: string): Promise<{ id: number; uuid: string; name: string } | null> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, uuid, name FROM organizations WHERE uuid = ${uuid}`,
      );
      return (
        (res.rows[0] as unknown as { id: number; uuid: string; name: string } | undefined) ?? null
      );
    });
  }

  async allocationByUuid(uuid: string): Promise<PlatformAllocationRow | null> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${ALLOCATION_COLUMNS}
        FROM bsp_credit_allocations a
        JOIN organizations o ON o.id = a.org_id
        LEFT JOIN workspace_settings ws ON ws.org_id = a.org_id
        WHERE a.uuid = ${uuid}
      `);
      return (res.rows[0] as unknown as PlatformAllocationRow | undefined) ?? null;
    });
  }

  /** Newest first by keyset (created_at, id): rows are never deleted, so a page boundary cannot move under the reader. */
  async listAllocations(opts: {
    limit: number;
    cursor?: string;
    status?: BspAllocationStatus;
  }): Promise<{ rows: PlatformAllocationRow[]; nextCursor: string | null; hasMore: boolean }> {
    const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
    const rows = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${ALLOCATION_COLUMNS}
        FROM bsp_credit_allocations a
        JOIN organizations o ON o.id = a.org_id
        LEFT JOIN workspace_settings ws ON ws.org_id = a.org_id
        WHERE true
          ${opts.status ? sql`AND a.status = ${opts.status}` : sql``}
          ${
            cursor
              ? sql`AND (a.created_at, a.id) < (${cursor.createdAtIso ?? cursor.createdAt.toISOString()}::timestamptz, ${cursor.id})`
              : sql``
          }
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${opts.limit + 1}
      `);
      return res.rows as unknown as Array<PlatformAllocationRow & { created_at_iso: string }>;
    });
    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              createdAt: new Date(last.created_at),
              id: Number(last.id),
              createdAtIso: last.created_at_iso,
            })
          : null,
    };
  }

  /**
   * Connected Cloud API numbers of every workspace, newest connection first. Reference also listed pending and disconnected rows
   * (TW-BSP-003 rule 1); a number that is not connected cannot be billed, so it is left out.
   */
  async wabaCandidates(limit = 500): Promise<WabaCandidateRow[]> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT * FROM (
          SELECT DISTINCT ON (c.org_id, c.meta_json->>'waba_id')
                 o.uuid AS org_uuid, o.name AS org_name, c.phone_number, c.display_label,
                 c.meta_json->>'waba_id' AS waba_id, a.status AS allocation_status, ws.currency,
                 c.created_at, c.id
          FROM wa_provider_configs c
          JOIN organizations o ON o.id = c.org_id
          LEFT JOIN workspace_settings ws ON ws.org_id = c.org_id
          LEFT JOIN bsp_credit_allocations a ON a.org_id = c.org_id AND a.waba_id = c.meta_json->>'waba_id'
          WHERE c.provider = 'waba' AND c.status = 'connected' AND COALESCE(c.meta_json->>'waba_id', '') <> ''
          ORDER BY c.org_id, c.meta_json->>'waba_id', c.id
        ) x
        ORDER BY x.created_at DESC, x.id DESC
        LIMIT ${limit}
      `);
      return res.rows as unknown as WabaCandidateRow[];
    });
  }

  /**
   * The connected numbers of RESELLER workspaces that still need a credit line. `onlyNew` is the auto-attach rule: never tried
   * (a failed or revoked row is left alone, so a saved config cannot hit Meta twice, TW-BSP-008 rule 2). Without it every number
   * not currently attached qualifies: that is "Attach all", the retry path. A workspace on direct billing is not attached
   * at all: attaching makes Meta bill the platform for a customer who pays Meta (TW-BSP-007 rule 5, fixed here).
   */
  async pendingAttachments(opts: { onlyNew: boolean; limit: number }): Promise<{
    items: PendingAttachment[];
    total: number;
    alreadyAttached: number;
  }> {
    return this.store.tx(async (tx) => {
      const base = sql`
        FROM wa_provider_configs c
        JOIN workspace_settings ws ON ws.org_id = c.org_id AND ws.bill_to_platform_credit
        LEFT JOIN bsp_credit_allocations a ON a.org_id = c.org_id AND a.waba_id = c.meta_json->>'waba_id'
        WHERE c.provider = 'waba' AND c.status = 'connected' AND COALESCE(c.meta_json->>'waba_id', '') <> ''
      `;
      const pending = this.onlyNewOrNotAttached(opts.onlyNew);
      const items = await tx.execute(sql`
        SELECT DISTINCT ON (c.org_id, c.meta_json->>'waba_id')
               c.org_id, c.meta_json->>'waba_id' AS waba_id, ws.currency
        ${base} AND ${pending}
        ORDER BY c.org_id, c.meta_json->>'waba_id'
        LIMIT ${opts.limit}
      `);
      const total = await tx.execute(sql`
        SELECT count(DISTINCT (c.org_id, c.meta_json->>'waba_id'))::int AS n ${base} AND ${pending}
      `);
      const attached = await tx.execute(sql`
        SELECT count(DISTINCT (c.org_id, c.meta_json->>'waba_id'))::int AS n ${base} AND a.status = 'attached'
      `);
      return {
        items: (
          items.rows as unknown as Array<{
            org_id: number;
            waba_id: string;
            currency: string | null;
          }>
        ).map((r) => ({ orgId: Number(r.org_id), wabaId: r.waba_id, currency: r.currency })),
        total: (total.rows[0] as unknown as { n: number }).n,
        alreadyAttached: (attached.rows[0] as unknown as { n: number }).n,
      };
    });
  }

  private onlyNewOrNotAttached(onlyNew: boolean) {
    return onlyNew ? sql`a.id IS NULL` : sql`(a.id IS NULL OR a.status <> 'attached')`;
  }

  /**
   * The month's reseller P&L (TW-BSP-014, -015). Only `charged` rows count: `free` and `refunded` messages never reach revenue.
   * An unknown Meta cost sums as 0 (margin = revenue for it) and is counted separately so the page can say so.
   *
   * Money leaves SQL as a decimal string already divided by the currency's minor-unit exponent, so no JS number ever holds an
   * amount. The window is half open and bound on `created_at`, the partition key, so only the month's partitions are read.
   */
  async dashboard(opts: {
    from: Date;
    to: Date;
    currency: string;
    /** What a charge with no currency was made in. */
    legacyCurrency: string;
    limit: number;
  }): Promise<DashboardRows> {
    return this.store.tx(async (tx) => {
      const precision = await tx.execute(
        sql`SELECT precision FROM currencies WHERE code = ${opts.currency}`,
      );
      const exponent = Number(
        (precision.rows[0] as { precision?: number } | undefined)?.precision ?? 2,
      );
      const major = (col: ReturnType<typeof sql>) =>
        sql`round((${col})::numeric / power(10::numeric, ${exponent}::int), ${exponent}::int)::text`;

      const totals = await tx.execute(sql`
        SELECT count(*) FILTER (WHERE status = 'charged')::int AS billed,
               count(*) FILTER (WHERE status = 'free')::int AS free,
               ${major(sql`COALESCE(sum(revenue_minor) FILTER (WHERE status = 'charged'), 0)`)} AS revenue,
               ${major(sql`COALESCE(sum(cost_minor) FILTER (WHERE status = 'charged'), 0)`)} AS cost,
               count(*) FILTER (WHERE status = 'charged' AND cost_minor IS NULL)::int AS unpriced
        FROM usage_charges
        WHERE created_at >= ${opts.from.toISOString()}::timestamptz AND created_at < ${opts.to.toISOString()}::timestamptz
          AND COALESCE(currency, ${opts.legacyCurrency}) = ${opts.currency}
      `);
      // wallets.balance is a major-unit amount in the wallet's currency (one wallet per workspace, unit = the platform
      // currency): confirmed against the WALLET engine (wallet-message-billing, TW-WALLET-001).
      const float = await tx.execute(sql`
        SELECT round(COALESCE(sum(balance), 0), ${exponent}::int)::text AS float FROM wallets WHERE unit = ${opts.currency}
      `);
      const per = await tx.execute(sql`
        SELECT o.uuid AS org_uuid, o.name AS org_name, g.billed,
               ${major(sql`g.revenue`)} AS revenue, ${major(sql`g.cost`)} AS cost,
               round(COALESCE(w.balance, 0), ${exponent}::int)::text AS wallet_balance
        FROM (
          SELECT org_id, count(*)::int AS billed, COALESCE(sum(revenue_minor), 0) AS revenue,
                 COALESCE(sum(cost_minor), 0) AS cost
          FROM usage_charges
          WHERE status = 'charged'
            AND created_at >= ${opts.from.toISOString()}::timestamptz AND created_at < ${opts.to.toISOString()}::timestamptz
            AND COALESCE(currency, ${opts.legacyCurrency}) = ${opts.currency}
          GROUP BY org_id
        ) g
        JOIN organizations o ON o.id = g.org_id
        LEFT JOIN wallets w ON w.org_id = g.org_id AND w.unit = ${opts.currency}
        ORDER BY g.revenue DESC, g.org_id
        LIMIT ${opts.limit + 1}
      `);

      const used = await tx.execute(sql`
        SELECT DISTINCT cur FROM (
          SELECT COALESCE(currency, ${opts.legacyCurrency}) AS cur FROM usage_charges
          WHERE created_at >= ${opts.from.toISOString()}::timestamptz AND created_at < ${opts.to.toISOString()}::timestamptz
          UNION SELECT unit FROM wallets
          UNION SELECT ${opts.legacyCurrency}
          UNION SELECT ${opts.currency}
        ) c ORDER BY cur`);
      const t = totals.rows[0] as unknown as {
        billed: number;
        free: number;
        revenue: string;
        cost: string;
        unpriced: number;
      };
      const rows = per.rows as unknown as DashboardRows['workspaces'];
      return {
        totals: {
          billed: t.billed,
          free: t.free,
          revenue: t.revenue,
          cost: t.cost,
          unpriced: t.unpriced,
          walletFloat: (float.rows[0] as unknown as { float: string }).float,
        },
        workspaces: rows.slice(0, opts.limit),
        hasMore: rows.length > opts.limit,
        currencies: (used.rows as unknown as Array<{ cur: string }>).map((r) => r.cur),
        exponent,
      };
    });
  }
}
