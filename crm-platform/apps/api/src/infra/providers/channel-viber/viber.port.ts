/**
 * The Viber REST Bot API as this app needs it (TW-VIB). Every call returns a plain result and never throws: a channel being down is
 * an expected outcome of a send, not an exception. Bound to a token, never to a concrete class, so tests use a fake.
 */

export interface ViberResult<T = unknown> {
  /** Viber's own success marker is the body's `status` being 0 on an HTTP success. */
  ok: boolean;
  /** Viber's `status` code; -1 when there was no answer. */
  status: number;
  data?: T;
  /** Viber's `status_message` (with its code), or the transport error. Never contains the token. */
  error?: string;
}

export interface ViberAccountInfo {
  id?: string;
  name?: string;
  uri?: string;
  icon?: string;
}

/** The bot identity every send carries. */
export interface ViberSender {
  name: string;
  avatar?: string;
}

/** One Viber message object (`type`, `text`, `media`, `keyboard`...), built by `viber-message.ts`. */
export type ViberMessage = Record<string, unknown>;

export interface ViberSendData {
  /** Viber's id of the message; kept as text (it is a 64 bit number). */
  message_token?: string;
}

export interface ViberBroadcastData extends ViberSendData {
  /** The receivers Viber could not reach, with why. */
  failed_list?: Array<{ receiver?: string; status?: number; status_message?: string }>;
}

export interface ViberBotApi {
  /** Identifies the account behind a token: validates the token on connect. */
  getAccountInfo(): Promise<ViberResult<ViberAccountInfo>>;
  /** Points the account at this install. Viber pings the address once to check it. */
  setWebhook(url: string): Promise<ViberResult>;
  /** Removes the webhook (an empty address). */
  removeWebhook(): Promise<ViberResult>;
  /** One message to one subscribed user. */
  sendMessage(receiver: string, message: ViberMessage): Promise<ViberResult<ViberSendData>>;
  /** One message to up to 300 subscribed users in a single call. */
  broadcast(
    receivers: readonly string[],
    message: ViberMessage,
  ): Promise<ViberResult<ViberBroadcastData>>;
}

export interface ViberApiFactory {
  forToken(token: string, sender?: ViberSender): ViberBotApi;
}
export const VIBER_API = Symbol('VIBER_API');

/** The events the webhook asks for (Reference's list). */
export const VIBER_EVENT_TYPES = [
  'message',
  'subscribed',
  'unsubscribed',
  'conversation_started',
  'delivered',
  'seen',
  'failed',
] as const;

/** Viber's per-call cap for `broadcast_message`. */
export const VIBER_BROADCAST_MAX = 300;
