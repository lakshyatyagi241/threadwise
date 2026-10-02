import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import type {
  AttachContactTagInput,
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
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import { assertContactScope, ContactsRepository } from '../contacts';
import { toTagResponse } from './tags.mapper';
import { TagsRepository, type TagRow } from './tags.repository';
import { segmentNamesUsing } from '../segments/segment-usage';

const MODULE_KEY = 'tags';

/** WaDesk's colour for a tag created on the fly. */
export const DEFAULT_TAG_COLOR = '#075E54';

const nameTaken = (name: string) =>
  new AppError(
    ERROR_CODES.CON_TAG_NAME_TAKEN,
    `A tag named "${name}" already exists.`,
    HttpStatus.CONFLICT,
  );

@Injectable()
export class TagsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TagsRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async list(query: ListTagsQuery): Promise<PageResponse<TagResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, {
        limit: query.limit,
        cursor: query.cursor,
        q: query.q,
        includeCounts: query.includeCounts,
      });
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map(toTagResponse), page };
    });
  }

  /**
   * One rule for creating a tag, wherever it happens (WD-CON-018 difference): the plan's tag
   * limit counts it, the name is unique ignoring case, and writes leave the same audit row and
   * event. WaDesk's Contacts paths skipped the limit and the permission.
   */
  async create(input: CreateTagInput): Promise<TagResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.assertUnderTagLimit(tx, ctx.orgId);
      const created = await this.repo.insertIfAbsent(tx, ctx.orgId, input);
      if (!created) throw nameTaken(input.name);
      await this.recordCreated(tx, created, input.name);

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

      let updated: boolean;
      try {
        updated = await tx.transaction((sp) =>
          this.repo.updateWithVersion(sp, ctx.orgId, existing.id, input.rowVersion, values),
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw nameTaken(input.name ?? existing.name);
        throw err;
      }
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

      // Segments that use this tag are not blocked: the condition now matches nothing and is flagged
      // (invalidConditions). GET /segments/usage?kind=tag&ref=<id> lists them before the delete.
      const segmentNames = await segmentNamesUsing(tx, ctx.orgId, 'tag', uuid);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'delete',
        ...(segmentNames.length > 0
          ? { delta: { segments: { old: segmentNames, new: null } } }
          : {}),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'tag.deleted',
        payload: { uuid, segments: segmentNames },
      });

      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }

  /**
   * Find a tag by name (any case), creating it when there is none.
   *
   * `enforcePermission` is true for a request: creating then needs `record.tags.create`, like
   * POST /tags. Background jobs pass false: the caller's permission was checked when the job was
   * accepted and a worker has no grants to look at. The plan's tag limit applies either way.
   */
  async findOrCreateByName(
    tx: Tx,
    orgId: number,
    rawName: string,
    opts: { enforcePermission: boolean },
  ): Promise<{ row: TagRow; created: boolean }> {
    const name = rawName.trim();
    const found = await this.repo.findByName(tx, orgId, name);
    if (found) return { row: found, created: false };

    if (opts.enforcePermission) {
      const ctx = RequestContextStore.require();
      if (!this.rbac.can(ctx.grants!, 'record.tags.create').allowed) {
        throw AppError.forbidden('record.tags.create');
      }
    }
    await this.assertUnderTagLimit(tx, orgId);

    const created = await this.repo.insertIfAbsent(tx, orgId, { name, color: DEFAULT_TAG_COLOR });
    if (!created) {
      // A simultaneous create of the same name won; that tag is the answer.
      const winner = await this.repo.findByName(tx, orgId, name);
      return { row: winner!, created: false };
    }
    await this.recordCreated(tx, created, name);
    return { row: (await this.repo.findById(tx, orgId, created.id))!, created: true };
  }

  private async assertUnderTagLimit(tx: Tx, orgId: number): Promise<void> {
    const cap = await this.entitlements.limit(orgId, 'tags');
    if (cap === 0) return;
    await this.entitlements.assertWithinLimit(orgId, 'tags', await this.repo.countAll(tx, orgId));
  }

  private async recordCreated(tx: Tx, created: { id: number; uuid: string }, name: string) {
    await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: created.id,
      eventType: 'tag.created',
      payload: { uuid: created.uuid, name },
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

      const added = await this.repo.attach(
        tx,
        ctx.orgId,
        [...contactIdByUuid.values()],
        tagRows.map((t) => t.id),
        ctx.userId,
      );
      const uuidByContact = new Map([...contactIdByUuid].map(([uuid, id]) => [id, uuid]));
      const uuidByTag = new Map(tagRows.map((t) => [t.id, t.uuid]));
      for (const a of added) {
        await this.outbox.emit(tx, {
          aggregateModule: 'contacts',
          aggregateId: a.contactId,
          eventType: 'contact.tag_added',
          payload: { uuid: uuidByContact.get(a.contactId), tagId: uuidByTag.get(a.tagId) },
        });
      }

      return { succeeded, failed };
    });
  }

  /**
   * Tag one contact by id or by name, creating the tag when the name is new (WD-CON-039).
   * Idempotent: an attached tag stays attached and no second event fires.
   */
  async attachToContact(contactUuid: string, input: AttachContactTagInput): Promise<TagResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.contactsRepo.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        contact.ownerId,
      );

      // An id that is not a tag in this org falls through to the name, as in WaDesk; with
      // neither there is nothing to attach.
      let tag: TagRow | undefined = input.tagId
        ? await this.repo.findByUuid(tx, ctx.orgId, input.tagId)
        : undefined;
      if (!tag) {
        if (!input.name) {
          throw new AppError(
            ERROR_CODES.CON_TAG_REQUIRED,
            'Pick a tag or type a new name.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        tag = (
          await this.findOrCreateByName(tx, ctx.orgId, input.name, { enforcePermission: true })
        ).row;
      }

      const added = await this.repo.attach(tx, ctx.orgId, [contact.id], [tag.id], ctx.userId);
      if (added.length > 0) {
        await this.audit.record(tx, {
          module: 'contacts',
          recordId: contact.id,
          action: 'update',
          delta: { tags: { old: null, new: `+${tag.name}` } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'contacts',
          aggregateId: contact.id,
          eventType: 'contact.tag_added',
          payload: { uuid: contactUuid, tagId: tag.uuid },
        });
      }
      return toTagResponse(tag);
    });
  }

  async detachFromContact(contactUuid: string, tagUuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const contact = await this.contactsRepo.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        contact.ownerId,
      );
      const tag = await this.repo.findByUuid(tx, ctx.orgId, tagUuid);
      if (!tag) throw AppError.notFound('Tag', tagUuid);

      const removed = await this.repo.detach(tx, ctx.orgId, contact.id, tag.id);
      if (removed) {
        await this.audit.record(tx, {
          module: 'contacts',
          recordId: contact.id,
          action: 'update',
          delta: { tags: { old: `-${tag.name}`, new: null } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'contacts',
          aggregateId: contact.id,
          eventType: 'contact.tag_removed',
          payload: { uuid: contactUuid, tagId: tag.uuid },
        });
      }
    });
  }

  async listForContact(contactUuid: string): Promise<TagResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.contactsRepo.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        contact.ownerId,
      );
      const rows = await this.repo.listByContact(tx, ctx.orgId, contact.id);
      return rows.map(toTagResponse);
    });
  }
}
