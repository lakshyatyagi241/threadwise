/**
 * Public surface of the channel-whatsapp-cloud domain. The inbox imports the pieces below; nothing else reaches into the folders.
 */
export { WhatsappGlyph } from './components/whatsapp-icon';
export {
  ReconnectBanner,
  TemplatesSoon,
  channelSettingsHref,
} from './components/inbox/reconnect-banner';
export { FailureNote } from './components/inbox/failure-note';
export { MediaStateNote } from './components/inbox/media-state-note';
export { InteractiveChip, ContactCards } from './components/inbox/message-extras';
export { AttachmentHints, useAttachmentError } from './components/inbox/attachment-hints';
export { checkAttachment, acceptAttribute, hasWhatsappLimits, limitHints } from './lib/limits';
export { channelState, sendBlocked } from './lib/status';
export { describeFailure } from './lib/failure';
export { mediaView, anyMediaPending } from './lib/media-state';
