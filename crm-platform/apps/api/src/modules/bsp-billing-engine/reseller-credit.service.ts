import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  BSP_CREDIT_CURRENCIES,
  ERROR_CODES,
  normalizeCurrencyInput,
  type AttachAllResult,
  type BspAllocation,
  type BspAllocationList,
  type BspWabaCandidateList,
  type ListBspAllocationsQuery,
  type RevokeResult,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  CREDIT_SOURCE_PORT,
  type CreditSourcePort,
} from '../../infra/providers/bsp-billing-engine/credit-source.port';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AuthAuditService } from '../auth';
import { toAllocation } from './reseller.mapper';
import { ResellerPlatformReader } from './reseller-platform.reader';
import { currencyProblem, pickAttachCurrency } from './reseller-rules';
import { ResellerRepository, type AllocationRow } from './reseller.repository';
import { ResellerSettingsService, type ResellerConnection } from './reseller-settings.service';

/** Where an attach was asked for, kept in the audit trail so "who attached this" has an answer (Reference dropped the actor). */
export type AttachOrigin = 'operator' | 'bulk' | 'auto' | 'customer';

export interface AttachRequest {
  orgId: number;
  wabaId: string;
  /** Explicit choice (the operator's form); otherwise the candidates decide. */
  currency?: string | null;
  /** Fallbacks in priority order, used when no currency was chosen. */
  currencyCandidates?: ReadonlyArray<string | null | undefined>;
  origin: AttachOrigin;
  operatorId?: number | null;
}

export interface AttachOutcome {
  allocation: AllocationRow;
  /** False when an `attached` row already existed and Meta was not called (TW-BSP-006 rule 3). */
  called: boolean;
}

/** One batch of "Attach all" holds this many Graph calls; the rest is reported as `remaining` and runs on the next press. */
const BATCH_SIZE = 20;
/** Graph calls in flight at once inside a batch: a 30 s call times 20 in a row would outlast the request. */
const CONCURRENCY = 4;

/**
 * Sharing the platform's Meta credit line onto customer WABAs, and taking it back (TW-BSP-006, -007, -008, -009).
 *
 * Every attach is: read what exists, call Meta with NO transaction open, then write the outcome plus its audit row and outbox
 * event in one tenant transaction. A transaction held across a 30 s Graph call would pin a pooled connection per slow request.
 * The outcome is a recorded row, not an exception: a refused attach is `failed` with Meta's wording in `last_error`, and the next
 * attempt reuses the row (unique per (workspace, WABA)).
 */
@Injectable()
export class ResellerCreditService {
  private readonly logger = new Logger(ResellerCreditService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ResellerRepository,
    private readonly reader: ResellerPlatformReader,
    private readonly settings: ResellerSettingsService,
    private readonly audit: AuthAuditService,
    private readonly outbox: OutboxService,
    @Inject(CREDIT_SOURCE_PORT) private readonly source: CreditSourcePort,
  ) {}

  // --- reads --------------------------------------------------------------------------------------------------------------------

  async list(query: ListBspAllocationsQuery): Promise<BspAllocationList> {
    const { rows, nextCursor, hasMore } = await this.reader.listAllocations(query);
    return {
      data: rows.map((r) => toAllocation(r)),
      page: { nextCursor, hasMore, limit: query.limit },
    };
  }

  async wabaCandidates(): Promise<BspWabaCandidateList> {
    const rows = await this.reader.wabaCandidates();
    return {
      data: rows.map((r) => ({
        workspaceId: r.org_uuid,
        workspaceName: r.org_name,
        phone: r.phone_number,
        displayLabel: r.display_label,
        wabaId: r.waba_id,
        allocationStatus: r.allocation_status,
        workspaceCurrency: r.currency,
      })),
    };
  }

  // --- attach --------------------------------------------------------------------------------------------------------------------

  /**
   * The operator attaches one number. The WABA must be a connected Cloud API number of that workspace: Reference accepted any
   * string and any workspace id (TW-BSP-006 rule 1), which would record a credit line against a number the workspace never owned.
   */
  async attachOne(
    workspaceUuid: string,
    wabaId: string,
    currency: string,
    operatorId: number,
  ): Promise<BspAllocation> {
    const org = await this.reader.orgByUuid(workspaceUuid);
    if (!org) throw AppError.notFound('Workspace');
    const { owned, reseller } = await this.db.txAs({ orgId: org.id, userId: null }, async (tx) => ({
      owned: await this.repo.wabaIsConnected(tx, org.id, wabaId),
      reseller: await this.repo.billsToPlatform(tx, org.id),
    }));
    if (!owned) {
      throw new AppError(
        ERROR_CODES.BSP_WABA_NOT_FOUND,
        'That number is not a connected WhatsApp Business (Cloud API) number of this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const { allocation } = await this.attach({
      orgId: org.id,
      wabaId,
      currency,
      origin: 'operator',
      operatorId,
    });
    return toAllocation({
      ...allocation,
      org_uuid: org.uuid,
      org_name: org.name,
      bills_to_platform: reseller,
    });
  }

