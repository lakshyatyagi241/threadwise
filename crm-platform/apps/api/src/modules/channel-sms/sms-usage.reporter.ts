import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import type { SmsProviderKind } from '../../infra/providers/channel-sms/sms.port';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { emitUsageReported } from '../../kernel/outbox/usage-report';
import { usageAggregateOf } from './sender-rules';

/** The module name the billing events of an SMS are filed under; the aggregate id is a number made from the provider's message id. */
const AGGREGATE_MODULE = 'sms_messages';

/** The contract's longest usage id; the same cut is made on the charge and on the refund so they still name the same message. */
const idOf = (messageId: string): string => messageId.trim().slice(0, 191);

/**
 * Tells the wallet about the SMS the workspace sent: the charge when a provider accepts a message. There is no refund path: the
 * carrier's later "undelivered" arrives on a callback signed with the workspace's own secret, which cannot be trusted to give the
 * platform's fee back. The worker's billing consumer prices and settles the report (`usage.reported`); this class only reports.
 *
 * It never throws. An SMS that already left cannot be un-sent, and a failed report must not turn it into a failed
 * recipient that a retry would text a second time; a billing fault is logged with the provider's message id so it can be settled by hand.
 */
@Injectable()
export class SmsUsageReporter {
  private readonly logger = new Logger(SmsUsageReporter.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  /** One SMS the provider accepted: `segments` is the provider's own count when it gave one. */
  async used(
    orgId: number,
    o: {
      messageId: string;
      provider: SmsProviderKind;
      segments: number;
      recipient: string;
      source: string;
      subjectName: string | null;
    },
  ): Promise<void> {
    const usageId = idOf(o.messageId);
    try {
      const reported = await this.db.txAs({ orgId, userId: null }, (tx) =>
        emitUsageReported(this.outbox, tx, {
          orgId,
          aggregateModule: AGGREGATE_MODULE,
          aggregateId: usageAggregateOf(usageId),
          report: {
            kind: 'sms',
            usageId,
            status: 'used',
            units: Math.max(1, Math.trunc(o.segments)),
            recipient: o.recipient,
            source: o.source,
            provider: o.provider,
            subjectName: o.subjectName,
          },
        }),
      );
      if (!reported) {
        this.logger.error(
          { orgId, messageId: usageId },
          'sms sent but its usage report did not parse: not billed',
        );
      }
    } catch (err) {
      this.logger.error(
        { orgId, messageId: usageId, err: String(err) },
        'sms sent but its usage could not be reported: not billed',
      );
    }
  }
}
