import { Injectable } from '@nestjs/common';
import type {
  ContactNoteResponse,
  CreateContactNoteInput,
  ListContactNotesQuery,
  PageResponse,
  UpdateContactNoteInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope, ContactsRepository } from '../contacts';
import { toContactNoteResponse } from './contact-notes.mapper';
import { ContactNotesRepository } from './contact-notes.repository';
import { ContactTouchService } from '../lead-handling/contact-touch.service';

const MODULE_KEY = 'contact_notes';

@Injectable()
export class ContactNotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactNotesRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly leadHandling: ContactTouchService,
  ) {}

  async list(
    contactUuid: string,
    query: ListContactNotesQuery,
  ): Promise<PageResponse<ContactNoteResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(tx, this.contactsRepo, ctx.orgId, scope, ctx.userId!, contact);
      const rows = await this.repo.listByContact(tx, ctx.orgId, contact.id, {
        limit: query.limit,
        cursor: query.cursor,
      });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toContactNoteResponse), page };
    });
  }

  async create(contactUuid: string, input: CreateContactNoteInput): Promise<ContactNoteResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(tx, this.contactsRepo, ctx.orgId, scope, ctx.userId!, contact);
      const contactId = contact.id;

      const created = await this.repo.insert(tx, ctx.orgId, {
        contactId,
        body: input.body,
        createdBy: ctx.userId,
      });
      await this.contactsRepo.bumpLastActivity(tx, ctx.orgId, contactId);
      // A note a person added reached the contact: lead handling (the uncontacted marker, BL-290). Never throws.
      await this.leadHandling.touch(tx, ctx.orgId, contactId, 'activity');

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact_note.created',
        payload: { uuid: created.uuid },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return toContactNoteResponse(row!);
    });
  }

  async update(uuid: string, input: UpdateContactNoteInput): Promise<ContactNoteResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('ContactNote', uuid);
      const parent = await this.contactsRepo.findById(tx, ctx.orgId, existing.contactId);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        parent ?? { ownerId: null, createdBy: null },
      );

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        {
          body: input.body,
          updatedBy: ctx.userId,
        },
      );
      if (!updated) throw AppError.rowVersionConflict('ContactNote');

      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: { body: { old: existing.body, new: input.body } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact_note.updated',
        payload: { uuid },
      });

      const row = await this.repo.findById(tx, ctx.orgId, existing.id);
      return toContactNoteResponse(row!);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('ContactNote', uuid);
      const parent = await this.contactsRepo.findById(tx, ctx.orgId, existing.contactId);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        parent ?? { ownerId: null, createdBy: null },
      );

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact_note.deleted',
        payload: { uuid },
      });
      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }

  private async requireContact(
    tx: Parameters<ContactsRepository['resolveContactRef']>[0],
    orgId: number,
    uuid: string,
  ) {
    const ref = await this.contactsRepo.resolveContactRef(tx, orgId, uuid);
    if (!ref) throw AppError.notFound('Contact', uuid);
    return ref;
  }
}
