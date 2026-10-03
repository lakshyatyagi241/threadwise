/**
 * PORT: copy one WhatsApp media file from Meta into the chat media store.
 *
 * Who calls what (Phase 2, plan-inbox-chat.md section 5):
 *
 *   - The Meta channel adapter (`MetaCloudChannelAdapter`) exposes an instance of this as `ChannelAdapter.inboundMedia`. That is the
 *     whole contract with the adapter: when a channel's adapter has it, the ingest pipeline stores the customer's message AT ONCE
 *     without the file (`mediaStatus: 'pending'`) and a `media-fetch` job calls `fetchAndStore` in the background, with retries.
 *     The adapter normalises the webhook (media id, mime, sha256, filename) and does nothing else about files.
 *   - `fetchAndStore` is what the worker calls. Where the file is looked up and how the call is authenticated come from the channel's
 *     route and connection (`profileOf` in `media-provider.ts`, over `WabaHttp`: direct Meta, or Interakt's proxy with its own address and headers). It is safe to call twice for the same file (it stores a new object each time and
 *     the caller keeps only the first result), and it never throws anything but `MediaFetchError`: `retryable` tells the worker
 *     whether to back off and try again or to mark the file failed.
 *
 * Implemented by `WhatsappInboundMediaFetcher`, bound to `INBOUND_MEDIA_FETCHER` by `WhatsappMediaModule`.
 */
import type { StoredMedia } from '../../chat-conversations/media/chat-media.store';
import type { MediaChannel } from './media-provider';
import type { WaMediaKind } from './whatsapp-media-rules';

export const INBOUND_MEDIA_FETCHER = Symbol('INBOUND_MEDIA_FETCHER');

/**
 * The channel as the fetcher needs it. `ChannelRuntime` satisfies this structurally; it is declared in `media-provider.ts` so the port
 * does not import the channel port (the channel port imports this file). Its credentials are opened for this call only and never logged.
 */
export type InboundMediaChannel = MediaChannel;

export interface InboundMediaRequest {
  channel: InboundMediaChannel;
  /** Meta's media id from the webhook. Expires about 30 days after delivery, which is why the file is copied at ingest. */
  mediaId: string;
  /** The kind the webhook gave the message (`image`, `audio`, ...): it sets the size limit while the file streams. */
  mediaKind: WaMediaKind;
  /** The mime type the webhook declared. It only decides between formats that share a signature; the bytes decide the type. */
  declaredMime: string;
  /** The sha256 the webhook announced (hex or base64). A file that does not match is refused. */
  sha256?: string | null;
  /** The file name the sender gave (documents). Display only. */
  filename?: string | null;
  /** Free text for logs (`<message uuid>`): never used to find anything. */
  ref?: string;
  signal?: AbortSignal;
}

export interface InboundMediaFetcher {
  fetchAndStore(request: InboundMediaRequest): Promise<StoredMedia>;
}
