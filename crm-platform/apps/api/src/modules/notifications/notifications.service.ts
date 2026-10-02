import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import type {
  ListNotificationsQuery,
  MarkAllReadResponse,
  NotificationListResponse,
  NotificationResponse,
  UnreadCountResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { toNotificationResponse } from './notifications.mapper';
import { NotificationsRepository } from './notifications.repository';

/** The keyset cursor is the id of the last row of the page, opaque to clients. */
const encode = (id: number): string => Buffer.from(String(id), 'utf8').toString('base64url');
function decode(raw: string): number {
  const id = Number.parseInt(Buffer.from(raw, 'base64url').toString('utf8'), 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
  return id;
}

/**
 * The caller's own notification feed (the header bell). Staff only, and every query is pinned to the caller's user id:
 * there is no way to read or mark someone else's, so no permission key gates it (Reference had no role gate either).
 * Marking read is per-person state on a notification row, not an audited business change, so it writes no audit or
 * outbox row; the rows themselves are written by outbox consumers.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: NotificationsRepository,
  ) {}

  private caller(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.forbidden('notifications');
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  async list(query: ListNotificationsQuery): Promise<NotificationListResponse> {
    const { orgId, userId } = this.caller();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, orgId, userId, {
        limit: query.limit + 1,
        beforeId: query.cursor ? decode(query.cursor) : undefined,
        unreadOnly: query.unreadOnly,
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map(toNotificationResponse),
        page: { nextCursor: hasMore && last ? encode(last.id) : null, hasMore, limit: query.limit },
        meta: { unread: await this.repo.countUnread(tx, orgId, userId) },
      };
    });
  }

  async unreadCount(): Promise<UnreadCountResponse> {
    const { orgId, userId } = this.caller();
    return this.db.tx(async (tx) => ({ unread: await this.repo.countUnread(tx, orgId, userId) }));
  }

  async markRead(uuid: string): Promise<NotificationResponse> {
    const { orgId, userId } = this.caller();
    return this.db.tx(async (tx) => {
      const row = await this.repo.markRead(tx, orgId, userId, uuid);
      if (!row) throw AppError.notFound('Notification', uuid);
      return toNotificationResponse(row);
    });
  }

  async markAllRead(): Promise<MarkAllReadResponse> {
    const { orgId, userId } = this.caller();
    return this.db.tx(async (tx) => ({ updated: await this.repo.markAllRead(tx, orgId, userId) }));
  }
}
