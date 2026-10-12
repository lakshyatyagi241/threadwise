import { Injectable } from '@nestjs/common';
import type { OutboundEmail } from '../../infra/providers/chat-conversations';
import type { OutgoingMail } from '../../infra/providers/channel-email';
import type { MailboxRow } from './mailboxes.repository';

/**
 * EXTENSION POINT owned by TW-MAIL-027 (outbound attachments, signatures, rich composer). The adapter builds the plain `OutgoingMail`
 * from the envelope and hands it here before the driver sees it. Phase 2 implements: merge the signature into `text` and `html`
 * (envelope `signatureId` / `signature: false` / the sender `sentBy` -> default `user` signature -> default `mailbox` signature), and turn
 * `email.attachmentIds` into `mail.attachments` with `bytes` read from the object store (a missing or foreign id is
 * `MAIL_ATTACHMENT_NOT_FOUND`; size caps `MAIL_ATTACHMENT_MAX_BYTES` / `MAIL_ATTACHMENTS_TOTAL_MAX_BYTES`). Throw a `ChannelError` for a
 * refusal. The default does nothing, so a reply goes out exactly as typed.
 */
@Injectable()
export class MailOutboundPreparer {
  prepare(
    _ctx: { orgId: number; mailbox: MailboxRow; email: OutboundEmail },
    mail: OutgoingMail,
  ): Promise<OutgoingMail> {
    return Promise.resolve(mail);
  }

  /** Called once the provider accepted the reply: staged files that went out are marked used. Default: nothing. */
  sent(_ctx: { orgId: number; mailbox: MailboxRow; email: OutboundEmail }): Promise<void> {
    return Promise.resolve();
  }
}
