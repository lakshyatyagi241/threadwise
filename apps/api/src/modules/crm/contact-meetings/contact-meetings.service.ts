import { Injectable } from '@nestjs/common';
import type {
  ContactMeetingResponse,
  CreateContactMeetingInput,
  ListContactMeetingsQuery,
  PageResponse,
  UpdateContactMeetingInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { ContactsRepository } from '../contacts';
import { toContactMeetingResponse } from './contact-meetings.mapper';
import { ContactMeetingsRepository } from './contact-meetings.repository';

const MODULE_KEY = 'contact_meetings';

@Injectable()
export class ContactMeetingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactMeetingsRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async list(
    contactUuid: string,
    query: ListContactMeetingsQuery,
  ): Promise<PageResponse<ContactMeetingResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contactId = await this.requireContactId(tx, ctx.orgId, contactUuid);
      const rows = await this.repo.listByContact(tx, ctx.orgId, contactId, {
        limit: query.limit,
        cursor: query.cursor,
      });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toContactMeetingResponse), page };
    });
  }

  async create(
    contactUuid: string,
    input: CreateContactMeetingInput,
  ): Promise<ContactMeetingResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contactId = await this.requireContactId(tx, ctx.orgId, contactUuid);

      const created = await this.repo.insert(tx, ctx.orgId, {
        contactId,
        title: input.title,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        location: input.location,
        createdBy: ctx.userId,
      });
      await this.contactsRepo.bumpLastActivity(tx, ctx.orgId, contactId);

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact_meeting.created',
        payload: { uuid: created.uuid, title: input.title },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return toContactMeetingResponse(row!);
    });
  }

  async update(uuid: string, input: UpdateContactMeetingInput): Promise<ContactMeetingResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('ContactMeeting', uuid);

      const values: Record<string, unknown> = {};
      if (input.title !== undefined) values.title = input.title;
      if (input.startsAt !== undefined)
        values.startsAt = input.startsAt ? new Date(input.startsAt) : null;
      if (input.endsAt !== undefined) values.endsAt = input.endsAt ? new Date(input.endsAt) : null;
      if (input.location !== undefined) values.location = input.location;

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('ContactMeeting');

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'update' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact_meeting.updated',
        payload: { uuid },
      });

      const row = await this.repo.findById(tx, ctx.orgId, existing.id);
      return toContactMeetingResponse(row!);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('ContactMeeting', uuid);

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact_meeting.deleted',
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
