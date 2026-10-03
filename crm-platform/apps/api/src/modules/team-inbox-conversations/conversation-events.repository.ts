import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  ConversationEvent,
  ConversationEventActorKind,
  ConversationEventListResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';

type Raw = Record<string, unknown>;

export interface AppendEventInput {
  /** Internal conversation id. */
  conversationId: number;
  type: string;
  actorKind?: ConversationEventActorKind;
  /** Internal id of the staff user, for `actorKind: 'user'`. */
  actorUserId?: number | null;
  /**
   * Type-specific details. Every id in it is a uuid (the timeline is read by clients that never see an internal id), so a writer
   * resolves the ids it holds before it calls.
   */
  payload?: Record<string, unknown>;
}

const US = `to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

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

/**
 * The conversation timeline (`conversation_events`, a monthly partitioned append-only stream): WaDesk's order of work is kept, the
 * state change first and its event row in the same transaction, so a timeline never shows a change that rolled back.
 */
@Injectable()
export class ConversationEventsRepository {
  /** Appends one event inside the caller's transaction. */
  async append(tx: Tx, orgId: number, input: AppendEventInput): Promise<void> {
    await tx.execute(sql`
      INSERT INTO conversation_events (org_id, conversation_id, actor_user_id, actor_type, type, payload)
      VALUES (${orgId}, ${input.conversationId}, ${input.actorUserId ?? null}, ${input.actorKind ?? 'user'},
              ${input.type}, ${JSON.stringify(input.payload ?? {})}::jsonb)`);
  }

  /** Newest first, `limit` per page, keyset on (created_at, id) at microsecond precision. */
  async list(
    tx: Tx,
    orgId: number,
    conversation: { id: number; uuid: string },
    opts: { limit: number; cursor?: string },
  ): Promise<ConversationEventListResponse> {
    const after = opts.cursor ? decode(opts.cursor) : null;
    const res = await tx.execute(sql`
      SELECT e.id, e.uuid, e.type, e.actor_type, e.payload, ${sql.raw(US)} AS created_at,
             u.uuid AS actor_uuid, u.full_name AS actor_name
      FROM conversation_events e
      LEFT JOIN users u ON u.org_id = e.org_id AND u.id = e.actor_user_id
      WHERE e.org_id = ${orgId} AND e.conversation_id = ${conversation.id}
        ${after ? sql`AND (e.created_at, e.id) < (${after.iso}::timestamptz, ${after.id})` : sql``}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${opts.limit + 1}`);
    const rows = res.rows as Raw[];
    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];
    const data: ConversationEvent[] = page.map((r) => ({
      id: r.uuid as string,
      conversationId: conversation.uuid,
      type: r.type as string,
      actor: {
        kind: r.actor_type as ConversationEventActorKind,
        userId: (r.actor_uuid as string | null) ?? null,
        name: (r.actor_name as string | null) ?? null,
      },
      payload: (r.payload as Record<string, unknown> | null) ?? {},
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
    return {
      data,
      page: {
        nextCursor: hasMore && last ? encode(last.created_at as string, Number(last.id)) : null,
        hasMore,
        limit: opts.limit,
      },
    };
  }
}
