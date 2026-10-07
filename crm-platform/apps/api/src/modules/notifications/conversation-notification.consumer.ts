import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { MESSAGE_RECEIVED_EVENT, messageReceivedPayloadSchema } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { notifyConfig } from '../../config/domains/notifications.env';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { MemberDirectory, PERM_CONVERSATION_READ, type ConversationRecord } from '../../realtime';
import { ConversationReadState } from './conversation-read-state';
import {
  assignedCopy,
  assignedKey,
  capRecipients,
  collapseKeyFor,
  mentionCopy,
  mentionKey,
  messageKey,
  newChatCopy,
  newChatKey,
  newMessageCopy,
  recipientsForAssignment,
  recipientsForMention,
  recipientsForMessage,
  recipientsForNewChat,
  typeForMessage,
} from './conversation-notification-rules';
import { NotificationPrefsResolver } from './notification-prefs.resolver';
import { NotificationPublisher } from './notification.publisher';
import { NotificationsRepository, type WrittenNotification } from './notifications.repository';

const PERM_CONVERSATION_REPLY = 'inbox.conversation.reply';
export const CONVERSATION_NOTIFY_EVENTS = [
  MESSAGE_RECEIVED_EVENT,
  'conversation.assigned',
  'conversation.note_added',
] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const uuidList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];

interface ConversationFacts extends ConversationRecord {
  uuid: string;
  mutedAt: Date | null;
  /** The sender's name as a notification words it (never a bare number: decision D4). */
  name: string | null;
  channelKind: string;
}

interface UserFacts {
  id: number;
  uuid: string;
  fullName: string | null;
}

/** A written row waiting for the live push, which must happen after the transaction commits. */
interface Pending {
  row: WrittenNotification;
  silent?: boolean;
  throttleKey?: string;
  /** The person's unread total, counted in the writing transaction. */
  unread?: number;
}

/**
 * Turns conversation events into bell rows (docs/specs/realtime-notifications.md catalogue rows 1 to 4):
 *
 *   message.received          the first message of a thread: a new chat; a later one: a new message, collapsed into one row per chat
 *   conversation.assigned     assigned to me (a person), or to my team
 *   conversation.note_added   mentioned in a note
 *
 * Every rule is recomputed at delivery time from the conversation as it is NOW, so a change that landed between the event and its
 * delivery is honoured and a stale one is dropped: who owns the thread, whether it is muted, who may read it. A muted thread
 * (`conversations.muted_at`) writes no row for a new chat or a message; an assignment or a mention still does (the person was addressed).
 * A person who just marked the thread read is looking at it and is skipped (`ConversationReadState`). The workspace owner's toggles
 * (decision D3) gate these four types. At most `NOTIFY_MAX_RECIPIENTS` people per event.
 *
 * Idempotent: each row carries a dedupe key built from the outbox event id (or the note), and the writes are ON CONFLICT DO NOTHING (a
 * collapsing row looks the key up first, so a redelivery does not delete the row it already replaced). The live push goes out AFTER the
 * transaction commits and never throws. Runs in the worker under the event's own tenant (RLS applies), never privileged. A bug here
 * fails only this subscriber, which the drain retries on its own; it cannot hold back the task, lead or wallet consumers.
 */
