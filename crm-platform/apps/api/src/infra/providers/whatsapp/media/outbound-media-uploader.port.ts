/**
 * PORT: get an outbound file to WhatsApp before its message is sent.
 *
 * Who calls what: `MetaCloudChannelAdapter.send` calls `prepare` for an `OutboundEnvelope` of kind `media`, then builds the Graph
 * message from the answer with `whatsappMediaMessage` (same folder). Nothing here sends the message itself.
 *
 * How the file travels is decided by the channel's route (`profileOf` in `media-provider.ts`, over `WabaHttp`):
 *
 *   - `capabilities.mediaUpload` (the Meta route): the file is uploaded to the provider's own storage through `WabaHttp`
 *     (`POST {provider}/{phone-number-id}/media`) and the message names the returned media id (`via: 'id'`).
 *     We never expose files publicly: the store has no public address, every read is authenticated and short lived.
 *   - no upload endpoint (the Interakt route: its Cloud API proxy documents sending media by id or public URL only): the message carries a link
 *     (`via: 'link'`) IF the store can make a temporary signed link (a cloud bucket). That is a deliberate privacy trade: the link needs
 *     no session, so until it expires (`WHATSAPP_MEDIA_LINK_TTL_SECONDS`, default 15 minutes) anyone holding it can read the file. When
 *     the store cannot make one (local disk) the send fails with `WA_MEDIA_UPLOAD_UNSUPPORTED`, a permanent error that says why.
 *
 * What `prepare` guarantees:
 *   - the file is something WhatsApp carries as the kind the message says it is (JPEG/PNG images, WebP stickers, MP4/3GPP video, AAC/MP4/
 *     MP3/AMR/Ogg-Opus audio, documents) and is within that kind's size limit, or it throws a PERMANENT `ChannelError` whose code
 *     says why (`WA_MEDIA_UNSUPPORTED_TYPE`, `WA_MEDIA_TRANSCODE_REQUIRED` for an audio container such as wav or webm, because
 *     transcoding is not part of this release, `WA_MEDIA_TOO_LARGE`, `WA_MEDIA_NOT_FOUND`);
 *   - an upload that failed for a reason worth retrying (network, 5xx, rate limit) throws a RETRYABLE `ChannelError`, so the send job
 *     backs off; a refusal by the provider (bad credentials, rejected media) is permanent and carries the provider's error code and text;
 *   - the same file sent again on the same number within the cache lifetime (default 6 hours) reuses the media id instead of uploading
 *     again: the cache key is (workspace, channel, phone number, sha256, mime). Links are never cached.
 *
 * If the provider later answers a send with "media not found" for a cached id, call `forget` and let the retry upload again.
 *
 * Implemented by `WhatsappOutboundMediaUploader`, bound to `OUTBOUND_MEDIA_UPLOADER` by `WhatsappMediaModule`.
 */
import type { MediaChannel } from './media-provider';
import type { WaMediaKind } from './whatsapp-media-rules';

export const OUTBOUND_MEDIA_UPLOADER = Symbol('OUTBOUND_MEDIA_UPLOADER');

/** `ChannelRuntime` satisfies this structurally (see the note on `InboundMediaChannel`). */
export type OutboundMediaChannel = MediaChannel;

export interface OutboundMediaFile {
  /** The media store key from the envelope (`envelope.media.key`). */
  key: string;
  /** The kind the message is sent as (`envelope.media.mediaKind`). */
  mediaKind: WaMediaKind;
  mime: string;
  /** The display name (`envelope.media.name`). */
  name?: string;
  /** The file's sha256 when the caller has it (the envelope and message row carry it); computed from the stored file otherwise. */
  sha256?: string;
}

interface PreparedCommon {
  kind: WaMediaKind;
  /** The mime type the file is sent as. */
  mime: string;
  /** For a document: the file name WhatsApp shows the recipient. */
  filename?: string;
  /** An Ogg/Opus audio file: WhatsApp renders it as a voice note. There is nothing to set in the payload. */
  voice: boolean;
}

export type PreparedWhatsappMedia = PreparedCommon &
  (
    | {
        /** The file is on the provider's storage: the Graph message names `{ id }`. */
        via: 'id';
        mediaId: string;
        /** The media id came from the cache (no upload happened). */
        cached: boolean;
      }
    | {
        /** The provider fetches the file itself: the Graph message names `{ link }`. See the privacy note above. */
        via: 'link';
        link: string;
        expiresAt: Date;
      }
  );

export interface OutboundMediaUploader {
  prepare(channel: OutboundMediaChannel, file: OutboundMediaFile): Promise<PreparedWhatsappMedia>;

  /** Drops the cached media id of this file (call it when the provider says the id is gone). */
  forget(
    channel: OutboundMediaChannel,
    file: Pick<OutboundMediaFile, 'key' | 'mime' | 'sha256'>,
  ): Promise<void>;
}
