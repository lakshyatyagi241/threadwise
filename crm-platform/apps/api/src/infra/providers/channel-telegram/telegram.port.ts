/**
 * The Telegram Bot API as this app needs it (TW-TG). Every call returns a plain result and never throws: a channel being
 * down is an expected outcome of a send, not an exception. Bound to a token, never to a concrete class, so tests use a fake.
 */

export interface TelegramResult<T = unknown> {
  ok: boolean;
  result?: T;
  /** Telegram's own description, or the transport error. Never contains the token. */
  error?: string;
}

export interface TelegramBotIdentity {
  id: number;
  username?: string;
  first_name?: string;
}

export type MediaKind =
  'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker' | 'animation' | 'video_note';

/** Where a media message gets its file: a public address, Telegram's own file id, or the bytes themselves. */
export type MediaSource =
  { url: string } | { fileId: string } | { bytes: Uint8Array; filename: string };

export interface SendOptions {
  /** `Markdown`, `HTML` or empty. Off by default; when Telegram rejects a mode the text is sent again unparsed. */
  parseMode?: string;
  /** A keyboard, already built (see `templateButtonsMarkup`). */
  replyMarkup?: object | null;
}

export interface SentMessage {
  message_id: number;
  /** Photos come back as sizes, smallest first: the last is the one to reuse. */
  photo?: Array<{ file_id: string }>;
  [media: string]: unknown;
}

export interface TelegramBotApi {
  /** Identifies the bot behind a token: validates the token on connect. */
  getMe(): Promise<TelegramResult<TelegramBotIdentity>>;
  /** Points the bot at this install. Drops the pending backlog so a reconnect does not replay old updates. */
  setWebhook(url: string, secretToken: string): Promise<TelegramResult>;
  deleteWebhook(): Promise<TelegramResult>;
  /** Text, cut to 4096 characters. */
  sendMessage(
    chatId: string,
    text: string,
    opts?: SendOptions,
  ): Promise<TelegramResult<SentMessage>>;
  /** A file with an optional caption (cut to 1024; stickers and video notes take none). */
  sendMedia(
    chatId: string,
    kind: MediaKind,
    source: MediaSource,
    caption?: string | null,
    opts?: SendOptions,
  ): Promise<TelegramResult<SentMessage>>;
  /** Stops the spinner on an inline-button tap; Telegram requires it. */
  answerCallbackQuery(queryId: string): Promise<TelegramResult>;
  /** Approves (or declines with a reason) a payment before Telegram's 10 second limit. */
  answerPreCheckoutQuery(
    queryId: string,
    ok: boolean,
    errorMessage?: string,
  ): Promise<TelegramResult>;
  /** The bytes of a file Telegram holds, or null on any failure. The tokened download URL never leaves the adapter. */
  downloadFile(fileId: string): Promise<{ bytes: Uint8Array; extension: string } | null>;
  /** The largest profile photo's file id for a user, or null when none or hidden by privacy. */
  getUserProfilePhoto(userId: string): Promise<string | null>;
}

export interface TelegramApiFactory {
  forToken(token: string): TelegramBotApi;
}
export const TELEGRAM_API = Symbol('TELEGRAM_API');

/** The updates the webhook asks for (TW-TG-002 rule 5). */
export const ALLOWED_UPDATES = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'callback_query',
  'poll_answer',
  'message_reaction',
  'pre_checkout_query',
  'chat_join_request',
] as const;
