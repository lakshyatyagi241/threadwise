import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { TchatChannelType, TchatInvitationStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';

/**
 * Every SQL statement of team chat. Each method takes the transaction it runs in (tenant scoping is the caller's, through
 * DatabaseService.tx) and names `org_id` itself so the planner can use the (org_id, ...) indexes; row-level security is the
 * backstop, not the filter.
 */

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const date = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const idList = (ids: number[]): SQL =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );

export interface ChannelRow {
  id: number;
  uuid: string;
  name: string;
  slug: string;
  type: TchatChannelType;
  description: string | null;
  createdById: number | null;
  lastMessageAt: Date | null;
  rowVersion: number;
  createdAt: Date;
}

export interface ChannelListRow extends ChannelRow {
  unread: number;
  peerUuid: string | null;
  peerName: string | null;
}

const toChannel = (r: Raw): ChannelRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.name as string,
  slug: r.slug as string,
  type: r.type as TchatChannelType,
  description: str(r.description),
  createdById: num(r.created_by_user_id),
  lastMessageAt: date(r.last_message_at),
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
});

export interface PersonRow {
  id: number;
  uuid: string;
  name: string;
  email: string;
}

const toPerson = (r: Raw): PersonRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.full_name as string,
  email: r.email as string,
});

export interface MessageRow {
  id: number;
  uuid: string;
  channelId: number;
  channelUuid: string;
  userId: number | null;
  authorUuid: string | null;
  authorName: string | null;
  body: string | null;
  mentionIds: number[];
  replyToId: number | null;
  replyUuid: string | null;
  replyAuthorName: string | null;
  replyBody: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  hasAttachment: boolean;
  editedAt: Date | null;
  pinnedAt: Date | null;
  rowVersion: number;
  createdAt: Date;
}

const toMessage = (r: Raw): MessageRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  channelId: Number(r.channel_id),
  channelUuid: r.channel_uuid as string,
  userId: num(r.user_id),
  authorUuid: str(r.author_uuid),
  authorName: str(r.author_name),
  body: str(r.body),
  mentionIds: Array.isArray(r.mentions) ? (r.mentions as unknown[]).map(Number) : [],
  replyToId: num(r.reply_to_id),
  replyUuid: str(r.reply_uuid),
  replyAuthorName: str(r.reply_author_name),
  replyBody: str(r.reply_body),
  attachmentName: str(r.attachment_name),
  attachmentMime: str(r.attachment_mime),
  hasAttachment: r.attachment_path !== null && r.attachment_path !== undefined,
  editedAt: date(r.edited_at),
  pinnedAt: date(r.pinned_at),
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
});

const MESSAGE_SELECT = sql`
  SELECT m.id, m.uuid, m.channel_id, c.uuid AS channel_uuid, m.user_id, au.uuid AS author_uuid, au.full_name AS author_name,
         m.body, m.mentions, m.reply_to_id, rp.uuid AS reply_uuid, ru.full_name AS reply_author_name, rp.body AS reply_body,
         m.attachment_path, m.attachment_name, m.attachment_mime, m.edited_at, m.pinned_at, m.row_version, m.created_at
  FROM team_chat_messages m
  JOIN team_chat_channels c ON c.org_id = m.org_id AND c.id = m.channel_id
  LEFT JOIN users au ON au.org_id = m.org_id AND au.id = m.user_id
  LEFT JOIN team_chat_messages rp ON rp.org_id = m.org_id AND rp.id = m.reply_to_id
  LEFT JOIN users ru ON ru.org_id = rp.org_id AND ru.id = rp.user_id`;

export interface InvitationRow {
  id: number;
  uuid: string;
  channelId: number | null;
  channelUuid: string | null;
  channelName: string | null;
  requesterId: number | null;
  requesterName: string | null;
  requesterEmail: string | null;
  inviteeUserId: number | null;
  inviteeEmail: string | null;
  inviteeName: string | null;
  /** The invitee has an active account in this workspace right now. */
  inviteeActive: boolean;
  status: TchatInvitationStatus;
  note: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

const toInvitation = (r: Raw): InvitationRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  channelId: num(r.channel_id),
  channelUuid: str(r.channel_uuid),
  channelName: str(r.channel_name),
  requesterId: num(r.requester_user_id),
  requesterName: str(r.requester_name),
  requesterEmail: str(r.requester_email),
  inviteeUserId: num(r.invitee_user_id),
  inviteeEmail: str(r.invitee_email),
  inviteeName: str(r.invitee_name),
  inviteeActive: r.invitee_active === true,
  status: r.status as TchatInvitationStatus,
  note: str(r.note),
  decidedByName: str(r.decided_by_name),
  decidedAt: date(r.decided_at),
  createdAt: new Date(r.created_at as string),
});

