import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ConversationNote } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';

type Raw = Record<string, unknown>;

export interface NoteRow {
  id: number;
  uuid: string;
  userId: number | null;
  rowVersion: number;
}

const US = (c: string) => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const encode = (iso: string, id: number) =>
  Buffer.from(`${iso}|${id}`, 'utf8').toString('base64url');

function decode(raw: string): { iso: string; id: number } {
  const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const n = Number.parseInt(id ?? '', 10);
  if (!iso || Number.isNaN(Date.parse(iso)) || Number.isNaN(n)) {
    throw AppError.validation('Invalid pagination cursor');
  }
  return { iso, id: n };
}

const toNote = (r: Raw, conversationUuid: string): ConversationNote => ({
  id: r.uuid as string,
  conversationId: conversationUuid,
  author: {
    userId: (r.author_uuid as string | null) ?? null,
    name: (r.author_name as string | null) ?? null,
  },
  body: r.body as string,
  mentions: (r.mentions as string[] | null) ?? [],
  isPinned: r.is_pinned === true,
  editedAt: r.edited_at ? new Date(r.edited_at as string).toISOString() : null,
  createdAt: new Date(r.created_at as string).toISOString(),
  rowVersion: Number(r.row_version),
});

const NOTE_SELECT = sql.raw(`
  n.id, n.uuid, n.body, n.mentions, n.is_pinned, n.edited_at, ${US('n.created_at')} AS created_at,
  n.row_version, u.uuid AS author_uuid, u.full_name AS author_name`);

/** Internal notes. Never joined to a message, never sent to a channel: a note is staff-only text on a conversation. */
@Injectable()
export class NotesRepository {
  async insert(
    tx: Tx,
    orgId: number,
    conversation: { id: number; uuid: string },
    authorId: number,
    body: string,
    mentionUuids: string[],
  ): Promise<{ note: ConversationNote; id: number }> {
    const res = await tx.execute(sql`
      INSERT INTO conversation_notes (org_id, conversation_id, user_id, body, mentions)
      VALUES (${orgId}, ${conversation.id}, ${authorId}, ${body}, ${JSON.stringify(mentionUuids)}::jsonb)
      RETURNING id`);
    const id = Number((res.rows[0] as Raw).id);
    const created = await this.byId(tx, orgId, conversation.uuid, id);
    return { note: created!, id };
  }

  private async byId(
    tx: Tx,
    orgId: number,
    conversationUuid: string,
    id: number,
  ): Promise<ConversationNote | null> {
    const res = await tx.execute(sql`
      SELECT ${NOTE_SELECT} FROM conversation_notes n
      LEFT JOIN users u ON u.org_id = n.org_id AND u.id = n.user_id
      WHERE n.org_id = ${orgId} AND n.id = ${id}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toNote(r, conversationUuid) : null;
  }

  /** Newest first. */
  async list(
    tx: Tx,
    orgId: number,
    conversation: { id: number; uuid: string },
    opts: { limit: number; cursor?: string },
  ) {
    const after = opts.cursor ? decode(opts.cursor) : null;
    const res = await tx.execute(sql`
      SELECT ${NOTE_SELECT}
      FROM conversation_notes n
      LEFT JOIN users u ON u.org_id = n.org_id AND u.id = n.user_id
      WHERE n.org_id = ${orgId} AND n.conversation_id = ${conversation.id}
        ${after ? sql`AND (n.created_at, n.id) < (${after.iso}::timestamptz, ${after.id})` : sql``}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ${opts.limit + 1}`);
    const rows = res.rows as Raw[];
    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];
    return {
      data: page.map((r) => toNote(r, conversation.uuid)),
      page: {
        nextCursor: hasMore && last ? encode(last.created_at as string, Number(last.id)) : null,
        hasMore,
        limit: opts.limit,
      },
    };
  }

  /** The note on this conversation, or null (a note of another conversation or workspace is not found). */
  async find(
    tx: Tx,
    orgId: number,
    conversationId: number,
    noteUuid: string,
  ): Promise<NoteRow | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, user_id, row_version FROM conversation_notes
      WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND uuid = ${noteUuid}
      FOR UPDATE`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          id: Number(r.id),
          uuid: r.uuid as string,
          userId: r.user_id === null ? null : Number(r.user_id),
          rowVersion: Number(r.row_version),
        }
      : null;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM conversation_notes WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The workspace's active users among these uuids: the only people a note may mention. Returns uuid -> internal id. */
  async activeUsers(tx: Tx, orgId: number, uuids: string[]): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const res = await tx.execute(sql`
      SELECT uuid, id FROM users
      WHERE org_id = ${orgId} AND status = 'active'
        AND uuid IN (${sql.join(
          uuids.map((u) => sql`${u}::uuid`),
          sql`, `,
        )})`);
    return new Map((res.rows as Raw[]).map((r) => [r.uuid as string, Number(r.id)]));
  }
}
