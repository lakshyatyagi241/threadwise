import { Injectable } from '@nestjs/common';
import {
  INBOX_MEDIA_UPLOAD_TTL_HOURS,
  type InboxMediaKind,
  type InboxMediaUpload,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ChatMediaStore } from '../../infra/providers/chat-conversations/media';
import { MediaUploadsRepository } from './media-uploads.repository';

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * `POST /inbox/media` (TW-TIB1-019): an attachment goes up before the message that carries it. The media store decides what is
 * allowed (by content, never by the browser's Content-Type) and where the bytes live; this keeps the reference the send names.
 */
@Injectable()
export class InboxMediaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly media: ChatMediaStore,
    private readonly uploads: MediaUploadsRepository,
  ) {}

  async upload(file: UploadedFile | undefined): Promise<InboxMediaUpload> {
    const ctx = RequestContextStore.require();
    if (!file || file.size === 0) {
      throw AppError.validation('A file is required', [
        { path: 'file', message: 'send the file as multipart field "file"' },
      ]);
    }
    const stored = await this.media.store({
      orgId: ctx.orgId,
      filename: file.originalname,
      buffer: file.buffer,
    });
    const kind: InboxMediaKind =
      stored.kind === 'media'
        ? stored.mime.startsWith('video/')
          ? 'video'
          : 'audio'
        : stored.kind;

    const row = await this.db
      .tx((tx) =>
        this.uploads.insert(
          tx,
          ctx.orgId,
          ctx.userId!,
          {
            key: stored.key,
            kind,
            mime: stored.mime,
            size: stored.size,
            name: stored.name,
            sha256: stored.sha256,
          },
          INBOX_MEDIA_UPLOAD_TTL_HOURS,
        ),
      )
      .catch(async (err: unknown) => {
        // The reference could not be kept: the file is unreachable, so do not leave it behind.
        await this.media.remove(ctx.orgId, stored.key).catch(() => undefined);
        throw err;
      });

    return {
      id: row.uuid,
      kind: row.kind,
      mime: row.mime,
      name: row.name,
      sizeBytes: row.sizeBytes,
      previewUrl: this.media.accessUrl(
        row.mediaKey,
        { orgId: ctx.orgId, userId: ctx.userId! },
        { name: row.name, mime: row.mime },
      ),
      expiresAt: row.expiresAt.toISOString(),
    };
  }
}
