import { Injectable } from '@nestjs/common';
import { channelEmailEnv } from '../../config/domains/channel-email.env';
import { ChannelError } from '../../infra/providers/chat-conversations/channel.port';
import { MailLimits } from './mail-limits';
import { effectiveSendLimit, waitWords } from './mail-rate-rules';
import type { MailboxRow } from './mailboxes.repository';

/**
 * Send limits and bounce protection of a reply (TW-MAIL-032). The adapter asks before each send and reports after it.
 *
 *  - Hourly cap per mailbox (`mail_mailboxes.send_limit_per_hour`, else `MAIL_SEND_LIMIT_PER_HOUR`), a sliding window in Redis. Over it:
 *    `MAIL_RATE_LIMITED`, NOT retried (the message fails with the wait in its reason and the agent presses Retry), `retryAfterMs` set.
 *    Gmail's own daily cap is not predicted here: it comes back from the driver as a refused send.
 *  - Burst per recipient: more than `MAIL_RECIPIENT_BURST_MAX` mails to one address from one mailbox inside the burst window is
 *    `MAIL_RATE_LIMITED` too, but retryable (the window is seconds, the queue's backoff honours `retryAfterMs`).
 *  - An address that hard-bounced within `MAIL_BOUNCE_BLOCK_DAYS` is refused (`MAIL_RECIPIENT_BOUNCED`): sending again only damages the
 *    mailbox's reputation. A person fixes the address (a new one is a different address).
 *
 * Redis errors fail open. `recordSent` counts only mail the provider accepted.
 */
@Injectable()
export class MailSendGuard {
  constructor(private readonly limits: MailLimits) {}

  async assertAllowed(
    orgId: number,
    mailbox: MailboxRow,
    recipients: string[] = [],
  ): Promise<void> {
    const env = channelEmailEnv();
    const bounced = await this.limits.bouncedAmong(
      orgId,
      recipients.map((r) => r.toLowerCase()),
    );
    if (bounced.length > 0) {
      throw new ChannelError(
        'MAIL_RECIPIENT_BOUNCED',
        `${bounced.join(', ')} did not accept earlier mail (the address does not exist or refuses mail). Check the address before sending again.`,
        false,
      );
    }

    const cap = effectiveSendLimit(mailbox.sendLimitPerHour, env.MAIL_SEND_LIMIT_PER_HOUR);
    const hourly = await this.limits.check(
      this.limits.hourlyKey(orgId, mailbox.uuid),
      3_600_000,
      cap,
    );
    if (!hourly.allowed) {
      throw new ChannelError(
        'MAIL_RATE_LIMITED',
        `This mailbox has reached its limit of ${cap} email${cap === 1 ? '' : 's'} per hour. Try again in about ${waitWords(hourly.retryAfterMs)}.`,
        false,
        { retryAfterMs: hourly.retryAfterMs },
      );
    }

    const windowMs = env.MAIL_RECIPIENT_BURST_WINDOW_S * 1000;
    for (const address of recipients) {
      const burst = await this.limits.check(
        this.limits.recipientKey(orgId, mailbox.uuid, address),
        windowMs,
        env.MAIL_RECIPIENT_BURST_MAX,
      );
      if (!burst.allowed) {
        throw new ChannelError(
          'MAIL_RATE_LIMITED',
          `Too many emails to ${address} in a short time. Try again in about ${waitWords(burst.retryAfterMs)}.`,
          true,
          { retryAfterMs: burst.retryAfterMs },
        );
      }
    }
  }

  async recordSent(orgId: number, mailbox: MailboxRow, recipients: string[] = []): Promise<void> {
    const env = channelEmailEnv();
    await this.limits.hit(this.limits.hourlyKey(orgId, mailbox.uuid), 3_600_000);
    for (const address of recipients) {
      await this.limits.hit(
        this.limits.recipientKey(orgId, mailbox.uuid, address),
        env.MAIL_RECIPIENT_BURST_WINDOW_S * 1000,
      );
    }
  }
}
