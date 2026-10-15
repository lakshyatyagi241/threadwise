/**
 * The LINE Messaging API as this app needs it (LINE channel). Every call returns a plain result and never throws: a channel being
 * down is an expected outcome of a send, not an exception. Bound to a token, never to a concrete class, so tests use a fake.
 */

export interface LineResult<T = unknown> {
  ok: boolean;
  /** The HTTP status, 0 when the request never got an answer. */
  status: number;
  data?: T;
  /** LINE's own message, or the transport error. Never contains a token. */
  error?: string;
}

/** `GET /v2/bot/info`: who the token belongs to. */
export interface LineBotInfo {
  /** The bot's user id (starts with `U`). */
  userId?: string;
  basicId?: string;
  displayName?: string;
  pictureUrl?: string;
}

/** `GET /v2/bot/profile/{userId}`. */
export interface LineProfile {
  displayName?: string;
  pictureUrl?: string;
}

/** A LINE message object (text, image, video, audio, template), already built. At most five go in one send. */
export type LineMessage = Record<string, unknown>;

/** `sentMessages` of a reply or push: LINE's id for each message object. */
export interface LineSent {
  sentMessages?: Array<{ id?: string }>;
}

export interface LineApi {
  /** Identifies the account behind a token: validates the token on connect. */
  botInfo(): Promise<LineResult<LineBotInfo>>;
  /** Points the channel at this install. */
  setWebhookEndpoint(url: string): Promise<LineResult>;
  /** Reply (free): needs a fresh single-use reply token, valid for about a minute. */
  reply(replyToken: string, messages: readonly LineMessage[]): Promise<LineResult<LineSent>>;
  /** Push (billable): to one user id, any time, up to five message objects. */
  push(to: string, messages: readonly LineMessage[]): Promise<LineResult<LineSent>>;
  getProfile(userId: string): Promise<LineResult<LineProfile>>;
  /** The bytes of a file a user sent (LINE keeps them briefly), or null on any failure. */
  getMessageContent(messageId: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
}

/** The v2.1 channel access token LINE issues for a signed assertion. */
export interface LineIssuedToken {
  accessToken: string;
  keyId: string;
  /** Seconds. */
  expiresIn: number;
}

export interface LineApiFactory {
  forToken(token: string): LineApi;
  /** `POST /oauth2/v2.1/token` with a signed JWT assertion (token rotation). */
  issueRotatingToken(assertionJwt: string): Promise<LineResult<LineIssuedToken>>;
}
export const LINE_API = Symbol('LINE_API');
