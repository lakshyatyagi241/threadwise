import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'node:stream';
import { ERROR_CODES, V1_MEDIA_MAX_BYTES, type V1MediaUpload } from '@crm/contracts';
import { RequestContextStore } from '../../../../common/context/request-context';
import { AppError } from '../../../../common/errors/app-error';
import type { Env } from '../../../../config/env.schema';
import {
  ChatMediaStore,
  MediaTokenService,
  displayName,
  type StoredMedia,
} from '../../../../infra/providers/chat-conversations/media';
import { SafeFetch } from '../../../../infra/providers/node-bridge-runtime/safe-fetch';
import { sendFailed, v1Error, validationFailed } from './messaging-errors';
import { mediaTypeOfMime } from './send-plan';

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/** How long the link a media upload answers with works. A message read mints a short one every time (the platform's default). */
const UPLOAD_LINK_TTL_SECONDS = 24 * 3600;
/** Reference gave a download 25 seconds. */
const DOWNLOAD_TIMEOUT_MS = 25_000;
const MEDIA_PATH = '/api/v1/media/';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/**
 * Where a file for a send comes from (TW-API-113, 119): a multipart upload, a URL the server downloads, or a link this API gave out
 * earlier. All three end in the platform's chat media store, so the secure-upload rules (extension allow-list, a content signature that
 * must agree with the extension, the per-kind size limit) are the platform's and apply to every path. Reference applied them to
 * `POST /media` only, and let a file attached to a send through unchecked.
 */
@Injectable()
export class MediaIntakeService {
  private readonly baseUrl: string;

  constructor(
    private readonly store: ChatMediaStore,
    private readonly tokens: MediaTokenService,
    private readonly fetcher: SafeFetch,
    config: ConfigService<Env, true>,
  ) {
    this.baseUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /** `POST /media`: stores the file and answers where to read it. */
  async upload(file: UploadedFile | undefined): Promise<V1MediaUpload> {
    if (!file) throw validationFailed('file', 'The file field is required.');
    const stored = await this.fromFile(file);
    return {
      url: this.linkFor(stored, UPLOAD_LINK_TTL_SECONDS),
      // The store's key names this workspace's numeric id; the client gets the file's own name only.
      path: `chat-media/${stored.key.split('/').pop()}`,
      type: mediaTypeOfMime(stored.mime),
      mime: stored.mime,
      size: stored.size,
    };
  }

  async fromFile(file: UploadedFile): Promise<StoredMedia> {
    const { orgId } = RequestContextStore.require();
    if (file.size > V1_MEDIA_MAX_BYTES) throw tooLarge();
    try {
      return await this.store.store({ orgId, filename: file.originalname, buffer: file.buffer });
    } catch (err) {
      throw uploadProblem(err);
    }
  }

  /**
   * A file by URL. A link this API handed out (`POST /media`, a message's `media_url`) is read straight from the store, because the
   * link needs the key to open and the server could not fetch it from itself anyway; any other URL is downloaded through the guarded
   * fetcher, which refuses private, loopback and reserved hosts, every redirect hop included.
   */
  async fromUrl(url: string): Promise<StoredMedia> {
    const own = await this.ownLink(url);
    if (own) return own;

    const { orgId } = RequestContextStore.require();
    let got;
    try {
      got = await this.fetcher.fetchMedia(url, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        maxBytes: V1_MEDIA_MAX_BYTES,
      });
    } catch {
      throw sendFailed('media_fetch_failed');
    }
    if (got.buffer.length === 0) throw sendFailed('media_fetch_failed');
    try {
      return await this.store.store({
        orgId,
        filename: `file${got.extension}`,
        buffer: got.buffer,
      });
    } catch (err) {
      throw uploadProblem(err);
    }
  }

  /** The read link for a stored file: `GET /api/v1/media/<token>`, for this key's workspace and owner, valid for minutes. */
  linkFor(
    media: { key: string; name?: string | null; mime?: string | null },
    ttlSeconds?: number,
  ): string {
    const ctx = RequestContextStore.require();
    const token = this.tokens.sign(
      {
        key: media.key,
        orgId: ctx.orgId,
        userId: ctx.userId!,
        name: media.name ?? undefined,
        mime: media.mime ?? undefined,
      },
      ttlSeconds,
    );
    return `${this.baseUrl}${MEDIA_PATH}${token}`;
  }

  private async ownLink(url: string): Promise<StoredMedia | null> {
    const prefix = `${this.baseUrl}${MEDIA_PATH}`;
    if (!url.startsWith(prefix)) return null;
    const ctx = RequestContextStore.require();
    const payload = this.tokens.verify(url.slice(prefix.length).split(/[?#]/)[0] ?? '');
    if (!payload || payload.orgId !== ctx.orgId || !this.store.ownsKey(ctx.orgId, payload.key)) {
      throw sendFailed('media_fetch_failed');
    }
    const opened = await this.store.open(ctx.orgId, payload.key).catch(() => null);
    if (!opened) throw sendFailed('media_fetch_failed');
    // Copied under a fresh key rather than reused, so deleting the message that carries it never removes a file an upload still points at.
    try {
      return await this.store.store({
        orgId: ctx.orgId,
        filename: payload.name ?? payload.key,
        buffer: await readAll(opened.stream),
        displayName: displayName(payload.name ?? ''),
      });
    } catch (err) {
      throw uploadProblem(err);
    }
  }
}

const tooLarge = (): AppError =>
  validationFailed(
    'file',
    `The file must not be greater than ${V1_MEDIA_MAX_BYTES / 1024} kilobytes.`,
  );

/** The platform's upload refusal, in Reference's words: 422 `unsupported_media_type` for a type or content that is not allowed. */
function uploadProblem(err: unknown): unknown {
  if (!(err instanceof AppError) || err.code !== ERROR_CODES.AUTH_UPLOAD_REJECTED) return err;
  const reason = err.details?.find((d) => d.path === 'file')?.message;
  if (reason === 'type_not_allowed')
    return v1Error('unsupported_media_type', 'This file type is not allowed.');
  if (reason === 'content_not_allowed' || /content is not allowed/i.test(err.message)) {
    return v1Error('unsupported_media_type', 'This file content is not allowed.');
  }
  if (reason === 'empty') return v1Error('unsupported_media_type', 'The uploaded file is invalid.');
  return validationFailed('file', err.message);
}
