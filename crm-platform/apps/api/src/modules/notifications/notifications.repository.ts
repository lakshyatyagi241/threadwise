import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
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
  /** Present only on collapsing rows (`msg:<conversation uuid>`). */
  collapseKey: string | null;
  eventCount: number;
  subjectKind: string | null;
  subjectUuid: string | null;
}

/** A row that was just written: what the live push needs (the type and subject travel in the event, the text does not). */
export interface WrittenNotification {
  id: number;
  uuid: string;
  userId: number;
  type: string;
  subjectKind: string | null;
  subjectUuid: string | null;
  /** The row replaced an earlier unread row of the same chat. */
  collapsed: boolean;
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
  /** What the row is about (`conversation`) and which one: lets "mark read" find it. */
  subjectKind?: string;
  subjectUuid?: string;
}

/** The text of a collapsing row depends on how many events it stands for, so the writer asks the caller once it knows. */
export interface CollapsingNotification extends Omit<NewNotification, 'title' | 'body' | 'data'> {
  /** One unread row per (user, key): `msg:<conversation uuid>`. */
  collapseKey: string;
  /** What this event adds to the count (1). */
  adds: number;
  /** The outbox event's id (numeric): events at or below the newest row's are redeliveries and add nothing. */
  eventId: number;
  build(count: number): Pick<NewNotification, 'title' | 'body' | 'data'>;
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
      collapseKey: inboxNotifications.collapseKey,
      eventCount: inboxNotifications.eventCount,
      subjectKind: inboxNotifications.subjectKind,
      subjectUuid: inboxNotifications.subjectUuid,
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

  /** Unread totals for several people at once (one grouped query), 0 for anyone with none. */
  async countUnreadFor(tx: Tx, orgId: number, userIds: number[]): Promise<Map<number, number>> {
    const totals = new Map<number, number>(userIds.map((id) => [id, 0]));
    if (userIds.length === 0) return totals;
    const rows = await tx
      .select({ userId: inboxNotifications.userId, n: sql<number>`count(*)::int` })
      .from(inboxNotifications)
      .where(
        and(
          eq(inboxNotifications.orgId, orgId),
          inArray(inboxNotifications.userId, userIds),
          isNull(inboxNotifications.readAt),
        ),
      )
      .groupBy(inboxNotifications.userId);
    for (const r of rows) totals.set(Number(r.userId), Number(r.n));
    return totals;
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
    return (await this.insertReturning(tx, orgId, n)) !== null;
  }

  /** Like `insertOnce`, but hands back the written row (for the live push), or null when the key was already there. */
  async insertReturning(
    tx: Tx,
    orgId: number,
    n: NewNotification,
  ): Promise<WrittenNotification | null> {
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
        subjectKind: n.subjectKind ?? null,
        subjectUuid: n.subjectUuid ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: inboxNotifications.id, uuid: inboxNotifications.uuid });
    const row = res[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      uuid: row.uuid,
      userId: n.userId,
      type: n.type,
      subjectKind: n.subjectKind ?? null,
      subjectUuid: n.subjectUuid ?? null,
      collapsed: false,
    };
  }

  /**
   * Writes a collapsing row: the person's unread row for this key (if any) is deleted and a new one is inserted carrying the old
   * count plus `adds`, so a chat stays ONE row that moves to the top of the feed (the keyset cursor is the id, which only grows).
   *
   * Idempotent per event: the new row carries the event's `dedupeKey` (which ends in the event id), and any event at or below the newest
   * row's id is a redelivery that writes nothing (the delete must not run for one, or the person would lose the row and get no
   * replacement, and the older events of a re-claimed batch must not be counted twice). Concurrent writers for one (user, key)
   * are serialised by a transaction-scoped advisory lock; the partial unique index on the key is the backstop.
   */
  async collapseOrInsert(
    tx: Tx,
    orgId: number,
    n: CollapsingNotification,
  ): Promise<WrittenNotification | null> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`inbox_notifications:${orgId}:${n.userId}:${n.collapseKey}`}, 0))`,
    );
    // Already counted? The newest row of this key (read or not) was written by the highest event so far, and its dedupe key ends in that
    // event's id. An event at or below it is a redelivery (a crashed batch is claimed again whole), so it must not add to the count.
    // The exact key is checked first because it is the common redelivery and needs no scan.
    const latest = await tx
      .select({ dedupeKey: inboxNotifications.dedupeKey })
      .from(inboxNotifications)
      .where(and(...this.mine(orgId, n.userId), eq(inboxNotifications.collapseKey, n.collapseKey)))
      .orderBy(desc(inboxNotifications.id))
      .limit(1);
    const lastEvent = Number(latest[0]?.dedupeKey?.split(':').pop());
    if (
      latest[0]?.dedupeKey === n.dedupeKey ||
      (Number.isFinite(lastEvent) && lastEvent >= n.eventId)
    ) {
      return null;
    }

    const replaced = await tx
      .delete(inboxNotifications)
      .where(
        and(
          ...this.mine(orgId, n.userId),
          eq(inboxNotifications.collapseKey, n.collapseKey),
          isNull(inboxNotifications.readAt),
        ),
      )
      .returning({ count: inboxNotifications.eventCount });
    const prior = replaced.reduce((sum, r) => sum + Number(r.count), 0);
    const count = prior + n.adds;
    const text = n.build(count);

    const res = await tx
      .insert(inboxNotifications)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        userId: n.userId,
        type: n.type,
        title: text.title,
        body: text.body,
        link: n.link,
        data: text.data,
        dedupeKey: n.dedupeKey,
        collapseKey: n.collapseKey,
        eventCount: count,
        subjectKind: n.subjectKind ?? null,
        subjectUuid: n.subjectUuid ?? null,
      })
      .returning({ id: inboxNotifications.id, uuid: inboxNotifications.uuid });
    const row = res[0]!;
    return {
      id: Number(row.id),
      uuid: row.uuid,
      userId: n.userId,
      type: n.type,
      subjectKind: n.subjectKind ?? null,
      subjectUuid: n.subjectUuid ?? null,
      collapsed: replaced.length > 0,
    };
  }

  /** Marks the caller's unread rows about one subject read. Returns the uuids that changed (empty when nothing was unread). */
  async markSubjectRead(
    tx: Tx,
    orgId: number,
    userId: number,
    subject: { kind: string; uuid: string },
  ): Promise<string[]> {
    const res = await tx
      .update(inboxNotifications)
      .set({ readAt: sql`now()` })
      .where(
        and(
          ...this.mine(orgId, userId),
          eq(inboxNotifications.subjectKind, subject.kind),
          eq(inboxNotifications.subjectUuid, subject.uuid),
          isNull(inboxNotifications.readAt),
        ),
      )
      .returning({ uuid: inboxNotifications.uuid });
    return res.map((r) => r.uuid);
  }
}
