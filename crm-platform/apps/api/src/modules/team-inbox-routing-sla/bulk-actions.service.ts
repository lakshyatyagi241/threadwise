import { Injectable, Logger } from '@nestjs/common';
import {
  type BulkConversationAction,
  type BulkConversationsInput,
  type BulkConversationsResponse,
  type BulkItemResult,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import {
  ConversationsRepository,
  INBOX_PERMISSION as PERM,
  InboxAccess,
  InboxConversationsService,
  InboxLabelsService,
  InboxTriageService,
} from '../team-inbox-conversations';
import { AssignmentService } from './assignment.service';

/** The permissions a bulk action needs besides `inbox.conversation.bulk`; any one of a list is enough. */
const UNDERLYING: Record<BulkConversationAction['type'], readonly string[]> = {
  status: [PERM.resolve],
  assign: [PERM.assign, PERM.assignSelf],
  mark_read: [PERM.read],
  priority: [PERM.priority],
  snooze: [PERM.snooze],
  label: [PERM.tag],
};

/**
 * Bulk actions on the conversation list (`inbox.conversation.bulk`, BL-036 phase 3).
 *
 * A bulk request is a loop over the single-conversation operations, never a second implementation of them, so every rule of the single
 * route holds for each conversation: visibility (a conversation the caller cannot see is `CONVERSATION_NOT_FOUND`, the same answer as
 * one that does not exist), the underlying permission's own scope (403 per conversation), the status state machine, the timeline
 * event, the audit row, the outbox event and the realtime signal. The caller needs `inbox.conversation.bulk` AND the underlying
 * permission (checked up front: without it the request is 403 and nothing runs).
 *
 * Each conversation is its own transaction, so one failure never rolls back the others; the answer lists every conversation's outcome
 * (`done`, `unchanged`, or `failed` with the problem code) and the counts. Running the same request again is safe: what is already
 * done answers `unchanged`. The request is bounded (200 conversations), so it runs inside the HTTP call; the whole request is one
 * `Idempotency-Key`, and it leaves one audit row with the counts.
 */
@Injectable()
export class BulkActionsService {
  private readonly logger = new Logger(BulkActionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConversationsRepository,
    private readonly access: InboxAccess,
    private readonly audit: AuditService,
    private readonly conversations: InboxConversationsService,
    private readonly triage: InboxTriageService,
    private readonly labels: InboxLabelsService,
    private readonly assignment: AssignmentService,
  ) {}

  async run(input: BulkConversationsInput): Promise<BulkConversationsResponse> {
    const ctx = RequestContextStore.require();
    const needed = UNDERLYING[input.action.type];
    if (!needed.some((key) => this.access.scopeOf(ctx, key) !== null)) {
      throw AppError.forbidden(needed[0]!);
    }

    const probe = await this.db.tx((tx) => this.repo.bulkProbe(tx, ctx.orgId, input.ids));
    const results: BulkItemResult[] = [];
    for (const id of input.ids) {
      const known = probe.get(id);
      if (!known) {
        results.push({ id, outcome: 'failed', code: 'CONVERSATION_NOT_FOUND' });
        continue;
      }
      try {
        results.push({ id, outcome: await this.apply(input.action, id, known) });
      } catch (err) {
        if (!(err instanceof AppError)) {
          this.logger.error({ err, id }, 'bulk action failed on a conversation');
        }
        results.push({
          id,
          outcome: 'failed',
          code: err instanceof AppError ? String(err.code) : 'INTERNAL_ERROR',
        });
      }
    }

    const count = (outcome: BulkItemResult['outcome']) =>
      results.filter((r) => r.outcome === outcome).length;
    const response: BulkConversationsResponse = {
      requested: input.ids.length,
      done: count('done'),
      unchanged: count('unchanged'),
      failed: count('failed'),
      results,
    };
    await this.db.tx((tx) =>
      this.audit.record(tx, {
        module: 'conversations.bulk',
        recordId: 0,
        action: 'update',
        delta: {
          bulk: {
            old: null,
            new: {
              action: input.action.type,
              requested: response.requested,
              done: response.done,
              unchanged: response.unchanged,
              failed: response.failed,
            },
          },
        },
      }),
    );
    return response;
  }

  private async apply(
    action: BulkConversationAction,
    id: string,
    known: { rowVersion: number; msgSeq: number; unreadCount: number },
  ): Promise<'done' | 'unchanged'> {
    const { rowVersion } = known;
    switch (action.type) {
      case 'status': {
        const after = await this.conversations.setStatus(id, { status: action.status, rowVersion });
        return after.rowVersion === rowVersion ? 'unchanged' : 'done';
      }
      case 'assign': {
        const after = await this.assignment.assign(id, {
          rowVersion,
          strategy: 'manual',
          ...(action.userId !== undefined ? { userId: action.userId } : {}),
          ...(action.teamId !== undefined ? { teamId: action.teamId } : {}),
        });
        return after.rowVersion === rowVersion ? 'unchanged' : 'done';
      }
      case 'priority': {
        const after = await this.triage.setPriority(id, { priority: action.priority, rowVersion });
        return after.rowVersion === rowVersion ? 'unchanged' : 'done';
      }
      case 'snooze': {
        const after = await this.triage.snooze(id, { until: action.until, rowVersion });
        return after.rowVersion === rowVersion ? 'unchanged' : 'done';
      }
      case 'label': {
        const after =
          action.mode === 'add'
            ? await this.labels.apply(id, { tagId: action.tagId })
            : await this.labels.withdraw(id, action.tagId);
        return after.rowVersion === rowVersion ? 'unchanged' : 'done';
      }
      case 'mark_read': {
        const { unreadCount } = await this.conversations.markRead(id, { upToSeq: known.msgSeq });
        return unreadCount === known.unreadCount ? 'unchanged' : 'done';
      }
    }
  }
}
