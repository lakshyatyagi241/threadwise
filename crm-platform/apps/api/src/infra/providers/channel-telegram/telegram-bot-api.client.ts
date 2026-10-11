import { Injectable } from '@nestjs/common';
import {
  ALLOWED_UPDATES,
  type MediaKind,
  type MediaSource,
  type SendOptions,
  type SentMessage,
  type TelegramApiFactory,
  type TelegramBotApi,
  type TelegramBotIdentity,
  type TelegramResult,
} from './telegram.port';

const BASE = 'https://api.telegram.org';
const TIMEOUT_MS = 20_000;
export const TEXT_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;

const clip = (s: string, limit: number) => (s.length > limit ? `${s.slice(0, limit - 1)}…` : s);

const METHOD: Record<MediaKind, [method: string, field: string]> = {
  image: ['sendPhoto', 'photo'],
  video: ['sendVideo', 'video'],
  audio: ['sendAudio', 'audio'],
  voice: ['sendVoice', 'voice'],
  document: ['sendDocument', 'document'],
  sticker: ['sendSticker', 'sticker'],
  animation: ['sendAnimation', 'animation'],
  video_note: ['sendVideoNote', 'video_note'],
};
const NO_CAPTION: ReadonlySet<MediaKind> = new Set(['sticker', 'video_note']);

/** One bot's calls over plain HTTPS. The token is in the URL Telegram requires, so errors are scrubbed before they leave. */
class BotApiClient implements TelegramBotApi {
  constructor(private readonly token: string) {}

  getMe(): Promise<TelegramResult<TelegramBotIdentity>> {
    return this.call<TelegramBotIdentity>('getMe');
  }

  setWebhook(url: string, secretToken: string): Promise<TelegramResult> {
    return this.call('setWebhook', {
      url,
      secret_token: secretToken,
      drop_pending_updates: 'true',
      allowed_updates: JSON.stringify(ALLOWED_UPDATES),
    });
  }

  deleteWebhook(): Promise<TelegramResult> {
    return this.call('deleteWebhook', { drop_pending_updates: 'true' });
  }

  async sendMessage(
    chatId: string,
    text: string,
    opts: SendOptions = {},
  ): Promise<TelegramResult<SentMessage>> {
    const base: Record<string, string> = {
      chat_id: chatId,
      text: clip(text, TEXT_LIMIT),
      disable_web_page_preview: 'false',
      ...(opts.replyMarkup ? { reply_markup: JSON.stringify(opts.replyMarkup) } : {}),
    };
    if (!opts.parseMode) return this.call<SentMessage>('sendMessage', base);
    const parsed = await this.call<SentMessage>('sendMessage', {
      ...base,
      parse_mode: opts.parseMode,
    });
    // A mode Telegram cannot parse must not lose the message: send it again as plain text.
    return parsed.ok ? parsed : this.call<SentMessage>('sendMessage', base);
  }

  async sendMedia(
    chatId: string,
    kind: MediaKind,
    source: MediaSource,
    caption: string | null = null,
    opts: SendOptions = {},
  ): Promise<TelegramResult<SentMessage>> {
    const [method, field] = METHOD[kind];
    const params: Record<string, string> = { chat_id: chatId };
    if (caption && !NO_CAPTION.has(kind)) {
      params.caption = clip(caption, CAPTION_LIMIT);
      if (opts.parseMode) params.parse_mode = opts.parseMode;
    }
    if (opts.replyMarkup) params.reply_markup = JSON.stringify(opts.replyMarkup);
    if (kind === 'video') params.supports_streaming = 'true';

    if ('bytes' in source) return this.upload<SentMessage>(method, field, source, params);
    params[field] = 'url' in source ? source.url : source.fileId;
    return this.call<SentMessage>(method, params);
  }

  /** The file goes up with the request: works with no public address for it. */
  private async upload<T>(
    method: string,
    field: string,
    file: { bytes: Uint8Array; filename: string },
    params: Record<string, string>,
  ): Promise<TelegramResult<T>> {
    if (this.token === '') return { ok: false, error: 'No Telegram bot token configured.' };
    try {
      const form = new FormData();
      for (const [k, v] of Object.entries(params)) form.set(k, v);
      form.set(field, new Blob([new Uint8Array(file.bytes)]), file.filename || 'file');
      const res = await fetch(`${BASE}/bot${this.token}/${method}`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        result?: T;
        description?: string;
      } | null;
      if (!body)
        return { ok: false, error: `Telegram returned a non-JSON response (HTTP ${res.status}).` };
      return body.ok === true
        ? { ok: true, result: body.result }
        : { ok: false, error: body.description ?? 'Telegram rejected the upload.' };
    } catch (err) {
      return { ok: false, error: this.scrub(err instanceof Error ? err.message : String(err)) };
    }
  }

  answerCallbackQuery(queryId: string): Promise<TelegramResult> {
    return this.call('answerCallbackQuery', { callback_query_id: queryId });
  }

  answerPreCheckoutQuery(queryId: string, ok: boolean, errorMessage = ''): Promise<TelegramResult> {
    return this.call('answerPreCheckoutQuery', {
      pre_checkout_query_id: queryId,
      ok: String(ok),
      ...(!ok && errorMessage !== '' ? { error_message: errorMessage.slice(0, 255) } : {}),
    });
  }

  async downloadFile(fileId: string): Promise<{ bytes: Uint8Array; extension: string } | null> {
    const file = await this.call<{ file_path?: string }>('getFile', { file_id: fileId });
    const path = file.ok ? (file.result?.file_path ?? '') : '';
    if (path === '') return null;
    try {
      const res = await fetch(`${BASE}/file/bot${this.token}/${path}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const extension = (path.split('.').pop() ?? '').toLowerCase();
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        extension: /^[a-z0-9]{1,5}$/.test(extension) ? extension : 'bin',
      };
    } catch {
      return null;
    }
  }

  async getUserProfilePhoto(userId: string): Promise<string | null> {
    const res = await this.call<{ photos?: Array<Array<{ file_id?: string }>> }>(
      'getUserProfilePhotos',
      { user_id: userId, limit: '1' },
    );
    // result.photos[0] is the sizes of the newest photo, smallest first: take the last.
    const sizes = res.ok ? (res.result?.photos?.[0] ?? []) : [];
    return sizes.at(-1)?.file_id ?? null;
  }

  private async call<T>(
    method: string,
    params: Record<string, string> = {},
  ): Promise<TelegramResult<T>> {
    if (this.token === '') return { ok: false, error: 'No Telegram bot token configured.' };
    try {
      const res = await fetch(`${BASE}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        result?: T;
        description?: string;
      } | null;
      if (!body)
        return { ok: false, error: `Telegram returned a non-JSON response (HTTP ${res.status}).` };
      if (body.ok !== true)
        return { ok: false, error: body.description ?? 'Telegram rejected the request.' };
      return { ok: true, result: body.result };
    } catch (err) {
      return { ok: false, error: this.scrub(err instanceof Error ? err.message : String(err)) };
    }
  }

  private scrub(message: string): string {
    return message.split(this.token).join('***');
  }
}

@Injectable()
export class TelegramBotApiFactory implements TelegramApiFactory {
  forToken(token: string): TelegramBotApi {
    return new BotApiClient(token);
  }
}
