import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  majorToMinor,
  minorToMajor,
  type ContactDealsResponse,
  type CreateDealInput,
  type DealResponse,
  type DealSource,
  type ListDealsQuery,
  type MarkDealLostInput,
  type MarkDealWonInput,
  type MoveDealStageInput,
  type PageResponse,
  type RecordScope,
  type ReopenDealInput,
  type UpdateDealInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { canActOn } from '../../../kernel/rbac/scope';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { assertContactScope } from '../contacts/contact-scope';
import { ContactsRepository } from '../contacts/contacts.repository';
import { assertOwnerWithinScope } from '../owner-scope';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertCompanyReadable, companyLinkRefused } from '../companies/company-link';
import { PipelinesRepository, type StageRow } from '../pipelines/pipelines.repository';
import { DealsPlan } from './deals-plan';
import { between, onTop } from './deal-ordering';
import { stampsForKind } from './deal-rules';
import { DEAL_MODULE, DealEngine, type LostReasonValue } from './deal-engine.service';
import { addTo, moneyList, type CurrencySums } from './deal-money';
import { dealEventPayload, toDealResponse } from './deals.mapper';
import {
  DealsRepository,
  dealScopeCondition,
  type DealFilter,
  type DealPeople,
  type DealRow,
} from './deals.repository';

const MAX_RENUMBERS = 2;

/** The filter fields every list shares, as they arrive from a query. */
export interface DealFilterInput {
  q?: string;
  ownerId?: string;
  unassigned?: boolean;
  contactId?: string;
  companyId?: string;
  source?: string;
  pipelineId?: string;
  stageId?: string;
  status?: 'open' | 'won' | 'lost';
  currency?: string;
}

/**
 * Deals (TW-DEAL-003..016). One transaction per operation: the row lock, the write, the timeline row, the audit row and the
 * outbox events commit together or not at all.
 *
 * Differences from Reference that matter to a caller (all listed in the inventory's "Port decisions"): a stage from another
 * pipeline is always 422 DEAL_STAGE_MISMATCH; an owner must be an active member; a contact or company that is not in the
 * workspace is 404, not silently dropped; a currency is never relabelled; a won deal drops a stale lost reason; the first
 * placement of a deal is a timeline row and a stage-changed event.
 */
