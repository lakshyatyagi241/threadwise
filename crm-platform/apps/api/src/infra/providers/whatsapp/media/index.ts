/**
 * WhatsApp media pipeline: the public surface. The Meta channel adapter uses the two ports (`INBOUND_MEDIA_FETCHER`,
 * `OUTBOUND_MEDIA_UPLOADER`) and `whatsappMediaMessage`; the worker-side job lives in `modules/chat-conversations` (`media-fetch`).
 */
export {
  INBOUND_MEDIA_FETCHER,
  type InboundMediaChannel,
  type InboundMediaFetcher,
  type InboundMediaRequest,
} from './inbound-media-fetcher.port';
export {
  OUTBOUND_MEDIA_UPLOADER,
  type OutboundMediaChannel,
  type OutboundMediaFile,
  type OutboundMediaUploader,
  type PreparedWhatsappMedia,
} from './outbound-media-uploader.port';
export {
  authContextOf,
  profileOf,
  wabaAuthOf,
  type MediaAuthContext,
  type MediaChannel,
  type MediaProviderProfile,
  type MediaRoute,
} from './media-provider';
export { MEDIA_FAILURE, MediaFetchError, type MediaFailureCode } from './media-fetch-error';
export { whatsappMediaMessage } from './whatsapp-media-message';
export { WhatsappMediaModule } from './whatsapp-media.module';
export { WhatsappInboundMediaFetcher } from './whatsapp-inbound-media.fetcher';
export { WhatsappOutboundMediaUploader } from './whatsapp-outbound-media.uploader';
export { whatsappMediaConfig, type WhatsappMediaConfig } from './whatsapp-media.config';
export {
  WA_MAX_BYTES,
  WA_MIMES,
  WA_UPLOAD_REFUSAL,
  classifyForUpload,
  sha256HexFrom,
  type WaMediaKind,
} from './whatsapp-media-rules';
