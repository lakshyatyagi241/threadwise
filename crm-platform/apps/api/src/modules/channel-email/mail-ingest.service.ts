import { Injectable, Logger } from '@nestjs/common';
import { emailMetaSchema, type EmailMeta } from '@crm/contracts';
import { channelEmailEnv } from '../../config/domains/channel-email.env';
import { ChatMediaStore, displayName } from '../../infra/providers/chat-conversations/media';
import {
  GmailClient,
  htmlToText,
  parseGmailMessage,
  sanitizeEmailHtml,
  type GmailMessage,
  type InboundAttachment,
  type ParsedEmail,
} from '../../infra/providers/channel-email';
import type { NormalisedInbound } from '../../infra/providers/chat-conversations';
import { ExternalChannelIngest } from '../chat-conversations';
import { channelAccountOf } from './mail-channel.sync';
import type { MailboxRow } from './mailboxes.repository';

/** The body of a mail with no text at all (only a picture, only files). */
const EMPTY_BODY = '(no text)';
/** Longest text body kept: the outbound limit of an email reply, so the thread is symmetric. */
const BODY_MAX = 100_000;
/** The attachment id is the object-store key, base64url: it must fit the contract's 128 characters. */
const ID_MAX = 128;

export type StoredMailOutcome = 'stored' | 'duplicate' | 'skipped' | 'dropped';

/** The attachment id the download route takes: the object-store key, which only the message's own `meta.email` can name. */
export const attachmentIdOfKey = (key: string): string =>
  Buffer.from(key, 'utf8').toString('base64url');
export const keyOfAttachmentId = (id: string): string =>
  Buffer.from(id, 'base64url').toString('utf8');

/**
 * One Gmail message becomes one inbox message (TW-MAIL-021, 025, 026): parsed, its files copied to the object store, its HTML sanitised,
 * and handed to the inbox core through `ExternalChannelIngest.inbound`, on the conversation of its Gmail thread (`peerKey` = `t:<threadId>`)
 * with the sender linked as the contact by email address.
 *
 * Files are stored BEFORE the message (their keys go into the message's `meta.email`), so a message the inbox then refuses as a duplicate
 * or drops has its files removed again. Redelivery is harmless: the caller skips a Gmail id already in the ledger before downloading, and
 * the inbox's own ledger is the authority.
 */
@Injectable()
export class MailIngestService {
  private readonly logger = new Logger(MailIngestService.name);

  constructor(
    private readonly gmail: GmailClient,
    private readonly media: ChatMediaStore,
    private readonly ingest: ExternalChannelIngest,
  ) {}

  async store(
    orgId: number,
    mailbox: MailboxRow,
    token: string,
    raw: GmailMessage,
    opts: { quiet: boolean },
  ): Promise<StoredMailOutcome> {
    const parsed = parseGmailMessage(raw, mailbox.address);
    if (parsed.skip) return 'skipped';

    const stored: string[] = [];
    try {
      const files = await this.storeFiles(orgId, token, parsed, stored);
      const message = this.normalise(parsed, files, opts.quiet);
      const outcome = await this.ingest.inbound(orgId, channelAccountOf(mailbox), message);
      if (outcome.outcome === 'duplicate' || outcome.outcome === 'dropped') {
        await this.removeAll(orgId, stored);
        return outcome.outcome === 'dropped' ? 'dropped' : 'duplicate';
      }
      return 'stored';
    } catch (err) {
      await this.removeAll(orgId, stored);
      throw err;
    }
  }