  /** The one attach path: manual, batch, sweep and the customer's choice all end here. Never throws for a Meta refusal. */
  async attach(req: AttachRequest): Promise<AttachOutcome> {
    const existing = await this.db.txAs({ orgId: req.orgId, userId: null }, (tx) =>
      this.repo.allocationByWaba(tx, req.orgId, req.wabaId),
    );
    if (existing?.status === 'attached') return { allocation: existing, called: false };

    const conn = await this.settings.connection();
    const currency =
      normalizeCurrencyInput(req.currency) ||
      pickAttachCurrency(null, [
        ...(req.currencyCandidates ?? []),
        conn.autoAttachCurrency,
        conn.baseCurrency,
      ]);

    const result = await this.askMeta(conn, req.wabaId, currency);
    const allocation = await this.db.txAs({ orgId: req.orgId, userId: null }, async (tx) => {
      const written = await this.repo.upsertAllocation(tx, {
        orgId: req.orgId,
        wabaId: req.wabaId,
        allocationConfigId: result.ok ? result.allocationConfigId : null,
        creditSource: this.source.name,
        currency,
        status: result.ok ? 'attached' : 'failed',
        lastError: result.ok ? null : result.error,
        operatorId: req.operatorId ?? null,
      });
      // Null: a concurrent attach won while Meta was being called. Its row is the truth; this attempt writes nothing.
      const row = written ?? (await this.repo.allocationByWaba(tx, req.orgId, req.wabaId))!;
      if (written) {
        await this.trail(tx, req.orgId, row, result.ok ? 'attached' : 'failed', req.origin, {
          currency,
          error: result.ok ? undefined : result.error,
        });
      }
      return row;
    });
    this.logger.log(
      { org: req.orgId, waba: req.wabaId, status: allocation.status, origin: req.origin },
      '[BSP-CREDIT] attach',
    );
    return { allocation, called: true };
  }

  private async askMeta(
    conn: ResellerConnection,
    wabaId: string,
    currency: string,
  ): Promise<{ ok: true; allocationConfigId: string } | { ok: false; error: string }> {
    if (!this.source.isConfigured(conn)) {
      return {
        ok: false,
        error:
          'The Meta connection is not set up. Add the business id and system-user token under Reseller billing.',
      };
    }
    const problem = currencyProblem(currency, BSP_CREDIT_CURRENCIES);
    if (problem) return { ok: false, error: problem };

    const creditLine = await this.source.resolveCreditLine(conn);
    if (!creditLine) {
      return { ok: false, error: 'No Meta extended credit line found for this business.' };
    }
    if (!conn.extendedCreditId) await this.settings.cacheCreditLine(creditLine);
    return this.source.attach(conn, creditLine, wabaId, currency);
  }

