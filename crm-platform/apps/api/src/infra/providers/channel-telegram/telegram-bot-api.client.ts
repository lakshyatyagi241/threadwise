import { Injectable } from '@nestjs/common';
import {
  ALLOWED_UPDATES,
  type TelegramApiFactory,
  type TelegramBotApi,
  type TelegramBotIdentity,
  type TelegramResult,
} from './telegram.port';

const BASE = 'https://api.telegram.org';
const TIMEOUT_MS = 20_000;

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
