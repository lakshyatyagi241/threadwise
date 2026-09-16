import { Injectable, Logger } from '@nestjs/common';
import type {
  ContactResponse,
  CreateContactInput,
  ListContactsQuery,
  PageResponse,
  RecordScope,
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
        email: input.email,
        phone: input.phone,
        companyId,
        ownerId,
        lifecycleStage: input.lifecycleStage,
        status: input.status,
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
      if (input.email !== undefined) values.email = input.email;
      if (input.phone !== undefined) values.phone = input.phone;
      if (input.status !== undefined) values.status = input.status;
      if (input.lifecycleStage !== undefined) values.lifecycleStage = input.lifecycleStage;
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
}
