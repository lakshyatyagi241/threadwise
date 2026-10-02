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
