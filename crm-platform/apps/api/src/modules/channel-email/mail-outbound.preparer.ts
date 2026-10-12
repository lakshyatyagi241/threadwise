import { Injectable, Logger } from '@nestjs/common';
import { emailMetaSchema } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  fillSignatureVariables,
  mergeSignature,
  outboundText,
  sanitizeEmailHtml,
  sanitizeOutboundHtml,
  type OutgoingMail,
} from '../../infra/providers/channel-email';
import { ChannelError, type OutboundEmail } from '../../infra/providers/chat-conversations';
import { attachmentIdOfKey } from './mail-ingest.service';
import { MailOutboundAttachments } from './mail-outbound-attachments.service';
import { MailSignaturesRepository } from './mail-signatures.repository';
import type { MailboxRow } from './mailboxes.repository';

export interface PrepareContext {
  orgId: number;
  mailbox: MailboxRow;
  email: OutboundEmail;
}

/** An `AppError` raised while preparing is a refusal the agent can act on: it ends the send (no retry) with our wording. */
const refusal = (err: AppError): ChannelError => new ChannelError(err.code, err.message, false);

/**
 * Between the adapter's plain `OutgoingMail` and the driver (TW-MAIL-027): the composer's rich text is sanitised, the signature merged,
 * the staged files read into the mail. Everything a driver then sends is final: `text`, `html` and `attachments[].bytes`.
 *
 * Signature: `signature: false` none; else the one the composer named (`signatureId`: the mailbox's own or the sender's own, otherwise
 * `MAIL_SIGNATURE_NOT_FOUND`); else the sender's default `user` signature; else the mailbox's default; else none. `{{name}}`, `{{title}}`
 * and `{{phone}}` come from the sending user (empty for a bot).
 */
@Injectable()
export class MailOutboundPreparer {
  private readonly logger = new Logger(MailOutboundPreparer.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly signatures: MailSignaturesRepository,
    private readonly files: MailOutboundAttachments,
  ) {}

  async prepare(ctx: PrepareContext, mail: OutgoingMail): Promise<OutgoingMail> {
    const { orgId, mailbox, email } = ctx;
    const userId = email.sentBy ?? null;

    // 1. The rich body: sanitised, its text derived (the composer's plain text is the fallback).
    let text = mail.text;
    let html: string | null = mail.html;
    if (email.bodyHtml !== undefined && email.bodyHtml.trim() !== '') {
      const clean = sanitizeOutboundHtml(email.bodyHtml);
      html = clean;
      text = outboundText(clean) || mail.text;
    }

    // 2. The signature.
    if (email.signature !== false) {
      const sig = await this.db.txAs(userId ? { orgId, userId } : { orgId }, async (tx) => {
        const found = await this.signatures.forSend(tx, orgId, {
          named: email.signatureId ?? null,
          userId,
          mailboxId: mailbox.id,
        });
        if (found === null || found === 'missing') return found;
        const vars = userId
          ? await this.signatures.senderFacts(tx, orgId, userId)
          : { name: '', title: '', phone: '' };
        return { found, vars };
      });
      if (sig === 'missing') {
        throw new ChannelError(
          'MAIL_SIGNATURE_NOT_FOUND',
          'The chosen signature no longer exists.',
          false,
        );
      }
      if (sig) {
        const bodyHtml = fillSignatureVariables(sig.found.bodyHtml, sig.vars, 'html');
        const bodyText = fillSignatureVariables(
          sig.found.bodyText !== '' ? sig.found.bodyText : outboundText(sig.found.bodyHtml),
          sig.vars,
          'text',
        );
        const merged = mergeSignature({ text, html }, { text: bodyText, html: bodyHtml });
        text = merged.text;
        html = merged.html;
      }
    }

    // 3. The files.
    let attachments = mail.attachments;
    if (email.attachmentIds?.length) {
      try {
        const files = await this.files.resolveForSend(
          orgId,
          userId,
          email.attachmentIds,
          mail.attempt,
        );
        attachments = [
          ...attachments,
          ...files.map((f) => ({
            name: f.name,
            mime: f.mime,
            bytes: f.bytes,
            objectKey: f.objectKey,
          })),
        ];
      } catch (err) {
        if (err instanceof AppError) throw refusal(err);
        throw err;
      }
    }

    return { ...mail, text, html, attachments };
  }

  /**
   * The provider accepted the reply. Spends the staged files and answers the `meta.email` block of what really went out (recipients, the
   * final HTML, the files as the thread's download route knows them), which the dispatcher records on the sent message. Never throws:
   * the mail is gone, so a bookkeeping failure must not fail or repeat the send.
   */
  async sent(
    ctx: PrepareContext,
    mail: OutgoingMail,
    result: { providerMessageId: string; threadKey: string | null },
  ): Promise<Record<string, unknown> | undefined> {
    try {
      await this.files.markUsed(ctx.orgId, ctx.email.sentBy ?? null, ctx.email.attachmentIds ?? []);
    } catch (err) {
      this.logger.warn(
        { orgId: ctx.orgId, err: (err as Error).message },
        'staged files not marked as sent',
      );
    }
    try {
      const shown = mail.html
        ? sanitizeEmailHtml(mail.html, { blockRemoteImages: false, inputMaxChars: 1_000_000 })
        : null;
      const addr = (a: string | { name: string | null; address: string }) =>
        typeof a === 'string' ? { name: null, address: a } : a;
      const email = emailMetaSchema.parse({
        subject: mail.subject,
        from: mail.from,
        to: mail.to.map(addr),
        cc: mail.cc.map(addr),
        bcc: mail.bcc.map(addr),
        messageId: mail.messageId,
        inReplyTo: mail.inReplyTo,
        references: mail.references,
        html: shown?.html || null,
        htmlTruncated: shown?.truncated ?? false,
        threadId: (result.threadKey ?? mail.threadKey ?? '').slice(0, 128),
        attachments: mail.attachments
          .filter((a) => a.objectKey && a.bytes)
          .map((a) => ({
            id: attachmentIdOfKey(a.objectKey!),
            name: a.name,
            mime: a.mime,
            size: a.bytes!.length,
            inline: false,
            tooLarge: false,
          })),
        automated: false,
        delivery: 'sent',
      });
      return { email };
    } catch (err) {
      this.logger.warn(
        { orgId: ctx.orgId, err: (err as Error).message },
        'sent mail not recorded on the message',
      );
      return undefined;
    }
  }
}
