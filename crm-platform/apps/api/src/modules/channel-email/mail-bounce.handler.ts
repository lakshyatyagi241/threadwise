import { Injectable, Logger } from '@nestjs/common';
import { channelEmailEnv } from '../../config/domains/channel-email.env';
import { detectBounce, type NormalisedMail } from '../../infra/providers/channel-email';
import { EmailDeliveryService } from '../chat-conversations';
import { MailLimits } from './mail-limits';
import type { MailboxRow } from './mailboxes.repository';

/**
 * Bounce and delivery-status handling (TW-MAIL-032), for every provider: the ingest shows each incoming mail here BEFORE it is stored.
 *
 * A mail `detectBounce` recognises (an RFC 3464 report, a MAILER-DAEMON / postmaster notice with a readable failure, `X-Failed-Recipients`)
 * is ALWAYS `consumed`: it never becomes a conversation, a message, an unread count or a notification of its own, and no listener (flow,
 * routing, auto answer) ever sees it. What it says is applied to the reply it is about (`EmailDeliveryService.recordBounce`: delivery
 * state, a system line, the sender's notification, the live update). A bounce whose original cannot be found (a mail sent from outside this
 * app, a reply older than the look-back) is dropped and logged: there is no thread it belongs to.
 *
 * A HARD bounce also flags the address for `MAIL_BOUNCE_BLOCK_DAYS` (Redis, read by `MailSendGuard`) and marks the contact's email
 * identity as not verified. Redelivery is harmless (the delivery service is idempotent per message and recipient).
 */
export type BounceOutcome = 'pass' | 'consumed';

@Injectable()
export class MailBounceHandler {
  private readonly logger = new Logger(MailBounceHandler.name);

  constructor(
    private readonly delivery: EmailDeliveryService,
    private readonly limits: MailLimits,
  ) {}

  async inspect(orgId: number, mailbox: MailboxRow, mail: NormalisedMail): Promise<BounceOutcome> {
    const bounce = detectBounce(mail);
    if (!bounce) return 'pass';

    if (bounce.kind === 'hard') {
      await this.limits.flagBounced(
        orgId,
        bounce.failedRecipient,
        channelEmailEnv().MAIL_BOUNCE_BLOCK_DAYS * 86_400,
      );
    }
    if (!mailbox.channelUuid) return 'consumed';
    const result = await this.delivery.recordBounce(orgId, mailbox.channelUuid, {
      mailboxAddress: mailbox.address,
      messageIds: bounce.originalMessageIds,
      bounce: {
        kind: bounce.kind,
        reason: bounce.reason,
        failedRecipient: bounce.failedRecipient,
      },
      at: mail.sentAt,
    });
    if (result.outcome === 'unlinked') {
      this.logger.debug(
        { orgId, mailbox: mailbox.uuid, kind: bounce.kind },
        'a bounce names no mail of this mailbox: dropped',
      );
    }
    return 'consumed';
  }
}
