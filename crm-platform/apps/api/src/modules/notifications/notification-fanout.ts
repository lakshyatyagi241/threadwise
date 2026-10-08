import { Injectable } from '@nestjs/common';
import type { NotificationPrefType } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { NotificationPrefsResolver } from './notification-prefs.resolver';
import { NotificationPublisher } from './notification.publisher';
import {
  NotificationsRepository,
  type CollapsingNotification,
  type NewNotification,
  type WrittenNotification,
} from './notifications.repository';

/** A written row waiting for the live push, which must go out after the transaction commits. */
export interface PendingNotification {
  row: WrittenNotification;
  silent?: boolean;
  throttleKey?: string;
  /** The person's unread total, counted in the writing transaction. */
  unread?: number;
}

export type RowDraft = Omit<NewNotification, 'userId' | 'type' | 'userPref' | 'workspaceInapp'>;
export type CollapsingDraft = Omit<
  CollapsingNotification,
  'userId' | 'type' | 'userPref' | 'workspaceInapp'
>;

/**
 * The shared tail of the phase 2 producers (devices, send outcomes, team chat): given the people to tell, write one bell row each inside
 * the caller's tenant transaction, honouring each person's own preference and the owner's toggle (the repository decides: person, then
 * owner, then default), then announce the rows live after the commit.
 *
 * One query loads every recipient's stored preference, the owner's toggle is read once (a few seconds of cache), and the unread totals the
 * pushes carry are counted once for everyone written, so an event costs a handful of round trips whatever the audience.
 */
@Injectable()
export class NotificationFanout {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly prefs: NotificationPrefsResolver,
    private readonly publisher: NotificationPublisher,
  ) {}

  /** One row per person; `make` returns null to skip a person. Idempotent through each draft's `dedupeKey`. */
  async write(
    tx: Tx,
    orgId: number,
    type: NotificationPrefType,
    userIds: number[],
    make: (userId: number) => RowDraft | null,
    options: { silent?: boolean; throttleKey?: string } = {},
  ): Promise<PendingNotification[]> {
    if (userIds.length === 0) return [];
    const [workspaceInapp, userPrefs] = await Promise.all([
      this.prefs.inappAllowed(orgId, type),
      this.repo.userPrefsFor(tx, orgId, userIds, type),
    ]);
    const written: PendingNotification[] = [];
    for (const userId of userIds) {
      const draft = make(userId);
      if (!draft) continue;
      const row = await this.repo.insertReturning(tx, orgId, {
        ...draft,
        userId,
        type,
        userPref: userPrefs.get(userId) ?? null,
        workspaceInapp,
      });
      if (row) written.push({ row, ...options });
    }
    return this.withTotals(tx, orgId, written);
  }

  /** Like `write`, for a type that keeps one unread row per person and subject (the count goes up instead of a new row). */
  async writeCollapsing(
    tx: Tx,
    orgId: number,
    type: NotificationPrefType,
    userIds: number[],
    make: (userId: number) => CollapsingDraft | null,
    options: { throttleKey?: string } = {},
  ): Promise<PendingNotification[]> {
    if (userIds.length === 0) return [];
    const [workspaceInapp, userPrefs] = await Promise.all([
      this.prefs.inappAllowed(orgId, type),
      this.repo.userPrefsFor(tx, orgId, userIds, type),
    ]);
    const written: PendingNotification[] = [];
    for (const userId of userIds) {
      const draft = make(userId);
      if (!draft) continue;
      const row = await this.repo.collapseOrInsert(tx, orgId, {
        ...draft,
        userId,
        type,
        userPref: userPrefs.get(userId) ?? null,
        workspaceInapp,
      });
      if (row) written.push({ row, ...options });
    }
    return this.withTotals(tx, orgId, written);
  }

  /** After the commit. Never throws (the publisher swallows its own failures). */
  async publish(orgId: number, pending: PendingNotification[]): Promise<void> {
    for (const p of pending) {
      await this.publisher.created(orgId, p.row, {
        silent: p.silent,
        throttleKey: p.throttleKey,
        unread: p.unread,
      });
    }
  }

  private async withTotals(
    tx: Tx,
    orgId: number,
    written: PendingNotification[],
  ): Promise<PendingNotification[]> {
    if (written.length === 0) return written;
    const totals = await this.repo.countUnreadFor(
      tx,
      orgId,
      written.map((w) => w.row.userId),
    );
    for (const w of written) w.unread = totals.get(w.row.userId);
    return written;
  }
}
