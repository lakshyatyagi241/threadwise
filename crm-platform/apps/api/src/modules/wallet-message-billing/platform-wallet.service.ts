import { HttpStatus, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  walletMajorToMinor,
  type AdjustWalletInput,
  type AdjustWalletResult,
  type PlatformWalletDetail,
  type PlatformWalletList,
  type PlatformWalletListQuery,
  type PlatformWalletOverview,
  type Reconciliation,
  type SetWorkspaceCurrencyInput,
  type SetWorkspaceCurrencyResult,
  type WalletLogList,
  type WalletLogQuery,
  type WalletLogRow,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService, PlatformStore } from '../auth';
import { BillingCurrencyService } from './billing-currency.service';
import { pgArray } from './pg-array';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletLogService } from './wallet-log.service';
import {
  LEDGER_COLUMNS,
  WalletRepository,
  decimalToMinor,
  inUnit,
  toLedger,
} from './wallet.repository';
import { WalletSettingsService } from './wallet-settings.service';
import { decodeCursor, encodeCursor, toTransaction } from './wallet-query.service';

export interface Operator {
  id: number;
  label: string;
}

/**
 * What a platform operator can do with workspaces' wallets: see them all, add or take money by hand with a reason, read the
 * trail, check that every balance still equals its ledger. Cross-workspace reads go through the platform door
 * (`PlatformStore`, behind the operator guard); anything that MOVES money runs as that one workspace's tenant transaction, the same
 * way a customer's own charge would, so the ledger code path is identical.
 */
@Injectable()
export class PlatformWalletService {
  constructor(
    private readonly store: PlatformStore,
    private readonly db: DatabaseService,
    private readonly repo: WalletRepository,
    private readonly ledger: WalletLedgerService,
    private readonly log: WalletLogService,
    private readonly audit: AuthAuditService,
    private readonly settings: WalletSettingsService,
    private readonly billing: BillingCurrencyService,
  ) {}

  async operator(id: number): Promise<Operator> {
    const res = await this.store.tx((tx) =>
      tx.execute(
        sql`SELECT email::text AS email, full_name FROM platform_operators WHERE id = ${id}`,
      ),
    );
    const r = res.rows[0] as { email: string; full_name: string } | undefined;
    return { id, label: r ? `${r.full_name} <${r.email}>` : `operator #${id}` };
  }

  // --- the list ----------------------------------------------------------------------------------------------------------------

