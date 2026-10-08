import { GETA_ERROR_MAX_CHARS, type GetaPublishStep } from '@crm/contracts';

/**
 * Pushing a bot live on an external console, behind a port (provider-adapter skill). The flow builder knows only this interface;
 * `GetaConsoleBotPublisher` talks HTTP to the Geta console and `FixtureBotPublisher` is the in-memory stand-in selected by
 * `GETA_PUBLISH_MODE`.
 *
 * Two calls, always in this order: the configuration update first, then publish-bot (publish-bot alone only publishes what the
 * console already has). Both are safe to repeat.
 */
export interface BotConsoleCredentials {
  /** `https://api-core-sandbox.geta.ai`, no trailing path. */
  baseUrl: string;
  /** Sent as the `authorization` header exactly as stored: no `Bearer ` prefix is added. */
  authorization: string;
  /** Sent as the `geta-host` header. */
  getaHost: string;
  /** The console's origin (`https://app-sandbox.geta.ai`): sent as `origin`, and `<origin>/` as `referer`. Null sends neither. */
  origin: string | null;
}

export interface UpdateChatbotConfigurationParams {
  /** The `id` of the chatbot record: the path segment of the call. */
  chatbotId: string;
  /** Sent as `{ "chatbot": <this> }`, untouched. */
  chatbot: Record<string, unknown>;
}

export interface PublishBotParams {
  /** Goes into the `appid` header as `{"botid":"<botId>"}`. */
  botId: string;
}

export interface BotCallResult {
  /** The 2xx status the console answered. */
  status: number;
}

export interface BotPublishPort {
  readonly name: string;
  updateChatbotConfiguration(
    credentials: BotConsoleCredentials,
    params: UpdateChatbotConfigurationParams,
  ): Promise<BotCallResult>;
  publishBot(credentials: BotConsoleCredentials, params: PublishBotParams): Promise<BotCallResult>;
}

export const BOT_PUBLISH_PORT = Symbol('BOT_PUBLISH_PORT');

/**
 * A call that did not end in a 2xx. `message` is already safe to store and show: no header value, no token, a cut response body
 * (see `sanitizeRemoteText`). `retryable` says whether the adapter itself tried again before giving up.
 */
export class BotPublishError extends Error {
  constructor(
    readonly step: GetaPublishStep,
    message: string,
    readonly detail: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'BotPublishError';
  }
}

/** Human name of a step, for error text and logs. */
export const STEP_LABEL: Record<GetaPublishStep, string> = {
  configuration_update: 'configuration update',
  publish_bot: 'publish',
};

/**
 * Makes text from a remote answer or a network error safe to store and show: control characters and runs of whitespace collapse, every
 * known secret is replaced, and the result is cut to `GETA_ERROR_MAX_CHARS` characters.
 */
export function sanitizeRemoteText(
  text: string,
  secrets: ReadonlyArray<string | null | undefined> = [],
  max = GETA_ERROR_MAX_CHARS,
): string {
  let out = text;
  // Longest first, so a secret that contains another is not left half visible.
  const known = secrets
    .filter((s): s is string => typeof s === 'string' && s.length >= 4)
    .sort((a, b) => b.length - a.length);
  const pieces = known.flatMap((s) => s.split(/\s+/).filter((p) => p.length >= 8));
  for (const secret of [...known, ...pieces].sort((a, b) => b.length - a.length))
    out = out.split(secret).join('***');
  out = out
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...out];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : out;
}
