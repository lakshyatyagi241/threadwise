import { Inject, Injectable, Logger } from '@nestjs/common';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../chat-conversations';
import { GrowthRepository } from './growth.repository';

export interface StageLine {
  /** The stage suggestion this line is about (its uuid): the Undo button and the "undone" line both carry it. */
  suggestionUuid: string;
  contactId: number;
  fromLabel: string;
  toLabel: string;
  action: 'auto' | 'undone';
}

/** The English text of the line (exports, old clients); the web app words it in the reader's language from `systemEvent`. */
export function stageLineBody(l: Pick<StageLine, 'action' | 'fromLabel' | 'toLabel'>): string {
  return l.action === 'auto'
    ? `AI read the chat and moved this contact from ${l.fromLabel} to ${l.toLabel}`
    : `Stage change undone: back to ${l.toLabel}`;
}

/**
 * Tells the people in the chat that the stage moved by itself, or that someone put it back. A `system` line like the consent line:
 * it touches only the thread's preview and sequence, never the unread count, the wait clock, assignment or notifications. The stage
 * is already changed (or restored) when this runs, so a failure is logged and never undoes it.
 */
@Injectable()
export class GrowthStageLineService {
  private readonly logger = new Logger(GrowthStageLineService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GrowthRepository,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async write(orgId: number, line: StageLine): Promise<void> {
    try {
      const thread = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.threadOf(tx, orgId, line.contactId),
      );
      if (!thread) return;
      await RequestContextStore.run(
        {
          requestId: `stage-line-${line.suggestionUuid}-${line.action}`,
          orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
        },
        () =>
          this.conversations.recordOutbound({
            channelId: thread.channelUuid,
            peerKey: thread.peerKey,
            source: 'stage_change',
            kind: 'system',
            direction: 'in',
            body: stageLineBody(line),
            // The system line has no provider message: this is its idempotency key (one line per suggestion and action).
            providerMessageId: `stage:${line.suggestionUuid}:${line.action}`,
            meta: {
              event: 'stage_change',
              stageAction: line.action,
              suggestionId: line.suggestionUuid,
              fromStage: line.fromLabel.slice(0, 120),
              toStage: line.toLabel.slice(0, 120),
            },
          }),
      );
    } catch (err) {
      this.logger.warn(
        { orgId, err: err instanceof Error ? err.message : String(err) },
        'stage change line could not be written',
      );
    }
  }
}