@Injectable()
export class ConversationNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'conversation-notifications';
  readonly eventTypes = CONVERSATION_NOTIFY_EVENTS;
  private readonly logger = new Logger(ConversationNotificationConsumer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: NotificationsRepository,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly directory: MemberDirectory,
    private readonly prefs: NotificationPrefsResolver,
    private readonly readState: ConversationReadState,
    private readonly publisher: NotificationPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    if (!notifyConfig().conversationsEnabled) return;
    const pending =
      event.eventType === MESSAGE_RECEIVED_EVENT
        ? await this.onMessage(event)
        : event.eventType === 'conversation.assigned'
          ? await this.onAssigned(event)
          : await this.onNote(event);
    // After the commit: the unread total the push carries must include the rows, and a rolled-back row must not be announced.
    for (const p of pending) {
      await this.publisher.created(event.orgId, p.row, {
        silent: p.silent,
        throttleKey: p.throttleKey,
        unread: p.unread,
      });
    }
  }

  // --- message.received ----------------------------------------------------------------------------------------------------------

  private async onMessage(event: OutboxEvent): Promise<Pending[]> {
    const parsed = messageReceivedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return [];
    const p = parsed.data;
    const type = typeForMessage(p.firstInbound);
    if (!(await this.prefs.inappAllowed(event.orgId, type))) return [];

    // One transaction for the read of the conversation and the writes: this runs once per inbound message, so the round trips count.
    return this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const conv = await this.conversationIn(tx, event.orgId, p.conversationId);
      if (!conv || conv.mutedAt !== null) return [];

      const readers = await this.directory.viewers(event.orgId, PERM_CONVERSATION_READ);
      const everyone = p.firstInbound
        ? recipientsForNewChat(
            conv,
            readers,
            conv.assigneeUserId === null && conv.assigneeTeamId === null
              ? await this.directory.viewers(event.orgId, PERM_CONVERSATION_REPLY)
              : [],
          )
        : recipientsForMessage(conv, readers);
      const capped = capRecipients(everyone, notifyConfig().maxRecipients);
      if (capped.truncated) {
        this.logger.warn(
          { orgId: event.orgId, conversationId: p.conversationId, people: everyone.length },
          'conversation notification truncated to the recipient cap',
        );
      }

      // Whoever marked this thread read since the message arrived has it open; telling them would only interrupt.
      const looking = await this.readState.seenSince(
        event.orgId,
        capped.userIds,
        p.conversationId,
        Date.parse(p.at),
      );
      const userIds = capped.userIds.filter((id) => !looking.has(id));
      if (userIds.length === 0) return [];

      const link = `/inbox?c=${p.conversationId}`;
      const subject = { subjectKind: 'conversation', subjectUuid: p.conversationId } as const;
      const name = p.contactName ?? conv.name;
      const dataBase = {
        conversationId: p.conversationId,
        contactName: name,
        channelKind: p.channelKind,
        preview: p.preview === '' ? null : p.preview,
      };

      const written: Pending[] = [];
      for (const userId of userIds) {
        if (p.firstInbound) {
          const copy = newChatCopy(name, p.preview);
          const row = await this.repo.insertReturning(tx, event.orgId, {
            userId,
            type,
            title: copy.title,
            body: copy.body,
            link,
            data: { ...dataBase, count: 1 },
            dedupeKey: newChatKey(p.conversationId, event.id),
            ...subject,
          });
          if (row) written.push({ row });
        } else {
          const row = await this.repo.collapseOrInsert(tx, event.orgId, {
            userId,
            type,
            link,
            dedupeKey: messageKey(event.id),
            eventId: Number(event.id),
            collapseKey: collapseKeyFor(p.conversationId),
            adds: 1,
            build: (count) => {
              const copy = newMessageCopy(name, p.preview, count);
              return { title: copy.title, body: copy.body, data: { ...dataBase, count } };
            },
            ...subject,
          });
          if (row) written.push({ row, throttleKey: p.conversationId });
        }
      }
      // The totals the pushes carry, counted here with the rows in view (one grouped query for everyone written).
      const totals = await this.repo.countUnreadFor(
        tx,
        event.orgId,
        written.map((w) => w.row.userId),
      );
      for (const w of written) w.unread = totals.get(w.row.userId);
      return written;
    });
  }

  // --- conversation.assigned -----------------------------------------------------------------------------------------------------

  private async onAssigned(event: OutboxEvent): Promise<Pending[]> {
    const p = event.payload;
    const conversationUuid = str(p.conversationId);
    if (!conversationUuid) return [];
    const toUserUuid = str(p.toUserId);
    const toTeamUuid = str(p.toTeamId);
    // An unassignment tells nobody.
    if (!toUserUuid && !toTeamUuid) return [];
    if (!(await this.prefs.inappAllowed(event.orgId, 'conversation_assigned'))) return [];

    const conv = await this.conversation(event.orgId, conversationUuid);
    if (!conv) return [];
    const byUuid = str(p.byUserId);
    const lookup = await this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => ({
      users: await this.users(
        tx,
        event.orgId,
        [toUserUuid, byUuid].filter((v): v is string => v !== null),
      ),
      teamId: toTeamUuid ? await this.teamId(tx, event.orgId, toTeamUuid) : null,
    }));
    const toUser = toUserUuid ? lookup.users.find((u) => u.uuid === toUserUuid) : undefined;
    const by = byUuid ? lookup.users.find((u) => u.uuid === byUuid) : undefined;

    // What the event said must still be true: reassigned since, or unassigned since, means this notification is late news.
    if (toUserUuid) {
      if (!toUser || conv.assigneeUserId !== toUser.id) return [];
    } else if (
      lookup.teamId === null ||
      conv.assigneeTeamId !== lookup.teamId ||
      conv.assigneeUserId !== null
    ) {
      return [];
    }

    const readers = await this.directory.viewers(event.orgId, PERM_CONVERSATION_READ);
    const who = recipientsForAssignment(
      { toUserId: toUser?.id ?? null, toTeamId: lookup.teamId, byUserId: by?.id ?? null },
      conv,
      readers,
    );
    const capped = capRecipients(who.userIds, notifyConfig().maxRecipients);
    if (capped.truncated) {
      this.logger.warn(
        { orgId: event.orgId, conversationId: conversationUuid },
        'assignment notification truncated to the recipient cap',
      );
    }
    if (capped.userIds.length === 0) return [];

    const copy = assignedCopy(conv.name, by?.fullName ?? null, who.team);
    const link = `/inbox?c=${conversationUuid}`;
    return this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      const recipients = await this.users(tx, event.orgId, undefined, capped.userIds);
      const written: Pending[] = [];
      for (const user of recipients) {
        const row = await this.repo.insertReturning(tx, event.orgId, {
          userId: user.id,
          type: 'conversation_assigned',
          title: copy.title,
          body: copy.body,
          link,
          data: {
            conversationId: conversationUuid,
            contactName: conv.name,
            channelKind: conv.channelKind,
            assignedByName: by?.fullName ?? null,
            teamAssigned: who.team,
          },
          dedupeKey: assignedKey(conversationUuid, user.uuid, event.id),
          subjectKind: 'conversation',
          subjectUuid: conversationUuid,
        });
        // A team-wide assignment fills the bell without a toast or a ping (spec row 3).
        if (row) written.push({ row, silent: who.team });
      }
      return written;
    });
  }

  // --- conversation.note_added ---------------------------------------------------------------------------------------------------

  private async onNote(event: OutboxEvent): Promise<Pending[]> {
    const p = event.payload;
    const conversationUuid = str(p.conversationId);
    const noteUuid = str(p.noteId);
    const authorUuid = str(p.authorId);
    const mentions = uuidList(p.mentions).filter((m) => m !== authorUuid);
    if (!conversationUuid || !noteUuid || mentions.length === 0) return [];
    if (!(await this.prefs.inappAllowed(event.orgId, 'mention'))) return [];

    const conv = await this.conversation(event.orgId, conversationUuid);
    if (!conv) return [];
    const readers = await this.directory.viewers(event.orgId, PERM_CONVERSATION_READ);

    return this.db.txAs({ orgId: event.orgId, userId: null }, async (tx) => {
      // The note is read under the tenant: a note deleted since the event is no longer worth an alert.
      const noteRows = await tx.execute(
        sql`SELECT body FROM conversation_notes WHERE org_id = ${event.orgId} AND uuid = ${noteUuid}::uuid`,
      );
      const note = noteRows.rows[0] as { body: string } | undefined;
      if (!note) return [];

      const people = await this.users(tx, event.orgId, [
        ...mentions,
        ...(authorUuid ? [authorUuid] : []),
      ]);
      const author = authorUuid ? people.find((u) => u.uuid === authorUuid) : undefined;
      const mentioned = people.filter((u) => mentions.includes(u.uuid));
      const allowed = capRecipients(
        recipientsForMention(
          mentioned.map((u) => u.id),
          author?.id ?? null,
          conv,
          readers,
        ),
        notifyConfig().maxRecipients,
      );
      const excerpt = note.body.replace(/\s+/g, ' ').trim().slice(0, 80);
      const copy = mentionCopy(author?.fullName ?? null, excerpt);
      const link = `/inbox?c=${conversationUuid}`;

      const written: Pending[] = [];
      for (const user of mentioned.filter((u) => allowed.userIds.includes(u.id))) {
        const row = await this.repo.insertReturning(tx, event.orgId, {
          userId: user.id,
          type: 'mention',
          title: copy.title,
          body: copy.body,
          link,
          data: {
            conversationId: conversationUuid,
            contactName: conv.name,
            channelKind: conv.channelKind,
            authorName: author?.fullName ?? null,
            noteId: noteUuid,
            preview: excerpt === '' ? null : excerpt,
          },
          dedupeKey: mentionKey(noteUuid, user.uuid),
          subjectKind: 'conversation',
          subjectUuid: conversationUuid,
        });
        if (row) written.push({ row });
      }
      return written;
    });
  }

  // --- reads ---------------------------------------------------------------------------------------------------------------------

  /** The conversation as it is now: who owns it, whether it is muted, and how to name its sender. Null when it is gone. */
  private conversation(orgId: number, uuid: string): Promise<ConversationFacts | null> {
    return this.db.txAs({ orgId, userId: null }, (tx) => this.conversationIn(tx, orgId, uuid));
  }

  private async conversationIn(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<ConversationFacts | null> {
    const res = await tx.execute(sql`
        SELECT c.assignee_user_id, c.assignee_team_id, c.muted_at, c.title, c.peer_name, c.peer_key, ch.kind AS channel_kind
        FROM conversations c
        JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
        WHERE c.org_id = ${orgId} AND c.uuid = ${uuid}::uuid
      `);
    const r = res.rows[0] as
      | {
          assignee_user_id: string | number | null;
          assignee_team_id: string | number | null;
          muted_at: string | Date | null;
          title: string;
          peer_name: string | null;
          peer_key: string;
          channel_kind: string;
        }
      | undefined;
    if (!r) return null;
    return {
      uuid,
      assigneeUserId: r.assignee_user_id === null ? null : Number(r.assignee_user_id),
      assigneeTeamId: r.assignee_team_id === null ? null : Number(r.assignee_team_id),
      mutedAt: r.muted_at === null ? null : new Date(r.muted_at),
      name: senderName(r),
      channelKind: r.channel_kind,
    };
  }

  /** Active users by uuid and/or internal id (inside the caller's tenant transaction). */
  private async users(
    tx: Tx,
    orgId: number,
    uuids?: string[],
    ids?: number[],
  ): Promise<UserFacts[]> {
    const wanted = [
      ...(uuids && uuids.length > 0
        ? [
            sql`uuid IN (${sql.join(
              uuids.map((u) => sql`${u}::uuid`),
              sql`, `,
            )})`,
          ]
        : []),
      ...(ids && ids.length > 0
        ? [
            sql`id IN (${sql.join(
              ids.map((i) => sql`${i}`),
              sql`, `,
            )})`,
          ]
        : []),
    ];
    if (wanted.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT id, uuid, full_name FROM users
      WHERE org_id = ${orgId} AND status = 'active' AND (${sql.join(wanted, sql` OR `)})
    `);
    return (res.rows as Array<{ id: string | number; uuid: string; full_name: string | null }>).map(
      (r) => ({ id: Number(r.id), uuid: r.uuid, fullName: r.full_name }),
    );
  }

  private async teamId(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM teams WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as { id: string | number } | undefined;
    return row ? Number(row.id) : null;
  }
}

const PHONE_KINDS = new Set(['simulator', 'whatsapp_cloud', 'whatsapp_qr']);

/**
 * How a notification names the sender: their own name; a group's title; else, on a phone channel, only the last four digits
 * (decision D4); else null, and the client falls back to the channel's name.
 */
export function senderName(r: {
  title: string;
  peer_name: string | null;
  peer_key: string;
  channel_kind: string;
}): string | null {
  if (r.peer_key.startsWith('g:')) return r.title.trim() || null;
  const name = r.peer_name?.trim();
  if (name) return name.slice(0, 200);
  return PHONE_KINDS.has(r.channel_kind) ? `…${r.peer_key.slice(-4)}` : null;
}
