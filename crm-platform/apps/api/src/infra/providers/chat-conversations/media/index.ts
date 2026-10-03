/**
 * Public surface of the chat media door. Other code stores and links media through `ChatMediaStore`; it never writes a file or
 * builds a media URL itself.
 */
export { ChatMediaModule, type ChatMediaModuleOptions } from './chat-media.module';
export {
  ChatMediaStore,
  MediaIntegrityError,
  MediaRangeError,
  MediaTooLargeError,
  displayName,
  type OpenedMedia,
  type StoredMedia,
} from './chat-media.store';
export { MediaTokenService, type MediaTokenPayload } from './media-token.service';
export { LocalDiskMediaStore, isSafeMediaKey } from './local-disk-media.store';
export { chatMediaConfig, type ChatMediaConfig } from './media.config';
export {
  kindOfMime,
  mimeForKey,
  servableMime,
  sniffMediaType,
  type MediaKind,
} from './media-types';
export {
  MEDIA_ACCESS_POLICY,
  MEDIA_OBJECT_GATEWAY,
  MEDIA_UPLOAD_VALIDATOR,
  type ChatMediaAccessPolicy,
  type ChatMediaObjectGateway,
  type ChatMediaUploadValidator,
} from './media.ports';
