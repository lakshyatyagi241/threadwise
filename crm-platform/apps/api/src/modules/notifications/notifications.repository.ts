import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';

const { inboxNotifications } = schema;

export interface NotificationRow {
  id: number;
  uuid: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NewNotification {
  userId: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown> | null;
  /** Idempotency key; a second insert with the same (org, user, key) is a no-op. */
  dedupeKey: string;
}

/** Data access for `inbox_notifications`: one person's feed. Every read and write is pinned to (org, user). */
@Injectable()
export class NotificationsRepository {
  private selection() {
    return {
      id: inboxNotifications.id,
      uuid: inboxNotifications.uuid,
      type: inboxNotifications.type,
      title: inboxNotifications.title,
      body: inboxNotifications.body,
      link: inboxNotifications.link,
      data: inboxNotifications.data,
      readAt: inboxNotifications.readAt,
      createdAt: inboxNotifications.createdAt,
    };
  }

  private mine(orgId: number, userId: number): SQL[] {
    return [eq(inboxNotifications.orgId, orgId), eq(inboxNotifications.userId, userId)];
  }

  /** Newest first. `beforeId` is the keyset bound (ids grow with time within a person's feed). */
  async list(
    tx: Tx,
    orgId: number,
    userId: number,
    opts: { limit: number; beforeId?: number; unreadOnly: boolean },
  ): Promise<NotificationRow[]> {
    const conditions = this.mine(orgId, userId);
    if (opts.beforeId !== undefined) conditions.push(lt(inboxNotifications.id, opts.beforeId));
    if (opts.unreadOnly) conditions.push(isNull(inboxNotifications.readAt));
    const rows = await tx
      .select(this.selection())
      .from(inboxNotifications)
      .where(and(...conditions))
      .orderBy(desc(inboxNotifications.id))
      .limit(opts.limit);
    return rows as NotificationRow[];
  }

  async countUnread(tx: Tx, orgId: number, userId: number): Promise<number> {
    const rows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(inboxNotifications)
      .where(and(...this.mine(orgId, userId), isNull(inboxNotifications.readAt)));
    return Number(rows[0]?.n ?? 0);
  }

  /** Marks one of the caller's notifications read (a no-op when it already is). Undefined when it is not theirs or absent. */
  async markRead(
    tx: Tx,
    orgId: number,
    userId: number,
    uuid: string,
  ): Promise<NotificationRow | undefined> {
    const [touched] = await tx
      .update(inboxNotifications)
      .set({ readAt: sql`coalesce(${inboxNotifications.readAt}, now())` })
      .where(and(...this.mine(orgId, userId), eq(inboxNotifications.uuid, uuid)))
      .returning(this.selection());
    return touched as NotificationRow | undefined;
  }

  async markAllRead(tx: Tx, orgId: number, userId: number): Promise<number> {
    const res = await tx
      .update(inboxNotifications)
      .set({ readAt: sql`now()` })
      .where(and(...this.mine(orgId, userId), isNull(inboxNotifications.readAt)))
      .returning({ id: inboxNotifications.id });
    return res.length;
  }

  /** Inserts unless the same (org, user, dedupeKey) is already there. Returns whether a row was written. */
  async insertOnce(tx: Tx, orgId: number, n: NewNotification): Promise<boolean> {
    const res = await tx
      .insert(inboxNotifications)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        userId: n.userId,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        data: n.data,
        dedupeKey: n.dedupeKey,
      })
      .onConflictDoNothing()
      .returning({ id: inboxNotifications.id });
    return res.length > 0;
  }
}
