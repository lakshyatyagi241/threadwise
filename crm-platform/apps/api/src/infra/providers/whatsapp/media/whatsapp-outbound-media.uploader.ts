import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { ChannelError } from '../../chat-conversations/channel.port';
import { ChatMediaStore } from '../../chat-conversations/media';
import { WabaHttp } from '../../whatsapp-cloud-api-waba/waba-http';
import { GraphMediaClient, graphFailureOf } from './graph-media.client';
import { MEDIA_FAILURE, MediaFetchError, redact } from './media-fetch-error';
import { authContextOf, profileOf, secretsIn } from './media-provider';
import type {
  OutboundMediaChannel,
  OutboundMediaFile,
  OutboundMediaUploader,
  PreparedWhatsappMedia,
} from './outbound-media-uploader.port';
import {
  MemoryUploadedMediaCache,
  RedisUploadedMediaCache,
  uploadCacheKey,
  type UploadedMediaCache,
} from './upload-cache';
import {
  WA_UPLOAD_REFUSAL,
  WaMediaRefusal,
  baseMime,
  classifyForUpload,
} from './whatsapp-media-rules';
import { whatsappMediaConfig } from './whatsapp-media.config';

const HEAD_BYTES = 4096;

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

const notFound = () =>
  new ChannelError(WA_UPLOAD_REFUSAL.NOT_FOUND, 'The file to send is no longer in storage.', false);

/**
 * Gets a stored file to WhatsApp (see the port for the contract). The channel's route decides how: an upload to the provider's storage
 * through `WabaHttp` (the bytes are read from the media store, which refuses another workspace's key), or, for a route without an upload
 * endpoint (Interakt documents none), a temporary signed link to the stored file when the store can make one: the file then goes by
 * public link.
 */
@Injectable()
export class WhatsappOutboundMediaUploader implements OutboundMediaUploader {
  private readonly logger = new Logger(WhatsappOutboundMediaUploader.name);
  private readonly cache: UploadedMediaCache;
  /** One upload per cache key at a time: two sends of the same new file in the same moment share one request. */
  private readonly inFlight = new Map<string, Promise<PreparedWhatsappMedia>>();

  constructor(
    private readonly store: ChatMediaStore,
    private readonly http: WabaHttp,
    @Optional() @Inject(REDIS_CLIENT) redis?: Redis,
  ) {
    this.cache = redis ? new RedisUploadedMediaCache(redis) : new MemoryUploadedMediaCache();
  }

  async prepare(
    channel: OutboundMediaChannel,
    file: OutboundMediaFile,
  ): Promise<PreparedWhatsappMedia> {
    const cfg = whatsappMediaConfig();
    const ctx = authContextOf(channel);
    const profile = profileOf(this.http, ctx.route);
    const secrets = secretsIn(profile.buildHeaders(ctx));

    const head = await this.head(channel.orgId, file.key);
    const decided = this.classify(file, head);
    const filename = file.name ? file.name.slice(0, 240) : undefined;
    const common = {
      kind: decided.kind,
      mime: decided.mime,
      ...(decided.kind === 'document' && filename ? { filename } : {}),
      voice: decided.voice,
    };

    if (!profile.capabilities.mediaUpload) {
      const link = await this.store.temporaryPublicLink(
        channel.orgId,
        file.key,
        cfg.linkTtlSeconds,
      );
      if (!link) {
        throw new ChannelError(
          WA_UPLOAD_REFUSAL.UPLOAD_UNSUPPORTED,
          'This WhatsApp provider cannot take file uploads, and file storage cannot make a temporary link for it. Connect object storage or use another provider.',
          false,
        );
      }
      return { ...common, via: 'link', link: link.url, expiresAt: link.expiresAt };
    }

    const phoneNumberId = ctx.phoneNumberId;
    if (!phoneNumberId || Object.keys(profile.buildHeaders(ctx)).length === 0) {
      throw new ChannelError(
        'WA_MEDIA_NO_CREDENTIALS',
        'This WhatsApp channel has no credentials or phone number id. Reconnect the channel.',
        false,
        { needsReauth: true },
      );
    }
    const sha256 = file.sha256 ?? (await this.digestOf(channel.orgId, file.key));
    const key = uploadCacheKey({
      orgId: channel.orgId,
      channelUuid: channel.uuid,
      phoneNumberId,
      sha256,
      mime: decided.mime,
    });

    const hit = await this.cache.get(key);
    if (hit) return { ...common, via: 'id', mediaId: hit, cached: true };

    const running = this.inFlight.get(key);
    if (running) return running;

    const upload = (async (): Promise<PreparedWhatsappMedia> => {
      try {
        const opened = await this.store.open(channel.orgId, file.key);
        if (!opened)
          throw new WaMediaRefusal(
            WA_UPLOAD_REFUSAL.NOT_FOUND,
            'The file to send is no longer in storage.',
          );
        const mediaId = await new GraphMediaClient(cfg, this.http).upload(profile, ctx, {
          stream: opened.stream,
          size: opened.size,
          mime: decided.mime,
          filename: filename ?? 'file',
        });
        await this.cache.set(key, mediaId, cfg.uploadCacheTtlSeconds);
        this.logger.debug(
          { channel: channel.uuid, kind: decided.kind, bytes: opened.size },
          'whatsapp media uploaded',
        );
        return { ...common, via: 'id', mediaId, cached: false };
      } catch (err) {
        throw this.asChannelError(err, secrets);
      }
    })();
    this.inFlight.set(key, upload);
    try {
      return await upload;
    } finally {
      this.inFlight.delete(key);
    }
  }

