import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  RECURRING_CATCH_UP_MAX,
  createInvoiceSchema,
  minorToMajor,
  occurrenceDate,
  upcomingRuns,
  type CreateInvoiceInput,
  type CreateRecurringInvoiceInput,
  type InvoiceResponse,
  type ListRecurringInvoicesQuery,
  type PageResponse,
  type RecordScope,
  type RecurringFrequency,
  type RecurringInvoiceResponse,
  type RecurringRunsResponse,
  type UpdateRecurringInvoiceInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { resolveTimezone, todayIn } from '../deals/deal-calendar';
import { priceInvoice } from './invoice-content';
import { InvoiceSettingsService } from './invoice-settings.service';
import { invoiceEventPayload } from './invoices.mapper';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import {
  RecurringInvoicesRepository,
  recurringScopeCondition,
  type RecurringRow,
} from './recurring-invoices.repository';

export const RECURRING_MODULE = 'recurring-invoices';

const bad = (code: string, message: string, status: HttpStatus, details?: Array<{ path: string; message: string }>) =>
  new AppError(code as never, message, status, details);

interface Shape {
  startDate: string;
  frequency: RecurringFrequency;
  interval: number;
  endDate: string | null;
  maxRuns: number | null;
}

/** The date of period `index`, or null when the schedule is past its end date or its run cap. */
export function dateOfPeriod(s: Shape, index: number): string | null {
  if (s.maxRuns != null && index >= s.maxRuns) return null;
  const d = occurrenceDate(s.startDate, s.frequency, s.interval, index);
  if (s.endDate && d > s.endDate) return null;
  return d;
}

/** The first period whose date is today or later, never before `floor`. Null when the schedule has no such period. */
export function firstPeriodFrom(s: Shape, today: string, floor: number): { index: number; date: string } | null {
  let i = floor;
  // bounded: a daily schedule that began years ago still lands within a few thousand steps
  for (let guard = 0; guard < 20_000; guard++, i++) {
    const d = dateOfPeriod(s, i);
    if (d === null) return null;
    if (d >= today) return { index: i, date: d };
  }
  return null;
}

/**
 * Recurring invoices. The schedule row, its run history and every invoice it makes move together: a period is claimed in the run
 * table first (the unique key is the idempotency), the invoice is made in a savepoint (a failure is recorded, not thrown, so one
 * broken schedule never blocks the others), and the schedule advances in the same transaction.
 */
