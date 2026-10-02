import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import type { ConversationRecord } from './conversation-visibility';

/** How the gateway learns who a conversation is assigned to when a socket asks to open its room. */
export const CONVERSATION_RECORD_LOADER = Symbol('CONVERSATION_RECORD_LOADER');

export interface ConversationRecordLoader {
  /** The record by uuid inside the caller's workspace, or null when there is none (the caller cannot tell it from a refusal). */
  load(orgId: number, userId: number, conversationUuid: string): Promise<ConversationRecord | null>;
}

/**
 * Reads the two columns visibility depends on straight from `conversations`, under the caller's tenant (row-level security
 * applies). It is a plain read because the realtime layer must not depend on the chat module that owns the table; a domain that
 * needs a richer rule binds its own loader to `CONVERSATION_RECORD_LOADER`.
 */
@Injectable()
export class DbConversationRecordLoader implements ConversationRecordLoader {
  constructor(private readonly db: DatabaseService) {}

  async load(
    orgId: number,
    userId: number,
    conversationUuid: string,
  ): Promise<ConversationRecord | null> {
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT assignee_user_id, assignee_team_id
        FROM conversations
        WHERE org_id = ${orgId} AND uuid = ${conversationUuid}::uuid
      `),
    );
    const row = res.rows[0] as
      | { assignee_user_id: string | number | null; assignee_team_id: string | number | null }
      | undefined;
    if (!row) return null;
    return {
      assigneeUserId: row.assignee_user_id === null ? null : Number(row.assignee_user_id),
      assigneeTeamId: row.assignee_team_id === null ? null : Number(row.assignee_team_id),
    };
  }
}
