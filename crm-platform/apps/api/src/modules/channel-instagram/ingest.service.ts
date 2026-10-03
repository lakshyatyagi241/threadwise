import { Inject, Injectable, Logger } from '@nestjs/common';
import { normalize, shouldAutomate } from './ingest-rules';
import {
  INSTAGRAM_AUTOMATION,
  INSTAGRAM_INBOX_INGEST,
  type InstagramAutomation,
  type InstagramInboxIngest,
} from './_shims/tokens';

export interface IngestResult {
  /** False when the message was already stored: the push and the pull may both deliver it. */
  stored: boolean;
  conversationId: number;
  messageId: number | null;
}

/**
 * One Instagram message into the team inbox (TW-IG-008). Shared by the push and the pull so both behave the same: stored once,
 * the thread moved, a contact made for a genuine inbound, and only then the auto-reply rules.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @Inject(INSTAGRAM_INBOX_INGEST) private readonly inbox: InstagramInboxIngest,
    @Inject(INSTAGRAM_AUTOMATION) private readonly automation: InstagramAutomation,
  ) {}

  /**
   * `data` is `{account, conversation, message}` as the engine gives them. `isHistory` marks a message that is stored but must not
   * trigger an automation (the pull sets it for anything older than the automation window).
   */
  async ingest(
    orgId: number,
    data: { account?: unknown; conversation?: unknown; message?: unknown },
    isHistory = false,
  ): Promise<IngestResult> {
    const n = normalize(data, new Date(), isHistory);
    const out = await this.inbox.record(orgId, n);

    this.logger.log(
      {
        orgId,
        conversationId: out.conversationId,
        messageId: out.messageId,
        direction: n.direction,
        stored: out.stored,
        test: n.isTest,
        trace: n.traceId || undefined,
      },
      'instagram message handled',
    );

    // Only a message stored now is answered: a redelivery must never fire a second reply.
    if (out.stored && shouldAutomate(n)) {
      try {
        await this.automation.automate({
          orgId,
          conversationId: out.conversationId,
          rawJid: n.rawJid,
          igsid: n.igsid,
          accountId: n.accountId,
          text: n.text.trim(),
          trigger: n.trigger,
        });
      } catch (err) {
        // The message is stored; a failing automation is logged and never turns the delivery into an error.
        this.logger.warn(
          { err, orgId, conversationId: out.conversationId },
          'instagram automation failed',
        );
      }
    }
    return { stored: out.stored, conversationId: out.conversationId, messageId: out.messageId };
  }
}
