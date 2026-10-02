import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../../common/errors/app-error';
import { LocalDiskMediaStore, isSafeMediaKey } from './local-disk-media.store';
import { MediaTokenService } from './media-token.service';
import { kindOfMime, sniffMediaType, type MediaKind } from './media-types';
import { chatMediaConfig } from './media.config';
import {
  MEDIA_OBJECT_GATEWAY,
  MEDIA_UPLOAD_VALIDATOR,
  type ChatMediaObjectGateway,
  type ChatMediaUploadValidator,
} from './media.ports';

export const LOCAL_DISK_MEDIA_STORE = Symbol('LOCAL_DISK_MEDIA_STORE');

/** What the caller keeps on the message row. The key is the only locator: never a URL, so a provider change rewrites no data. */
export interface StoredMedia {
  key: string;
  mime: string;
  size: number;
  /** The name to show and to offer on download: the sender's, with path and control characters removed. */
  name: string;
  sha256: string;
  kind: MediaKind;
}

export interface OpenedMedia {
  stream: Readable;
  size: number;
  start: number;
  end: number;
  /** True when only a byte range was asked for and served. */
  partial: boolean;
}

/** The asked-for range starts beyond the end of the file. */
export class MediaRangeError extends Error {
  constructor(readonly size: number) {
    super('range not satisfiable');
  }
}

const ALL_KINDS: MediaKind[] = ['image', 'media', 'document'];

const reject = (message: string) =>
  new AppError(ERROR_CODES.AUTH_UPLOAD_REJECTED, message, HttpStatus.UNPROCESSABLE_ENTITY);

/** What the sender called a file, made safe to show and to offer on download: no path, no control characters, at most 120 characters. */
export function displayName(filename: string, fallback = 'file'): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const clean = [...base]
    .filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return (clean || fallback).slice(0, 120);
}

/**
 * The one door chat media goes in and out of.
 *
 * Writing: the upload policy decides what is allowed (extension and content signature, never the client's Content-Type), the
 * size limit is the one for the file's kind, the object key is generated here (`chat/<workspace>/<yyyy>/<mm>/<random>.<ext>`:
 * the sender's file name is never part of a path), and the bytes go to the bucket when the platform's storage settings enable
 * one, otherwise to local disk. Bytes never go to Postgres.
 *
 * Reading: only through `open`, called by the authenticated media route. A key outside the caller's workspace is not there, and
 * a bucket is read by the server (a link only the server holds), never exposed as a public address.
 */
@Injectable()
export class ChatMediaStore {
  constructor(
    @Inject(MEDIA_OBJECT_GATEWAY) private readonly gateway: ChatMediaObjectGateway,
    @Inject(MEDIA_UPLOAD_VALIDATOR) private readonly validator: ChatMediaUploadValidator,
    @Inject(LOCAL_DISK_MEDIA_STORE) private readonly local: LocalDiskMediaStore,
    private readonly tokens: MediaTokenService,
  ) {}

  /** Validates and stores a file an agent uploaded (or any file whose name and bytes are the client's claim). */
  async store(input: {
    orgId: number;
    filename: string;
    buffer: Buffer;
    allow?: MediaKind[];
    /** The name to keep for display when it should differ from `filename`. */
    displayName?: string;
  }): Promise<StoredMedia> {
    const limits = chatMediaConfig().maxBytes;
    const validated = this.validator.validate({
      filename: input.filename,
      buffer: input.buffer,
      allow: input.allow ?? ALL_KINDS,
      maxBytes: Math.max(limits.image, limits.media, limits.document),
    });

    const kind = kindOfMime(validated.mime);
    if (input.buffer.length > limits[kind]) {
      throw reject(
        `The file is too large (limit ${Math.round(limits[kind] / (1024 * 1024))} MB for ${kind === 'media' ? 'audio and video' : `${kind}s`}).`,
      );
    }

    const now = new Date();
    const key = [
      'chat',
      String(input.orgId),
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      validated.storedName,
    ].join('/');

    const remote = await this.gateway.put(key, input.buffer, validated.mime);
    if (remote === null) await this.local.put(key, input.buffer);

    return {
      key,
      mime: validated.mime,
      size: input.buffer.length,
      name: displayName(input.displayName ?? input.filename),
      sha256: createHash('sha256').update(input.buffer).digest('hex'),
      kind,
    };
  }

  /**
   * Stores bytes a channel delivered (a customer's photo from the provider). The sender chose the file name and the mime type,
   * so neither is trusted: the content decides the type, and then the same policy and size limits apply as for an upload.
   */
  async storeInbound(input: {
    orgId: number;
    buffer: Buffer;
    declaredMime?: string;
    filename?: string;
  }): Promise<StoredMedia> {
    const sniffed = sniffMediaType(input.buffer, input.declaredMime);
    if (!sniffed) throw reject('This file content is not allowed.');
    return this.store({
      orgId: input.orgId,
      filename: `inbound.${sniffed.ext}`,
      buffer: input.buffer,
      displayName: input.filename
        ? displayName(input.filename, `file.${sniffed.ext}`)
        : `file.${sniffed.ext}`,
    });
  }

  /** Whether the key is one of this workspace's (the check that keeps a key from another tenant from ever resolving). */
  ownsKey(orgId: number, key: string): boolean {
    return key.startsWith(`chat/${orgId}/`) && isSafeMediaKey(key);
  }

  /** The bytes of a stored file, or null when there is none (or the key is not this workspace's). */
  async open(
    orgId: number,
    key: string,
    range?: { start: number; end?: number },
  ): Promise<OpenedMedia | null> {
    if (!this.ownsKey(orgId, key)) return null;

    const stat = await this.local.stat(key);
    if (stat) {
      const opened = await this.local.open(key, range);
      if (!opened) throw new MediaRangeError(stat.size);
      return { ...opened, partial: range !== undefined };
    }

    if ((await this.gateway.destination()).disk !== 'cloud') return null;
    return this.openRemote(key, range);
  }

  async remove(orgId: number, key: string): Promise<void> {
    if (!this.ownsKey(orgId, key)) return;
    await this.local.remove(key);
    if ((await this.gateway.destination()).disk === 'cloud') await this.gateway.remove(key);
  }

  /**
   * A link for one person to read one object for a few minutes, in the shape a client uses (through the web app's proxy). Call it
   * only after checking the person may see the conversation the object belongs to.
   */
  accessUrl(
    key: string,
    actor: { orgId: number; userId: number },
    meta: { name?: string | null; mime?: string | null } = {},
  ): string {
    const token = this.tokens.sign({
      key,
      orgId: actor.orgId,
      userId: actor.userId,
      name: meta.name ?? undefined,
      mime: meta.mime ?? undefined,
    });
    return `/api/v2/media/${token}`;
  }

  private async openRemote(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<OpenedMedia | null> {
    const url = await this.gateway.url(key, 60);
    const res = await fetch(url, {
      headers: range ? { range: `bytes=${range.start}-${range.end ?? ''}` } : {},
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404 || res.status === 403) return null;
    if (res.status === 416)
      throw new MediaRangeError(
        Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? 0),
      );
    if ((!res.ok && res.status !== 206) || !res.body) {
      throw new Error(`Object storage refused the read (HTTP ${res.status})`);
    }
    const length = Number(res.headers.get('content-length') ?? 0);
    const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? length);
    const start = range && res.status === 206 ? range.start : 0;
    return {
      stream: Readable.fromWeb(res.body as unknown as WebReadableStream),
      size: total,
      start,
      end: start + length - 1,
      partial: res.status === 206,
    };
  }
}
