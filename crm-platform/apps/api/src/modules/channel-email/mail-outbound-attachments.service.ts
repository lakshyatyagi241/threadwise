import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  MAIL_OUTBOUND_ATTACHMENT_TTL_HOURS,
  type MailOutboundAttachment,
  type UploadMailAttachmentFields,
} from '@crm/contracts';
import { HttpStatus } from '@nestjs/common';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { channelEmailEnv } from '../../config/domains/channel-email.env';
import { DatabaseService } from '../../infra/db/database.service';
import { mimeAllowed, mimeList } from '../../infra/providers/channel-email';
import { ChatMediaStore } from '../../infra/providers/chat-conversations/media';
import { EmailMessageAccess } from '../chat-conversations';
import { MailAttachmentScanner } from './mail-attachment-scanner';
import { attachmentIdOfKey } from './mail-ingest.service';
import { attachmentNotFound, attachmentTooLarge, tooManyAttachments } from './mail-outbound-errors';
import {
  MailOutboundAttachmentsRepository,
  type StagedAttachmentRow,
} from './mail-outbound-attachments.repository';

export interface UploadedMailFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/** A staged file ready to go out: its row facts and its bytes. */
export interface ResolvedAttachment {
  uuid: string;
  name: string;
  mime: string;
  size: number;
  objectKey: string;
  bytes: Buffer;
}

/** How long past its expiry an unsent file is kept before the sweep deletes it (a send racing the expiry still finds it). */
export const STAGED_GRACE_MINUTES = 60;

const toResponse = (row: StagedAttachmentRow): MailOutboundAttachment => ({
  id: row.uuid,
  name: row.name,
  mime: row.mime,
  size: row.size,
  expiresAt: row.expiresAt.toISOString(),
});

/**
 * Composer uploads (TW-MAIL-027): a file is staged in the object store for its uploader, named by id in the reply, read back when the reply
 * is sent, and removed again if it never is. Nothing here trusts the browser: the object store decides the type from the content, the
 * env caps and mime lists apply, and a staged file is only ever usable by the person who uploaded it, once.
 */
@Injectable()
export class MailOutboundAttachments {
  private readonly logger = new Logger(MailOutboundAttachments.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MailOutboundAttachmentsRepository,
    private readonly store: ChatMediaStore,
    private readonly access: EmailMessageAccess,
    private readonly scanner: MailAttachmentScanner,
  ) {}