  async forget(
    channel: OutboundMediaChannel,
    file: Pick<OutboundMediaFile, 'key' | 'mime' | 'sha256'>,
  ): Promise<void> {
    const phoneNumberId = authContextOf(channel).phoneNumberId;
    if (!phoneNumberId) return;
    const sha256 = file.sha256 ?? (await this.digestOf(channel.orgId, file.key).catch(() => null));
    if (!sha256) return;
    await this.cache.del(
      uploadCacheKey({
        orgId: channel.orgId,
        channelUuid: channel.uuid,
        phoneNumberId,
        sha256,
        mime: baseMime(file.mime),
      }),
    );
  }

  // --- pieces --------------------------------------------------------------------------------------------------------------

  private classify(file: OutboundMediaFile, head: { bytes: Buffer; size: number }) {
    try {
      return classifyForUpload({
        mediaKind: file.mediaKind,
        mime: file.mime,
        size: head.size,
        head: head.bytes,
      });
    } catch (err) {
      throw this.asChannelError(err, []);
    }
  }

  /** The first bytes and the size of the stored file, from a ranged read. */
  private async head(orgId: number, key: string): Promise<{ bytes: Buffer; size: number }> {
    const opened = await this.store
      .open(orgId, key, { start: 0, end: HEAD_BYTES - 1 })
      .catch(() => null);
    if (!opened) throw notFound();
    return { bytes: await readAll(opened.stream), size: opened.size };
  }

  private async digestOf(orgId: number, key: string): Promise<string> {
    const opened = await this.store.open(orgId, key);
    if (!opened) throw notFound();
    const hash = createHash('sha256');
    for await (const chunk of opened.stream) hash.update(chunk as Buffer);
    return hash.digest('hex');
  }

  private asChannelError(err: unknown, secrets: string[]): ChannelError {
    if (err instanceof ChannelError) return err;
    if (err instanceof WaMediaRefusal) return new ChannelError(err.code, err.message, false);
    if (err instanceof MediaFetchError) {
      const graph = graphFailureOf(err);
      // The provider's own error code is the code the agent and the support team can look up; transport trouble has none.
      const code = graph
        ? graph.code
        : err.code === MEDIA_FAILURE.NO_CREDENTIALS
          ? 'WA_MEDIA_NO_CREDENTIALS'
          : 'WA_MEDIA_UPLOAD_FAILED';
      const reason =
        err.code === MEDIA_FAILURE.AUTH
          ? 'WhatsApp refused the credentials. Reconnect the channel.'
          : redact(err.message, ...secrets);
      return new ChannelError(code, reason, err.retryable, {
        needsReauth: err.code === MEDIA_FAILURE.AUTH || err.code === MEDIA_FAILURE.NO_CREDENTIALS,
        providerCode: graph?.code ?? null,
      });
    }
    return new ChannelError(
      'WA_MEDIA_UPLOAD_FAILED',
      redact(`The upload to WhatsApp failed (${(err as Error).message})`, ...secrets).slice(0, 300),
      true,
    );
  }
}
