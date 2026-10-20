import { Injectable } from '@nestjs/common';
import type {
  ContactActivityResponse,
  CreateContactActivityInput,
  ListContactActivitiesQuery,
  PageResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { encodeCursor } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope, ContactsRepository } from '../contacts';
import { toContactActivityResponse } from './contact-activities.mapper';
import { ContactActivitiesRepository } from './contact-activities.repository';
import { ContactTouchService } from '../lead-handling/contact-touch.service';

const MODULE_KEY = 'contact_activities';

@Injectable()
export class ContactActivitiesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactActivitiesRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly leadHandling: ContactTouchService,
  ) {}

  async list(
    contactUuid: string,
    query: ListContactActivitiesQuery,
  ): Promise<PageResponse<ContactActivityResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(tx, this.contactsRepo, ctx.orgId, scope, ctx.userId!, contact);
      const rows = await this.repo.listByContact(tx, ctx.orgId, contact.id, {
        limit: query.limit,
        cursor: query.cursor,
      });

      // Paginate on `occurredAt`, not `createdAt` — a caller can backdate
      // occurredAt (a historical/imported activity), and the repository's
      // WHERE clause keys off occurredAt too. The generic buildPage() helper
      // hardcodes `createdAt`, which would build a cursor against the wrong
      // column the moment those two timestamps diverge.
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.occurredAt, id: last.id }) : null;

      return {
        data: items.map(toContactActivityResponse),
        page: { nextCursor, hasMore, limit: query.limit },
      };
    });
  }

  /** Manual entries only — source is always 'user'; system/bot writers are internal-only. */
  async create(
    contactUuid: string,
    input: CreateContactActivityInput,
  ): Promise<ContactActivityResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(tx, this.contactsRepo, ctx.orgId, scope, ctx.userId!, contact);
      const contactId = contact.id;

      const created = await this.repo.insert(tx, ctx.orgId, {
        contactId,
        activityType: input.activityType,
        title: input.title,
        body: input.body,
        source: 'user',
        actorId: ctx.userId,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
      });
      await this.contactsRepo.bumpLastActivity(tx, ctx.orgId, contactId);
      // A activity a person added reached the contact: lead handling (the uncontacted marker, BL-290). Never throws.
      await this.leadHandling.touch(tx, ctx.orgId, contactId, 'activity');

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact_activity.created',
        payload: { uuid: created.uuid, activityType: input.activityType },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return toContactActivityResponse(row!);
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
