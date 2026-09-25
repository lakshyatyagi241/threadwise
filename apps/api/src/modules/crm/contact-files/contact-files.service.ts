import { Injectable } from '@nestjs/common';
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
import { ContactsRepository } from '../contacts';
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
  ) {}

  async list(
    contactUuid: string,
    query: ListContactFilesQuery,
  ): Promise<PageResponse<ContactFileResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contactId = await this.requireContactId(tx, ctx.orgId, contactUuid);
      const rows = await this.repo.listByContact(tx, ctx.orgId, contactId, {
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
      const contactId = await this.requireContactId(tx, ctx.orgId, contactUuid);

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

  private async requireContactId(
    tx: Parameters<ContactsRepository['resolveContactId']>[0],
    orgId: number,
    uuid: string,
  ): Promise<number> {
    const id = await this.contactsRepo.resolveContactId(tx, orgId, uuid);
    if (id === undefined) throw AppError.notFound('Contact', uuid);
    return id;
  }
}