@Injectable()
export class RecurringInvoicesService {
  private readonly logger = new Logger(RecurringInvoicesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RecurringInvoicesRepository,
    private readonly invoices: InvoicesService,
    private readonly invoicesRepo: InvoicesRepository,
    private readonly settings: InvoiceSettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // --- reads -----------------------------------------------------------------------------------------------------------------------

  async list(query: ListRecurringInvoicesQuery, scope: RecordScope): Promise<PageResponse<RecurringInvoiceResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query, recurringScopeCondition(ctx.orgId, scope, ctx.userId));
      const page = buildPage(rows, query.limit);
      const data: RecurringInvoiceResponse[] = [];
      for (const r of page.items) data.push(await this.toResponse(tx, ctx.orgId, r));
      return { data, page: page.page };
    });
  }

  async get(uuid: string, scope: RecordScope): Promise<RecurringInvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope);
      return this.toResponse(tx, ctx.orgId, row);
    });
  }

  async runs(uuid: string, query: { limit: number; cursor?: string }, scope: RecordScope): Promise<RecurringRunsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope);
      const before = query.cursor ? Number(Buffer.from(query.cursor, 'base64url').toString('utf8')) : undefined;
      const rows = await this.repo.runs(tx, ctx.orgId, row.id, query.limit, Number.isFinite(before) ? before : undefined);
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map((r) => ({
          id: String(r.id),
          periodIndex: r.periodIndex,
          periodDate: r.periodDate,
          status: r.status,
          invoice: r.invoiceUuid ? { id: r.invoiceUuid, number: r.invoiceNumber } : null,
          error: r.error,
          at: r.createdAt.toISOString(),
        })),
        page: {
          nextCursor: hasMore && last ? Buffer.from(String(last.periodIndex), 'utf8').toString('base64url') : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  // --- writes ----------------------------------------------------------------------------------------------------------------------

  async create(input: CreateRecurringInvoiceInput, scope: RecordScope): Promise<RecurringInvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const profile = await this.settings.load(tx, ctx.orgId);
      const today = todayIn(resolveTimezone(profile.timezone));
      const template = await this.templateOf(tx, input, scope);
      // Validates everything the invoice would be (buyer, links, lines, tax) now, so a broken template fails here and not at 3 a.m.
      const spec = await this.invoices.specFromInput(tx, ctx.orgId, ctx.userId, template, { source: 'recurring' });
      const shape: Shape = {
        startDate: input.startDate,
        frequency: input.frequency,
        interval: input.interval,
        endDate: input.endDate ?? null,
        maxRuns: input.maxRuns ?? null,
      };
      let missed = 0;
      for (let i = 0; i < 1000; i++) {
        const d = dateOfPeriod(shape, i);
        if (d === null || d >= today) break;
        missed++;
      }
      if (missed > RECURRING_CATCH_UP_MAX)
        throw bad(
          ERROR_CODES.REC_START_TOO_OLD,
          `The start date is ${missed} periods in the past: at most ${RECURRING_CATCH_UP_MAX} are caught up. Start from a later date`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'startDate', message: 'too far in the past' }],
        );
      const first = dateOfPeriod(shape, 0);
      if (first === null)
        throw AppError.validation('The schedule has no period before its end date', [{ path: 'endDate', message: 'before the first period' }]);
      const id = await this.repo.insert(tx, ctx.orgId, {
        name: input.name,
        frequency: input.frequency,
        interval: input.interval,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        maxRuns: input.maxRuns ?? null,
        mode: input.mode,
        sendChannel: input.sendChannel,
        template,
        contactId: spec.contactId,
        companyId: spec.companyId,
        dealId: spec.dealId,
        ownerId: spec.ownerId,
        createdBy: ctx.userId,
        nextRunDate: first,
      });
      const row = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.audit.record(tx, {
        module: RECURRING_MODULE,
        recordId: id,
        action: 'insert',
        delta: {
          name: { old: null, new: row.name },
          frequency: { old: null, new: `${row.interval} ${row.frequency}` },
          startDate: { old: null, new: row.startDate },
          mode: { old: null, new: row.mode },
        },
      });
      await this.emit(tx, 'recurring_invoice.created', row);
      return this.toResponse(tx, ctx.orgId, row);
    });
  }

  async update(uuid: string, input: UpdateRecurringInvoiceInput, scope: RecordScope): Promise<RecurringInvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope, true);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Recurring invoice');
      if (row.status === 'ended') throw bad(ERROR_CODES.REC_ENDED, 'The schedule has ended', HttpStatus.CONFLICT);
      const profile = await this.settings.load(tx, ctx.orgId);
      const today = todayIn(resolveTimezone(profile.timezone));
      const patch: Parameters<RecurringInvoicesRepository['update']>[4] = {};
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      const set = <K extends keyof typeof patch>(k: K, v: (typeof patch)[K], old: unknown) => {
        patch[k] = v;
        delta[k as string] = { old, new: v };
      };
      if (input.name !== undefined && input.name !== row.name) set('name', input.name, row.name);
      if (input.mode !== undefined && input.mode !== row.mode) set('mode', input.mode, row.mode);
      if (input.sendChannel !== undefined && input.sendChannel !== row.sendChannel) set('sendChannel', input.sendChannel, row.sendChannel);
      if (input.endDate !== undefined && (input.endDate ?? null) !== row.endDate) set('endDate', input.endDate ?? null, row.endDate);
      if (input.maxRuns !== undefined && (input.maxRuns ?? null) !== row.maxRuns) set('maxRuns', input.maxRuns ?? null, row.maxRuns);
      if (input.frequency !== undefined && input.frequency !== row.frequency) set('frequency', input.frequency, row.frequency);
      if (input.interval !== undefined && input.interval !== row.interval) set('interval', input.interval, row.interval);
      if (input.template !== undefined) {
        const { issueDate: _i, dueDate: _d, ...template } = input.template as CreateInvoiceInput;
        void _i;
        void _d;
        const spec = await this.invoices.specFromInput(tx, ctx.orgId, ctx.userId, template, { source: 'recurring' });
        patch.template = template;
        patch.contactId = spec.contactId;
        patch.companyId = spec.companyId;
        patch.dealId = spec.dealId;
        delta.template = { old: true, new: true };
      }
      const shape: Shape = {
        startDate: row.startDate,
        frequency: patch.frequency ? (patch.frequency as RecurringFrequency) : row.frequency,
        interval: patch.interval ?? row.interval,
        endDate: patch.endDate !== undefined ? patch.endDate : row.endDate,
        maxRuns: patch.maxRuns !== undefined ? patch.maxRuns : row.maxRuns,
      };
      if (shape.endDate && shape.endDate < row.startDate)
        throw AppError.validation('The end date is before the start date', [{ path: 'endDate', message: 'before the start date' }]);
      if (patch.frequency || patch.interval || patch.endDate !== undefined || patch.maxRuns !== undefined) {
        // A changed schedule continues from today (never over a period that already ran).
        const floor = Math.max(row.nextIndex, (await this.repo.maxRunIndex(tx, ctx.orgId, row.id)) + 1);
        const next = patch.frequency || patch.interval ? firstPeriodFrom(shape, today, floor) : firstPeriodFrom(shape, '0000-01-01', floor);
        patch.nextIndex = next ? next.index : floor;
        patch.nextRunDate = next ? next.date : null;
        if (!next) patch.status = 'ended';
      }
      if (Object.keys(patch).length === 0) return this.toResponse(tx, ctx.orgId, row);
      const ok = await this.repo.update(tx, ctx.orgId, row.id, input.rowVersion, patch);
      if (!ok) throw AppError.rowVersionConflict('Recurring invoice');
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.audit.record(tx, { module: RECURRING_MODULE, recordId: row.id, action: 'update', delta });
      await this.emit(tx, 'recurring_invoice.updated', after);
      return this.toResponse(tx, ctx.orgId, after);
    });
  }

  async pause(uuid: string, scope: RecordScope): Promise<RecurringInvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope, true);
      if (row.status === 'ended') throw bad(ERROR_CODES.REC_ENDED, 'The schedule has ended', HttpStatus.CONFLICT);
      if (row.status === 'paused') return this.toResponse(tx, ctx.orgId, row);
      await this.repo.update(tx, ctx.orgId, row.id, null, { status: 'paused' });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.audit.record(tx, { module: RECURRING_MODULE, recordId: row.id, action: 'update', delta: { status: { old: 'active', new: 'paused' } } });
      await this.emit(tx, 'recurring_invoice.paused', after);
      return this.toResponse(tx, ctx.orgId, after);
    });
  }

  /** Resuming skips the periods that fell while it was paused (no flood of back-dated invoices): the next one is today's or later. */
  async resume(uuid: string, scope: RecordScope): Promise<RecurringInvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope, true);
      if (row.status === 'ended') throw bad(ERROR_CODES.REC_ENDED, 'The schedule has ended', HttpStatus.CONFLICT);
      if (row.status === 'active') return this.toResponse(tx, ctx.orgId, row);
      const profile = await this.settings.load(tx, ctx.orgId);
      const today = todayIn(resolveTimezone(profile.timezone));
      const floor = Math.max(row.nextIndex, (await this.repo.maxRunIndex(tx, ctx.orgId, row.id)) + 1);
      const next = firstPeriodFrom(row, today, floor);
      await this.repo.update(tx, ctx.orgId, row.id, null, {
        status: next ? 'active' : 'ended',
        nextIndex: next ? next.index : floor,
        nextRunDate: next ? next.date : null,
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.audit.record(tx, { module: RECURRING_MODULE, recordId: row.id, action: 'update', delta: { status: { old: 'paused', new: after.status } } });
      await this.emit(tx, 'recurring_invoice.resumed', after);
      return this.toResponse(tx, ctx.orgId, after);
    });
  }

  /** Generates the next period now, ahead of its date (the schedule then moves on to the period after). */
  async runNow(uuid: string, scope: RecordScope): Promise<RecurringInvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope, true);
      if (row.status === 'ended' || row.nextRunDate === null)
        throw bad(ERROR_CODES.REC_ENDED, 'The schedule has ended: nothing is left to run', HttpStatus.CONFLICT);
      await this.generateIn(tx, ctx.orgId, ctx.userId, row, row.nextIndex, row.nextRunDate);
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      return this.toResponse(tx, ctx.orgId, after);
    });
  }

  async remove(uuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope, true);
      await this.audit.record(tx, { module: RECURRING_MODULE, recordId: row.id, action: 'delete', delta: { name: { old: row.name, new: null } } });
      await this.emit(tx, 'recurring_invoice.deleted', row);
      // Invoices already generated stay (their recurring_id is cleared by the foreign key).
      await this.repo.delete(tx, ctx.orgId, row.id);
    });
  }

  // --- the worker ------------------------------------------------------------------------------------------------------------------

  /** Schedules due in their workspace's calendar, across tenants (the worker uses this; the caller runs each in its own context). */
  due(limit: number): Promise<Array<{ orgId: number; id: number }>> {
    return this.db.privileged((tx) => this.repo.dueAcrossTenants(tx, limit));
  }

  /**
   * One worker pass over one schedule, inside the schedule's workspace context: every period whose date has come (up to the
   * catch-up cap), in order. Idempotent: the run table's unique key stops a period from being generated twice, whoever tries.
   */
  async runDue(orgId: number, id: number): Promise<number> {
    return this.db.tx(async (tx) => {
      if (!(await this.repo.lockForRun(tx, orgId, id))) return 0; // being run by another worker
      const profile = await this.settings.load(tx, orgId);
      const today = todayIn(resolveTimezone(profile.timezone));
      let made = 0;
      for (let step = 0; step < RECURRING_CATCH_UP_MAX; step++) {
        const row = await this.repo.findById(tx, orgId, id);
        if (!row || row.status !== 'active' || row.nextRunDate === null || row.nextRunDate > today) break;
        if (await this.generateIn(tx, orgId, null, row, row.nextIndex, row.nextRunDate)) made++;
      }
      return made;
    });
  }

  /**
   * Claims period `index`, makes its invoice in a savepoint, records the outcome and moves the schedule on. Returns whether an
   * invoice was made. A period that fails is recorded as failed and skipped (the history shows why); a period that was already
   * claimed is skipped without a second invoice.
   */
  private async generateIn(
    tx: Tx,
    orgId: number,
    actorUserId: number | null,
    row: RecurringRow,
    index: number,
    periodDate: string,
  ): Promise<boolean> {
    const nextIndex = index + 1;
    const nextDate = dateOfPeriod(row, nextIndex);
    const runId = await this.repo.claimRun(tx, orgId, row.id, index, periodDate);
    if (runId === null) {
      await this.repo.advance(tx, orgId, row.id, { nextIndex, nextRunDate: nextDate, ok: true });
      return false;
    }
    let invoice: { id: number; uuid: string; number: string | null } | null = null;
    let error: string | null = null;
    try {
      invoice = await tx.transaction(async (sp) => this.makeInvoice(sp, orgId, actorUserId, row, index, periodDate));
    } catch (err) {
      error = (err instanceof AppError ? err.message : err instanceof Error ? err.message : 'unknown error').slice(0, 500);
      this.logger.warn({ recurring: row.uuid, index, error }, 'recurring invoice generation failed');
    }
    await this.repo.finishRun(tx, orgId, runId, { invoiceId: invoice?.id ?? null, error });
    await this.repo.advance(tx, orgId, row.id, { nextIndex, nextRunDate: nextDate, ok: error === null });
    const after = (await this.repo.findById(tx, orgId, row.id))!;
    if (error === null && invoice) {
      await this.emit(tx, 'recurring_invoice.generated', after, { invoiceId: invoice.uuid, invoiceNumber: invoice.number, periodDate, periodIndex: index });
    } else {
      await this.emit(tx, 'recurring_invoice.failed', after, { periodDate, periodIndex: index, error });
    }
    if (after.status === 'ended') await this.emit(tx, 'recurring_invoice.ended', after);
    return error === null;
  }

  private async makeInvoice(
    tx: Tx,
    orgId: number,
    actorUserId: number | null,
    row: RecurringRow,
    index: number,
    periodDate: string,
  ): Promise<{ id: number; uuid: string; number: string | null }> {
    const template = createInvoiceSchema.parse({ ...row.template, issueDate: periodDate, dueDate: null });
    const spec = await this.invoices.specFromInput(tx, orgId, actorUserId ?? row.createdBy, template, {
      source: 'recurring',
      metaJson: { recurringId: row.uuid, periodIndex: index, periodDate },
    });
    // The schedule's people win over the creator-as-default: the owner is the schedule's owner.
    spec.ownerId = row.ownerId ?? spec.ownerId;
    let inv = await this.invoices.createDraftIn(tx, orgId, actorUserId, spec);
    await this.repo.tagInvoice(tx, orgId, inv.id, row.id);
    if (row.mode !== 'draft') {
      inv = await this.invoices.issueIn(tx, orgId, actorUserId, inv, { issueDate: periodDate });
    }
    if (row.mode === 'issue_send') {
      if (row.sendChannel === 'email' && !inv.buyerEmail) throw new Error('The invoice has no buyer email to send to');
      await this.invoicesRepo.markSent(tx, orgId, inv.id, row.sendChannel);
      await this.invoicesRepo.log(tx, orgId, inv.id, { event: 'sent', detail: row.sendChannel, actorKind: 'system' });
      inv = (await this.invoicesRepo.findById(tx, orgId, inv.id, await this.invoices.zone(tx, orgId)))!;
      await this.outbox.emit(tx, {
        aggregateModule: 'invoices',
        aggregateId: inv.id,
        eventType: 'invoice.sent',
        payload: { ...invoiceEventPayload(inv), channel: row.sendChannel, message: null, recurringId: row.uuid },
      });
    }
    return { id: inv.id, uuid: inv.uuid, number: inv.number };
  }

  // --- helpers ---------------------------------------------------------------------------------------------------------------------

  private async load(tx: Tx, uuid: string, scope: RecordScope, forUpdate = false): Promise<RecurringRow> {
    const ctx = RequestContextStore.require();
    const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, forUpdate);
    if (!row) throw AppError.notFound('Recurring invoice', uuid);
    if (scope !== 'all' && !(await this.repo.visible(tx, ctx.orgId, row.id, recurringScopeCondition(ctx.orgId, scope, ctx.userId))))
      throw AppError.notFound('Recurring invoice', uuid);
    return row;
  }

  /** The template to store: the body as given, or a copy of an existing invoice's content. Never the dates. */
  private async templateOf(tx: Tx, input: CreateRecurringInvoiceInput, scope: RecordScope): Promise<CreateInvoiceInput> {
    if (input.fromInvoiceId) {
      const inv = await this.invoices.get(input.fromInvoiceId, scope);
      return templateFromInvoice(inv);
    }
    void tx;
    const { issueDate: _i, dueDate: _d, ...rest } = input.template as CreateInvoiceInput;
    void _i;
    void _d;
    return rest as CreateInvoiceInput;
  }

  private async toResponse(tx: Tx, orgId: number, row: RecurringRow): Promise<RecurringInvoiceResponse> {
    const profile = await this.settings.load(tx, orgId);
    const tpl = row.template as Partial<CreateInvoiceInput>;
    const currency = (tpl.currency as string | undefined) ?? profile.currency;
    let amount = minorToMajor(0n, currency);
    try {
      const spec = await this.invoices.specFromInput(tx, orgId, row.createdBy, createInvoiceSchema.parse({ ...row.template, issueDate: null, dueDate: null }), { source: 'recurring' });
      const priced = priceInvoice({ currency: spec.currency, specs: spec.lines, discount: spec.discount, shipping: spec.shipping, reverseCharge: spec.reverseCharge });
      amount = minorToMajor(priced.totals.totalMinor, spec.currency);
    } catch {
      // a template that no longer prices (a deleted tax rate): the failure shows in the run history, the list still renders
    }
    const upcoming =
      row.status === 'ended'
        ? []
        : upcomingRuns({
            start: row.startDate,
            frequency: row.frequency,
            interval: row.interval,
            fromIndex: row.nextIndex,
            end: row.endDate,
            maxRuns: row.maxRuns,
            count: 5,
          }).map((u) => u.date);
    return {
      id: row.uuid,
      name: row.name,
      status: row.status,
      frequency: row.frequency,
      interval: row.interval,
      startDate: row.startDate,
      endDate: row.endDate,
      maxRuns: row.maxRuns,
      mode: row.mode,
      sendChannel: row.sendChannel,
      nextRunDate: row.nextRunDate,
      lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
      runCount: row.runCount,
      failureCount: row.failureCount,
      upcoming,
      buyerName: (tpl.buyerName as string | null | undefined) ?? row.contactName ?? null,
      currency,
      amount,
      contact: row.contactUuid ? { id: row.contactUuid, name: row.contactName } : null,
      lineCount: Array.isArray(tpl.lines) ? tpl.lines.length : 0,
      rowVersion: row.rowVersion,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private emit(tx: Tx, eventType: string, row: RecurringRow, extra: Record<string, unknown> = {}): Promise<void> {
    return this.outbox.emit(tx, {
      aggregateModule: RECURRING_MODULE,
      aggregateId: row.id,
      eventType,
      payload: {
        uuid: row.uuid,
        name: row.name,
        status: row.status,
        frequency: row.frequency,
        interval: row.interval,
        nextRunDate: row.nextRunDate,
        runCount: row.runCount,
        contactId: row.contactUuid,
        ...extra,
      },
    });
  }
}

/** An existing invoice's content as a template: what a new invoice of the same kind would be created from. */
export function templateFromInvoice(inv: InvoiceResponse): CreateInvoiceInput {
  return {
    docType: inv.docType === 'receipt' ? 'tax_invoice' : (inv.docType as 'tax_invoice' | 'proforma'),
    buyerName: inv.buyer.name,
    buyerEmail: inv.buyer.email,
    buyerPhone: inv.buyer.phone,
    buyerAddress: inv.buyer.address,
    buyerTaxId: inv.buyer.taxId,
    buyerCountry: inv.buyer.country,
    contactId: inv.contact?.id ?? null,
    companyId: inv.company?.id ?? null,
    dealId: inv.deal?.id ?? null,
    ownerId: inv.owner?.id ?? null,
    currency: inv.currency,
    taxRegime: inv.taxRegime,
    taxMode: inv.taxExplanation ? 'auto' : 'rates',
    placeOfSupply: inv.placeOfSupply,
    reverseCharge: inv.reverseCharge,
    reference: inv.reference,
    discount: inv.discount,
    shipping: inv.amounts.shipping !== minorToMajor(0n, inv.currency) ? inv.amounts.shipping : null,
    notes: inv.notes,
    terms: inv.terms,
    legalNotes: inv.legalNotes,
    lines: inv.lines.map((l) => ({
      description: l.description,
      sku: l.sku,
      hsnSac: l.hsnSac,
      qty: l.qty,
      unitPrice: l.unitPrice,
      discount: l.discount,
      taxRateId: l.taxRateId,
    })),
  } as CreateInvoiceInput;
}