  async upload(
    file: UploadedMailFile | undefined,
    fields: UploadMailAttachmentFields,
  ): Promise<MailOutboundAttachment> {
    const ctx = RequestContextStore.require();
    const env = channelEmailEnv();
    if (!file || file.size === 0 || file.buffer.length === 0) {
      throw AppError.validation('A file is required', [
        { path: 'file', message: 'send the file as multipart field "file"' },
      ]);
    }
    if (file.buffer.length > env.MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES) {
      throw attachmentTooLarge(env.MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES);
    }
    let conversationId: number | null = null;
    if (fields.conversationId) {
      conversationId = await this.access.conversationReadable(fields.conversationId);
      if (conversationId === null) throw AppError.notFound('Conversation', fields.conversationId);
    }

    const verdict = await this.scanner.scan({
      orgId: ctx.orgId,
      name: file.originalname,
      mime: '',
      bytes: file.buffer,
    });
    if (!verdict.clean) {
      throw new AppError(
        ERROR_CODES.AUTH_UPLOAD_REJECTED,
        'This file was refused by the security scan.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const stored = await this.store.store({
      orgId: ctx.orgId,
      filename: file.originalname,
      buffer: file.buffer,
    });
    const refuse = async (message: string): Promise<never> => {
      await this.store.remove(ctx.orgId, stored.key).catch(() => undefined);
      throw new AppError(
        ERROR_CODES.AUTH_UPLOAD_REJECTED,
        message,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    };
    if (
      !mimeAllowed(
        stored.mime,
        mimeList(env.MAIL_OUTBOUND_ATTACHMENT_ALLOW_MIME),
        mimeList(env.MAIL_OUTBOUND_ATTACHMENT_DENY_MIME),
      )
    ) {
      return refuse('This type of file cannot be attached to an email.');
    }
    // The download id is the key, base64url, and must fit the contract's 128 characters.
    if (attachmentIdOfKey(stored.key).length > 128) return refuse('This file cannot be attached.');

    try {
      const row = await this.db.txAs({ orgId: ctx.orgId, userId: ctx.userId! }, (tx) =>
        this.repo.insert(tx, ctx.orgId, {
          uploadedBy: ctx.userId!,
          conversationId,
          name: stored.name,
          mime: stored.mime,
          size: stored.size,
          objectKey: stored.key,
          ttlHours: env.MAIL_OUTBOUND_ATTACHMENT_TTL_HOURS || MAIL_OUTBOUND_ATTACHMENT_TTL_HOURS,
        }),
      );
      return toResponse(row);
    } catch (err) {
      await this.store.remove(ctx.orgId, stored.key).catch(() => undefined);
      throw err;
    }
  }

  /** The uploader takes a staged file back (removed from the composer). Only their own, only before it was sent: anything else is a 404. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const key = await this.db.txAs({ orgId: ctx.orgId, userId: ctx.userId! }, async (tx) => {
      const row = await this.repo.ownedUnused(tx, ctx.orgId, uuid, ctx.userId!);
      if (!row) return null;
      await this.repo.delete(tx, ctx.orgId, row.id);
      return row.objectKey;
    });
    if (key === null) throw attachmentNotFound();
    await this.store.remove(ctx.orgId, key).catch(() => undefined);
  }

  /**
   * The files of a reply, with their bytes, in the order the composer named them. Throws `AppError`s the adapter turns into a failed
   * message: an id that is not the sender's own unsent upload is `MAIL_ATTACHMENT_NOT_FOUND`, and the count and size caps apply.
   */
  async resolveForSend(
    orgId: number,
    userId: number | null,
    ids: readonly string[],
    attempt: number,
  ): Promise<ResolvedAttachment[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const env = channelEmailEnv();
    if (unique.length > env.MAIL_OUTBOUND_ATTACHMENTS_MAX_COUNT) {
      throw tooManyAttachments(env.MAIL_OUTBOUND_ATTACHMENTS_MAX_COUNT);
    }
    if (userId === null) throw attachmentNotFound();
    const found = await this.db.txAs({ orgId, userId }, (tx) =>
      this.repo.forSend(tx, orgId, userId, unique, attempt > 1),
    );
    if (found.length !== unique.length) throw attachmentNotFound();
    let total = 0;
    for (const row of found) {
      if (row.size > env.MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES) {
        throw attachmentTooLarge(env.MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES);
      }
      total += row.size;
    }
    if (total > env.MAIL_OUTBOUND_ATTACHMENTS_TOTAL_MAX_BYTES) {
      throw attachmentTooLarge(env.MAIL_OUTBOUND_ATTACHMENTS_TOTAL_MAX_BYTES, 'total');
    }
    const byUuid = new Map(found.map((r) => [r.uuid, r]));
    const out: ResolvedAttachment[] = [];
    let read = 0;
    for (const id of unique) {
      const row = byUuid.get(id)!;
      const bytes = await this.readBytes(orgId, row, env.MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES);
      read += bytes.length;
      if (read > env.MAIL_OUTBOUND_ATTACHMENTS_TOTAL_MAX_BYTES) {
        throw attachmentTooLarge(env.MAIL_OUTBOUND_ATTACHMENTS_TOTAL_MAX_BYTES, 'total');
      }
      out.push({
        uuid: row.uuid,
        name: row.name,
        mime: row.mime,
        size: bytes.length,
        objectKey: row.objectKey,
        bytes,
      });
    }
    return out;
  }

  /** Reads a staged object into memory, stopping the moment it passes the cap (the stream is never read to the end for a runaway file). */
  private async readBytes(orgId: number, row: StagedAttachmentRow, cap: number): Promise<Buffer> {
    const opened = await this.store.open(orgId, row.objectKey);
    if (!opened) throw attachmentNotFound();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of opened.stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buf.length;
        if (size > cap) throw attachmentTooLarge(cap);
        chunks.push(buf);
      }
    } finally {
      opened.stream.destroy();
    }
    return Buffer.concat(chunks, size);
  }

  /** The reply was accepted by the provider: its files are spent (never offered or sent again; the sweep leaves them). */
  async markUsed(orgId: number, userId: number | null, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.txAs(userId ? { orgId, userId } : { orgId }, (tx) =>
      this.repo.markUsed(tx, orgId, [...new Set(ids)]),
    );
  }

  /** Deletes unsent files that expired (object and row). Returns how many. Cross-workspace: run by the worker only. */
  async sweepExpired(limit = 200): Promise<number> {
    const due = await this.db.privileged((tx) =>
      this.repo.expiredEverywhere(tx, STAGED_GRACE_MINUTES, limit),
    );
    let removed = 0;
    for (const f of due) {
      try {
        const gone = await this.db.txAs({ orgId: f.orgId }, (tx) =>
          this.repo.deleteUnusedById(tx, f.orgId, f.id),
        );
        if (!gone) continue;
        await this.store.remove(f.orgId, f.objectKey).catch(() => undefined);
        removed += 1;
      } catch (err) {
        this.logger.warn(
          { orgId: f.orgId, err: (err as Error).message },
          'staged attachment not removed',
        );
      }
    }
    return removed;
  }
}
