import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import type {
  ContactFileResponse,
  CreateContactFileInput,
  ListContactFilesQuery,
  PageResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope, ContactsRepository } from '../contacts';
import { toContactFileResponse } from './contact-files.mapper';
import { ContactFilesRepository } from './contact-files.repository';

const MODULE_KEY = 'contact_files';

@Injectable()
export class ContactFilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactFilesRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async list(
    contactUuid: string,
    query: ListContactFilesQuery,
  ): Promise<PageResponse<ContactFileResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        contact.ownerId,
      );
      const rows = await this.repo.listByContact(tx, ctx.orgId, contact.id, {
        limit: query.limit,
        cursor: query.cursor,
      });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toContactFileResponse), page };
    });
  }

  async create(contactUuid: string, input: CreateContactFileInput): Promise<ContactFileResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        contact.ownerId,
      );
      const contactId = contact.id;

      // AZ-009: a key minted per workspace looks like `<area>/<orgId>/...`; it may only name the caller's own workspace.
      const keyOrg = /^[^/]+\/(\d+)\//.exec(input.storageKey)?.[1];
      if (keyOrg !== undefined && Number(keyOrg) !== ctx.orgId) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'The storage key belongs to another workspace.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'storageKey', message: 'not a key of this workspace' }],
        );
      }

      const created = await this.repo.insert(tx, ctx.orgId, {
        contactId,
        fileName: input.fileName,
        fileSizeBytes: input.fileSizeBytes,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        uploadedBy: ctx.userId,
      });
      await this.contactsRepo.bumpLastActivity(tx, ctx.orgId, contactId);

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact_file.created',
        payload: { uuid: created.uuid, fileName: input.fileName },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return toContactFileResponse(row!);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('ContactFile', uuid);
      const parent = await this.contactsRepo.findById(tx, ctx.orgId, existing.contactId);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        parent?.ownerId ?? null,
      );

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact_file.deleted',
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
