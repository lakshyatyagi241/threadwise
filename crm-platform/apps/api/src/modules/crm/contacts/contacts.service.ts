import { Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { ERROR_CODES, canonicalizePhone, composeDisplayName } from '@crm/contracts';
import type {
  AssigneeResponse,
  BulkResult,
  BulkUpdateContactsInput,
  ContactListResponse,
  ContactResponse,
  ContactSelectItem,
  ContactSelectQuery,
  CreateContactInput,
  FieldHistoryEntry,
  ListContactsQuery,
  ListFieldHistoryQuery,
  PageResponse,
  RecordScope,
  SetContactAssigneeInput,
  UpdateContactInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { DisplayIdService } from '../../../kernel/identifiers/display-id.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { resolveContactFilter } from './contact-filter.resolver';
import { stageEntryValues } from './contact-stage';
import { planStatus } from './contact-status-stage';
import { assertFormFieldLimits } from './form-field-limits';
import { missingRequired, requiredPropertiesError } from './required-properties';
import { ContactQuotaService } from './contact-quota.service';
import { assertContactScope } from './contact-scope';
import { toContactResponse } from './contacts.mapper';
import { ContactsRepository } from './contacts.repository';

const MODULE_KEY = 'contacts';
const DISPLAY_PREFIX = 'CON';

/**
 * Contacts — the reference implementation.
 *
 * The shape every other module follows:
 *   1. one transaction per operation, opened by DatabaseService.tx()
 *   2. the write, the audit row and the outbox event all inside it
 *   3. uuid -> internal id resolution at the edge, never deeper
 *   4. optimistic locking on update, 409 on a lost race
 */
@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly displayIds: DisplayIdService,
    private readonly rbac: RbacService,
    private readonly quota: ContactQuotaService,
  ) {}

  async list(query: ListContactsQuery, scope: RecordScope): Promise<ContactListResponse> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const resolution = await resolveContactFilter(tx, ctx.orgId, query);

      // A filter that names a uuid that does not exist (an owner, a group, a tag) must return
      // nothing, not "ignore the filter and return everything".
      if (resolution.empty) {
        return {
          data: [],
          page: { nextCursor: null, hasMore: false, limit: query.limit },
          ...(query.includeTotal ? { meta: { total: 0 } } : {}),
        };
      }

      const rows = await this.repo.list(tx, ctx.orgId, {
        limit: query.limit,
        cursor: query.cursor,
        order: query.order,
        filter: resolution.filter,
        scope,
        actorUserId: ctx.userId,
      });

      const { items, page } = buildPage(rows, query.limit);

      const ids = items.map((i) => i.id);
      const groupChips = query.expand?.includes('groups')
        ? await this.repo.groupChips(tx, ctx.orgId, ids)
        : undefined;
      const tagChips = query.expand?.includes('tags')
        ? await this.repo.tagChips(tx, ctx.orgId, ids)
        : undefined;
      const data = items.map((row) =>
        toContactResponse(row, {
          groups: groupChips?.filter((c) => c.contactId === row.id),
          tags: tagChips?.filter((c) => c.contactId === row.id),
        }),
      );

      const total = query.includeTotal
        ? await this.repo.count(tx, ctx.orgId, resolution.filter, scope, ctx.userId)
        : undefined;
      return { data, page, ...(total !== undefined ? { meta: { total } } : {}) };
    });
  }

  /** The stat tiles and sidebar counts: workspace-wide, inside the caller's record scope. */
  async stats(scope: RecordScope) {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const s = await this.repo.stats(tx, ctx.orgId, scope, ctx.userId);
      return { ...s, grouped: s.total - s.noGroup };
    });
  }

  async getByUuid(uuid: string): Promise<ContactResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Contact', uuid);
      const { scope } = this.rbac.can(ctx.grants!, 'record.contacts.read');
      await assertContactScope(tx, this.repo, ctx.orgId, scope, ctx.userId!, row.ownerId);
      return toContactResponse(row);
    });
  }

  async create(input: CreateContactInput): Promise<ContactResponse> {
    const ctx = RequestContextStore.require();

    // One canonicaliser for create, import and dedupe (TW-CON-013). The contract already insists
    // on E.164, so this normally changes nothing; it is what keeps the identity key identical to
    // the one the importer writes for the same number.
    const phone = input.phone
      ? (canonicalizePhone({ number: input.phone })?.e164 ?? input.phone)
      : undefined;

    return this.db.tx(async (tx) => {
      const ownerId = input.ownerId
        ? await this.requireUser(tx, ctx.orgId, input.ownerId)
        : ctx.userId;
      const companyId = input.companyId
        ? await this.requireCompany(tx, ctx.orgId, input.companyId)
        : null;

      // Identity-first dedup: if this email or phone already belongs to a
      // contact in this org, that contact IS this person. Creating a second
      // row would fork their timeline across channels, which is precisely
      // what contact_identities exists to prevent.
      const existingId =
        (input.email
          ? await this.repo.findByIdentity(tx, ctx.orgId, 'email', input.email)
          : undefined) ??
        (phone ? await this.repo.findByIdentity(tx, ctx.orgId, 'phone', phone) : undefined);

      if (existingId !== undefined) {
        const existing = await this.repo.findById(tx, ctx.orgId, existingId);
        if (existing) {
          this.logger.log(
            { orgId: ctx.orgId, contactId: existingId },
            'contact create matched an existing identity — returning the existing contact',
          );
          return toContactResponse(existing);
        }
      }

      assertFormFieldLimits(input.customFields);
      // Properties the workspace marked required (Contact properties screen) are part of the contract of a create.
      await this.assertRequiredProperties(tx, ctx.orgId, input.customFields);

      // Plan cap (TW-CON-026): every way of adding a contact counts, not only the UI's.
      await this.quota.assertCanAddOne(tx, ctx.orgId);

      // No stage chosen: the workspace's default stage (Contact stages screen), else the column default.
      const stage =
        input.lifecycleStage ??
        (await this.repo.defaultOptionValue(tx, ctx.orgId, 'lifecycle_stage'));
      // A contact created straight into a won or lost stage is stamped, and a lost one needs its reason.
      const stageValues = stage
        ? stageEntryValues({
            flags: await this.repo.stageFlags(tx, ctx.orgId, stage),
            current: { wonAt: null, lostAt: null, lostReason: null, otherLostReason: null },
            lostReason: input.lostReason,
            otherLostReason: input.otherLostReason,
            now: new Date(),
          })
        : {};

      // The status must belong to the stage the contact starts in; none given = the stage's default status, if it has one.
      const startStage = stage ?? 'new';
      const statusCtx = await this.repo.statusContext(tx, ctx.orgId);
      const statusPlan = planStatus({
        scope: statusCtx.scope,
        stage: startStage,
        stageLabel: statusCtx.stageLabels.get(startStage) ?? null,
        stageChanged: true,
        current: null,
        requested: input.status,
      });

      const displayId = await this.displayIds.next(tx, ctx.orgId, MODULE_KEY, DISPLAY_PREFIX);

      const created = await this.repo.insert(tx, ctx.orgId, {
        // The display name is the typed name, else first + last. Never the title (TW-CON-012).
        name: composeDisplayName({
          name: input.name,
          firstName: input.firstName,
          lastName: input.lastName,
        }),
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone,
        companyId,
        ownerId,
        lifecycleStage: stage,
        lostReason: input.lostReason,
        otherLostReason: input.otherLostReason,
        wonAt: (stageValues.wonAt as Date | null | undefined) ?? null,
        lostAt: (stageValues.lostAt as Date | null | undefined) ?? null,
        status: statusPlan.status ?? undefined,
        leadScore: input.leadScore,
        whatsappSubscriptionStatus: input.whatsappSubscriptionStatus,
        smsSubscriptionStatus: input.smsSubscriptionStatus,
        emailSubscriptionStatus: input.emailSubscriptionStatus,
        emailConfirmed: input.emailConfirmed,
        faxNumber: input.faxNumber,
        source: input.source,
        isUnsubscribed: input.isUnsubscribed === true,
        unsubscribedAt: input.isUnsubscribed === true ? new Date() : null,
        data: input.customFields,
        displayId,
        createdBy: ctx.userId,
      });

      if (input.email) {
        await this.repo.addIdentity(tx, ctx.orgId, created.id, 'email', input.email);
      }
      if (phone) {
        await this.repo.addIdentity(tx, ctx.orgId, created.id, 'phone', phone);
      }

      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: created.id,
        action: 'insert',
      });

      // Same transaction as the insert — see OutboxService for why that is
      // not negotiable.
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact.created',
        payload: { uuid: created.uuid, displayId, email: input.email, phone },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return toContactResponse(row!);
    });
  }

  async update(uuid: string, input: UpdateContactInput): Promise<ContactResponse> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Contact', uuid);
      const updateScope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(
        tx,
        this.repo,
        ctx.orgId,
        updateScope,
        ctx.userId!,
        existing.ownerId,
      );

      const values: Record<string, unknown> = { updatedBy: ctx.userId };
      if (input.name !== undefined) values.name = input.name;
      if (input.firstName !== undefined) values.firstName = input.firstName;
      if (input.lastName !== undefined) values.lastName = input.lastName;
      if (input.email !== undefined) values.email = input.email;
      const phone = input.phone
        ? (canonicalizePhone({ number: input.phone })?.e164 ?? input.phone)
        : input.phone;
      if (phone !== undefined) values.phone = phone;
      if (input.lostReason !== undefined) values.lostReason = input.lostReason;
      if (input.otherLostReason !== undefined) values.otherLostReason = input.otherLostReason;
      if (input.leadScore !== undefined) values.leadScore = input.leadScore;
      if (input.whatsappSubscriptionStatus !== undefined) {
        values.whatsappSubscriptionStatus = input.whatsappSubscriptionStatus;
      }
      if (input.smsSubscriptionStatus !== undefined) {
        values.smsSubscriptionStatus = input.smsSubscriptionStatus;
      }
      if (input.emailSubscriptionStatus !== undefined) {
        values.emailSubscriptionStatus = input.emailSubscriptionStatus;
      }
      if (input.emailConfirmed !== undefined) values.emailConfirmed = input.emailConfirmed;
      if (input.faxNumber !== undefined) values.faxNumber = input.faxNumber;
      if (input.source !== undefined) values.source = input.source;
      // Marketing opt-out (TW-CON-017): the timestamp is written with the flag, on every change, so the evidence is never
      // missing (Reference left it empty on a manual change). No change, nothing touched.
      if (input.isUnsubscribed !== undefined && input.isUnsubscribed !== existing.isUnsubscribed) {
        values.isUnsubscribed = input.isUnsubscribed;
        values.unsubscribedAt = input.isUnsubscribed ? new Date() : null;
      }
      // lifecycle_stage is NOT NULL: a null stage is "leave it", not a clear.
      if (input.lifecycleStage != null && input.lifecycleStage !== existing.lifecycleStage) {
        // Track the transition, not just the current value — the sub-agent
        // portal and the pipeline UI both read "what was it before".
        values.lifecycleStage = input.lifecycleStage;
        values.lifecycleStageDate = new Date();
        values.previousLifecycleStage = existing.lifecycleStage;
        values.previousLifecycleStageDate = existing.lifecycleStageDate;
        // Entering a won or lost stage stamps it (a lost one needs a reason); leaving one clears the stamp.
        Object.assign(
          values,
          stageEntryValues({
            flags: await this.repo.stageFlags(tx, ctx.orgId, input.lifecycleStage),
            current: existing,
            lostReason: input.lostReason,
            otherLostReason: input.otherLostReason,
            now: new Date(),
          }),
        );
      }
      // The status stays valid for the stage: a stage move that leaves it invalid resets it (to the new stage's default, or
      // none), and a status set by the caller must belong to the contact's (new) stage (422 CON_STATUS_STAGE_MISMATCH).
      const nextStage = (values.lifecycleStage as string | undefined) ?? existing.lifecycleStage;
      if (input.status !== undefined || values.lifecycleStage !== undefined) {
        const statusCtx = await this.repo.statusContext(tx, ctx.orgId);
        const plan = planStatus({
          scope: statusCtx.scope,
          stage: nextStage,
          stageLabel: statusCtx.stageLabels.get(nextStage) ?? null,
          stageChanged: values.lifecycleStage !== undefined,
          current: existing.status,
          requested: input.status,
        });
        if (plan.status !== undefined) values.status = plan.status;
      }
      if (input.customFields !== undefined) {
        assertFormFieldLimits(input.customFields);
        // Merge, don't replace: a client that sends three fields must not wipe
        // the other forty the org has defined.
        values.data = { ...(existing.data ?? {}), ...input.customFields };
        // A save that edits properties answers for all of them; a stage or owner change alone does not (a contact that
        // predates a newly required property stays editable).
        await this.assertRequiredProperties(tx, ctx.orgId, values.data as Record<string, unknown>);
      }
      if (input.ownerId !== undefined) {
        values.ownerId = input.ownerId
          ? await this.requireUser(tx, ctx.orgId, input.ownerId)
          : null;
      }
      if (input.companyId !== undefined) {
        values.companyId = input.companyId
          ? await this.requireCompany(tx, ctx.orgId, input.companyId)
          : null;
      }

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('Contact');

      // The identity keys follow the contact: the old address or number is released (an edit or a clear), the new one claimed.
      if (input.email !== undefined && existing.email && input.email !== existing.email) {
        await this.repo.removeIdentity(tx, ctx.orgId, existing.id, 'email', existing.email);
      }
      if (input.email && input.email !== existing.email) {
        await this.repo.addIdentity(tx, ctx.orgId, existing.id, 'email', input.email);
      }
      if (phone !== undefined && existing.phone && phone !== existing.phone) {
        await this.repo.removeIdentity(tx, ctx.orgId, existing.id, 'phone', existing.phone);
      }
      if (phone && phone !== existing.phone) {
        await this.repo.addIdentity(tx, ctx.orgId, existing.id, 'phone', phone);
      }

      const after = await this.repo.findById(tx, ctx.orgId, existing.id);

      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(
          existing as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
        ),
      });

      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType:
          existing.lifecycleStage !== after!.lifecycleStage
            ? 'contact.stage_changed'
            : 'contact.updated',
        payload: {
          uuid,
          previousStage: existing.lifecycleStage,
          stage: after!.lifecycleStage,
        },
      });

      return toContactResponse(after!);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();

    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Contact', uuid);
      const deleteScope = this.rbac.can(ctx.grants!, 'record.contacts.delete').scope;
      await assertContactScope(
        tx,
        this.repo,
        ctx.orgId,
        deleteScope,
        ctx.userId!,
        existing.ownerId,
      );

      // Hard delete. The audit row and the outbox
      // event are written first so the trail survives the row.
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'delete',
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact.deleted',
        payload: { uuid, displayId: existing.displayId },
      });

      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }

  /** 422 CON_REQUIRED_PROPERTY_MISSING when properties the registry marks required have no value (honouring dependencies). */
  private async assertRequiredProperties(
    tx: Tx,
    orgId: number,
    data: Record<string, unknown>,
    only?: ReadonlySet<string>,
  ): Promise<void> {
    const missing = missingRequired(await this.repo.requiredRules(tx, orgId), data, only);
    if (missing.length > 0) throw requiredPropertiesError(missing);
  }

  private async requireUser(
    tx: Parameters<typeof this.repo.resolveUserId>[0],
    orgId: number,
    uuid: string,
  ) {
    const id = await this.repo.resolveUserId(tx, orgId, uuid);
    if (id === undefined) throw AppError.notFound('User', uuid);
    return id;
  }

  private async requireCompany(
    tx: Parameters<typeof this.repo.resolveCompanyId>[0],
    orgId: number,
    uuid: string,
  ) {
    const id = await this.repo.resolveCompanyId(tx, orgId, uuid);
    if (id === undefined) throw AppError.notFound('Company', uuid);
    return id;
  }

  async listFieldHistory(
    uuid: string,
    query: ListFieldHistoryQuery,
  ): Promise<PageResponse<FieldHistoryEntry>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!contact) throw AppError.notFound('Contact', uuid);
      const readScope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(tx, this.repo, ctx.orgId, readScope, ctx.userId!, contact.ownerId);

      const { items, nextCursor, hasMore } = await this.audit.listByRecord(
        tx,
        ctx.orgId,
        MODULE_KEY,
        contact.id,
        { limit: query.limit, cursor: query.cursor },
      );

      const actorIds = [
        ...new Set(items.map((i) => i.actorId).filter((id): id is number => id !== null)),
      ];
      const actorUuids = await this.repo.resolveUserUuids(tx, ctx.orgId, actorIds);

      const entries: FieldHistoryEntry[] = items.flatMap((entry) =>
        Object.entries(entry.delta ?? {}).map(([fieldKey, change]) => ({
          fieldKey,
          oldValue: (change as { old: unknown }).old,
          newValue: (change as { new: unknown }).new,
          actorType: entry.actorType,
          changedByUserId: entry.actorId !== null ? (actorUuids.get(entry.actorId) ?? null) : null,
          changedAt: entry.at.toISOString(),
        })),
      );

      return { data: entries, page: { nextCursor, hasMore, limit: query.limit } };
    });
  }

  async selectData(query: ContactSelectQuery, scope: RecordScope): Promise<ContactSelectItem[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) =>
      this.repo.selectData(tx, ctx.orgId, { ...query, scope, actorUserId: ctx.userId }),
    );
  }

  async listAssignees(): Promise<AssigneeResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) => this.repo.listAssignable(tx, ctx.orgId));
  }

  async setAssignee(input: SetContactAssigneeInput): Promise<BulkResult> {
    const ctx = RequestContextStore.require();
    const updateScope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
    return this.db.tx(async (tx) => {
      const ownerId = input.ownerId ? await this.requireUser(tx, ctx.orgId, input.ownerId) : null;
      return this.forEachRowIsolated(tx, ctx.orgId, input.ids, async (rowTx, id, uuid) => {
        const existing = await this.repo.findById(rowTx, ctx.orgId, id);
        if (!existing) throw AppError.notFound('Contact');
        await assertContactScope(
          rowTx,
          this.repo,
          ctx.orgId,
          updateScope,
          ctx.userId!,
          existing.ownerId,
        );

        const updated = await this.repo.updateFieldsById(rowTx, ctx.orgId, id, {
          ownerId,
          updatedBy: ctx.userId,
        });
        if (!updated) throw AppError.notFound('Contact');

        await this.audit.record(rowTx, {
          module: MODULE_KEY,
          recordId: id,
          action: 'update',
          // input.ownerId, not the resolved internal `ownerId` above — every
          // response, field-history included, exposes uuids, never the
          // internal bigint PK.
          delta: { ownerId: { old: undefined, new: input.ownerId } },
        });
        await this.outbox.emit(rowTx, {
          aggregateModule: MODULE_KEY,
          aggregateId: id,
          eventType: 'contact.updated',
          payload: { uuid, ownerId: input.ownerId },
        });
      });
    });
  }

  /**
   * Bulk-edit: every id in one outer transaction, but each row's write runs
   * in its own SAVEPOINT (via nested `tx.transaction()`) so one bad id rolls
   * back only that row — never the whole batch. Merges customFields the same
   * way `update()` does (a partial patch, not a replace).
   */
  async bulkUpdate(input: BulkUpdateContactsInput): Promise<BulkResult> {
    const ctx = RequestContextStore.require();
    const updateScope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
    return this.db.tx(async (tx) => {
      const ownerId = input.values.ownerId
        ? await this.requireUser(tx, ctx.orgId, input.values.ownerId)
        : input.values.ownerId; // null (unset) or undefined (leave alone) pass through
      // Read once for the whole batch; each row is planned against it.
      const statusCtx =
        input.values.status !== undefined || input.values.lifecycleStage != null
          ? await this.repo.statusContext(tx, ctx.orgId)
          : undefined;

      return this.forEachRowIsolated(tx, ctx.orgId, input.ids, async (rowTx, id, uuid) => {
        const existing = await this.repo.findById(rowTx, ctx.orgId, id);
        if (!existing) throw AppError.notFound('Contact');
        await assertContactScope(
          rowTx,
          this.repo,
          ctx.orgId,
          updateScope,
          ctx.userId!,
          existing.ownerId,
        );

        const values: Record<string, unknown> = { updatedBy: ctx.userId };
        if (input.values.ownerId !== undefined) values.ownerId = ownerId;
        if (
          input.values.lifecycleStage !== undefined &&
          input.values.lifecycleStage !== null &&
          input.values.lifecycleStage !== existing.lifecycleStage
        ) {
          values.lifecycleStage = input.values.lifecycleStage;
          values.lifecycleStageDate = new Date();
          values.previousLifecycleStage = existing.lifecycleStage;
          values.previousLifecycleStageDate = existing.lifecycleStageDate;
          Object.assign(
            values,
            stageEntryValues({
              flags: await this.repo.stageFlags(rowTx, ctx.orgId, input.values.lifecycleStage),
              current: existing,
              lostReason: input.values.lostReason,
              otherLostReason: input.values.otherLostReason,
              now: new Date(),
            }),
          );
        }
        if (statusCtx) {
          const nextStage =
            (values.lifecycleStage as string | undefined) ?? existing.lifecycleStage;
          const plan = planStatus({
            scope: statusCtx.scope,
            stage: nextStage,
            stageLabel: statusCtx.stageLabels.get(nextStage) ?? null,
            stageChanged: values.lifecycleStage !== undefined,
            current: existing.status,
            requested: input.values.status,
          });
          if (plan.status !== undefined) values.status = plan.status;
        }
        if (input.values.customFields !== undefined) {
          assertFormFieldLimits(input.values.customFields);
          values.data = { ...(existing.data ?? {}), ...input.values.customFields };
          // Only the keys this edit sets are held to the rule: it may not blank a required property, but contacts
          // that never had one are not all refused.
          await this.assertRequiredProperties(
            rowTx,
            ctx.orgId,
            values.data as Record<string, unknown>,
            new Set(Object.keys(input.values.customFields)),
          );
        }

        await this.repo.updateFieldsById(rowTx, ctx.orgId, id, values);
        await this.audit.record(rowTx, { module: MODULE_KEY, recordId: id, action: 'update' });
        await this.outbox.emit(rowTx, {
          aggregateModule: MODULE_KEY,
          aggregateId: id,
          eventType:
            input.values.lifecycleStage !== undefined &&
            input.values.lifecycleStage !== existing.lifecycleStage
              ? 'contact.stage_changed'
              : 'contact.updated',
          payload: {
            uuid,
            previousStage: existing.lifecycleStage,
            stage: input.values.lifecycleStage ?? existing.lifecycleStage,
          },
        });
      });
    });
  }

  /**
   * Resolves every uuid to an internal id up front (a uuid that does not
   * exist fails immediately, no savepoint needed), then runs `fn` for each
   * resolved row inside its own SAVEPOINT so a mid-batch failure — a 404
   * that raced with a concurrent delete, a constraint violation — rolls
   * back only that row.
   */
  private async forEachRowIsolated(
    tx: Tx,
    orgId: number,
    uuids: string[],
    fn: (rowTx: Tx, id: number, uuid: string) => Promise<void>,
  ): Promise<BulkResult> {
    const succeeded: string[] = [];
    const failed: BulkResult['failed'] = [];

    for (const uuid of uuids) {
      const row = await this.repo.findByUuid(tx, orgId, uuid);
      if (!row) {
        failed.push({ id: uuid, code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' });
        continue;
      }
      try {
        await tx.transaction((rowTx) => fn(rowTx, row.id, uuid));
        succeeded.push(uuid);
      } catch (err) {
        const message = err instanceof AppError ? err.message : 'Unexpected error';
        const code = err instanceof AppError ? err.code : ERROR_CODES.INTERNAL;
        failed.push({ id: uuid, code, message });
      }
    }

    return { succeeded, failed };
  }
}
