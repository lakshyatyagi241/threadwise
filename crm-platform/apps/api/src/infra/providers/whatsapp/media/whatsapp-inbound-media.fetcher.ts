import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../../common/errors/app-error';
import {
  ChatMediaStore,
  MediaIntegrityError,
  MediaTooLargeError,
  type StoredMedia,
} from '../../chat-conversations/media';
import { WabaHttp } from '../../whatsapp-cloud-api-waba/waba-http';
import { GraphMediaClient } from './graph-media.client';
import type { InboundMediaFetcher, InboundMediaRequest } from './inbound-media-fetcher.port';
import { MEDIA_FAILURE, MediaFetchError, redact, safeUrlForLog } from './media-fetch-error';
import { authContextOf, profileOf, secretsIn } from './media-provider';
import { inboundByteCap, sha256HexFrom } from './whatsapp-media-rules';
import { whatsappMediaConfig } from './whatsapp-media.config';

/**
 * Copies a customer's WhatsApp file into the chat media store:
 *
 *   1. `GET {provider}/{media-id}` for the short-lived download address, through `WabaHttp` with the channel's connection (direct Meta,
 *      or Interakt's proxy with its own address and headers; with `phone_number_id` on Meta, so a forged id for another number is refused);
 *   2. an early refusal when Meta announces a size over the limit for the kind (nothing is downloaded);
 *   3. the download, as a stream, through the SSRF guard; the provider's headers go only to the provider's own host and Meta's media hosts;
 *   4. `ChatMediaStore.storeInboundStream`: size capped while streaming, sha256 verified against what Meta announced, the real type
 *      decided from the bytes, the platform upload policy applied, one atomic move into the store.
 *
 * Every failure is a `MediaFetchError` with a stable code and a `retryable` flag, and a message that carries no credential and no
 * signed address. The timing of the transfer is bounded three ways (time to first byte, silence on the connection, and a total
 * deadline), so a stuck download cannot hold a worker.
 */
@Injectable()
export class WhatsappInboundMediaFetcher implements InboundMediaFetcher {
  private readonly logger = new Logger(WhatsappInboundMediaFetcher.name);

  constructor(
    private readonly store: ChatMediaStore,
    private readonly http: WabaHttp,
  ) {}

  async fetchAndStore(req: InboundMediaRequest): Promise<StoredMedia> {
    const cfg = whatsappMediaConfig();
    const client = new GraphMediaClient(cfg, this.http);
    const ctx = authContextOf(req.channel);
    const profile = profileOf(this.http, ctx.route, ctx.registry);
    // Every header value the provider asked for: removed from any text that leaves this function.
    const secrets = secretsIn(profile.buildHeaders(ctx));

    const total = AbortSignal.timeout(cfg.totalTimeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, total]) : total;
    const cap = inboundByteCap(req.mediaKind);

    try {
      const found = await client.lookup(profile, ctx, req.mediaId);
      if (found.fileSize !== null && found.fileSize > cap) {
        throw new MediaFetchError(
          MEDIA_FAILURE.TOO_LARGE,
          `The file is ${found.fileSize} bytes; the limit for this kind is ${cap}.`,
          false,
        );
      }

      // The webhook's digest is the one we were told to expect; the lookup's is the fallback when the webhook had none.
      const announced = req.sha256 ?? found.sha256;
      const expected = sha256HexFrom(announced);
      if (announced && !expected) {
        this.logger.warn(
          { ref: req.ref },
          'media sha256 announced in an unknown format; not verified',
        );
      }

      const download = await client.download(profile, ctx, found.url, signal);
      if (download.contentLength !== null && download.contentLength > cap) {
        download.stream.destroy();
        throw new MediaFetchError(
          MEDIA_FAILURE.TOO_LARGE,
          `The file is ${download.contentLength} bytes; the limit for this kind is ${cap}.`,
          false,
        );
      }

      const stored = await this.store.storeInboundStream({
        orgId: req.channel.orgId,
        stream: download.stream,
        declaredMime: found.mime ?? req.declaredMime,
        filename: req.filename ?? undefined,
        maxBytes: cap,
        verifySha256Hex: expected ?? undefined,
      });
      this.logger.debug(
        { ref: req.ref, kind: stored.kind, bytes: stored.size, from: safeUrlForLog(found.url) },
        'whatsapp media stored',
      );
      return stored;
    } catch (err) {
      throw this.asFetchError(err, secrets);
    }
  }

  private asFetchError(err: unknown, secrets: string[]): MediaFetchError {
    if (err instanceof MediaFetchError) return err;
    if (err instanceof MediaTooLargeError) {
      return new MediaFetchError(
        MEDIA_FAILURE.TOO_LARGE,
        `The file is larger than the ${err.limitBytes} byte limit for this kind.`,
        false,
      );
    }
    if (err instanceof MediaIntegrityError) {
      return new MediaFetchError(
        MEDIA_FAILURE.SHA256_MISMATCH,
        'The downloaded file does not match the checksum WhatsApp announced.',
        true,
      );
    }
    if (err instanceof AppError && err.code === ERROR_CODES.AUTH_UPLOAD_REJECTED) {
      return new MediaFetchError(
        MEDIA_FAILURE.REJECTED,
        'The platform does not accept this type of file.',
        false,
      );
    }
    // A cut or reset connection while the body was flowing, a full disk, anything else: worth another try, with nothing sensitive in the text.
    return new MediaFetchError(
      MEDIA_FAILURE.DOWNLOAD_FAILED,
      redact(`The download was interrupted (${(err as Error).message})`, ...secrets).slice(0, 300),
      true,
    );
  }
}
