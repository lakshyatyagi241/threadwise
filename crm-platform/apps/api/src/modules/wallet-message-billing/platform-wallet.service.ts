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
  type WalletLogList,
  type WalletLogQuery,
  type WalletLogRow,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService, PlatformStore } from '../auth';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletLogService } from './wallet-log.service';
import { LEDGER_COLUMNS, WalletRepository, decimalToMinor, toLedger } from './wallet.repository';
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
      const filter: SQL[] = [sql`true`];
      if (like) filter.push(sql`(o.name ILIKE ${like} OR o.slug ILIKE ${like})`);
      if (q.lowOnly && s.lowBalanceThresholdMinor > 0) {
        filter.push(sql`COALESCE(w.balance, 0) <= ${s.lowBalanceThresholdMinor}::numeric / 100`);
      }
      const where = sql.join(filter, sql` AND `);
      const rows = await tx.execute(sql`
        SELECT o.id, o.uuid, o.name, o.slug, COALESCE(w.unit, ${s.currency}) AS unit, COALESCE(w.balance, 0)::text AS balance,
               (COALESCE(ws.bill_to_platform_credit, false) OR ${s.payPerMessage}) AS wallet_mode,
               last.at AS last_activity
        FROM organizations o
        LEFT JOIN wallets w ON w.org_id = o.id
        LEFT JOIN workspace_settings ws ON ws.org_id = o.id
        LEFT JOIN LATERAL (
          SELECT max(created_at) AS at FROM wallet_transactions t WHERE t.org_id = o.id
        ) last ON true
        WHERE ${where} ${cur ? sql`AND o.id < ${cur}` : sql``}
        ORDER BY o.id DESC LIMIT ${q.limit + 1}`);
      const totals = await tx.execute(sql`
        SELECT count(*)::int AS workspaces,
               COALESCE(sum(w.balance), 0)::text AS float,
               count(*) FILTER (WHERE ${s.lowBalanceThresholdMinor} > 0 AND COALESCE(w.balance, 0) <= ${s.lowBalanceThresholdMinor}::numeric / 100)::int AS low
        FROM organizations o LEFT JOIN wallets w ON w.org_id = o.id
        `);
      const t = totals.rows[0] as { workspaces: number; float: string; low: number };
      const raw = rows.rows as unknown as Array<{
        id: string | number;
        uuid: string;
        name: string;
        slug: string;
        unit: string;
        balance: string;
        wallet_mode: boolean;
        last_activity: Date | null;
      }>;
      const hasMore = raw.length > q.limit;
      const page = raw.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        currency: s.currency,
        totals: {
          workspaces: t.workspaces,
          floatMinor: decimalToMinor(t.float),
          lowBalance: t.low,
        },
        data: page.map((r) => {
          const balanceMinor = decimalToMinor(r.balance);
          return {
            workspaceId: r.uuid,
            workspaceName: r.name,
            slug: r.slug,
            currency: r.unit,
            balanceMinor,
            billingMode: r.wallet_mode ? ('wallet' as const) : ('plan' as const),
            lowBalance:
              s.lowBalanceThresholdMinor > 0 && balanceMinor <= s.lowBalanceThresholdMinor,
            lastActivityAt: r.last_activity ? new Date(r.last_activity).toISOString() : null,
          };
        }),
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
      const wallet = await this.repo.peekWallet(tx, org.id);
      const ws = await tx.execute(
        sql`SELECT bill_to_platform_credit FROM workspace_settings WHERE org_id = ${org.id}`,
      );
      const walletMode =
        (ws.rows[0] as { bill_to_platform_credit?: boolean } | undefined)
          ?.bill_to_platform_credit === true || s.payPerMessage;
      const res = await tx.execute(sql`
        SELECT ${LEDGER_COLUMNS} FROM wallet_transactions WHERE org_id = ${org.id}
        ORDER BY created_at DESC, id DESC LIMIT 25`);
      const recent = (res.rows as unknown as Parameters<typeof toLedger>[0][]).map(toLedger);
      const balance = wallet?.balanceMinor ?? 0;
      return {
        workspace: { id: workspaceUuid, name: org.name, slug: org.slug },
        currency: wallet?.unit ?? s.currency,
        balanceMinor: balance,
        billingMode: walletMode ? ('wallet' as const) : ('plan' as const),
        lowBalanceThresholdMinor: s.lowBalanceThresholdMinor,
        lowBalance: s.lowBalanceThresholdMinor > 0 && balance <= s.lowBalanceThresholdMinor,
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
   * takes what is there and the result says requested versus applied, so support sees intent (Reference's unused adjust helper
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
    const unit = await this.settings.currency();
    const credit = input.direction === 'credit';

    return this.db.txAs({ orgId: org.id, userId: null }, async (tx) => {
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
      const w = await tx.execute(sql`
        SELECT COALESCE(sum(balance), 0)::text AS float,
               count(*) FILTER (WHERE balance > 0)::int AS holding,
               count(*) FILTER (WHERE ${s.lowBalanceThresholdMinor} > 0 AND balance <= ${s.lowBalanceThresholdMinor}::numeric / 100)::int AS low
        FROM wallets`);
      const t = await tx.execute(sql`
        SELECT COALESCE(sum(amount) FILTER (WHERE type = 'topup'), 0)::text AS topped,
               COALESCE(-sum(amount) FILTER (WHERE type = 'spend'), 0)::text AS charged,
               COALESCE(sum(amount) FILTER (WHERE type = 'refund'), 0)::text AS refunded,
               COALESCE(sum(amount) FILTER (WHERE type = 'admin_adjust' AND amount > 0), 0)::text AS adj_in,
               COALESCE(-sum(amount) FILTER (WHERE type = 'admin_adjust' AND amount < 0), 0)::text AS adj_out
        FROM wallet_transactions WHERE created_at >= now() - interval '30 days'`);
      const c = await tx.execute(sql`
        SELECT count(*) FILTER (WHERE status = 'charged')::int AS charged, count(*) FILTER (WHERE status = 'free')::int AS free
        FROM usage_charges WHERE created_at >= now() - interval '30 days'`);
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

  /** Every balance against the sum of its ledger. A mismatch is logged against the workspace (once a day) as an error. */
  async reconcile(): Promise<Reconciliation> {
    const found = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT w.org_id, o.uuid, o.name, w.balance::text AS balance, COALESCE(l.total, 0)::text AS ledger
        FROM wallets w
        JOIN organizations o ON o.id = w.org_id
        LEFT JOIN (SELECT org_id, sum(amount) AS total FROM wallet_transactions GROUP BY org_id) l ON l.org_id = w.org_id
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
