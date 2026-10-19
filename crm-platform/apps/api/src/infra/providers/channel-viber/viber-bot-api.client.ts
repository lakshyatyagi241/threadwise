import { Injectable } from '@nestjs/common';
import {
  VIBER_BROADCAST_MAX,
  VIBER_EVENT_TYPES,
  type ViberAccountInfo,
  type ViberApiFactory,
  type ViberBotApi,
  type ViberBroadcastData,
  type ViberMessage,
  type ViberResult,
  type ViberSendData,
  type ViberSender,
} from './viber.port';
import { tryParseViberJson } from './viber-json';

const BASE = 'https://chatapi.viber.com/pa';
const TIMEOUT_MS = 20_000;

/** One account's calls over plain HTTPS. Auth is a static header (no exchange); every send carries the bot's sender object. */
class BotApiClient implements ViberBotApi {
  constructor(
    private readonly token: string,
    private readonly sender: ViberSender,
  ) {}

  getAccountInfo(): Promise<ViberResult<ViberAccountInfo>> {
    return this.call<ViberAccountInfo>('/get_account_info', {});
  }

  setWebhook(url: string): Promise<ViberResult> {
    return this.call('/set_webhook', {
      url,
      event_types: [...VIBER_EVENT_TYPES],
      send_name: true,
      send_photo: true,
    });
  }

  removeWebhook(): Promise<ViberResult> {
    return this.call('/set_webhook', { url: '' });
  }

  sendMessage(receiver: string, message: ViberMessage): Promise<ViberResult<ViberSendData>> {
    return this.call<ViberSendData>('/send_message', {
      receiver,
      min_api_version: 1,
      sender: this.sender,
      ...message,
    });
  }

  broadcast(
    receivers: readonly string[],
    message: ViberMessage,
  ): Promise<ViberResult<ViberBroadcastData>> {
    return this.call<ViberBroadcastData>('/broadcast_message', {
      min_api_version: 1,
      sender: this.sender,
      broadcast_list: receivers.slice(0, VIBER_BROADCAST_MAX),
      ...message,
    });
  }

  private async call<T>(path: string, body: Record<string, unknown>): Promise<ViberResult<T>> {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-viber-auth-token': this.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      const data = tryParseViberJson(text);
      const record =
        typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
      const status = typeof record.status === 'number' ? record.status : -1;
      const ok = res.ok && status === 0;
      const message = typeof record.status_message === 'string' ? record.status_message : text;
      return {
        ok,
        status,
        data: record as T,
        ...(ok
          ? {}
          : { error: `${status >= 0 ? `${status} ` : ''}${message}`.trim().slice(0, 500) }),
      };
    } catch (err) {
      // The token travels in a header, not the address, but the message is still kept to what a person can act on.
      return {
        ok: false,
        status: -1,
        error: err instanceof Error ? err.message : 'Viber request failed',
      };
    }
  }
}

/** Builds a client for a token. Injected as `VIBER_API`; tests replace `forToken`. */
@Injectable()
export class ViberBotApiFactory implements ViberApiFactory {
  forToken(token: string, sender: ViberSender = { name: 'Bot' }): ViberBotApi {
    return new BotApiClient(token, sender);
  }
}