@Injectable()
export class DealsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DealsRepository,
    private readonly pipelines: PipelinesRepository,
    private readonly contacts: ContactsRepository,
    private readonly engine: DealEngine,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly plan: DealsPlan,
  ) {}

  // --- reads -----------------------------------------------------------------------------------------------------------

  async list(query: ListDealsQuery, scope: RecordScope): Promise<PageResponse<DealResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const filter = await this.resolveFilter(tx, ctx.orgId, query);
      if (!filter)
        return { data: [], page: { nextCursor: null, hasMore: false, limit: query.limit } };
      const rows = await this.repo.list(tx, ctx.orgId, {
        filter,
        scope: dealScopeCondition(ctx.orgId, scope, ctx.userId),
        cursor: query.cursor,
        limit: query.limit,
        order: query.order,
      });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toDealResponse), page };
    });
  }

  async get(uuid: string, scope: RecordScope): Promise<DealResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Deal', uuid);
      await this.assertScope(tx, scope, row);
      return toDealResponse(row);
    });
  }

  /** The contact detail page's deals (TW-DEAL-037): open first, newest first, at most 50, with the rollup. */
  async forContact(contactUuid: string, scope: RecordScope): Promise<ContactDealsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.contacts.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      // The contact's own record scope decides whether the caller may see the contact at all.
      const contactRead = this.rbac.can(ctx.grants!, 'record.contacts.read');
      if (!contactRead.allowed) throw AppError.forbidden('record.contacts.read');
      await assertContactScope(
        tx,
        this.contacts,
        ctx.orgId,
        contactRead.scope,
        ctx.userId!,
        contact,
      );

      const rows = await this.repo.forContact(tx, ctx.orgId, contact.id, 50);
      const scoped: DealRow[] = [];
      for (const r of rows) if (await this.inScope(tx, scope, r)) scoped.push(r);
      const rollupRows = await this.repo.contactRollup(tx, ctx.orgId, contact.id);
      const open: CurrencySums = new Map();
      const won: CurrencySums = new Map();
      let openCount = 0;
      let wonCount = 0;
      for (const r of rollupRows) {
        if (r.status === 'open') {
          openCount += r.n;
          addTo(open, r.currency, r.total);
        } else {
          wonCount += r.n;
          addTo(won, r.currency, r.total);
        }
      }
      return {
        deals: scoped.map(toDealResponse),
        rollup: { openCount, openValue: moneyList(open), wonCount, wonValue: moneyList(won) },
      };
    });
  }

  // --- create / update / delete ----------------------------------------------------------------------------------------

  async create(input: CreateDealInput, source: DealSource = 'manual'): Promise<DealResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const pipeline = input.pipelineId
        ? await this.pipelines.pipelineByUuid(tx, ctx.orgId, input.pipelineId)
        : await this.pipelines.defaultPipeline(tx, ctx.orgId);
      if (!pipeline) throw AppError.notFound('Pipeline', input.pipelineId);

      let stage: StageRow | undefined;
      if (input.stageId) {
        stage = await this.pipelines.stageByUuid(tx, ctx.orgId, input.stageId);
        if (!stage) throw AppError.notFound('Stage', input.stageId);
        if (stage.pipelineId !== pipeline.id) throw stageMismatch();
      } else {
        stage = await this.pipelines.firstStage(tx, ctx.orgId, pipeline.id);
        if (!stage) {
          throw new AppError(
            ERROR_CODES.DEAL_NO_OPEN_STAGE,
            'This pipeline has no stages.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
      }

      const currency = input.currency ?? pipeline.currency;
      const valueMinor = parseValue(input.value ?? '0', currency);
      const ownerId = await this.resolveOwnerForCreate(tx, ctx.orgId, ctx.userId, input.ownerId);
      if (ctx.grants) {
        await this.assertOwnerAllowed(
          tx,
          ownerId,
          this.rbac.can(ctx.grants, 'record.deals.create').scope,
        );
      }

      let contactId: number | null = null;
      let companyId: number | null = null;
      if (input.contactId) {
        const contact = await this.repo.resolveContact(tx, ctx.orgId, input.contactId);
        if (!contact) throw AppError.notFound('Contact', input.contactId);
        contactId = contact.id;
        // A deal with no company of its own belongs to its contact's company (TW-DEAL-038: Reference never wrote it).
        companyId = contact.companyId;
      }
      if (input.companyId !== undefined) {
        companyId = await this.resolveCompany(tx, ctx.orgId, input.companyId);
      }

      const stamps = stampsForKind(stage.kind, null, new Date());
      const top = onTop(await this.repo.minOrder(tx, ctx.orgId, stage.id));
      const created = await this.repo.insert(tx, ctx.orgId, {
        pipelineId: pipeline.id,
        stageId: stage.id,
        contactId,
        companyId,
        title: input.title,
        valueMinor,
        currency,
        ownerUserId: ownerId,
        createdBy: ctx.userId ?? null,
        expectedCloseDate: input.expectedCloseDate ?? null,
        status: stamps.status,
        lostReason: null,
        source,
        sortOrder: top,
        notes: input.notes ?? null,
        wonAt: stamps.wonAt,
        lostAt: stamps.lostAt,
      });
      const row = (await this.repo.findById(tx, ctx.orgId, created.id))!;
      await this.engine.recordCreated(tx, row);
      return toDealResponse(row);
    });
  }

  /**
   * The flow Deal step (TW-FLR-037): create a deal in a stage, or move the contact's most recent open deal there (a contact with
   * none gets a new one, so the flow never dead-ends). Same plan gate as the board. A move into another pipeline takes the deal
   * with it (Reference changed only the stage and left the deal pointing at the old pipeline). The stage change goes through the deal
   * engine, so `deal.stage_changed` starts `deal_stage_changed` flows exactly as a drag does. Any refusal is an AppError the node
   * turns into its error port. Runs as the system actor: no owner unless the node names one.
   */
  async flowAction(input: {
    action: 'create' | 'move';
    stageId: string;
    title: string;
    value: string;
    ownerId: string | null;
    contact: { id: number; uuid: string } | null;
  }): Promise<{ dealId: string; status: string; created: boolean }> {
    const ctx = RequestContextStore.require();
    await this.plan.assertEnabled(ctx.orgId);
    const stage = await this.db.tx((tx) =>
      this.pipelines.stageByUuid(tx, ctx.orgId, input.stageId),
    );
    if (!stage) throw AppError.notFound('Stage', input.stageId);

    if (input.action === 'move' && input.contact) {
      const contactId = input.contact.id;
      const moved = await this.db.tx(async (tx) => {
        const [latest] = await this.repo.forContact(tx, ctx.orgId, contactId, 1);
        if (!latest || latest.status !== 'open') return null;
        const deal = (await this.repo.findById(tx, ctx.orgId, latest.id, true))!;
        if (deal.stageId === stage.id) return deal;
        const top = onTop(await this.repo.minOrder(tx, ctx.orgId, stage.id));
        return this.engine.changeStage(tx, deal, stage, { sortOrder: top });
      });
      if (moved) return { dealId: moved.uuid, status: moved.status, created: false };
    }

    const deal = await this.create(
      {
        title: input.title,
        value: input.value,
        pipelineId: stage.pipelineUuid,
        stageId: stage.uuid,
        ownerId: input.ownerId,
        ...(input.contact ? { contactId: input.contact.uuid } : {}),
      },
      'flow',
    );
    return { dealId: deal.id, status: deal.status, created: true };
  }

  async update(uuid: string, input: UpdateDealInput, scope: RecordScope): Promise<DealResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const deal = await this.lockForWrite(tx, uuid, scope);
      const patch: Parameters<DealsRepository['update']>[4] = {};

      if (input.title !== undefined) patch.title = input.title;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.expectedCloseDate !== undefined)
        patch.expected_close_date = input.expectedCloseDate;

      // The amount and its currency change together: relabelling 100 USD as 100 EUR is a different deal, never a side effect.
      const currency = input.currency ?? deal.currency;
      if (
        input.currency !== undefined &&
        input.currency !== deal.currency &&
        input.value === undefined
      ) {
        throw AppError.validation('Send the value together with a new currency', [
          { path: 'value', message: 'a currency change needs the value in the new currency' },
        ]);
      }
      if (input.value !== undefined) {
        patch.value_minor = parseValue(input.value, currency);
        patch.currency = currency;
      }

      let ownerChanged = false;
      if (input.ownerId !== undefined) {
        const next =
          input.ownerId === null
            ? null
            : await this.requireActiveUser(tx, ctx.orgId, input.ownerId);
        if (next !== deal.ownerId) {
          await this.assertOwnerAllowed(tx, next, scope);
          ownerChanged = true;
        }
        patch.owner_user_id = next;
      }

      if (input.contactId !== undefined) {
        if (input.contactId === null) {
          patch.contact_id = null;
        } else {
          const contact = await this.repo.resolveContact(tx, ctx.orgId, input.contactId);
          if (!contact) throw AppError.notFound('Contact', input.contactId);
          patch.contact_id = contact.id;
          // Linking a contact fills an empty company from it, never overwrites a company that was chosen.
          if (
            input.companyId === undefined &&
            deal.companyId === null &&
            contact.companyId !== null
          ) {
            patch.company_id = contact.companyId;
          }
        }
      }
      if (input.companyId !== undefined) {
        patch.company_id = await this.resolveCompany(
          tx,
          ctx.orgId,
          input.companyId,
          deal.companyId,
        );
      }

      const ok = await this.repo.update(tx, ctx.orgId, deal.id, input.rowVersion, patch);
      if (!ok) throw AppError.rowVersionConflict('Deal');

      const after = (await this.repo.findById(tx, ctx.orgId, deal.id))!;
      const delta = this.audit.diff(auditView(deal), auditView(after));
      if (Object.keys(delta).length > 0) {
        await this.audit.record(tx, {
          module: DEAL_MODULE,
          recordId: deal.id,
          action: 'update',
          delta,
        });
        await this.outbox.emit(tx, {
          aggregateModule: DEAL_MODULE,
          aggregateId: deal.id,
          eventType: 'deal.updated',
          payload: { ...dealEventPayload(after), changed: Object.keys(delta) },
        });
      }
      if (ownerChanged) {
        await this.outbox.emit(tx, {
          aggregateModule: DEAL_MODULE,
          aggregateId: deal.id,
          eventType: 'deal.owner_changed',
          payload: { ...dealEventPayload(after), previousOwnerId: deal.ownerUuid },
        });
      }
      return toDealResponse(after);
    });
  }

  async remove(uuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const deal = await this.lockForWrite(tx, uuid, scope);
      await this.audit.record(tx, {
        module: DEAL_MODULE,
        recordId: deal.id,
        action: 'delete',
        delta: {
          title: { old: deal.title, new: null },
          value: { old: minorToMajor(deal.valueMinor, deal.currency), new: null },
          currency: { old: deal.currency, new: null },
          stage: { old: deal.stageName, new: null },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: DEAL_MODULE,
        aggregateId: deal.id,
        eventType: 'deal.deleted',
        payload: dealEventPayload(deal),
      });
      // The timeline cascades with the deal; the audit row above is what stays.
      await this.repo.deleteById(tx, ctx.orgId, deal.id);
    });
  }

  // --- stage moves -----------------------------------------------------------------------------------------------------

  async moveStage(
    uuid: string,
    input: MoveDealStageInput,
    scope: RecordScope,
  ): Promise<DealResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const deal = await this.lockForWrite(tx, uuid, scope);
      this.checkVersion(deal, input.rowVersion);

      const target = await this.pipelines.stageByUuid(tx, ctx.orgId, input.stageId);
      if (!target) throw AppError.notFound('Stage', input.stageId);
      if (target.pipelineId !== deal.pipelineId) throw stageMismatch();

      const sortOrder = await this.resolvePosition(tx, ctx.orgId, target.id, deal.id, input);

      if (target.id === deal.stageId) {
        // Same column: a reorder, not a stage change. No timeline row, no event.
        if (sortOrder !== deal.sortOrder) {
          await this.repo.update(tx, ctx.orgId, deal.id, undefined, { sort_order: sortOrder });
        }
        return toDealResponse((await this.repo.findById(tx, ctx.orgId, deal.id))!);
      }

      const reason =
        target.kind === 'lost'
          ? await this.lostReasonFor(tx, ctx.orgId, input.lostReasonId, input.lostReason)
          : null;
      if (target.kind === 'lost') await this.assertReasonIfRequired(tx, ctx.orgId, reason);

      const after = await this.engine.changeStage(tx, deal, target, {
        sortOrder,
        lostReason: reason,
      });
      return toDealResponse(after);
    });
  }

  async markWon(uuid: string, input: MarkDealWonInput, scope: RecordScope): Promise<DealResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const deal = await this.lockForWrite(tx, uuid, scope);
      this.checkVersion(deal, input.rowVersion);
      const stage = await this.pipelines.stageOfKind(tx, ctx.orgId, deal.pipelineId, 'won');
      if (!stage) {
        throw new AppError(
          ERROR_CODES.DEAL_NO_WON_STAGE,
          'This pipeline has no Won stage.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      // Marking a won deal won again is a no-op (no timeline row, no event).
      if (deal.stageId === stage.id) return toDealResponse(deal);
      const sortOrder = onTop(await this.repo.minOrder(tx, ctx.orgId, stage.id, deal.id));
      return toDealResponse(await this.engine.changeStage(tx, deal, stage, { sortOrder }));
    });
  }

  async markLost(
    uuid: string,
    input: MarkDealLostInput,
    scope: RecordScope,
  ): Promise<DealResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const deal = await this.lockForWrite(tx, uuid, scope);
      this.checkVersion(deal, input.rowVersion);
      const stage = await this.pipelines.stageOfKind(tx, ctx.orgId, deal.pipelineId, 'lost');
      if (!stage) {
        throw new AppError(
          ERROR_CODES.DEAL_NO_LOST_STAGE,
          'This pipeline has no Lost stage.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const reason = await this.lostReasonFor(tx, ctx.orgId, input.lostReasonId, input.reason);

      if (deal.stageId === stage.id) {
        // Already lost: a new reason replaces the old one, no reason leaves it alone; neither is a stage change.
        if (reason) {
          await this.repo.update(tx, ctx.orgId, deal.id, undefined, {
            lost_reason: reason.text,
            lost_reason_id: reason.id,
          });
          const after = (await this.repo.findById(tx, ctx.orgId, deal.id))!;
          await this.audit.record(tx, {
            module: DEAL_MODULE,
            recordId: deal.id,
            action: 'update',
            delta: { lostReason: { old: deal.lostReason, new: after.lostReason } },
          });
          return toDealResponse(after);
        }
        return toDealResponse(deal);
      }

      await this.assertReasonIfRequired(tx, ctx.orgId, reason);
      const sortOrder = onTop(await this.repo.minOrder(tx, ctx.orgId, stage.id, deal.id));
      return toDealResponse(
        await this.engine.changeStage(tx, deal, stage, { sortOrder, lostReason: reason }),
      );
    });
  }

  /** Back to an open stage: the one given, else the pipeline's first open stage. Clears won/lost stamps and the reason. */
  async reopen(uuid: string, input: ReopenDealInput, scope: RecordScope): Promise<DealResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const deal = await this.lockForWrite(tx, uuid, scope);
      this.checkVersion(deal, input.rowVersion);
      let stage: StageRow | undefined;
      if (input.stageId) {
        stage = await this.pipelines.stageByUuid(tx, ctx.orgId, input.stageId);
        if (!stage) throw AppError.notFound('Stage', input.stageId);
        if (stage.pipelineId !== deal.pipelineId) throw stageMismatch();
        if (stage.kind !== 'open') {
          throw AppError.validation('Pick an open stage to reopen into', [
            { path: 'stageId', message: 'the stage is a won or lost stage' },
          ]);
        }
      } else {
        stage = await this.pipelines.stageOfKind(tx, ctx.orgId, deal.pipelineId, 'open');
        if (!stage) {
          throw new AppError(
            ERROR_CODES.DEAL_NO_OPEN_STAGE,
            'This pipeline has no open stage.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
      }
      if (deal.status === 'open' && deal.stageId === stage.id) return toDealResponse(deal);
      const sortOrder = onTop(await this.repo.minOrder(tx, ctx.orgId, stage.id, deal.id));
      return toDealResponse(await this.engine.changeStage(tx, deal, stage, { sortOrder }));
    });
  }

  // --- shared helpers --------------------------------------------------------------------------------------------------

  /** Row lock + record scope: the deal is not found for a caller whose grant does not cover its owner. */
  async lockForWrite(tx: Tx, uuid: string, scope: RecordScope): Promise<DealRow> {
    const ctx = RequestContextStore.require();
    const deal = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
    if (!deal) throw AppError.notFound('Deal', uuid);
    await this.assertScope(tx, scope, deal);
    return deal;
  }

  async inScope(tx: Tx, scope: RecordScope, deal: DealPeople): Promise<boolean> {
    const ctx = RequestContextStore.require();
    if (scope === 'all') return true;
    if (!ctx.userId) return false;
    // Owner and creator, the same people `dealScopeCondition` filters a list by (D1).
    return canActOn(tx, { orgId: ctx.orgId, userId: ctx.userId }, scope, [
      deal.ownerId,
      deal.createdBy,
    ]);
  }

  /** Not-found, never forbidden: a deal outside the caller's scope is not revealed to exist. */
  async assertScope(tx: Tx, scope: RecordScope, deal: DealPeople): Promise<void> {
    if (!(await this.inScope(tx, scope, deal))) throw AppError.notFound('Deal');
  }

  private checkVersion(deal: DealRow, expected: number | undefined): void {
    if (expected !== undefined && expected !== deal.rowVersion)
      throw AppError.rowVersionConflict('Deal');
  }

  /** uuids of a filter to internal ids. `null` means a uuid in it is not in this workspace: the answer is empty. */
  async resolveFilter(tx: Tx, orgId: number, f: DealFilterInput): Promise<DealFilter | null> {
    const out: DealFilter = {
      q: f.q,
      source: f.source,
      unassigned: f.unassigned,
      status: f.status,
      currency: f.currency,
    };
    if (f.pipelineId) {
      const p = await this.pipelines.pipelineByUuid(tx, orgId, f.pipelineId);
      if (!p) return null;
      out.pipelineId = p.id;
    }
    if (f.stageId) {
      const s = await this.pipelines.stageByUuid(tx, orgId, f.stageId);
      if (!s) return null;
      out.stageId = s.id;
    }
    if (f.ownerId) {
      const id = await this.repo.resolveUserId(tx, orgId, f.ownerId);
      if (id === undefined) return null;
      out.ownerId = id;
    }
    if (f.contactId) {
      const id = await this.repo.resolveContactId(tx, orgId, f.contactId);
      if (id === undefined) return null;
      out.contactId = id;
    }
    if (f.companyId) {
      const id = await this.repo.resolveCompanyId(tx, orgId, f.companyId);
      if (id === undefined) return null;
      out.companyId = id;
    }
    return out;
  }

  /** AZ-007: the record scope also bounds who a deal may be handed to (the caller, a teammate, or anyone for `all`). */
  private async assertOwnerAllowed(
    tx: Tx,
    nextOwnerId: number | null,
    scope: RecordScope,
  ): Promise<void> {
    const ctx = RequestContextStore.require();
    await assertOwnerWithinScope({
      scope,
      actorUserId: ctx.userId,
      nextOwnerId,
      inActorTeam: (id) => this.repo.isOwnerInActorTeam(tx, ctx.orgId, ctx.userId!, id),
      path: 'ownerId',
    });
  }

  private async requireActiveUser(tx: Tx, orgId: number, uuid: string): Promise<number> {
    const user = await this.repo.resolveActiveUser(tx, orgId, uuid);
    if (!user) {
      throw new AppError(
        ERROR_CODES.DEAL_OWNER_INVALID,
        'The owner must be an active member of this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'ownerId', message: uuid }],
      );
    }
    return user.id;
  }

  /** Omitted owner is the caller; `null` is no owner; a uuid must be an active member (Reference accepted any integer). */
  private async resolveOwnerForCreate(
    tx: Tx,
    orgId: number,
    actorUserId: number | null,
    ownerId: string | null | undefined,
  ): Promise<number | null> {
    if (ownerId === undefined) return actorUserId;
    if (ownerId === null) return null;
    return this.requireActiveUser(tx, orgId, ownerId);
  }

  /** A company to link: in this workspace (404 otherwise), and, when the link is new, one the caller may read (capability and record scope). */
  private async resolveCompany(
    tx: Tx,
    orgId: number,
    companyId: string | null,
    current: number | null = null,
  ): Promise<number | null> {
    if (companyId === null) return null;
    const id = await this.repo.resolveCompanyId(tx, orgId, companyId);
    if (id === undefined) throw companyLinkRefused('notFound');
    if (id !== current) await assertCompanyReadable(tx, this.rbac, orgId, id);
    return id;
  }

  /** The reason as the deal keeps it, from a catalogue id and/or free text; null when neither is given. */
  async lostReasonFor(
    tx: Tx,
    orgId: number,
    reasonId: string | undefined,
    text: string | undefined,
  ): Promise<LostReasonValue | null> {
    if (reasonId) {
      const row = await this.pipelines.reasonByUuid(tx, orgId, reasonId);
      if (!row) throw AppError.notFound('Lost reason', reasonId);
      if (!row.isActive) {
        throw AppError.validation('That lost reason is no longer in use', [
          { path: 'lostReasonId', message: 'inactive' },
        ]);
      }
      return { text: row.name, id: row.id };
    }
    if (text) return { text, id: null };
    return null;
  }

  private async assertReasonIfRequired(
    tx: Tx,
    orgId: number,
    reason: LostReasonValue | null,
  ): Promise<void> {
    if (reason) return;
    const settings = await this.pipelines.settings(tx, orgId);
    if (!settings.lostReasonRequired) return;
    throw new AppError(
      ERROR_CODES.DEAL_LOST_REASON_REQUIRED,
      'This workspace requires a reason when a deal is lost.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'lostReasonId', message: 'required' }],
    );
  }

  /** Where a dropped card lands in its column (TW-DEAL-007, D-07). */
  private async resolvePosition(
    tx: Tx,
    orgId: number,
    stageId: number,
    dealId: number,
    input: Pick<MoveDealStageInput, 'beforeDealId' | 'afterDealId'>,
  ): Promise<bigint> {
    const anchorUuid = input.beforeDealId ?? input.afterDealId;
    if (!anchorUuid) return onTop(await this.repo.minOrder(tx, orgId, stageId, dealId));

    for (let attempt = 0; attempt <= MAX_RENUMBERS; attempt++) {
      const anchor = await this.repo.anchor(tx, orgId, anchorUuid);
      if (!anchor || anchor.stageId !== stageId || anchor.id === dealId) {
        throw new AppError(
          ERROR_CODES.DEAL_POSITION_INVALID,
          'The deal to drop next to is not in that stage.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: input.beforeDealId ? 'beforeDealId' : 'afterDealId', message: anchorUuid }],
        );
      }
      const result = input.beforeDealId
        ? between(await this.repo.cardAbove(tx, orgId, stageId, anchor, dealId), anchor.sortOrder)
        : between(anchor.sortOrder, await this.repo.cardBelow(tx, orgId, stageId, anchor, dealId));
      if (result.kind === 'value') return result.order;
      await this.repo.renumber(tx, orgId, stageId, dealId);
    }
    throw new AppError(
      ERROR_CODES.DEAL_POSITION_INVALID,
      'Could not find room to drop the deal there.',
      HttpStatus.CONFLICT,
    );
  }
}

function stageMismatch(): AppError {
  return new AppError(
    ERROR_CODES.DEAL_STAGE_MISMATCH,
    "That stage belongs to a different pipeline than the deal's.",
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path: 'stageId', message: "not in the deal's pipeline" }],
  );
}

function parseValue(value: string, currency: string): bigint {
  const minor = majorToMinor(value, currency);
  if (minor === null) {
    throw new AppError(
      ERROR_CODES.DEAL_VALUE_INVALID,
      `"${value}" is not a valid amount in ${currency}.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'value', message: 'too many decimals for the currency, or above 99,999,999' }],
    );
  }
  return minor;
}

/** The fields an update's audit row compares; ids are uuids, never internal. */
function auditView(r: DealRow): Record<string, unknown> {
  return {
    title: r.title,
    value: minorToMajor(r.valueMinor, r.currency),
    currency: r.currency,
    owner: r.ownerUuid,
    contact: r.contactUuid,
    company: r.companyUuid,
    expectedCloseDate: r.expectedCloseDate,
    notes: r.notes,
  };
}