  /** Copies each attachment into the object store, within the size caps. Whatever cannot be stored is listed as `tooLarge` (not stored). */
  private async storeFiles(
    orgId: number,
    token: string,
    parsed: ParsedEmail,
    storedKeys: string[],
  ): Promise<{ attachments: EmailMeta['attachments']; cid: Map<string, string> }> {
    const env = channelEmailEnv();
    const attachments: EmailMeta['attachments'] = [];
    const cid = new Map<string, string>();
    let total = 0;
    for (const file of parsed.attachments.slice(0, 50)) {
      const base = {
        name: displayName(file.name, 'attachment').slice(0, 255),
        mime: file.mime.slice(0, 127),
        size: file.size,
        inline: file.inline,
      };
      const notStored = () =>
        attachments.push({ ...base, id: `x-${file.partId}`.slice(0, ID_MAX), tooLarge: true });
      if (
        file.size > env.MAIL_ATTACHMENT_MAX_BYTES ||
        total + file.size > env.MAIL_ATTACHMENTS_TOTAL_MAX_BYTES
      ) {
        notStored();
        continue;
      }
      try {
        const bytes = await this.bytesOf(token, parsed.providerMessageId, file);
        if (bytes.length === 0 || bytes.length > env.MAIL_ATTACHMENT_MAX_BYTES) {
          notStored();
          continue;
        }
        const saved = await this.media.storeInbound({
          orgId,
          buffer: bytes,
          declaredMime: file.mime,
          filename: file.name,
        });
        storedKeys.push(saved.key);
        const id = attachmentIdOfKey(saved.key);
        if (id.length > ID_MAX) {
          await this.media.remove(orgId, saved.key).catch(() => undefined);
          storedKeys.pop();
          notStored();
          continue;
        }
        total += bytes.length;
        attachments.push({ ...base, mime: saved.mime, size: saved.size, id, tooLarge: false });
        if (file.contentId) cid.set(file.contentId, id);
      } catch (err) {
        // A file the upload policy refuses (an executable), or one Google would not hand over: the mail is kept, the file is noted as not stored.
        this.logger.debug(
          { orgId, name: file.name, err: (err as Error).message },
          'mail attachment not stored',
        );
        notStored();
      }
    }
    return { attachments, cid };
  }

  private async bytesOf(
    token: string,
    messageId: string,
    file: InboundAttachment,
  ): Promise<Buffer> {
    if (file.data) return file.data;
    if (!file.attachmentId) return Buffer.alloc(0);
    return this.gmail.getAttachment(token, messageId, file.attachmentId);
  }

  private normalise(
    parsed: ParsedEmail,
    files: { attachments: EmailMeta['attachments']; cid: Map<string, string> },
    quiet: boolean,
  ): NormalisedInbound {
    const env = channelEmailEnv();
    let html: string | null = null;
    let htmlTruncated = false;
    if (parsed.html) {
      const clean = sanitizeEmailHtml(parsed.html, {
        blockRemoteImages: env.MAIL_BLOCK_REMOTE_IMAGES,
        inputMaxChars: env.MAIL_HTML_INPUT_MAX_CHARS,
        cidToAttachmentId: files.cid,
      });
      html = clean.html || null;
      htmlTruncated = clean.truncated;
    }
    const text = parsed.text || (parsed.html ? htmlToText(parsed.html) : '');
    const body = (text || EMPTY_BODY).slice(0, BODY_MAX);
    const addr = (a: { name: string | null; address: string }) => ({
      name: a.name ? a.name.slice(0, 200) : null,
      address: a.address.slice(0, 320),
    });
    const email: EmailMeta = emailMetaSchema.parse({
      subject: parsed.subject,
      from: addr(parsed.from),
      to: parsed.to.slice(0, 100).map(addr),
      cc: parsed.cc.slice(0, 100).map(addr),
      bcc: parsed.bcc.slice(0, 100).map(addr),
      messageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references.slice(-100),
      html,
      htmlTruncated,
      threadId: parsed.threadId,
      attachments: files.attachments,
      automated: parsed.automated,
    });
    return {
      providerMessageId: parsed.providerMessageId,
      peerKey: `t:${parsed.threadId}`,
      peerName: parsed.from.name || parsed.from.address,
      kind: 'text',
      body,
      providerTimestamp: parsed.sentAt,
      title: parsed.subject || '(no subject)',
      contactIdentity: {
        kind: 'email',
        value: parsed.from.address,
        ...(parsed.from.name ? { name: parsed.from.name } : {}),
      },
      meta: { email },
      ...(quiet ? { history: { direction: 'in' as const } } : {}),
    };
  }

  private async removeAll(orgId: number, keys: string[]): Promise<void> {
    for (const key of keys) await this.media.remove(orgId, key).catch(() => undefined);
  }
}
