import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REALTIME_EVENT } from '@crm/contracts';
import { notifyConfig } from '../../config/domains/notifications.env';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { RealtimeEmitter } from '../../realtime';
import { NotificationsRepository, type WrittenNotification } from './notifications.repository';

export interface CreatedOptions {
  /** Update the bell but do not toast or ping (a team-wide assignment, a muted type). */
  silent?: boolean;
  /**
   * A key that identifies "the same conversation for the same person" (`<chat uuid>`): a second push inside the throttle window is sent
   * `silent`, so a burst of messages moves the row and the badge but pings once. Never drops the event itself.
   */
  throttleKey?: string;
  /**
   * The person's unread total, when the caller already counted it inside the transaction that wrote the row (saves a round trip per
   * recipient on the hot path). Omitted: it is counted here.
   */
  unread?: number;
}

/**
 * Tells a person's open tabs that their bell changed (`notification.created`, `notification.read`) over the `user` room.
 *
 * The row in `inbox_notifications` is the truth and the event is a hint: it carries ids and the person's true unread total, never text,
 * so the client refetches the feed (docs/api/realtime.md). Call it AFTER the transaction that wrote the row has committed (a rolled-back
 * row must not be announced, and the unread count must include it). It never throws: a Redis hiccup costs one live update, and the
 * client's poll and resync catch up.
 */
@Injectable()
export class NotificationPublisher {
  private readonly logger = new Logger(NotificationPublisher.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: NotificationsRepository,
    private readonly emitter: RealtimeEmitter,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** A bell row was written for `row.userId`. */
  async created(
    orgId: number,
    row: WrittenNotification,
    options: CreatedOptions = {},
  ): Promise<void> {
    try {
      const silent = options.silent === true || (await this.throttled(orgId, row.userId, options));
      const unread = options.unread ?? (await this.unread(orgId, row.userId));
      await this.emitter.emitToUsers(orgId, [row.userId], REALTIME_EVENT.notificationCreated, {
        notificationId: row.uuid,
        type: row.type,
        unread,
        subjectKind: row.subjectKind,
        subjectId: row.subjectUuid,
        collapsed: row.collapsed,
        silent,
      });
    } catch (err) {
      this.logger.warn(
        { err, orgId, userId: row.userId },
        'could not publish notification.created',
      );
    }
  }

  /** Several rows of one person were marked read (`'all'` for mark-all). Other tabs and devices converge on `unread`. */
  async read(orgId: number, userId: number, notificationIds: string[] | 'all'): Promise<void> {
    try {
      const unread = await this.unread(orgId, userId);
      await this.emitter.emitToUsers(orgId, [userId], REALTIME_EVENT.notificationRead, {
        unread,
        notificationIds,
      });
    } catch (err) {
      this.logger.warn({ err, orgId, userId }, 'could not publish notification.read');
    }
  }

  private unread(orgId: number, userId: number): Promise<number> {
    return this.db.txAs({ orgId, userId }, (tx) => this.repo.countUnread(tx, orgId, userId));
  }

  /** True when this (person, chat) already pinged inside the window. A Redis failure answers false: never lose a ping. */
  private async throttled(
    orgId: number,
    userId: number,
    options: CreatedOptions,
  ): Promise<boolean> {
    const seconds = notifyConfig().throttleSeconds;
    if (!options.throttleKey || seconds === 0) return false;
    try {
      const won = await this.redis.set(
        `rt:nc:${orgId}:${userId}:${options.throttleKey}`,
        '1',
        'PX',
        seconds * 1000,
        'NX',
      );
      return won === null;
    } catch {
      return false;
    }
  }
}
