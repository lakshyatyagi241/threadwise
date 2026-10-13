import { Injectable } from '@nestjs/common';
import type {
  ContactViewResponse,
  ViewAccessType,
  ViewShareMode,
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
import { toContactViewResponse, type ViewAccess } from './contact-views.mapper';
import { ContactViewsRepository, type ContactViewRow } from './contact-views.repository';
import type { Tx } from '@crm/db';

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

  /** What the caller may do with a view they can already see: the creator does everything; shared people do what `accessType` allows. */
  private accessOf(row: ContactViewRow, userId: number | null): ViewAccess {
    const creator = row.createdBy === null || row.createdBy === userId;
    return {
      canManage: creator,
      canEdit: creator || (row.shareMode !== 'me' && row.accessType === 'can_edit'),
    };
  }

  /** A view's row if the caller may see it, else 404 (a view someone else keeps to themselves does not exist for the caller). */
  private async visible(
    tx: Tx,
    orgId: number,
    uuid: string,
    userId: number | null,
  ): Promise<ContactViewRow> {
    const row = await this.repo.findByUuid(tx, orgId, uuid);
    const seen =
      row &&
      (row.createdBy === userId ||
        row.shareMode === 'everyone' ||
        (row.shareMode === 'selected' &&
          userId !== null &&
          (await this.repo.isSharedWith(tx, orgId, row.id, userId))));
    if (!row || !seen) throw AppError.notFound('ContactView', uuid);
    return row;
  }

  /** The caller's own view of one row: favorite flag, what they may do, and who it is shared with. */
  private async present(
    tx: Tx,
    orgId: number,
    userId: number | null,
    row: ContactViewRow,
  ): Promise<ContactViewResponse> {
    const favorited = userId
      ? await this.repo.favoritedViewIds(tx, orgId, userId, [row.id])
      : new Set<number>();
    const shared = await this.repo.sharedUserUuids(tx, orgId, [row.id]);
    return toContactViewResponse(
      row,
      favorited.has(row.id),
      this.accessOf(row, userId),
      shared.get(row.id) ?? [],
    );
  }

  /**
   * The sharing a request asks for: `shareMode` wins over the older `isShared` flag. People are checked against this workspace; an
   * unknown one is a 422 naming the field, not a silently shorter list.
   */
  private async sharing(
    tx: Tx,
    orgId: number,
    input: {
      isShared?: boolean;
      shareMode?: ViewShareMode;
      accessType?: ViewAccessType;
      userIds?: string[];
    },
    current?: ContactViewRow,
  ): Promise<{
    shareMode: ViewShareMode;
    accessType: ViewAccessType;
    isShared: boolean;
    userIds: number[] | null;
  }> {
    const mode: ViewShareMode =
      input.shareMode ??
      (input.isShared === undefined
        ? (current?.shareMode ?? 'me')
        : input.isShared
          ? 'everyone'
          : 'me');
    // The creator alone is never limited, so 'me' carries no access level worth keeping.
    const access: ViewAccessType =
      mode === 'me' ? 'can_edit' : (input.accessType ?? current?.accessType ?? 'can_view');
    let userIds: number[] | null = null;
    if (mode === 'selected' && input.userIds !== undefined) {
      const wanted = [...new Set(input.userIds)];
      const found = await this.repo.userIdsByUuid(tx, orgId, wanted);
      const missing = wanted.filter((u) => !found.has(u));
      if (missing.length > 0)
        throw AppError.validation('Some of the people to share with were not found', [
          { path: 'userIds', message: 'unknown person' },
        ]);
      userIds = wanted.map((u) => found.get(u)!);
    }
    return { shareMode: mode, accessType: access, isShared: mode !== 'me', userIds };
  }

  async list(query: ListContactViewsQuery): Promise<PageResponse<ContactViewResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.listVisible(tx, ctx.orgId, ctx.userId);
      const ids = rows.map((r) => r.id);
      const favorited = ctx.userId
        ? await this.repo.favoritedViewIds(tx, ctx.orgId, ctx.userId, ids)
        : new Set<number>();
      const shared = await this.repo.sharedUserUuids(tx, ctx.orgId, ids);

      return {
        data: rows.map((row) =>
          toContactViewResponse(
            row,
            favorited.has(row.id),
            this.accessOf(row, ctx.userId),
            shared.get(row.id) ?? [],
          ),
        ),
        page: { nextCursor: null, hasMore: false, limit: query.limit },
      };
    });
  }

  async create(input: CreateContactViewInput): Promise<ContactViewResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const position = input.position ?? (await this.repo.nextPosition(tx, ctx.orgId));
      const share = await this.sharing(tx, ctx.orgId, input);

      const created = await this.repo.insert(tx, ctx.orgId, {
        name: input.name,
        filter: input.filter,
        isShared: share.isShared,
        shareMode: share.shareMode,
        accessType: share.accessType,
        position,
        createdBy: ctx.userId,
      });
      if (share.userIds)
        await this.repo.replaceSharedUsers(tx, ctx.orgId, created.id, share.userIds);

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact_view.created',
        payload: { uuid: created.uuid, name: input.name },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return this.present(tx, ctx.orgId, ctx.userId, row!);
    });
  }

  async update(uuid: string, input: UpdateContactViewInput): Promise<ContactViewResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.visible(tx, ctx.orgId, uuid, ctx.userId);
      const access = this.accessOf(existing, ctx.userId);
      if (!access.canEdit) throw AppError.forbidden('record.contact-views.update');

      const changesSharing =
        input.isShared !== undefined ||
        input.shareMode !== undefined ||
        input.accessType !== undefined ||
        input.userIds !== undefined;
      // Who may see a view is the creator's call; someone it is shared with as `can_edit` changes its name and filter only.
      if (changesSharing && !access.canManage)
        throw AppError.forbidden('record.contact-views.update');

      const values: Record<string, unknown> = {};
      if (input.name !== undefined) values.name = input.name;
      if (input.filter !== undefined) values.filter = input.filter;
      let people: number[] | null = null;
      if (changesSharing) {
        const share = await this.sharing(tx, ctx.orgId, input, existing);
        values.isShared = share.isShared;
        values.shareMode = share.shareMode;
        values.accessType = share.accessType;
        people = share.shareMode === 'selected' ? share.userIds : [];
        // 'selected' with no new list keeps the people it already had.
        if (
          share.shareMode === 'selected' &&
          share.userIds === null &&
          existing.shareMode !== 'selected'
        )
          throw AppError.validation('Choose at least one person to share with', [
            { path: 'userIds', message: 'required' },
          ]);
      }

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('ContactView');
      if (people !== null) await this.repo.replaceSharedUsers(tx, ctx.orgId, existing.id, people);

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

      return this.present(tx, ctx.orgId, ctx.userId, row!);
    });
  }

  async reorder(input: ReorderContactViewsInput): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const ids: number[] = [];
      for (const uuid of input.orderedIds) {
        const row = await this.visible(tx, ctx.orgId, uuid, ctx.userId);
        ids.push(row.id);
      }
      await this.repo.reorder(tx, ctx.orgId, ids);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.visible(tx, ctx.orgId, uuid, ctx.userId);
      if (!this.accessOf(existing, ctx.userId).canManage)
        throw AppError.forbidden('record.contact-views.delete');

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
      const existing = await this.visible(tx, ctx.orgId, uuid, ctx.userId);
      await this.repo.addFavorite(tx, ctx.orgId, existing.id, ctx.userId!);
    });
  }

  /** "closeContactView" (legacy name) — unpin, without deleting the view itself. */
  async unfavorite(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    await this.db.tx(async (tx) => {
      const existing = await this.visible(tx, ctx.orgId, uuid, ctx.userId);
      await this.repo.removeFavorite(tx, ctx.orgId, existing.id, ctx.userId!);
    });
  }
}
