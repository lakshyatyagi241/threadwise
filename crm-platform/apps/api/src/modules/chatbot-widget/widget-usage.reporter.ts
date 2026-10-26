import { Injectable, Logger } from '@nestjs/common';
import { isWalletEmpty } from '../../common/errors/wallet-empty';
import { stableUsageId } from '../../common/stable-usage-id';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { emitUsageReported } from '../../kernel/outbox/usage-report';
import { UsageBillingService } from '../wallet-message-billing';

/** The widget a message came in on, as the wallet needs it: the aggregate its event is ordered by and the name the expense log shows. */
export interface WidgetUsageRef {
  id: number;
  name: string | null;
}

/**
 * The website chatbot's own message fee (usage kind `webbot_message`): one visitor message the bot handles is one unit. The plan includes a
 * number of them free each month (`plans.limits.webbot_messages`); the wallet pays for the ones beyond it. The AI behind an assistant's reply
 * is a separate charge (`AiChargeService`), so an AI widget pays both: the message fee and the model's cost plus the markup.
 */
@Injectable()
export class WidgetUsageReporter {
  private readonly logger = new Logger(WidgetUsageReporter.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly usage: UsageBillingService,
  ) {}

  /**
   * Whether the bot may answer one more message: the plan's allowance still covers it, or the wallet can pay for it. A false answer means
   * the bot stays quiet for this message (the visitor gets the assistant's fallback line). Any other fault lets the message through:
   * billing trouble never silences a customer's chat.
   */
  async canAnswer(orgId: number): Promise<boolean> {
    try {
      await this.usage.assertCanAfford(orgId, 'webbot_message', 1);
      return true;
    } catch (err) {
      return !isWalletEmpty(err);
    }
  }

  /**
   * Reports one message the bot handled, in its own transaction, named by the visitor's stored line (`messageId`) so a retry bills it once.
   * Never throws: the visitor already has their answer, and a billing fault must not take it away.
   */
  async reportMessage(
    orgId: number,
    widget: WidgetUsageRef,
    messageId: string | number,
  ): Promise<void> {
    try {
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        emitUsageReported(this.outbox, tx, {
          orgId,
          aggregateModule: 'chatbot_widget',
          aggregateId: widget.id,
          report: {
            kind: 'webbot_message',
            usageId: stableUsageId('widget', messageId),
            units: 1,
            label: 'Website chatbot message',
            source: 'widget',
            subjectName: widget.name,
          },
        }),
      );
    } catch (err) {
      this.logger.warn(
        { orgId, widget: widget.id, err: String(err) },
        '[WGT] message could not be billed',
      );
    }
  }
}
