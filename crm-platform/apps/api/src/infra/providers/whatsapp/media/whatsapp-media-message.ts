import type { PreparedWhatsappMedia } from './outbound-media-uploader.port';
import type { WaMediaKind } from './whatsapp-media-rules';

/** Kinds whose Graph object takes a `caption`. Audio and stickers refuse one (Meta answers with an error), so it is left out. */
const CAPTION_KINDS: ReadonlySet<WaMediaKind> = new Set(['image', 'video', 'document']);

/**
 * The media part of a Graph `messages` payload for a prepared file: `{ type, [type]: { id | link, caption?, filename? } }` (`id` when
 * the file was uploaded to the provider, `link` when the provider fetches it itself). The caller adds
 * `messaging_product`, `recipient_type`, `to` and `context` (a reply). The caption is dropped for kinds that cannot carry one; the
 * file name is set for documents only (it is what the recipient sees on the file).
 */
export function whatsappMediaMessage(
  prepared: PreparedWhatsappMedia,
  caption?: string | null,
): Record<string, unknown> {
  const text = caption?.trim();
  return {
    type: prepared.kind,
    [prepared.kind]: {
      ...(prepared.via === 'id' ? { id: prepared.mediaId } : { link: prepared.link }),
      ...(text && CAPTION_KINDS.has(prepared.kind) ? { caption: text } : {}),
      ...(prepared.kind === 'document' && prepared.filename ? { filename: prepared.filename } : {}),
    },
  };
}
