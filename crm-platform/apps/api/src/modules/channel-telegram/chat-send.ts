import {
  type MediaKind,
  type MediaSource,
  type SentMessage,
  type TelegramBotApi,
  type TelegramResult,
} from '../../infra/providers/channel-telegram/telegram.port';

/** One message to one chat, however it is built (WD-TG-008, 013): the part an inbox reply and a broadcast share. */

export interface Outcome {
  ok: boolean;
  providerMessageId: string | null;
  /** Telegram's id for the file just sent; reuse it so the file is uploaded once, not once per recipient. */
  fileId: string | null;
  error: string | null;
}

export interface ChatMessage {
  text: string;
  media?: { kind: MediaKind; source: MediaSource } | null;
  markup?: object | null;
  parseMode?: string;
}

/** A caption holds 1024 characters against 4096 for text: the rest of a longer message follows as its own text message. */
export const CAPTION_LIMIT = 1024;

const FIELD: Partial<Record<MediaKind, string>> = {
  video: 'video',
  audio: 'audio',
  voice: 'voice',
  document: 'document',
  sticker: 'sticker',
  animation: 'animation',
  video_note: 'video_note',
};

/**
 * Telegram's id for what was just uploaded. A photo comes back as several sizes, smallest first, so the last is the one to
 * reuse: the first would send everyone after the first recipient a thumbnail.
 */
export function fileIdFrom(sent: SentMessage | undefined, kind: MediaKind): string | null {
  if (!sent) return null;
  if (kind === 'image') return sent.photo?.at(-1)?.file_id ?? null;
  const field = FIELD[kind];
  const media = field ? (sent[field] as { file_id?: unknown } | undefined) : undefined;
  return typeof media?.file_id === 'string' && media.file_id !== '' ? media.file_id : null;
}

const outcome = (res: TelegramResult<SentMessage>, kind: MediaKind | null): Outcome => ({
  ok: res.ok,
  providerMessageId: res.ok && res.result ? String(res.result.message_id) : null,
  fileId: res.ok && kind ? fileIdFrom(res.result, kind) : null,
  error: res.ok ? null : (res.error ?? 'Telegram rejected the send.'),
});

export async function sendToChat(
  api: TelegramBotApi,
  chatId: string,
  m: ChatMessage,
): Promise<Outcome> {
  const opts = { parseMode: m.parseMode, replyMarkup: m.markup ?? null };
  if (!m.media) return outcome(await api.sendMessage(chatId, m.text, opts), null);

  const caption = m.text !== '' ? m.text : null;
  const res = await api.sendMedia(chatId, m.media.kind, m.media.source, caption, opts);
  const out = outcome(res, m.media.kind);
  if (out.ok && m.text.length > CAPTION_LIMIT) {
    // Telegram would silently cut the tail of a long caption; send the rest rather than lose the end of the message.
    await api.sendMessage(chatId, m.text.slice(CAPTION_LIMIT - 1));
  }
  return out;
}
