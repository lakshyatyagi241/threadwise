import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import type {
  ListNotificationsQuery,
  MarkAllReadResponse,
  NotificationListResponse,
  NotificationResponse,
  ReadSubjectRequest,
  ReadSubjectResponse,
  UnreadCountResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ConversationReadState } from './conversation-read-state';
import { NotificationPublisher } from './notification.publisher';
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
 * there is no way to read or mark someone else's, so no permission key gates it (WaDesk had no role gate either).
 * Marking read is per-person state on a notification row, not an audited business change, so it writes no audit or
 * outbox row; the rows themselves are written by outbox consumers. Every mark-read tells the person's other tabs and devices
 * (`notification.read`, after the commit) so their badges converge.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: NotificationsRepository,
    private readonly publisher: NotificationPublisher,
    private readonly readState: ConversationReadState,
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
    const response = await this.db.tx(async (tx) => {
      const row = await this.repo.markRead(tx, orgId, userId, uuid);
      if (!row) throw AppError.notFound('Notification', uuid);
      return toNotificationResponse(row);
    });
    await this.publisher.read(orgId, userId, [response.id]);
    return response;
  }

  async markAllRead(): Promise<MarkAllReadResponse> {
    const { orgId, userId } = this.caller();
    const updated = await this.db.tx((tx) => this.repo.markAllRead(tx, orgId, userId));
    if (updated > 0) await this.publisher.read(orgId, userId, 'all');
    return { updated };
  }

  /**
   * Marks the caller's unread rows about one subject read (`POST /notifications/read-subject`). The inbox calls the same thing
   * when a thread is read (`markConversationRead`).
   */
  async markSubjectRead(input: ReadSubjectRequest): Promise<ReadSubjectResponse> {
    const { orgId, userId } = this.caller();
    return this.readSubject(orgId, userId, input);
  }

  /**
   * The caller read a conversation: its bell rows are read too, on every device. Also records the moment, so a message that arrives
   * while the thread is open does not alert the person looking at it. Never throws: reading a thread must not fail because the bell
   * could not be updated.
   */
  async markConversationRead(conversationUuid: string): Promise<void> {
    try {
      const { orgId, userId } = this.caller();
      await this.readState.markSeen(orgId, userId, conversationUuid);
      await this.readSubject(orgId, userId, { kind: 'conversation', id: conversationUuid });
    } catch {
      /* the bell is best effort here */
    }
  }

  private async readSubject(
    orgId: number,
    userId: number,
    input: ReadSubjectRequest,
  ): Promise<ReadSubjectResponse> {
    const done = await this.db.tx(async (tx) => {
      const ids = await this.repo.markSubjectRead(tx, orgId, userId, {
        kind: input.kind,
        uuid: input.id,
      });
      return { ids, unread: await this.repo.countUnread(tx, orgId, userId) };
    });
    if (done.ids.length > 0) await this.publisher.read(orgId, userId, done.ids);
    return { updated: done.ids.length, unread: done.unread };
  }
}