const INVITATION_SELECT = sql`
  SELECT i.id, i.uuid, i.channel_id, ch.uuid AS channel_uuid, ch.name AS channel_name,
         i.requester_user_id, ru.full_name AS requester_name, ru.email AS requester_email,
         i.invitee_user_id, i.invitee_email, i.invitee_name,
         coalesce(iu.status = 'active', false) AS invitee_active,
         i.status, i.note, du.full_name AS decided_by_name, i.decided_at, i.created_at
  FROM team_chat_invitations i
  LEFT JOIN team_chat_channels ch ON ch.org_id = i.org_id AND ch.id = i.channel_id
  LEFT JOIN users ru ON ru.org_id = i.org_id AND ru.id = i.requester_user_id
  LEFT JOIN users iu ON iu.org_id = i.org_id AND iu.id = i.invitee_user_id
  LEFT JOIN users du ON du.org_id = i.org_id AND du.id = i.decided_by_user_id`;

@Injectable()
export class TeamChatRepository {
  // --- people ----------------------------------------------------------------------------------------------------------

  /** The roster: every active staff user of the workspace. Name order, then id, so the list is stable. */
  async roster(tx: Tx, orgId: number): Promise<PersonRow[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, full_name, email FROM users
      WHERE org_id = ${orgId} AND status = 'active'
      ORDER BY lower(full_name), id`);
    return rowsOf(res).map(toPerson);
  }

  async activeUserByUuid(tx: Tx, orgId: number, uuid: string): Promise<PersonRow | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, full_name, email FROM users WHERE org_id = ${orgId} AND uuid = ${uuid} AND status = 'active'`);
    const r = rowsOf(res)[0];
    return r ? toPerson(r) : null;
  }

  async userByEmail(
    tx: Tx,
    orgId: number,
    email: string,
  ): Promise<(PersonRow & { active: boolean }) | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, full_name, email, status = 'active' AS active FROM users
      WHERE org_id = ${orgId} AND email = ${email}`);
    const r = rowsOf(res)[0];
    return r ? { ...toPerson(r), active: r.active === true } : null;
  }

  async userRefs(tx: Tx, orgId: number, ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const res = await tx.execute(
      sql`SELECT id, uuid FROM users WHERE org_id = ${orgId} AND id IN (${idList(ids)})`,
    );
    return new Map(rowsOf(res).map((r) => [Number(r.id), r.uuid as string]));
  }

  // --- channels --------------------------------------------------------------------------------------------------------

  /** #general exists in every workspace; the first visit creates it and a concurrent first visit does not fail. */
  async ensureGeneral(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(sql`
      INSERT INTO team_chat_channels (org_id, name, slug, description, type)
      VALUES (${orgId}, 'general', 'general', 'Everyone in this workspace', 'public')
      ON CONFLICT (org_id, slug) DO NOTHING`);
  }

  /**
   * The channels a user sees with their unread counts, in one statement. Public channels first, then private and direct ones the
   * user belongs to, each group by id (Reference's order). A user with no read pointer on a public channel has read nothing there.
   */
  async listForUser(tx: Tx, orgId: number, userId: number): Promise<ChannelListRow[]> {
    const res = await tx.execute(sql`
      SELECT c.id, c.uuid, c.name, c.slug, c.type, c.description, c.created_by_user_id, c.last_message_at, c.row_version,
             c.created_at, peer.uuid AS peer_uuid, peer.full_name AS peer_name,
             (SELECT count(*) FROM team_chat_messages x
               WHERE x.org_id = c.org_id AND x.channel_id = c.id
                 AND x.user_id IS DISTINCT FROM ${userId}
                 AND x.id > coalesce(me.last_read_message_id, 0)) AS unread
      FROM team_chat_channels c
      LEFT JOIN team_chat_channel_members me
        ON me.org_id = c.org_id AND me.channel_id = c.id AND me.user_id = ${userId}
      LEFT JOIN LATERAL (
        SELECT u.uuid, u.full_name FROM team_chat_channel_members pm
        JOIN users u ON u.org_id = pm.org_id AND u.id = pm.user_id
        WHERE c.type = 'dm' AND pm.org_id = c.org_id AND pm.channel_id = c.id AND pm.user_id <> ${userId}
        LIMIT 1) peer ON true
      WHERE c.org_id = ${orgId} AND (c.type = 'public' OR me.id IS NOT NULL)
      ORDER BY (c.type <> 'public'), c.id`);
    return rowsOf(res).map((r) => ({
      ...toChannel(r),
      unread: Number(r.unread),
      peerUuid: str(r.peer_uuid),
      peerName: str(r.peer_name),
    }));
  }

  async channelByUuid(tx: Tx, orgId: number, uuid: string): Promise<ChannelRow | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, name, slug, type, description, created_by_user_id, last_message_at, row_version, created_at
      FROM team_chat_channels WHERE org_id = ${orgId} AND uuid = ${uuid}`);
    const r = rowsOf(res)[0];
    return r ? toChannel(r) : null;
  }

  async channelBySlug(tx: Tx, orgId: number, slug: string): Promise<ChannelRow | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, name, slug, type, description, created_by_user_id, last_message_at, row_version, created_at
      FROM team_chat_channels WHERE org_id = ${orgId} AND slug = ${slug}`);
    const r = rowsOf(res)[0];
    return r ? toChannel(r) : null;
  }

  /** The channel a user may open: null when they are not a member of a private or direct channel. */
  async memberRole(
    tx: Tx,
    orgId: number,
    channelId: number,
    userId: number,
  ): Promise<'admin' | 'member' | null> {
    const res = await tx.execute(sql`
      SELECT role FROM team_chat_channel_members
      WHERE org_id = ${orgId} AND channel_id = ${channelId} AND user_id = ${userId}`);
    const r = rowsOf(res)[0];
    return r ? (r.role as 'admin' | 'member') : null;
  }

  /** Null when the slug is taken (the unique index decides, so two creators cannot both win). */
  async insertChannel(
    tx: Tx,
    orgId: number,
    input: {
      name: string;
      slug: string;
      description: string | null;
      type: TchatChannelType;
      createdBy: number;
    },
  ): Promise<ChannelRow | null> {
    const res = await tx.execute(sql`
      INSERT INTO team_chat_channels (org_id, name, slug, description, type, created_by_user_id)
      VALUES (${orgId}, ${input.name}, ${input.slug}, ${input.description}, ${input.type}, ${input.createdBy})
      ON CONFLICT (org_id, slug) DO NOTHING
      RETURNING id, uuid, name, slug, type, description, created_by_user_id, last_message_at, row_version, created_at`);
    const r = rowsOf(res)[0];
    return r ? toChannel(r) : null;
  }

  async deleteChannel(tx: Tx, orgId: number, channelId: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM team_chat_channels WHERE org_id = ${orgId} AND id = ${channelId}`,
    );
  }

  async addMember(
    tx: Tx,
    orgId: number,
    channelId: number,
    userId: number,
    role: 'admin' | 'member',
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      INSERT INTO team_chat_channel_members (org_id, channel_id, user_id, role, joined_at)
      VALUES (${orgId}, ${channelId}, ${userId}, ${role}, now())
      ON CONFLICT (org_id, channel_id, user_id) DO NOTHING RETURNING id`);
    return rowsOf(res).length > 0;
  }

  async removeMember(tx: Tx, orgId: number, channelId: number, userId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      DELETE FROM team_chat_channel_members
      WHERE org_id = ${orgId} AND channel_id = ${channelId} AND user_id = ${userId} RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** The people with a membership row (private and direct channels); active users only. */
  async channelMembers(
    tx: Tx,
    orgId: number,
    channelId: number,
  ): Promise<Array<PersonRow & { role: 'admin' | 'member' }>> {
    const res = await tx.execute(sql`
      SELECT u.id, u.uuid, u.full_name, u.email, m.role
      FROM team_chat_channel_members m
      JOIN users u ON u.org_id = m.org_id AND u.id = m.user_id
      WHERE m.org_id = ${orgId} AND m.channel_id = ${channelId} AND u.status = 'active'
      ORDER BY lower(u.full_name), u.id`);
    return rowsOf(res).map((r) => ({ ...toPerson(r), role: r.role as 'admin' | 'member' }));
  }

  /** The direct-message channel of a pair, created on first use; the unique slug makes two simultaneous opens one channel. */
  async upsertDirect(
    tx: Tx,
    orgId: number,
    slug: string,
    userA: number,
    userB: number,
  ): Promise<{ channel: ChannelRow; created: boolean }> {
    const res = await tx.execute(sql`
      INSERT INTO team_chat_channels (org_id, name, slug, type, created_by_user_id)
      VALUES (${orgId}, 'direct message', ${slug}, 'dm', ${userA})
      ON CONFLICT (org_id, slug) DO NOTHING
      RETURNING id, uuid, name, slug, type, description, created_by_user_id, last_message_at, row_version, created_at`);
    const inserted = rowsOf(res)[0];
    const channel = inserted ? toChannel(inserted) : (await this.channelBySlug(tx, orgId, slug))!;
    // Both members are written either way: a half-written pair heals on the next open.
    await this.addMember(tx, orgId, channel.id, userA, 'member');
    await this.addMember(tx, orgId, channel.id, userB, 'member');
    return { channel, created: Boolean(inserted) };
  }

  // --- messages --------------------------------------------------------------------------------------------------------

  async insertMessage(
    tx: Tx,
    orgId: number,
    input: {
      channelId: number;
      userId: number;
      body: string | null;
      mentionIds: number[];
      replyToId: number | null;
      attachmentPath: string | null;
      attachmentMime: string | null;
      attachmentName: string | null;
    },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO team_chat_messages
        (org_id, channel_id, user_id, body, mentions, reply_to_id, attachment_path, attachment_mime, attachment_name)
      VALUES (${orgId}, ${input.channelId}, ${input.userId}, ${input.body},
              ${input.mentionIds.length ? JSON.stringify(input.mentionIds) : null}::jsonb,
              ${input.replyToId}, ${input.attachmentPath}, ${input.attachmentMime}, ${input.attachmentName})
      RETURNING id, uuid`);
    const r = rowsOf(res)[0]!;
    return { id: Number(r.id), uuid: r.uuid as string };
  }

  async insertAttachmentBlob(
    tx: Tx,
    orgId: number,
    messageId: number,
    bytes: Buffer,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO team_chat_attachment_blobs (org_id, message_id, bytes, byte_size)
      VALUES (${orgId}, ${messageId}, ${bytes}, ${bytes.length})`);
  }

  async attachmentBytes(tx: Tx, orgId: number, messageId: number): Promise<Buffer | null> {
    const res = await tx.execute(sql`
      SELECT bytes FROM team_chat_attachment_blobs WHERE org_id = ${orgId} AND message_id = ${messageId}`);
    const r = rowsOf(res)[0];
    return r ? (r.bytes as Buffer) : null;
  }

  async messageByUuid(tx: Tx, orgId: number, uuid: string): Promise<MessageRow | null> {
    const res = await tx.execute(
      sql`${MESSAGE_SELECT} WHERE m.org_id = ${orgId} AND m.uuid = ${uuid}`,
    );
    const r = rowsOf(res)[0];
    return r ? toMessage(r) : null;
  }

  async messageById(tx: Tx, orgId: number, id: number): Promise<MessageRow | null> {
    const res = await tx.execute(sql`${MESSAGE_SELECT} WHERE m.org_id = ${orgId} AND m.id = ${id}`);
    const r = rowsOf(res)[0];
    return r ? toMessage(r) : null;
  }

  /** Newest first: `limit + 1` rows older than `before`. The caller reverses the page for display. */
  async historyBefore(
    tx: Tx,
    orgId: number,
    channelId: number,
    before: number | null,
    limit: number,
  ): Promise<MessageRow[]> {
    const bound = before === null ? sql`` : sql`AND m.id < ${before}`;
    const res = await tx.execute(sql`
      ${MESSAGE_SELECT}
      WHERE m.org_id = ${orgId} AND m.channel_id = ${channelId} ${bound}
      ORDER BY m.id DESC LIMIT ${limit + 1}`);
    return rowsOf(res).map(toMessage);
  }

  /** Oldest first: `limit + 1` rows newer than `after`, so a burst larger than a page is read in order, never skipped. */
  async historyAfter(
    tx: Tx,
    orgId: number,
    channelId: number,
    after: number,
    limit: number,
  ): Promise<MessageRow[]> {
    const res = await tx.execute(sql`
      ${MESSAGE_SELECT}
      WHERE m.org_id = ${orgId} AND m.channel_id = ${channelId} AND m.id > ${after}
      ORDER BY m.id ASC LIMIT ${limit + 1}`);
    return rowsOf(res).map(toMessage);
  }

  async searchMessages(
    tx: Tx,
    orgId: number,
    channelId: number,
    likePattern: string,
    limit: number,
  ): Promise<MessageRow[]> {
    const res = await tx.execute(sql`
      ${MESSAGE_SELECT}
      WHERE m.org_id = ${orgId} AND m.channel_id = ${channelId} AND m.body ILIKE ${likePattern} ESCAPE '\\'
      ORDER BY m.id DESC LIMIT ${limit}`);
    return rowsOf(res).map(toMessage);
  }

  async pinnedMessages(tx: Tx, orgId: number, channelId: number): Promise<MessageRow[]> {
    const res = await tx.execute(sql`
      ${MESSAGE_SELECT}
      WHERE m.org_id = ${orgId} AND m.channel_id = ${channelId} AND m.pinned_at IS NOT NULL
      ORDER BY m.pinned_at DESC, m.id DESC LIMIT 100`);
    return rowsOf(res).map(toMessage);
  }

  /** The reaction counts of a set of messages, with whether `me` is one of the reactors. */
  async reactionsFor(
    tx: Tx,
    orgId: number,
    messageIds: number[],
    me: number,
  ): Promise<Map<number, Array<{ emoji: string; count: number; mine: boolean }>>> {
    const out = new Map<number, Array<{ emoji: string; count: number; mine: boolean }>>();
    if (messageIds.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT message_id, emoji, count(*)::int AS n, bool_or(user_id = ${me}) AS mine, min(id) AS first_id
      FROM team_chat_reactions
      WHERE org_id = ${orgId} AND message_id IN (${idList(messageIds)})
      GROUP BY message_id, emoji ORDER BY message_id, first_id`);
    for (const r of rowsOf(res)) {
      const list = out.get(Number(r.message_id)) ?? [];
      list.push({ emoji: r.emoji as string, count: Number(r.n), mine: r.mine === true });
      out.set(Number(r.message_id), list);
    }
    return out;
  }

  /** Adds the reaction, or removes it when it is already there (toggle). Returns whether it is now present. */
  async toggleReaction(
    tx: Tx,
    orgId: number,
    messageId: number,
    userId: number,
    emoji: string,
  ): Promise<boolean> {
    const added = await tx.execute(sql`
      INSERT INTO team_chat_reactions (org_id, message_id, user_id, emoji)
      VALUES (${orgId}, ${messageId}, ${userId}, ${emoji})
      ON CONFLICT (org_id, message_id, user_id, emoji) DO NOTHING RETURNING id`);
    if (rowsOf(added).length > 0) return true;
    await tx.execute(sql`
      DELETE FROM team_chat_reactions
      WHERE org_id = ${orgId} AND message_id = ${messageId} AND user_id = ${userId} AND emoji = ${emoji}`);
    return false;
  }

  /** Optimistic update of the text; null when the version moved. */
  async updateBody(
    tx: Tx,
    orgId: number,
    id: number,
    body: string,
    mentionIds: number[],
    expectedVersion: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE team_chat_messages
      SET body = ${body}, mentions = ${mentionIds.length ? JSON.stringify(mentionIds) : null}::jsonb, edited_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion} RETURNING id`);
    return rowsOf(res).length > 0;
  }

  async setPinned(tx: Tx, orgId: number, id: number, pinnedBy: number | null): Promise<void> {
    await tx.execute(sql`
      UPDATE team_chat_messages
      SET pinned_at = ${pinnedBy === null ? null : sql`now()`}, pinned_by_user_id = ${pinnedBy}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async deleteMessage(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM team_chat_messages WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async touchChannel(tx: Tx, orgId: number, channelId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE team_chat_channels SET last_message_at = now() WHERE org_id = ${orgId} AND id = ${channelId}`);
  }

  /**
   * Moves a user's read pointer forward, never back (Reference wrote whatever it was given, so a late poll could un-read a channel).
   * The first call also creates the membership row of a public channel; `joined_at` is set once, not on every read.
   */
  async advanceRead(
    tx: Tx,
    orgId: number,
    channelId: number,
    userId: number,
    messageId: number,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO team_chat_channel_members
        (org_id, channel_id, user_id, role, last_read_message_id, last_read_at, joined_at)
      VALUES (${orgId}, ${channelId}, ${userId}, 'member', ${messageId}, now(), now())
      ON CONFLICT (org_id, channel_id, user_id) DO UPDATE
        SET last_read_message_id = GREATEST(team_chat_channel_members.last_read_message_id, EXCLUDED.last_read_message_id),
            last_read_at = now()`);
  }

  async newestMessageId(tx: Tx, orgId: number, channelId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT coalesce(max(id), 0) AS id FROM team_chat_messages WHERE org_id = ${orgId} AND channel_id = ${channelId}`);
    return Number(rowsOf(res)[0]!.id);
  }

  // --- invitations -----------------------------------------------------------------------------------------------------

  async insertInvitation(
    tx: Tx,
    orgId: number,
    input: {
      channelId: number | null;
      requesterId: number;
      inviteeUserId: number | null;
      inviteeEmail: string;
      inviteeName: string | null;
      note: string | null;
      status: 'pending' | 'approved';
      decidedBy: number | null;
    },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO team_chat_invitations
        (org_id, channel_id, requester_user_id, invitee_user_id, invitee_email, invitee_name, note, status, decided_by_user_id, decided_at)
      VALUES (${orgId}, ${input.channelId}, ${input.requesterId}, ${input.inviteeUserId}, ${input.inviteeEmail},
              ${input.inviteeName}, ${input.note}, ${input.status}, ${input.decidedBy},
              ${input.decidedBy === null ? null : sql`now()`})
      RETURNING id, uuid`);
    const r = rowsOf(res)[0]!;
    return { id: Number(r.id), uuid: r.uuid as string };
  }

  async invitationByUuid(tx: Tx, orgId: number, uuid: string): Promise<InvitationRow | null> {
    const res = await tx.execute(
      sql`${INVITATION_SELECT} WHERE i.org_id = ${orgId} AND i.uuid = ${uuid}`,
    );
    const r = rowsOf(res)[0];
    return r ? toInvitation(r) : null;
  }

  async invitationById(tx: Tx, orgId: number, id: number): Promise<InvitationRow | null> {
    const res = await tx.execute(
      sql`${INVITATION_SELECT} WHERE i.org_id = ${orgId} AND i.id = ${id}`,
    );
    const r = rowsOf(res)[0];
    return r ? toInvitation(r) : null;
  }

  /** Newest first. Everyone's for a decider, else the caller's own. */
  async listInvitations(
    tx: Tx,
    orgId: number,
    requesterOnly: number | null,
    limit: number,
  ): Promise<InvitationRow[]> {
    const own = requesterOnly === null ? sql`` : sql`AND i.requester_user_id = ${requesterOnly}`;
    const res = await tx.execute(sql`
      ${INVITATION_SELECT}
      WHERE i.org_id = ${orgId} ${own}
      ORDER BY i.id DESC LIMIT ${limit}`);
    return rowsOf(res).map(toInvitation);
  }

  async countPending(tx: Tx, orgId: number, requesterOnly: number | null): Promise<number> {
    const own = requesterOnly === null ? sql`` : sql`AND requester_user_id = ${requesterOnly}`;
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM team_chat_invitations
      WHERE org_id = ${orgId} AND status = 'pending' ${own}`);
    return Number(rowsOf(res)[0]!.n);
  }

  /** Decides a pending invitation; false when it was already decided (the status check is the lock). */
  async decideInvitation(
    tx: Tx,
    orgId: number,
    id: number,
    status: 'approved' | 'declined',
    decidedBy: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE team_chat_invitations
      SET status = ${status}, decided_by_user_id = ${decidedBy}, decided_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'pending' RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** The invitee's account is resolved when the decision is made, not frozen at the request (Reference froze it). */
  async linkInvitee(tx: Tx, orgId: number, id: number, userId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE team_chat_invitations SET invitee_user_id = ${userId} WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