  async list(q: PlatformWalletListQuery): Promise<PlatformWalletList> {
    const s = await this.settings.effective();
    const cur = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString('utf8')) : null;
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    return this.store.tx(async (tx) => {
      // Each workspace is shown with its wallet in ITS billing currency, and judged against the low-balance threshold converted
      // to that currency. Currencies are never added together: the totals come back one line per currency.
      const billable = await this.billing.billable(tx);
      const thresholds = await Promise.all(
        billable.map(
          async (c) => [c, await this.billing.fromPlatform(s.lowBalanceThresholdMinor, c)] as const,
        ),
      );
      const unitOf = sql`CASE WHEN upper(o.settings->>'currency') = ANY(${pgArray(billable, 'text')})
                              THEN upper(o.settings->>'currency') ELSE ${s.currency} END`;
      const withUnits = sql`
        WITH th(unit, minor) AS (VALUES ${sql.join(
          thresholds.map(([c, m]) => sql`(${c}::text, ${m}::bigint)`),
          sql`, `,
        )}),
        b AS (SELECT o.id AS org_id, ${unitOf} AS unit FROM organizations o)`;
      const isLow = sql`(COALESCE(th.minor, 0) > 0 AND COALESCE(w.balance, 0) <= th.minor::numeric / 100)`;
      const filter: SQL[] = [sql`true`];
      if (like) filter.push(sql`(o.name ILIKE ${like} OR o.slug ILIKE ${like})`);
      if (q.lowOnly) filter.push(isLow);
      const where = sql.join(filter, sql` AND `);
      const rows = await tx.execute(sql`
        ${withUnits}
        SELECT o.id, o.uuid, o.name, o.slug, b.unit, COALESCE(w.balance, 0)::text AS balance,
               (COALESCE(ws.bill_to_platform_credit, false) OR ${s.payPerMessage}) AS wallet_mode,
               ${isLow} AS low, last.at AS last_activity
        FROM organizations o
        JOIN b ON b.org_id = o.id
        LEFT JOIN wallets w ON w.org_id = o.id AND w.unit = b.unit
        LEFT JOIN th ON th.unit = b.unit
        LEFT JOIN workspace_settings ws ON ws.org_id = o.id
        LEFT JOIN LATERAL (
          SELECT max(created_at) AS at FROM wallet_transactions t WHERE t.org_id = o.id
        ) last ON true
        WHERE ${where} ${cur ? sql`AND o.id < ${cur}` : sql``}
        ORDER BY o.id DESC LIMIT ${q.limit + 1}`);
      const totals = await tx.execute(sql`
        ${withUnits}
        SELECT (SELECT count(*) FROM organizations)::int AS workspaces,
               (SELECT count(*) FROM organizations o
                  JOIN b ON b.org_id = o.id
                  LEFT JOIN wallets w ON w.org_id = o.id AND w.unit = b.unit
                  LEFT JOIN th ON th.unit = b.unit
                 WHERE ${isLow})::int AS low`);
      const float = await tx.execute(sql`
        SELECT unit, COALESCE(sum(balance), 0)::text AS float, count(*)::int AS wallets
        FROM wallets GROUP BY unit ORDER BY unit`);
      const t = totals.rows[0] as { workspaces: number; low: number };
      const byCurrency = (
        float.rows as unknown as Array<{ unit: string; float: string; wallets: number }>
      ).map((r) => ({
        currency: r.unit,
        floatMinor: decimalToMinor(r.float),
        wallets: r.wallets,
      }));
      const raw = rows.rows as unknown as Array<{
        id: string | number;
        uuid: string;
        name: string;
        slug: string;
        unit: string;
        balance: string;
        wallet_mode: boolean;
        low: boolean;
        last_activity: Date | null;
      }>;
      const hasMore = raw.length > q.limit;
      const page = raw.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        currency: s.currency,
        totals: {
          workspaces: t.workspaces,
          floatMinor: byCurrency.find((c) => c.currency === s.currency)?.floatMinor ?? 0,
          lowBalance: t.low,
          floatByCurrency: byCurrency,
        },
        data: page.map((r) => ({
          workspaceId: r.uuid,
          workspaceName: r.name,
          slug: r.slug,
          currency: r.unit,
          balanceMinor: decimalToMinor(r.balance),
          billingMode: r.wallet_mode ? ('wallet' as const) : ('plan' as const),
          lowBalance: r.low,
          lastActivityAt: r.last_activity ? new Date(r.last_activity).toISOString() : null,
        })),
        page: {
          nextCursor: hasMore && last ? Buffer.from(String(last.id)).toString('base64url') : null,
          hasMore,
          limit: q.limit,
        },
      };
    });
  }

  private async orgByUuid(uuid: string): Promise<{ id: number; name: string; slug: string }> {
    const res = await this.store.tx((tx) =>
      tx.execute(sql`SELECT id, name, slug FROM organizations WHERE uuid = ${uuid}::uuid`),
    );
    const r = res.rows[0] as { id: string | number; name: string; slug: string } | undefined;
    if (!r) throw AppError.notFound('Workspace');
    return { id: Number(r.id), name: r.name, slug: r.slug };
  }

  async detail(workspaceUuid: string): Promise<PlatformWalletDetail> {
    const org = await this.orgByUuid(workspaceUuid);
    const s = await this.settings.effective();
    return this.db.txAs({ orgId: org.id, userId: null }, async (tx) => {
      const unit = await this.billing.forOrg(tx, org.id);
      const wallet = await this.repo.peekWallet(tx, org.id, unit);
      const wallets = await this.repo.wallets(tx, org.id);
      const billable = await this.billing.billable(tx);
      const threshold = await this.billing.fromPlatform(s.lowBalanceThresholdMinor, unit);
      const ws = await tx.execute(
        sql`SELECT bill_to_platform_credit FROM workspace_settings WHERE org_id = ${org.id}`,
      );
      const walletMode =
        (ws.rows[0] as { bill_to_platform_credit?: boolean } | undefined)
          ?.bill_to_platform_credit === true || s.payPerMessage;
      const res = await tx.execute(sql`
        SELECT ${LEDGER_COLUMNS} FROM wallet_transactions
        WHERE org_id = ${org.id} AND ${inUnit(unit, s.currency)}
        ORDER BY created_at DESC, id DESC LIMIT 25`);
      const recent = (res.rows as unknown as Parameters<typeof toLedger>[0][]).map(toLedger);
      const balance = wallet?.balanceMinor ?? 0;
      return {
        workspace: { id: workspaceUuid, name: org.name, slug: org.slug },
        currency: unit,
        billableCurrencies: billable,
        wallets: wallets.map((w) => ({ currency: w.unit, balanceMinor: w.balanceMinor })),
        balanceMinor: balance,
        billingMode: walletMode ? ('wallet' as const) : ('plan' as const),
        lowBalanceThresholdMinor: threshold,
        lowBalance: threshold > 0 && balance <= threshold,
        lastActivityAt: recent[0]?.createdAt.toISOString() ?? null,
        recent: recent.map((r) => ({
          ...toTransaction(r),
          actorLabel: r.actorLabel,
          actorType: r.actorType,
        })),
      };
    });
  }

  // --- adding or taking money by hand -----------------------------------------------------------------------------------------

  /**
   * Credits or debits a workspace's wallet with a reason. The note is mandatory (zod, the ledger service and a CHECK on the table
   * all refuse a blank one) and is what the customer, support and the audit trail all read. The posting, its wallet log row, the
   * security audit row and the `wallet.topped_up` outbox event are ONE transaction. A debit never takes the wallet below 0: it
   * takes what is there and the result says requested versus applied, so support sees intent (WaDesk's unused adjust helper
   * did the same). `idempotencyKey` makes a double click post once.
   */
  async adjust(
    workspaceUuid: string,
    input: AdjustWalletInput,
    operator: Operator,
    idempotencyKey: string,
  ): Promise<AdjustWalletResult> {
    const amountMinor = walletMajorToMinor(input.amount);
    if (amountMinor === null || amountMinor <= 0) {
      throw new AppError(
        ERROR_CODES.WALLET_AMOUNT_INVALID,
        'Enter an amount greater than 0 with at most 2 decimals.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const org = await this.orgByUuid(workspaceUuid);
    const credit = input.direction === 'credit';

    return this.db.txAs({ orgId: org.id, userId: null }, async (tx) => {
      // The adjustment is made to the wallet the workspace is billed from, in its currency.
      const unit = await this.billing.forOrg(tx, org.id);
      const posted = await this.ledger.post(tx, {
        orgId: org.id,
        unit,
        type: 'admin_adjust',
        direction: credit ? 'in' : 'out',
        amountMinor,
        idempotencyKey: `admin:${operator.id}:${idempotencyKey}`,
        source: 'admin.adjust',
        description: credit
          ? 'Credit added by platform support'
          : 'Balance adjusted by platform support',
        note: input.note,
        meta: { requestedMinor: amountMinor, direction: input.direction },
        actor: { type: 'platform_operator', label: operator.label, operatorId: operator.id },
        allowPartial: true,
      });
      if (!posted.replayed) {
        const appliedNote =
          posted.appliedMinor !== posted.requestedMinor
            ? ` (applied ${posted.appliedMinor}, the wallet held less)`
            : '';
        await this.log.event(tx, {
          orgId: org.id,
          event: 'wallet.admin.adjusted',
          severity: credit ? 'info' : 'warning',
          message: `${operator.label} ${credit ? 'added' : 'took'} ${posted.appliedMinor} ${credit ? 'to' : 'from'} the wallet${appliedNote}`,
          actorType: 'platform_operator',
          actorLabel: operator.label,
          subjectType: 'wallet_transaction',
          subjectId: posted.transactionRowId,
          payload: {
            direction: input.direction,
            requestedMinor: posted.requestedMinor,
            appliedMinor: posted.appliedMinor,
            balanceBeforeMinor: posted.balanceBeforeMinor,
            balanceAfterMinor: posted.balanceAfterMinor,
            note: input.note,
          },
        });
        await this.audit.record(tx, {
          event: 'platform.wallet.adjusted',
          status: 'success',
          orgId: org.id,
          actorType: 'platform_operator',
          actorId: operator.id,
          recordId: posted.walletId,
          payload: {
            direction: input.direction,
            requestedMinor: posted.requestedMinor,
            appliedMinor: posted.appliedMinor,
            balanceAfterMinor: posted.balanceAfterMinor,
            note: input.note,
          },
        });
      }
      return {
        transactionId: posted.transactionId,
        direction: input.direction,
        requestedMinor: posted.requestedMinor,
        appliedMinor: posted.appliedMinor,
        balanceBeforeMinor: posted.balanceBeforeMinor,
        balanceAfterMinor: posted.balanceAfterMinor,
        replayed: posted.replayed,
      };
    });
  }

  // --- the trail ---------------------------------------------------------------------------------------------------------------

  async logs(q: WalletLogQuery): Promise<WalletLogList> {
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const cur = decodeCursor(q.cursor);
    let orgId: number | null = null;
    if (q.workspaceId) orgId = (await this.orgByUuid(q.workspaceId)).id;

    const common = (alias: string): SQL[] => {
      const p: SQL[] = [];
      if (q.event) p.push(sql`${sql.raw(alias)}.event = ${q.event}`);
      if (q.severity) p.push(sql`${sql.raw(alias)}.severity = ${q.severity}`);
      if (like)
        p.push(
          sql`(${sql.raw(alias)}.message ILIKE ${like} OR ${sql.raw(alias)}.payload::text ILIKE ${like})`,
        );
      if (q.from) p.push(sql`${sql.raw(alias)}.created_at >= ${q.from}::date`);
      if (q.to) p.push(sql`${sql.raw(alias)}.created_at < (${q.to}::date + 1)`);
      return p;
    };
    const wsWhere = [...common('e'), ...(orgId ? [sql`e.org_id = ${orgId}`] : [])];
    const plWhere = common('p');
    const branches: SQL[] = [];
    if (q.scope !== 'platform') {
      branches.push(sql`
        SELECT 'workspace'::text AS scope, e.id AS rid, e.created_at, e.event, e.severity, e.message, o.uuid AS org_uuid,
               o.name AS org_name, e.actor_type, e.actor_label, e.payload, e.request_id
        FROM wallet_events e JOIN organizations o ON o.id = e.org_id
        ${wsWhere.length ? sql`WHERE ${sql.join(wsWhere, sql` AND `)}` : sql``}`);
    }
    // A workspace filter excludes platform rows: they belong to no workspace.
    if (q.scope !== 'workspace' && !orgId) {
      branches.push(sql`
        SELECT 'platform'::text AS scope, p.id AS rid, p.created_at, p.event, p.severity, p.message, NULL::uuid AS org_uuid,
               NULL::text AS org_name, p.actor_type, p.actor_label, p.payload, p.request_id
        FROM wallet_platform_log p
        ${plWhere.length ? sql`WHERE ${sql.join(plWhere, sql` AND `)}` : sql``}`);
    }
    if (branches.length === 0)
      return { data: [], page: { nextCursor: null, hasMore: false, limit: q.limit } };

    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT * FROM (${sql.join(branches, sql` UNION ALL `)}) l
        ${cur ? sql`WHERE (l.created_at, l.rid) < (${cur.at}::timestamptz, ${cur.id})` : sql``}
        ORDER BY l.created_at DESC, l.rid DESC LIMIT ${q.limit + 1}`);
      const raw = res.rows as unknown as Array<{
        scope: 'workspace' | 'platform';
        rid: string | number;
        created_at: Date;
        event: string;
        severity: 'info' | 'warning' | 'error';
        message: string;
        org_uuid: string | null;
        org_name: string | null;
        actor_type: string;
        actor_label: string | null;
        payload: Record<string, unknown>;
        request_id: string | null;
      }>;
      const hasMore = raw.length > q.limit;
      const page = raw.slice(0, q.limit);
      const last = page[page.length - 1];
      const data: WalletLogRow[] = page.map((r) => ({
        id: `${r.scope}:${r.rid}`,
        scope: r.scope,
        event: r.event,
        severity: r.severity,
        message: r.message,
        workspaceId: r.org_uuid,
        workspaceName: r.org_name,
        actorType: r.actor_type,
        actorLabel: r.actor_label,
        payload: r.payload ?? {},
        requestId: r.request_id,
        createdAt: new Date(r.created_at).toISOString(),
      }));
      return {
        data,
        page: {
          nextCursor:
            hasMore && last ? encodeCursor(new Date(last.created_at), Number(last.rid)) : null,
          hasMore,
          limit: q.limit,
        },
      };
    });
  }

  // --- the numbers ---------------------------------------------------------------------------------------------------------------

  async overview(): Promise<PlatformWalletOverview> {
    const s = await this.settings.effective();
    return this.store.tx(async (tx) => {
      // The headline figures are the platform currency's; every other currency has its own line below, never added in.
      const w = await tx.execute(sql`
        SELECT COALESCE(sum(balance), 0)::text AS float,
               count(*) FILTER (WHERE balance > 0)::int AS holding,
               count(*) FILTER (WHERE ${s.lowBalanceThresholdMinor} > 0 AND balance <= ${s.lowBalanceThresholdMinor}::numeric / 100)::int AS low
        FROM wallets WHERE unit = ${s.currency}`);
      const t = await tx.execute(sql`
        SELECT COALESCE(sum(amount) FILTER (WHERE type = 'topup'), 0)::text AS topped,
               COALESCE(-sum(amount) FILTER (WHERE type = 'spend'), 0)::text AS charged,
               COALESCE(sum(amount) FILTER (WHERE type = 'refund'), 0)::text AS refunded,
               COALESCE(sum(amount) FILTER (WHERE type = 'admin_adjust' AND amount > 0), 0)::text AS adj_in,
               COALESCE(-sum(amount) FILTER (WHERE type = 'admin_adjust' AND amount < 0), 0)::text AS adj_out
        FROM wallet_transactions
        WHERE created_at >= now() - interval '30 days' AND ${inUnit(s.currency, s.currency)}`);
      const c = await tx.execute(sql`
        SELECT count(*) FILTER (WHERE status = 'charged')::int AS charged, count(*) FILTER (WHERE status = 'free')::int AS free
        FROM usage_charges WHERE created_at >= now() - interval '30 days'`);
      const others = await tx.execute(sql`
        SELECT w.unit, COALESCE(sum(w.balance), 0)::text AS float, count(*) FILTER (WHERE w.balance > 0)::int AS holding,
               COALESCE((SELECT sum(t.amount) FROM wallet_transactions t
                          WHERE t.unit = w.unit AND t.type = 'topup' AND t.created_at >= now() - interval '30 days'), 0)::text AS topped,
               COALESCE((SELECT -sum(t.amount) FROM wallet_transactions t
                          WHERE t.unit = w.unit AND t.type = 'spend' AND t.created_at >= now() - interval '30 days'), 0)::text AS charged
        FROM wallets w WHERE w.unit <> ${s.currency} GROUP BY w.unit ORDER BY w.unit`);
      const wr = w.rows[0] as { float: string; holding: number; low: number };
      const tr = t.rows[0] as Record<
        'topped' | 'charged' | 'refunded' | 'adj_in' | 'adj_out',
        string
      >;
      const cr = c.rows[0] as { charged: number; free: number };
      return {
        currency: s.currency,
        floatMinor: decimalToMinor(wr.float),
        workspacesWithBalance: wr.holding,
        lowBalanceWorkspaces: wr.low,
        otherCurrencies: (
          others.rows as unknown as Array<{
            unit: string;
            float: string;
            holding: number;
            topped: string;
            charged: string;
          }>
        ).map((r) => ({
          currency: r.unit,
          floatMinor: decimalToMinor(r.float),
          workspacesWithBalance: r.holding,
          toppedUp30dMinor: decimalToMinor(r.topped),
          charged30dMinor: decimalToMinor(r.charged),
        })),
        last30d: {
          toppedUpMinor: decimalToMinor(tr.topped),
          chargedMinor: decimalToMinor(tr.charged),
          refundedMinor: decimalToMinor(tr.refunded),
          adjustedInMinor: decimalToMinor(tr.adj_in),
          adjustedOutMinor: decimalToMinor(tr.adj_out),
          chargedMessages: cr.charged,
          freeMessages: cr.free,
        },
      };
    });
  }

  /**
   * Switches the currency a workspace is billed in (see `setWorkspaceCurrencySchema`). Only a currency whose Meta rate card is
   * stored can be chosen. The old wallet keeps its balance; the result says how much was left there.
   */
  async setCurrency(
    workspaceUuid: string,
    input: SetWorkspaceCurrencyInput,
    operator: Operator,
  ): Promise<SetWorkspaceCurrencyResult> {
    const org = await this.orgByUuid(workspaceUuid);
    return this.store.tx(async (tx) => {
      const billable = await this.billing.billable(tx);
      if (!billable.includes(input.currency)) {
        throw new AppError(
          ERROR_CODES.WALLET_CURRENCY_UNSUPPORTED,
          `Meta\u2019s rate card for ${input.currency} has not been imported, so workspaces cannot be billed in it yet.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'currency', message: `Use one of ${billable.join(', ')}` }],
        );
      }
      const previous = await this.billing.forOrg(tx, org.id);
      const leftBehind = (await this.repo.peekWallet(tx, org.id, previous))?.balanceMinor ?? 0;
      if (previous === input.currency) {
        return {
          currency: previous,
          previousCurrency: previous,
          leftBehindMinor: 0,
          changed: false,
        };
      }
      await tx.execute(sql`
        UPDATE organizations
        SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{currency}', to_jsonb(${input.currency}::text))
        WHERE id = ${org.id}`);
      const payload = {
        from: previous,
        to: input.currency,
        leftBehindMinor: leftBehind,
        note: input.note,
      };
      await this.log.platform(tx, {
        event: 'platform.workspace_currency.changed',
        severity: leftBehind > 0 ? 'warning' : 'info',
        message: `${org.name} is now billed in ${input.currency} (was ${previous})`,
        operatorId: operator.id,
        actorLabel: operator.label,
        payload: { workspace: workspaceUuid, ...payload },
      });
      await this.log.event(tx, {
        orgId: org.id,
        event: 'wallet.admin.adjusted',
        severity: 'info',
        message: `Billing currency changed from ${previous} to ${input.currency} by ${operator.label}`,
        actorType: 'platform_operator',
        actorLabel: operator.label,
        payload,
      });
      await this.audit.record(tx, {
        event: 'platform.wallet.currency_changed',
        status: 'success',
        orgId: org.id,
        actorType: 'platform_operator',
        actorId: operator.id,
        payload,
      });
      return {
        currency: input.currency,
        previousCurrency: previous,
        leftBehindMinor: leftBehind,
        changed: true,
      };
    });
  }

  /** Every balance against the sum of its ledger. A mismatch is logged against the workspace (once a day) as an error. */
  async reconcile(): Promise<Reconciliation> {
    const platform = await this.settings.currency();
    const found = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT w.org_id, o.uuid, o.name, w.balance::text AS balance, COALESCE(l.total, 0)::text AS ledger
        FROM wallets w
        JOIN organizations o ON o.id = w.org_id
        LEFT JOIN (
          SELECT org_id, COALESCE(unit, ${platform}) AS unit, sum(amount) AS total FROM wallet_transactions GROUP BY 1, 2
        ) l ON l.org_id = w.org_id AND l.unit = w.unit
        WHERE w.balance <> COALESCE(l.total, 0)`);
      const count = await tx.execute(sql`SELECT count(*)::int AS n FROM wallets`);
      return {
        checked: (count.rows[0] as { n: number }).n,
        rows: res.rows as unknown as Array<{
          org_id: string | number;
          uuid: string;
          name: string;
          balance: string;
          ledger: string;
        }>,
      };
    });
    const mismatches = found.rows.map((r) => {
      const balanceMinor = decimalToMinor(r.balance);
      const ledgerMinor = decimalToMinor(r.ledger);
      return {
        orgId: Number(r.org_id),
        workspaceId: r.uuid,
        workspaceName: r.name,
        balanceMinor,
        ledgerMinor,
        differenceMinor: balanceMinor - ledgerMinor,
      };
    });
    for (const m of mismatches) {
      await this.db.txAs({ orgId: m.orgId, userId: null }, async (tx) => {
        const recent = await tx.execute(sql`
          SELECT 1 FROM wallet_events WHERE org_id = ${m.orgId} AND event = 'wallet.reconcile.mismatch'
            AND created_at > now() - interval '23 hours' LIMIT 1`);
        if (recent.rows.length > 0) return;
        await this.log.event(tx, {
          orgId: m.orgId,
          event: 'wallet.reconcile.mismatch',
          severity: 'error',
          message: `Balance ${m.balanceMinor} differs from its ledger ${m.ledgerMinor} by ${m.differenceMinor}`,
          payload: {
            balanceMinor: m.balanceMinor,
            ledgerMinor: m.ledgerMinor,
            differenceMinor: m.differenceMinor,
          },
        });
      });
    }
    return {
      checkedAt: new Date().toISOString(),
      workspacesChecked: found.checked,
      mismatches: mismatches.map(({ orgId: _orgId, ...rest }) => rest),
    };
  }
}
