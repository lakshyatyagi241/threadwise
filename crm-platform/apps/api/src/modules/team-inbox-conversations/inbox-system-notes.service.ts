import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ConversationEventsRepository } from './conversation-events.repository';
import { ConversationsRepository } from './conversations.repository';
import { InboxRealtimePublisher } from './inbox-realtime.publisher';

/**
 * An internal note on a conversation written by the system (no author): the AI's handover summary. It is shown like any note, appears
 * in the timeline as added by the system, and tells the people looking at the thread. Idempotent per `key`: the same key writes once.
 */
@Injectable()
export class InboxSystemNotes {
  constructor(
    private readonly db: DatabaseService,
    private readonly conversations: ConversationsRepository,
    private readonly events: ConversationEventsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly publisher: InboxRealtimePublisher,
  ) {}

  /** Returns false when the conversation is gone or the key was already written. */
  async create(
    orgId: number,
    conversationUuid: string,
    body: string,
    key: string,
  ): Promise<boolean> {
    const text = body.trim().slice(0, 4000);
    if (text === '') return false;
    const done = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const locked = await this.conversations.lockByUuid(tx, orgId, conversationUuid);
      if (!locked) return null;
      // One note per key: the key travels in the event payload of the note it wrote.
      const seen = await tx.execute(sql`
        SELECT 1 FROM conversation_events
         WHERE org_id = ${orgId} AND conversation_id = ${locked.id} AND type = 'note_added' AND payload ->> 'systemKey' = ${key}
         LIMIT 1`);
      if (seen.rows.length > 0) return null;
      const res = await tx.execute(sql`
        INSERT INTO conversation_notes (org_id, conversation_id, user_id, body, mentions)
        VALUES (${orgId}, ${locked.id}, NULL, ${text}, '[]'::jsonb) RETURNING id`);
      const noteId = Number((res.rows[0] as { id: number | string }).id);
      await this.events.append(tx, orgId, {
        conversationId: locked.id,
        type: 'note_added',
        actorKind: 'system',
        payload: { noteId, systemKey: key },
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'conversations',
        aggregateId: locked.id,
        eventType: 'conversation.note_added',
        payload: { conversationId: conversationUuid, noteId, authorId: null, mentions: [] },
      });
      await this.audit.record(tx, {
        module: 'conversation_notes',
        recordId: noteId,
        action: 'insert',
      });
      return locked;
    });
    if (!done) return false;
    await this.publisher.conversationChanged(
      orgId,
      {
        uuid: conversationUuid,
        rowVersion: done.rowVersion,
        assigneeUserId: done.assigneeUserId,
        assigneeTeamId: done.assigneeTeamId,
        channelOwnerUserId: done.channelOwnerUserId,
      },
      ['notes'],
    );
    return true;
  }
}
