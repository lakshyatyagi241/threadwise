import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { NotificationFanout, type PendingNotification } from './notification-fanout';
import {
  TEAMCHAT_NOTIFY_EVENTS,
  mayHearTeamChat,
  teamDirectCollapseKey,
  teamDirectCopy,
  teamDirectKey,
  teamMentionCollapseKey,
  teamMentionCopy,
  teamMentionKey,
  teamPreview,
  type TeamChatFacts,
} from './phase2-notification-rules';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const uuids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];

interface MessageFacts extends TeamChatFacts {
  messageId: number;
  messageUuid: string;
  channelId: number;
  channelUuid: string;
  authorId: number | null;
  body: string | null;
}

/**
 * Tells a person about team chat that is addressed to them (catalogue row 10):
 *
 *   teamchat.mention.created   the mentioned member, once per person and message (the producer already skips the author)
 *   teamchat.message.posted    in a direct message channel, the other person (unless the message also mentions them: that is the
 *                              mention's row, not a second one)
 *
 * Both collapse into ONE unread row per person and channel with a count, so a chatty thread is a single bell entry that moves to the top.
 * The person must still belong to a private or direct channel (membership is read at delivery), must not have read the message yet (a
 * channel kept open moves the person's read pointer past each message, which is how "not while they are looking" is known on the
 * server), and the message must still exist. Team chat has no per-channel mute; a person silences it with their own preference for
 * the type (`teamchat_mention`, `teamchat_message`), which this consumer honours through the repository. Idempotent: the key ends in the
 * outbox event id. The live push goes out after the commit, throttled per person and channel like the inbox.
 */