  /**
   * "Attach all connected now": a bounded batch of the numbers of reseller workspaces that are not attached, a few Graph calls at a
   * time. Reference looped over all of them inside one request. The result says how many are left, so the operator presses again.
   */
  async attachAll(operatorId: number): Promise<AttachAllResult> {
    if (!(await this.settings.isConfigured())) {
      throw new AppError(
        ERROR_CODES.BSP_NOT_CONFIGURED,
        'Connect your Meta credit line first (step 1).',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const { items, total, alreadyAttached } = await this.reader.pendingAttachments({
      onlyNew: false,
      limit: BATCH_SIZE,
    });
    return this.runBatch(items, total, alreadyAttached, 'bulk', operatorId);
  }

  /** The worker's sweep (TW-BSP-008): numbers never tried, when auto-attach is on and the connection is set up. */
  async autoAttachPending(limit = 10): Promise<AttachAllResult | null> {
    const conn = await this.settings.connection();
    if (!conn.autoAttach || !this.source.isConfigured(conn)) return null;
    const { items, total, alreadyAttached } = await this.reader.pendingAttachments({
      onlyNew: true,
      limit,
    });
    if (items.length === 0) return null;
    return this.runBatch(items, total, alreadyAttached, 'auto', null);
  }

  private async runBatch(
    items: Array<{ orgId: number; wabaId: string; currency: string | null }>,
    total: number,
    alreadyAttached: number,
    origin: AttachOrigin,
    operatorId: number | null,
  ): Promise<AttachAllResult> {
    let attached = 0;
    let failed = 0;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      const outcomes = await Promise.all(
        chunk.map((item) =>
          this.attach({
            orgId: item.orgId,
            wabaId: item.wabaId,
            // The admin's own auto-attach currency (or base) beats the workspace's: it is the platform's explicit choice.
            currencyCandidates: [item.currency],
            origin,
            operatorId,
          }).catch((err: unknown) => {
            // One workspace must not stop the batch; the failure is logged and counted.
            this.logger.warn({ org: item.orgId, err }, '[BSP-CREDIT] attach crashed');
            return null;
          }),
        ),
      );
      for (const o of outcomes) {
        if (o?.allocation.status === 'attached') attached += 1;
        else failed += 1;
      }
    }
    return {
      attached,
      failed,
      skipped: alreadyAttached,
      remaining: Math.max(0, total - items.length),
    };
  }

  // --- revoke --------------------------------------------------------------------------------------------------------------------

  /**
   * Stops sharing the credit line with a customer WABA. Meta first, then the row: a refusal leaves the row `attached` with
   * Meta's message in `last_error` and surfaces as 502 so the console can show it (TW-BSP-009). Reference let any row be revoked and
   * re-called Meta for a revoked one; here only an `attached` allocation can be.
   */
  async revoke(uuid: string, operatorId: number, expectedVersion?: number): Promise<RevokeResult> {
    const found = await this.reader.allocationByUuid(uuid);
    if (!found) throw AppError.notFound('Allocation');
    if (found.status !== 'attached') {
      throw new AppError(
        ERROR_CODES.BSP_ALLOCATION_NOT_ATTACHED,
        'Only an attached credit line can be revoked.',
        HttpStatus.CONFLICT,
      );
    }
    if (expectedVersion !== undefined && expectedVersion !== found.row_version) {
      throw AppError.rowVersionConflict('Allocation');
    }

    const conn = await this.settings.connection();
    const result = await this.source.revoke(conn, found.allocation_config_id ?? '');
    const orgId = Number(found.org_id);
    if (!result.ok) {
      await this.db.txAs({ orgId, userId: null }, async (tx) => {
        await this.repo.setLastError(tx, orgId, Number(found.id), result.error);
        await this.audit.record(tx, {
          event: 'platform.bsp.credit_revoke_failed',
          status: 'failure',
          orgId,
          actorType: 'platform_operator',
          actorId: operatorId,
          payload: { allocation: found.uuid, error: result.error },
        });
      });
      throw new AppError(
        ERROR_CODES.BSP_META_REJECTED,
        `Revoke failed: ${result.error}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const revoked = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const row = await this.repo.markRevoked(tx, orgId, Number(found.id), expectedVersion);
      if (!row) return null;
      await this.trail(tx, orgId, row, 'revoked', 'operator', {});
      return row;
    });
    // Meta already revoked it. The row did not move only if someone changed it during the call; report the conflict.
    if (!revoked) throw AppError.rowVersionConflict('Allocation');
    this.logger.log({ org: orgId, waba: found.waba_id }, '[BSP-CREDIT] revoked');

    return {
      allocation: toAllocation({
        ...revoked,
        org_uuid: found.org_uuid,
        org_name: found.org_name,
        bills_to_platform: found.bills_to_platform,
      }),
      workspaceStillReseller: found.bills_to_platform,
    };
  }

  // --- helpers -------------------------------------------------------------------------------------------------------------------

  /**
   * The audit row (tenant Activity Log), the security event (operator trail) and the outbox event, all in the caller's
   * transaction. The actor comes from the request when there is one; the worker's sweep has none and records `system`.
   */
  private async trail(
    tx: Tx,
    orgId: number,
    row: AllocationRow,
    outcome: 'attached' | 'failed' | 'revoked',
    origin: AttachOrigin,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const ctx = RequestContextStore.peek();
    const actorType = ctx?.actorType ?? 'system';
    const actorId = ctx?.actorId ?? null;
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
      VALUES (${orgId}, ${actorId}, ${actorType}, 'bsp', ${Number(row.id)},
              ${outcome === 'revoked' ? 'update' : 'insert'},
              ${JSON.stringify({
                status: { old: null, new: outcome },
                origin: { old: null, new: origin },
                ...Object.fromEntries(
                  Object.entries(extra)
                    .filter(([, v]) => v !== undefined)
                    .map(([k, v]) => [k, { old: null, new: v }]),
                ),
              })}::jsonb,
              ${ctx?.requestId ?? null})
    `);
    // The operator's trail (security_events). A tenant actor's change already sits in audit_log above, and the auth writer would
    // add a second, wrongly filed row for it, so only operator requests go through it.
    if (actorType === 'platform_operator') {
      await this.audit.record(tx, {
        event: `platform.bsp.credit_${outcome}`,
        status: outcome === 'failed' ? 'failure' : 'success',
        orgId,
        payload: { allocation: row.uuid, waba: row.waba_id, origin, ...extra },
      });
    }
    await this.outbox.emit(tx, {
      aggregateModule: 'bsp_credit_allocations',
      aggregateId: Number(row.id),
      eventType: `bsp.credit_allocation.${outcome}`,
      orgId,
      payload: { uuid: row.uuid, wabaId: row.waba_id, currency: row.currency, origin },
    });
  }
}
