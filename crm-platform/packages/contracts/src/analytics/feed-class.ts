import { SOURCE_KIND } from './events';

/**
 * What kind of content a message is, as the Message History's "type" needs it. A message's `kind` column has thirteen values; the history only
 * tells these apart. Stored in `an_events.k1` (append only, like every code in this folder).
 */
export const MESSAGE_KIND_CLASS = {
  text: 1,
  template: 2,
  image: 3,
  video: 4,
  audio: 5,
  document: 6,
  location: 7,
  other: 8,
} as const;

export type MessageKindClass = keyof typeof MESSAGE_KIND_CLASS;

/** The `messages.kind` value to its class: the same mapping as `an_msg_kind_class()` in migration 20270201090000 (a test keeps them equal). */
export function messageKindClass(kind: string): number {
  switch (kind) {
    case 'text':
      return MESSAGE_KIND_CLASS.text;
    case 'template':
      return MESSAGE_KIND_CLASS.template;
    case 'image':
      return MESSAGE_KIND_CLASS.image;
    case 'video':
      return MESSAGE_KIND_CLASS.video;
    case 'audio':
    case 'voice':
      return MESSAGE_KIND_CLASS.audio;
    case 'document':
    case 'sticker':
      return MESSAGE_KIND_CLASS.document;
    case 'location':
      return MESSAGE_KIND_CLASS.location;
    default:
      return MESSAGE_KIND_CLASS.other;
  }
}

const PACK = 16;

/**
 * The third dimension of the MSG_FEED rollup is two small codes in one number: `source * 16 + kind class`. Both are below 16, so the packing
 * is exact; this pair of functions is the only code that knows it.
 */
export function packFeedClass(source: number, kindClass: number): number {
  if (!Number.isInteger(source) || source < 0 || source >= PACK)
    throw new RangeError(`feed source ${source}`);
  if (!Number.isInteger(kindClass) || kindClass < 0 || kindClass >= PACK) {
    throw new RangeError(`feed kind class ${kindClass}`);
  }
  return source * PACK + kindClass;
}

export function unpackFeedClass(feedClass: number): { source: number; kindClass: number } {
  if (!Number.isInteger(feedClass) || feedClass < 0)
    throw new RangeError(`feed class ${feedClass}`);
  return { source: Math.floor(feedClass / PACK), kindClass: feedClass % PACK };
}

/**
 * The Message History's `type` of a feed row, from its event type and feed class: what `messageType()` in message-history.query.ts says for the
 * same message. Automated sources are their own type, then the media kinds, then template, else text.
 */
export function feedType(
  feedClass: number,
):
  | 'auto_reply'
  | 'broadcast'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'template'
  | 'text' {
  const { source, kindClass } = unpackFeedClass(feedClass);
  if (source === SOURCE_KIND.auto_reply) return 'auto_reply';
  if (source === SOURCE_KIND.broadcast) return 'broadcast';
  switch (kindClass) {
    case MESSAGE_KIND_CLASS.image:
      return 'image';
    case MESSAGE_KIND_CLASS.video:
      return 'video';
    case MESSAGE_KIND_CLASS.audio:
      return 'audio';
    case MESSAGE_KIND_CLASS.document:
      return 'document';
    case MESSAGE_KIND_CLASS.location:
      return 'location';
    case MESSAGE_KIND_CLASS.template:
      return 'template';
    default:
      return 'text';
  }
}
