import { Injectable } from '@nestjs/common';
import type { MailboxRow } from './mailboxes.repository';

/**
 * EXTENSION POINT owned by TW-MAIL-032 (rate limits). The adapter asks before each send and reports after it. Phase 2 implements the
 * per-mailbox hourly cap (`mail_mailboxes.send_limit_per_hour`, else a platform default) with Redis counters (no table): `assertAllowed`
 * throws `ChannelError('MAIL_RATE_LIMITED', ..., retryable true)` over the cap; `recordSent` counts one. The default allows everything.
 */
@Injectable()
export class MailSendGuard {
  assertAllowed(_orgId: number, _mailbox: MailboxRow): Promise<void> {
    return Promise.resolve();
  }

  recordSent(_orgId: number, _mailbox: MailboxRow): Promise<void> {
    return Promise.resolve();
  }
}
