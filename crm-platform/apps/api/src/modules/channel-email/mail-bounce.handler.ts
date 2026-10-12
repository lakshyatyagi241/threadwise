import { Injectable } from '@nestjs/common';
import type { NormalisedMail } from '../../infra/providers/channel-email';
import type { MailboxRow } from './mailboxes.repository';

/**
 * EXTENSION POINT owned by TW-MAIL-032 (bounces). The ingest shows every incoming mail to the handler BEFORE it is stored. Phase 2
 * implements: recognise a delivery-status notification or a provider bounce (`mail.rawHeaders`, `mail.automated`, a `multipart/report`),
 * find the sent message it is about (by the Message-ID the reply was sent with), mark that message `meta.email.delivery = 'bounced'` with
 * `meta.email.bounce`, and answer `consumed` when the bounce should not appear as a customer message. `pass` stores the mail as usual.
 * The default passes everything.
 */
export type BounceOutcome = 'pass' | 'consumed';

@Injectable()
export class MailBounceHandler {
  inspect(_orgId: number, _mailbox: MailboxRow, _mail: NormalisedMail): Promise<BounceOutcome> {
    return Promise.resolve('pass');
  }
}
