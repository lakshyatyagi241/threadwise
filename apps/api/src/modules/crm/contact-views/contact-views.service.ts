import { Injectable } from '@nestjs/common';
import type {
  ContactViewResponse,
  CreateContactViewInput,
  ListContactViewsQuery,
  PageResponse,
  ReorderContactViewsInput,
  UpdateContactViewInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { toContactViewResponse } from './contact-views.mapper';
import { ContactViewsRepository } from './contact-views.repository';

const MODULE_KEY = 'contact_views';

/**
 * Saved contact list views. `list` returns everything the caller can see in
 * one page — an org's saved-view count is bounded (dozens, not thousands) —
 * the contract still carries the standard page envelope for consistency.
 */
@Injectable()
export class ContactViewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactViewsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListContactViewsQuery): Promise<PageResponse<ContactViewResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.listVisible(tx, ctx.orgId, ctx.userId);
      const favorited = ctx.userId
        ? await this.repo.favoritedViewIds(
            tx,
            ctx.orgId,
            ctx.userId,
            rows.map((r) => r.id),
          )
        : new Set<number>();

      return {
        data: rows.map((row) => toContactViewResponse(row, favorited.has(row.id))),
        page: { nextCursor: null, hasMore: false, limit: query.limit },
      };
    });
  }

  async create(input: CreateContactViewInput): Promise<ContactViewResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const position = input.position ?? (await this.repo.nextPosition(tx, ctx.orgId));

      const created = await this.repo.insert(tx, ctx.orgId, {
        name: input.name,
        filter: input.filter,
        isShared: input.isShared,
        position,
        createdBy: ctx.userId,
      });

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact_view.created',
        payload: { uuid: created.uuid, name: input.name },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return toContactViewResponse(row!, false);
    });
  }

  async update(uuid: string, input: UpdateContactViewInput): Promise<ContactViewResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('ContactView', uuid);

      const values: Record<string, unknown> = {};
      if (input.name !== undefined) values.name = input.name;
      if (input.filter !== undefined) values.filter = input.filter;
      if (input.isShared !== undefined) values.isShared = input.isShared;

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('ContactView');

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
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact_view.updated',
        payload: { uuid },
      });

      const favorited = ctx.userId
        ? await this.repo.favoritedViewIds(tx, ctx.orgId, ctx.userId, [existing.id])
        : new Set<number>();
      return toContactViewResponse(row!, favorited.has(existing.id));
    });
  }

  async reorder(input: ReorderContactViewsInput): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const ids: number[] = [];
      for (const uuid of input.orderedIds) {
        const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
        if (!row) throw AppError.notFound('ContactView', uuid);
        ids.push(row.id);
      }
      await this.repo.reorder(tx, ctx.orgId, ids);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('ContactView', uuid);

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact_view.deleted',
        payload: { uuid },
      });

      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }

  /** "addContactView" (legacy name) — pin a shared view onto the caller's own sidebar. */
  async favorite(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('ContactView', uuid);
      await this.repo.addFavorite(tx, ctx.orgId, existing.id, ctx.userId!);
    });
  }

  /** "closeContactView" (legacy name) — unpin, without deleting the view itself. */
  async unfavorite(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('ContactView', uuid);
      await this.repo.removeFavorite(tx, ctx.orgId, existing.id, ctx.userId!);
    });
  }
}
