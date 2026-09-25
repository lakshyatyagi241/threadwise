import { Injectable, Logger } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { ERROR_CODES } from '@crm/contracts';
import type {
  AssigneeResponse,
  BulkContactIdsInput,
  BulkResult,
  BulkUpdateContactsInput,
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
  ) {}

  async list(query: ListContactsQuery, scope: RecordScope): Promise<PageResponse<ContactResponse>> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const ownerId = query.ownerId
        ? await this.repo.resolveUserId(tx, ctx.orgId, query.ownerId)
        : undefined;

      // An owner filter for a uuid that does not exist must return nothing,
      // not "ignore the filter and return everything".
      if (query.ownerId && ownerId === undefined) {
        return { data: [], page: { nextCursor: null, hasMore: false, limit: query.limit } };
      }

      const rows = await this.repo.list(tx, ctx.orgId, {
        limit: query.limit,
        cursor: query.cursor,
        order: query.order,
        q: query.q,
        ownerId,
        lifecycleStage: query.lifecycleStage,
        includeArchived: query.includeArchived,
        scope,
        actorUserId: ctx.userId,
      });

      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toContactResponse), page };
    });
  }

  async getByUuid(uuid: string): Promise<ContactResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Contact', uuid);
      return toContactResponse(row);
    });
  }

  async create(input: CreateContactInput): Promise<ContactResponse> {
    const ctx = RequestContextStore.require();

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
        (input.phone
          ? await this.repo.findByIdentity(tx, ctx.orgId, 'phone', input.phone)
          : undefined);

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

      const displayId = await this.displayIds.next(tx, ctx.orgId, MODULE_KEY, DISPLAY_PREFIX);

      const created = await this.repo.insert(tx, ctx.orgId, {
        name: input.name,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        companyId,
        ownerId,
        lifecycleStage: input.lifecycleStage,
        status: input.status,
        leadScore: input.leadScore,
        whatsappSubscriptionStatus: input.whatsappSubscriptionStatus,
        smsSubscriptionStatus: input.smsSubscriptionStatus,
        emailSubscriptionStatus: input.emailSubscriptionStatus,
        emailConfirmed: input.emailConfirmed,
        faxNumber: input.faxNumber,
        data: input.customFields,
        displayId,
        createdBy: ctx.userId,
      });

      if (input.email) {
        await this.repo.addIdentity(tx, ctx.orgId, created.id, 'email', input.email);
      }
      if (input.phone) {
        await this.repo.addIdentity(tx, ctx.orgId, created.id, 'phone', input.phone);
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
        payload: { uuid: created.uuid, displayId, email: input.email, phone: input.phone },
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

      const values: Record<string, unknown> = { updatedBy: ctx.userId };
      if (input.name !== undefined) values.name = input.name;
      if (input.firstName !== undefined) values.firstName = input.firstName;
      if (input.lastName !== undefined) values.lastName = input.lastName;
      if (input.email !== undefined) values.email = input.email;
      if (input.phone !== undefined) values.phone = input.phone;
      if (input.status !== undefined) values.status = input.status;
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
      if (input.lifecycleStage !== undefined && input.lifecycleStage !== existing.lifecycleStage) {
        // Track the transition, not just the current value — the sub-agent
        // portal and the pipeline UI both read "what was it before".
        values.lifecycleStage = input.lifecycleStage;
        values.lifecycleStageDate = new Date();
        values.previousLifecycleStage = existing.lifecycleStage;
        values.previousLifecycleStageDate = existing.lifecycleStageDate;
      }
      if (input.customFields !== undefined) {
        // Merge, don't replace: a client that sends three fields must not wipe
        // the other forty the org has defined.
        values.data = { ...(existing.data ?? {}), ...input.customFields };
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

      if (input.email && input.email !== existing.email) {
        await this.repo.addIdentity(tx, ctx.orgId, existing.id, 'email', input.email);
      }
      if (input.phone && input.phone !== existing.phone) {
        await this.repo.addIdentity(tx, ctx.orgId, existing.id, 'phone', input.phone);
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

      // Hard delete, as decided in ADR-0009. The audit row and the outbox
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

  async selectData(query: ContactSelectQuery): Promise<ContactSelectItem[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) => this.repo.selectData(tx, ctx.orgId, query));
  }

  async listAssignees(): Promise<AssigneeResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) => this.repo.listAssignable(tx, ctx.orgId));
  }

  async setAssignee(input: SetContactAssigneeInput): Promise<BulkResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const ownerId = input.ownerId ? await this.requireUser(tx, ctx.orgId, input.ownerId) : null;
      return this.forEachRowIsolated(tx, ctx.orgId, input.ids, async (rowTx, id, uuid) => {
        const updated = await this.repo.updateFieldsById(rowTx, ctx.orgId, id, {
          ownerId,
          updatedBy: ctx.userId,
        });
        if (!updated) throw AppError.notFound('Contact');

        await this.audit.record(rowTx, {
          module: MODULE_KEY,
          recordId: id,
          action: 'update',
          delta: { ownerId: { old: undefined, new: ownerId } },
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
    return this.db.tx(async (tx) => {
      const ownerId = input.values.ownerId
        ? await this.requireUser(tx, ctx.orgId, input.values.ownerId)
        : input.values.ownerId; // null (unset) or undefined (leave alone) pass through

      return this.forEachRowIsolated(tx, ctx.orgId, input.ids, async (rowTx, id, uuid) => {
        const existing = await this.repo.findById(rowTx, ctx.orgId, id);
        if (!existing) throw AppError.notFound('Contact');

        const values: Record<string, unknown> = { updatedBy: ctx.userId };
        if (input.values.ownerId !== undefined) values.ownerId = ownerId;
        if (input.values.lifecycleStage !== undefined)
          values.lifecycleStage = input.values.lifecycleStage;
        if (input.values.status !== undefined) values.status = input.values.status;
        if (input.values.customFields !== undefined) {
          values.data = { ...(existing.data ?? {}), ...input.values.customFields };
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

  async bulkDelete(input: BulkContactIdsInput): Promise<BulkResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      return this.forEachRowIsolated(tx, ctx.orgId, input.ids, async (rowTx, id, uuid) => {
        const existing = await this.repo.findById(rowTx, ctx.orgId, id);
        if (!existing) throw AppError.notFound('Contact');

        await this.audit.record(rowTx, { module: MODULE_KEY, recordId: id, action: 'delete' });
        await this.outbox.emit(rowTx, {
          aggregateModule: MODULE_KEY,
          aggregateId: id,
          eventType: 'contact.deleted',
          payload: { uuid, displayId: existing.displayId },
        });
        await this.repo.deleteById(rowTx, ctx.orgId, id);
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
