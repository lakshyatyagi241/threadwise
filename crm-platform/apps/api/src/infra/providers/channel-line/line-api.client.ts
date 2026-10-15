import { Injectable } from '@nestjs/common';
import type {
  LineApi,
  LineApiFactory,
  LineBotInfo,
  LineIssuedToken,
  LineMessage,
  LineProfile,
  LineResult,
  LineSent,
} from './line.port';

const BASE = 'https://api.line.me';
const DATA_BASE = 'https://api-data.line.me';
const TIMEOUT_MS = 20_000;
const CONTENT_TIMEOUT_MS = 30_000;
/** LINE accepts at most five message objects per send. */
const MAX_MESSAGES = 5;

const messageOf = (body: unknown, fallback: string): string => {
  if (typeof body === 'object' && body !== null) {
    const m = (body as { message?: unknown; error_description?: unknown }).message;
    if (typeof m === 'string' && m !== '') return m;
    const d = (body as { error_description?: unknown }).error_description;
    if (typeof d === 'string' && d !== '') return d;
  }
  return fallback;
};

/** One call over plain HTTPS with the token as a Bearer header. Never throws. */
async function call<T>(
  token: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<LineResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (res.ok) return { ok: true, status: res.status, data: (parsed ?? {}) as T };
    return {
      ok: false,
      status: res.status,
      error: messageOf(parsed, text || `HTTP ${res.status}`),
    };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One channel's calls. */
class LineClient implements LineApi {
  constructor(private readonly token: string) {}

  botInfo(): Promise<LineResult<LineBotInfo>> {
    return call<LineBotInfo>(this.token, 'GET', '/v2/bot/info');
  }

  setWebhookEndpoint(url: string): Promise<LineResult> {
    return call(this.token, 'PUT', '/v2/bot/channel/webhook/endpoint', { endpoint: url });
  }

  reply(replyToken: string, messages: readonly LineMessage[]): Promise<LineResult<LineSent>> {
    return call<LineSent>(this.token, 'POST', '/v2/bot/message/reply', {
      replyToken,
      messages: messages.slice(0, MAX_MESSAGES),
    });
  }

  push(to: string, messages: readonly LineMessage[]): Promise<LineResult<LineSent>> {
    return call<LineSent>(this.token, 'POST', '/v2/bot/message/push', {
      to,
      messages: messages.slice(0, MAX_MESSAGES),
    });
  }

  getProfile(userId: string): Promise<LineResult<LineProfile>> {
    return call<LineProfile>(this.token, 'GET', `/v2/bot/profile/${encodeURIComponent(userId)}`);
  }

  async getMessageContent(messageId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
    try {
      const res = await fetch(
        `${DATA_BASE}/v2/bot/message/${encodeURIComponent(messageId)}/content`,
        {
          headers: { authorization: `Bearer ${this.token}` },
          signal: AbortSignal.timeout(CONTENT_TIMEOUT_MS),
        },
      );
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0) return null;
      return {
        bytes,
        mime: res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }
}

/** The LINE Messaging API over HTTPS, bound to `LINE_API`. */
@Injectable()
export class LineApiFactoryImpl implements LineApiFactory {
  forToken(token: string): LineApi {
    return new LineClient(token);
  }

  async issueRotatingToken(assertionJwt: string): Promise<LineResult<LineIssuedToken>> {
    try {
      const res = await fetch(`${BASE}/oauth2/v2.1/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: assertionJwt,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
      } catch {
        body = {};
      }
      const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
      if (res.ok && accessToken !== '') {
        return {
          ok: true,
          status: res.status,
          data: {
            accessToken,
            keyId: typeof body.key_id === 'string' ? body.key_id : '',
            expiresIn: Number(body.expires_in) || 0,
          },
        };
      }
      return {
        ok: false,
        status: res.status,
        error: messageOf(body, text || `HTTP ${res.status}`),
      };
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