@Injectable()
export class TeamChatNotificationConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'team-chat-notifications';
  readonly eventTypes = TEAMCHAT_NOTIFY_EVENTS;

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: OutboxSubscriberRegistry,
    private readonly fanout: NotificationFanout,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const messageUuid = str(event.payload.uuid);
    if (!messageUuid) return;
    const channelUuid = str(event.payload.channelId);
    const pending: PendingNotification[] = await this.db.txAs(
      { orgId: event.orgId, userId: null },
      async (tx) => {
        const facts = await this.message(tx, event.orgId, messageUuid);
        if (!facts || (channelUuid && facts.channelUuid !== channelUuid)) return [];
        return event.eventType === 'teamchat.mention.created'
          ? this.onMention(tx, event, facts)
          : this.onPosted(tx, event, facts);
      },
    );
    await this.fanout.publish(event.orgId, pending);
  }

  private async onMention(
    tx: Tx,
    event: OutboxEvent,
    f: MessageFacts,
  ): Promise<PendingNotification[]> {
    const mentionedUuid = str(event.payload.mentionedUserId);
    if (!mentionedUuid) return [];
    const person = await this.person(tx, event.orgId, f, mentionedUuid);
    if (!person) return [];
    const preview = teamPreview(f.body);
    return this.fanout.writeCollapsing(
      tx,
      event.orgId,
      'teamchat_mention',
      [person.id],
      () => ({
        link: `/team-chat?c=${f.channelUuid}`,
        dedupeKey: teamMentionKey(f.messageUuid, person.uuid, event.id),
        eventId: Number(event.id),
        collapseKey: teamMentionCollapseKey(f.channelUuid),
        adds: 1,
        subjectKind: 'team_chat_channel',
        subjectUuid: f.channelUuid,
        build: (count) => {
          const copy = teamMentionCopy(f, preview, count);
          return {
            title: copy.title,
            body: copy.body,
            data: this.data(f, preview, count),
          };
        },
      }),
      { throttleKey: `tc:${f.channelUuid}` },
    );
  }

  private async onPosted(
    tx: Tx,
    event: OutboxEvent,
    f: MessageFacts,
  ): Promise<PendingNotification[]> {
    if (f.channelType !== 'dm') return [];
    const mentioned = new Set(uuids(event.payload.mentions));
    const res = await tx.execute(sql`
      SELECT u.id, u.uuid, cm.last_read_message_id
      FROM team_chat_channel_members cm
      JOIN users u ON u.org_id = cm.org_id AND u.id = cm.user_id
      WHERE cm.org_id = ${event.orgId} AND cm.channel_id = ${f.channelId} AND u.status = 'active'
        AND cm.user_id IS DISTINCT FROM ${f.authorId}`);
    const others = (
      res.rows as Array<{
        id: string | number;
        uuid: string;
        last_read_message_id: string | number;
      }>
    )
      .filter(
        (r) =>
          !mentioned.has(r.uuid) &&
          mayHearTeamChat({
            channelType: f.channelType,
            isMember: true,
            isAuthor: false,
            lastReadMessageId: Number(r.last_read_message_id),
            messageId: f.messageId,
          }),
      )
      .map((r) => ({ id: Number(r.id), uuid: r.uuid }));
    if (others.length === 0) return [];
    const byId = new Map(others.map((o) => [o.id, o.uuid]));
    const preview = teamPreview(f.body);
    return this.fanout.writeCollapsing(
      tx,
      event.orgId,
      'teamchat_message',
      others.map((o) => o.id),
      (userId) => ({
        link: `/team-chat?c=${f.channelUuid}`,
        dedupeKey: teamDirectKey(f.messageUuid, byId.get(userId) ?? String(userId), event.id),
        eventId: Number(event.id),
        collapseKey: teamDirectCollapseKey(f.channelUuid),
        adds: 1,
        subjectKind: 'team_chat_channel',
        subjectUuid: f.channelUuid,
        build: (count) => {
          const copy = teamDirectCopy(f, preview, count);
          return {
            title: copy.title,
            body: copy.body,
            data: { ...this.data(f, preview, count), direct: true },
          };
        },
      }),
      { throttleKey: `tc:${f.channelUuid}` },
    );
  }

  private data(f: MessageFacts, preview: string, count: number): Record<string, unknown> {
    return {
      channelId: f.channelUuid,
      channelName: f.channelType === 'dm' ? null : f.channelName,
      messageId: f.messageUuid,
      authorName: f.authorName,
      preview: preview === '' ? null : preview,
      count,
    };
  }

  /** The message with its channel and author, as it is now. Null when the message (or its channel) is gone. */
  private async message(tx: Tx, orgId: number, uuid: string): Promise<MessageFacts | null> {
    const res = await tx.execute(sql`
      SELECT m.id, m.uuid, m.body, m.user_id, c.id AS channel_id, c.uuid AS channel_uuid, c.name, c.type, a.full_name
      FROM team_chat_messages m
      JOIN team_chat_channels c ON c.org_id = m.org_id AND c.id = m.channel_id
      LEFT JOIN users a ON a.org_id = m.org_id AND a.id = m.user_id
      WHERE m.org_id = ${orgId} AND m.uuid = ${uuid}::uuid`);
    const r = res.rows[0] as
      | {
          id: string | number;
          uuid: string;
          body: string | null;
          user_id: string | number | null;
          channel_id: string | number;
          channel_uuid: string;
          name: string;
          type: 'public' | 'private' | 'dm';
          full_name: string | null;
        }
      | undefined;
    if (!r) return null;
    return {
      messageId: Number(r.id),
      messageUuid: r.uuid,
      channelId: Number(r.channel_id),
      channelUuid: r.channel_uuid,
      authorId: r.user_id === null ? null : Number(r.user_id),
      body: r.body,
      channelType: r.type,
      channelName: r.name,
      authorName: r.full_name,
    };
  }

  /** The mentioned member when they may hear it: active, in the channel if it is closed, and not yet caught up. */
  private async person(
    tx: Tx,
    orgId: number,
    f: MessageFacts,
    userUuid: string,
  ): Promise<{ id: number; uuid: string } | null> {
    const res = await tx.execute(sql`
      SELECT u.id, u.uuid, cm.last_read_message_id AS last_read, (cm.id IS NOT NULL) AS is_member
      FROM users u
      LEFT JOIN team_chat_channel_members cm
        ON cm.org_id = u.org_id AND cm.user_id = u.id AND cm.channel_id = ${f.channelId}
      WHERE u.org_id = ${orgId} AND u.uuid = ${userUuid}::uuid AND u.status = 'active'`);
    const r = res.rows[0] as
      | {
          id: string | number;
          uuid: string;
          last_read: string | number | null;
          is_member: boolean;
        }
      | undefined;
    if (!r) return null;
    const ok = mayHearTeamChat({
      channelType: f.channelType,
      isMember: r.is_member === true,
      isAuthor: f.authorId !== null && Number(r.id) === f.authorId,
      lastReadMessageId: Number(r.last_read ?? 0),
      messageId: f.messageId,
    });
    return ok ? { id: Number(r.id), uuid: r.uuid } : null;
  }
}
