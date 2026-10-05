import type { GetaPublishStep } from '@crm/contracts';
import { guardedRequest } from '../../net/guarded-http';
import {
  BotPublishError,
  STEP_LABEL,
  sanitizeRemoteText,
  type BotCallResult,
  type BotConsoleCredentials,
  type BotPublishPort,
  type PublishBotParams,
  type UpdateChatbotConfigurationParams,
} from './bot-publish.port';

export interface GetaConsoleOptions {
  /** Per request. */
  timeoutMs: number;
  /** Total tries per call (1 = never retry). */
  maxAttempts: number;
  /** First backoff; doubles per try. */
  backoffMs: number;
  /** Lets the base URL be a private or loopback address (a local stub). */
  allowPrivate: boolean;
  /** Replaceable in tests; the default waits for real. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_RETRY_AFTER_MS = 5_000;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** What `Retry-After` asks for, in milliseconds, when it is a small number of seconds. */
function retryAfterMs(header: string | string[] | undefined): number | null {
  const raw = Array.isArray(header) ? header[0] : header;
  const secs = raw ? Number(raw) : NaN;
  return Number.isFinite(secs) && secs >= 0 ? Math.min(secs * 1000, MAX_RETRY_AFTER_MS) : null;
}

/** The exact `appid` header value: a JSON string with a single `botid` key. */
export const appIdHeader = (botId: string): string => JSON.stringify({ botid: botId });

/**
 * The HTTP adapter for the Geta console. It sends exactly:
 *
 *   PUT  {baseUrl}/api/v1/chatbot/{chatbotId}/configuration/update/   body {"chatbot": {...}}
 *   POST {baseUrl}/api/v1/console/publish-bot                         body {}        header appid: {"botid":"<bot id>"}
 *
 * with `accept: application/json`, `content-type: application/json;charset=UTF-8`, `authorization` and `geta-host` as given (no
 * `Bearer ` is added) and, when an origin is configured, `origin` and `referer`. A network error, a timeout, a 429 or a 5xx is tried
 * again with exponential backoff; any other answer is final. Redirects are never followed. Secrets are never logged, put in an
 * error or returned: an error carries the status and a cut, sanitised excerpt of the response body.
 */
export class GetaConsoleBotPublisher implements BotPublishPort {
  readonly name = 'geta-console';
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: GetaConsoleOptions) {
    this.sleep = options.sleep ?? wait;
  }

  updateChatbotConfiguration(
    credentials: BotConsoleCredentials,
    params: UpdateChatbotConfigurationParams,
  ): Promise<BotCallResult> {
    return this.call(
      'configuration_update',
      credentials,
      'PUT',
      `/api/v1/chatbot/${encodeURIComponent(params.chatbotId)}/configuration/update/`,
      JSON.stringify({ chatbot: params.chatbot }),
      {},
    );
  }

  publishBot(credentials: BotConsoleCredentials, params: PublishBotParams): Promise<BotCallResult> {
    return this.call('publish_bot', credentials, 'POST', '/api/v1/console/publish-bot', '{}', {
      appid: appIdHeader(params.botId),
    });
  }

  private async call(
    step: GetaPublishStep,
    c: BotConsoleCredentials,
    method: 'PUT' | 'POST',
    path: string,
    body: string,
    extra: Record<string, string>,
  ): Promise<BotCallResult> {
    const secrets = [c.authorization, c.getaHost];
    const fail = (why: string, status?: number, retryable = false): BotPublishError =>
      new BotPublishError(step, `${why} (${STEP_LABEL[step]})`, { status, retryable });
    let url: URL;
    try {
      url = new URL(`${c.baseUrl.replace(/\/+$/, '')}${path}`);
    } catch {
      throw fail('The Geta base URL is not a valid URL');
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json;charset=UTF-8',
      ...extra,
      authorization: c.authorization,
      'geta-host': c.getaHost,
    };
    if (c.origin) {
      headers.origin = c.origin;
      headers.referer = `${c.origin.replace(/\/+$/, '')}/`;
    }

    let last: BotPublishError | null = null;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      let pause = this.options.backoffMs * 2 ** (attempt - 1);
      try {
        const res = await guardedRequest({
          method,
          url,
          headers,
          body,
          timeoutMs: this.options.timeoutMs,
          allowPrivate: this.options.allowPrivate,
          maxBytes: MAX_RESPONSE_BYTES,
        });
        if (res.status >= 200 && res.status < 300) return { status: res.status };
        const excerpt = sanitizeRemoteText(res.body, secrets);
        const retryable = res.status === 429 || res.status >= 500;
        last = fail(
          `Geta answered ${res.status}${excerpt ? `: ${excerpt}` : ''}`,
          res.status,
          retryable,
        );
        if (!retryable) throw last;
        pause = retryAfterMs(res.headers['retry-after']) ?? pause;
      } catch (err) {
        if (err instanceof BotPublishError) {
          if (!err.detail.retryable) throw err;
        } else {
          const why = err instanceof Error ? err.message : String(err);
          last = fail(
            `Could not reach Geta: ${sanitizeRemoteText(why, secrets, 120)}`,
            undefined,
            true,
          );
        }
      }
      if (attempt < this.options.maxAttempts) await this.sleep(pause);
    }
    throw last ?? fail('Geta did not answer');
  }
}
