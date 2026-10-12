import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ConversationNote,
  type CreateConversationNoteInput,
  type ListConversationNotesQuery,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ConversationEventsRepository } from './conversation-events.repository';
import { ConversationsRepository } from './conversations.repository';
import { InboxAccess, PERM, conversationNotFound } from './inbox-access.service';
import { InboxRealtimePublisher } from './inbox-realtime.publisher';
import { NotesRepository } from './notes.repository';

const MODULE_KEY = 'conversations';

/**
 * Internal notes (TW-TIB1-038): staff-only text on a conversation. A note is not a message: it has no channel, never reaches the
 * customer, and is not part of the thread's sequence.
 *
 * Fixes Reference's gaps, recorded as `intended` in the parity file: a mention must name an active member of this workspace (Reference
 * accepted any integer and notified users of other workspaces), mentions are structured ids rather than parsed from text, and a note
 * is deleted by its author or by someone who may assign conversations (Reference: any agent could delete anyone's note).
 */
@Injectable()
export class InboxNotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConversationsRepository,
    private readonly notes: NotesRepository,
    private readonly events: ConversationEventsRepository,
    private readonly access: InboxAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly publisher: InboxRealtimePublisher,
  ) {}

  async list(uuid: string, query: ListConversationNotesQuery) {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      const record = await this.repo.recordByUuid(tx, ctx.orgId, uuid);
      if (!record) throw conversationNotFound();
      this.access.assertVisible(viewer, record);
      return this.notes.list(tx, ctx.orgId, { id: record.id, uuid }, query);
    });
  }

  async create(uuid: string, input: CreateConversationNoteInput): Promise<ConversationNote> {
    const ctx = RequestContextStore.require();
    const result = await this.db.tx(async (tx) => {
      const locked = await this.repo.lockByUuid(tx, ctx.orgId, uuid);
      if (!locked) throw conversationNotFound();
      const viewer = await this.access.viewer(tx, ctx);
      this.access.assertVisible(viewer, locked);
      await this.access.assertCan(tx, ctx, PERM.note, locked);

      // Mentions are checked against the workspace's members (Reference did not), in the order given, without repeats and without the author.
      const authorUuid = await this.repo.userUuid(tx, ctx.orgId, ctx.userId!);
      const wanted = [...new Set(input.mentions)].filter((m) => m !== authorUuid);
      const known = await this.notes.activeUsers(tx, ctx.orgId, wanted);
      const unknown = wanted.filter((m) => !known.has(m));
      if (unknown.length > 0) {
        throw AppError.validation(
          'A mentioned person is not an active member of this workspace',
          unknown.map((m) => ({ path: 'mentions', message: `${m} is not a member` })),
        );
      }

      const { note, id } = await this.notes.insert(
        tx,
        ctx.orgId,
        { id: locked.id, uuid },
        ctx.userId!,
        input.body,
        wanted,
      );
      await this.events.append(tx, ctx.orgId, {
        conversationId: locked.id,
        type: 'note_added',
        actorUserId: ctx.userId,
        payload: { noteId: note.id },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: locked.id,
        eventType: 'conversation.note_added',
        // The text stays out of the event: a consumer that needs it reads the note, under its own access check.
        payload: { conversationId: uuid, noteId: note.id, authorId: authorUuid, mentions: wanted },
      });
      await this.audit.record(tx, {
        module: 'conversation_notes',
        recordId: id,
        action: 'insert',
      });
      return { note, locked };
    });

    await this.publisher.conversationChanged(
      ctx.orgId,
      {
        uuid,
        rowVersion: result.locked.rowVersion,
        assigneeUserId: result.locked.assigneeUserId,
        assigneeTeamId: result.locked.assigneeTeamId,
        channelOwnerUserId: result.locked.channelOwnerUserId,
      },
      ['notes'],
      { excludeUserIds: [ctx.userId!] },
    );
    return result.note;
  }

  async remove(uuid: string, noteUuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const locked = await this.repo.lockByUuid(tx, ctx.orgId, uuid);
      if (!locked) throw conversationNotFound();
      const viewer = await this.access.viewer(tx, ctx);
      this.access.assertVisible(viewer, locked);
      await this.access.assertCan(tx, ctx, PERM.note, locked);

      const note = await this.notes.find(tx, ctx.orgId, locked.id, noteUuid);
      if (!note) {
        throw new AppError(
          ERROR_CODES.CONVERSATION_NOTE_NOT_FOUND,
          'Note not found',
          HttpStatus.NOT_FOUND,
        );
      }
      const isAuthor = note.userId !== null && note.userId === ctx.userId;
      if (!isAuthor && this.access.scopeOf(ctx, PERM.assign) === null) {
        throw new AppError(
          ERROR_CODES.INBOX_NOTE_NOT_DELETABLE,
          'Only the author of a note, or someone who manages assignments, can delete it',
          HttpStatus.FORBIDDEN,
        );
      }
      await this.notes.delete(tx, ctx.orgId, note.id);
      await this.audit.record(tx, {
        module: 'conversation_notes',
        recordId: note.id,
        action: 'delete',
      });
    });
  }
}
