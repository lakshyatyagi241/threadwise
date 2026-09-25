import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import type {
  BulkResult,
  CreateTagInput,
  ListTagsQuery,
  PageResponse,
  SetContactTagsInput,
  TagResponse,
  UpdateTagInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { toTagResponse } from './tags.mapper';
import { TagsRepository } from './tags.repository';

const MODULE_KEY = 'tags';

@Injectable()
export class TagsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TagsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListTagsQuery): Promise<PageResponse<TagResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, {
        limit: query.limit,
        cursor: query.cursor,
        q: query.q,
      });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toTagResponse), page };
    });
  }

  async create(input: CreateTagInput): Promise<TagResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const created = await this.repo.insert(tx, ctx.orgId, input);

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'tag.created',
        payload: { uuid: created.uuid, name: input.name },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return toTagResponse(row!);
    });
  }

  async update(uuid: string, input: UpdateTagInput): Promise<TagResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Tag', uuid);

      const values: Record<string, unknown> = {};
      if (input.name !== undefined) values.name = input.name;
      if (input.color !== undefined) values.color = input.color;

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('Tag');

      const row = await this.repo.findById(tx, ctx.orgId, existing.id);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(
          existing as unknown as Record<string, unknown>,
          row as unknown as Record<string, unknown>,
        ),
      });

      return toTagResponse(row!);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Tag', uuid);

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'tag.deleted',
        payload: { uuid },
      });

      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }

  /**
   * Attach every tag in `tagIds` to every contact in `contactIds`. Idempotent.
   * Tags must all exist (rejects the whole call otherwise — there are at
   * most a handful per request, unlike contacts). Contacts are resolved
   * per-id: a uuid that does not exist in this org fails independently,
   * exactly like bulk-edit/bulk-delete's partial-failure reporting.
   */
  async attachToContacts(input: SetContactTagsInput): Promise<BulkResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tagRows = await this.repo.findManyByUuids(tx, ctx.orgId, input.tagIds);
      if (tagRows.length !== input.tagIds.length) {
        const found = new Set(tagRows.map((t) => t.uuid));
        const missing = input.tagIds.find((id) => !found.has(id));
        throw AppError.notFound('Tag', missing);
      }

      const contactIdByUuid = await this.repo.resolveContactIdMap(tx, ctx.orgId, input.contactIds);

      const succeeded: string[] = [];
      const failed: BulkResult['failed'] = [];
      for (const uuid of input.contactIds) {
        if (contactIdByUuid.has(uuid)) succeeded.push(uuid);
        else failed.push({ id: uuid, code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' });
      }

      await this.repo.attach(
        tx,
        ctx.orgId,
        [...contactIdByUuid.values()],
        tagRows.map((t) => t.id),
        ctx.userId,
      );

      return { succeeded, failed };
    });
  }

  async detachFromContact(contactUuid: string, tagUuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const contactIdByUuid = await this.repo.resolveContactIdMap(tx, ctx.orgId, [contactUuid]);
      const contactId = contactIdByUuid.get(contactUuid);
      if (!contactId) throw AppError.notFound('Contact', contactUuid);
      const tag = await this.repo.findByUuid(tx, ctx.orgId, tagUuid);
      if (!tag) throw AppError.notFound('Tag', tagUuid);

      await this.repo.detach(tx, ctx.orgId, contactId, tag.id);
    });
  }

  async listForContact(contactUuid: string): Promise<TagResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contactIdByUuid = await this.repo.resolveContactIdMap(tx, ctx.orgId, [contactUuid]);
      const contactId = contactIdByUuid.get(contactUuid);
      if (!contactId) throw AppError.notFound('Contact', contactUuid);
      const rows = await this.repo.listByContact(tx, ctx.orgId, contactId);
      return rows.map(toTagResponse);
    });
  }
}
