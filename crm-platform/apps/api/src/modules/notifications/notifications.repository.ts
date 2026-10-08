import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPE_PREF_KEY,
  effectiveEventFlags,
  resolveNotificationChannels,
  type NotificationChannelsEffective,
  type NotificationPrefType,
  type StoredNotificationPrefs,
  type StoredUserPref,
} from '@crm/contracts';
import { schema, type Tx } from '@crm/db';

const { inboxNotifications, notificationUserPrefs } = schema;

/** A type no catalogue entry knows (another domain's newer type): delivered as before, toast on, no ping, no browser push. */
const UNLISTED: NotificationChannelsEffective = {
  bell: true,
  toast: true,
  sound: false,
  push: false,
};

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
  /**
   * The person's effective toast and ping for this row (their own preference, else the catalogue default), resolved when the row was
   * written. Absent on a row built by hand: the publisher then uses the catalogue default of the type.
   */
  toast?: boolean;
  sound?: boolean;
  /** Whether this person's browser push applies to the row (their own choice, else the catalogue default). Absent: the catalogue default. */
  push?: boolean;
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
  /**
   * The recipient's stored preference for this type, when the caller already loaded it (one query for all recipients of an event).
   * `undefined`: the writer looks it up. `null`: the person never chose.
   */
  userPref?: StoredUserPref | null;
  /** The owner's in-app toggle for this type, when the caller already read it. `undefined`: the writer reads it (only for gated types). */
  workspaceInapp?: boolean;
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

  /**
   * The bell, toast and ping this person gets for this type: their own setting, else the owner's toggle, else the default
   * (`resolveNotificationChannels`). Looks up what the caller did not already pass in; for a type no toggle governs and a caller that
   * passed the preference, that is no query at all.
   */
  async channelsFor(
    tx: Tx,
    orgId: number,
    n: Pick<NewNotification, 'userId' | 'type' | 'userPref' | 'workspaceInapp'>,
  ): Promise<NotificationChannelsEffective> {
    if (!(n.type in NOTIFICATION_CATALOG)) return UNLISTED;
    const type = n.type as NotificationPrefType;
    const stored =
      n.userPref !== undefined ? n.userPref : await this.userPref(tx, orgId, n.userId, type);
    const key = NOTIFICATION_TYPE_PREF_KEY[type];
    let workspaceInapp = n.workspaceInapp;
    // The owner's toggle only matters when the person has no say of their own about the bell.
    if (workspaceInapp === undefined && key && (stored?.bell ?? null) === null) {
      const res = await tx.execute(
        sql`SELECT settings -> 'notificationPrefs' AS prefs FROM organizations WHERE id = ${orgId}`,
      );
      const prefs = (res.rows[0] as { prefs: StoredNotificationPrefs | null } | undefined)?.prefs;
      workspaceInapp = effectiveEventFlags(prefs ?? undefined, key).inapp;
    }
    return resolveNotificationChannels(type, stored, workspaceInapp ?? true);
  }

  /** One person's stored preference for a type (null when they never chose). */
  async userPref(
    tx: Tx,
    orgId: number,
    userId: number,
    type: string,
  ): Promise<StoredUserPref | null> {
    const rows = await tx
      .select({
        bell: notificationUserPrefs.bell,
        toast: notificationUserPrefs.toast,
        sound: notificationUserPrefs.sound,
        push: notificationUserPrefs.push,
      })
      .from(notificationUserPrefs)
      .where(
        and(
          eq(notificationUserPrefs.orgId, orgId),
          eq(notificationUserPrefs.userId, userId),
          eq(notificationUserPrefs.type, type),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** The stored preferences of several people for one type (one query); a person who never chose is absent from the map. */
  async userPrefsFor(
    tx: Tx,
    orgId: number,
    userIds: number[],
    type: string,
  ): Promise<Map<number, StoredUserPref>> {
    const out = new Map<number, StoredUserPref>();
    if (userIds.length === 0) return out;
    const rows = await tx
      .select({
        userId: notificationUserPrefs.userId,
        bell: notificationUserPrefs.bell,
        toast: notificationUserPrefs.toast,
        sound: notificationUserPrefs.sound,
        push: notificationUserPrefs.push,
      })
      .from(notificationUserPrefs)
      .where(
        and(
          eq(notificationUserPrefs.orgId, orgId),
          eq(notificationUserPrefs.type, type),
          inArray(notificationUserPrefs.userId, userIds),
        ),
      );
    for (const r of rows) {
      out.set(Number(r.userId), { bell: r.bell, toast: r.toast, sound: r.sound, push: r.push });
    }
    return out;
  }

  /** Every type the person changed, by type. */
  async userPrefsOf(tx: Tx, orgId: number, userId: number): Promise<Map<string, StoredUserPref>> {
    const rows = await tx
      .select({
        type: notificationUserPrefs.type,
        bell: notificationUserPrefs.bell,
        toast: notificationUserPrefs.toast,
        sound: notificationUserPrefs.sound,
        push: notificationUserPrefs.push,
      })
      .from(notificationUserPrefs)
      .where(and(eq(notificationUserPrefs.orgId, orgId), eq(notificationUserPrefs.userId, userId)));
    return new Map(
      rows.map((r) => [r.type, { bell: r.bell, toast: r.toast, sound: r.sound, push: r.push }]),
    );
  }

  /**
   * Applies a partial change to one person's preference for one type: a boolean sets the channel, `null` goes back to inheriting, an
   * absent key stays. A row left with nothing set is deleted, so the table only holds real choices. Applying the same patch twice
   * changes nothing (the update is skipped when no value would move, so the version does not bump).
   */
  async applyUserPref(
    tx: Tx,
    orgId: number,
    userId: number,
    type: string,
    patch: {
      bell?: boolean | null;
      toast?: boolean | null;
      sound?: boolean | null;
      push?: boolean | null;
    },
  ): Promise<void> {
    const has = (v: unknown) => v !== undefined;
    const val = (v: boolean | null | undefined) => (v === undefined ? null : v);
    await tx.execute(sql`
      INSERT INTO notification_user_prefs (org_id, user_id, type, bell, toast, sound, push)
      VALUES (${orgId}, ${userId}, ${type}, ${val(patch.bell)}, ${val(patch.toast)}, ${val(patch.sound)}, ${val(patch.push)})
      ON CONFLICT (org_id, user_id, type) DO UPDATE SET
        bell  = CASE WHEN ${has(patch.bell)}::boolean  THEN EXCLUDED.bell  ELSE notification_user_prefs.bell  END,
        toast = CASE WHEN ${has(patch.toast)}::boolean THEN EXCLUDED.toast ELSE notification_user_prefs.toast END,
        sound = CASE WHEN ${has(patch.sound)}::boolean THEN EXCLUDED.sound ELSE notification_user_prefs.sound END,
        push  = CASE WHEN ${has(patch.push)}::boolean  THEN EXCLUDED.push  ELSE notification_user_prefs.push  END
      WHERE (
        CASE WHEN ${has(patch.bell)}::boolean  THEN EXCLUDED.bell  ELSE notification_user_prefs.bell  END,
        CASE WHEN ${has(patch.toast)}::boolean THEN EXCLUDED.toast ELSE notification_user_prefs.toast END,
        CASE WHEN ${has(patch.sound)}::boolean THEN EXCLUDED.sound ELSE notification_user_prefs.sound END,
        CASE WHEN ${has(patch.push)}::boolean  THEN EXCLUDED.push  ELSE notification_user_prefs.push  END
      ) IS DISTINCT FROM (notification_user_prefs.bell, notification_user_prefs.toast, notification_user_prefs.sound, notification_user_prefs.push)`);
    await tx.execute(sql`
      DELETE FROM notification_user_prefs
       WHERE org_id = ${orgId} AND user_id = ${userId} AND type = ${type}
         AND bell IS NULL AND toast IS NULL AND sound IS NULL AND push IS NULL`);
  }

  /**
   * Like `insertOnce`, but hands back the written row (for the live push), or null when the key was already there or the person turned
   * the bell off for this type (their own setting, else the owner's toggle).
   */
  async insertReturning(
    tx: Tx,
    orgId: number,
    n: NewNotification,
  ): Promise<WrittenNotification | null> {
    const channels = await this.channelsFor(tx, orgId, n);
    if (!channels.bell) return null;
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
      toast: channels.toast,
      sound: channels.sound,
      push: channels.push,
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
    // A person who turned the bell off for this type has no row to collapse into: an existing one is left as it is.
    const channels = await this.channelsFor(tx, orgId, n);
    if (!channels.bell) return null;
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
      toast: channels.toast,
      sound: channels.sound,
      push: channels.push,
    };
  }

  /** What a browser push is built from: the row of one person, or undefined when it is gone (pruned, or another person's). */
  async findForPush(
    tx: Tx,
    orgId: number,
    userId: number,
    uuid: string,
  ): Promise<NotificationRow | undefined> {
    const rows = await tx
      .select(this.selection())
      .from(inboxNotifications)
      .where(and(...this.mine(orgId, userId), eq(inboxNotifications.uuid, uuid)))
      .limit(1);
    return rows[0] as NotificationRow | undefined;
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
