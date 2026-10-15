/**
 * The WeChat Official Account API as this app needs it (WECH). Every call returns a plain result and never throws: a channel being
 * down is an expected outcome of a send, not an exception. Bound to the token `WECHAT_API`, never to a concrete class, so tests use
 * a fake. The access token is passed in: keeping it fresh is the channel's job (it is shared per account and refreshing it
 * invalidates the previous one), not the transport's.
 */

export interface WechatResult<T = Record<string, unknown>> {
  ok: boolean;
  /** WeChat's JSON answer (empty on a transport failure). */
  data: T;
  /** WeChat's `errcode` when it refused; null on success or a transport failure. */
  errcode: number | null;
  /** `<errcode> <errmsg>` or the transport error. Never contains a token or the AppSecret. */
  error: string | null;
}

/** `errcode`s that mean the access token is invalid or expired: refresh it once and try again. */
export const TOKEN_ERRCODES: readonly number[] = [40001, 42001, 40014];

/** WeChat's text ceiling for one message, in characters. */
export const WECHAT_TEXT_LIMIT = 2048;

export type WechatMessage =
  | { msgtype: 'text'; text: { content: string } }
  | { msgtype: 'image'; image: { media_id: string } }
  | { msgtype: 'voice'; voice: { media_id: string } }
  | {
      msgtype: 'video';
      video: { media_id: string; thumb_media_id: string; title?: string; description?: string };
    };

export type WechatUploadType = 'image' | 'voice' | 'video' | 'thumb';

export interface WechatUserInfo {
  subscribe?: number;
  openid?: string;
  nickname?: string;
  headimgurl?: string;
}

export interface WechatAccessToken {
  accessToken: string;
  /** Seconds; WeChat issues 7200. */
  expiresIn: number;
}

export interface WechatApi {
  /** Proves the AppID and AppSecret (and gives the first token). The secret is in WeChat's query string, so errors are scrubbed. */
  fetchAccessToken(appId: string, appSecret: string): Promise<WechatResult<WechatAccessToken>>;
  /** A customer-service message to one follower (only within 48 hours of their last message). */
  sendCustomMessage(
    token: string,
    openid: string,
    message: WechatMessage,
  ): Promise<WechatResult<Record<string, unknown>>>;
  /** A Template Message: the way to reach a follower outside the 48 hour window. `data` is `{ keyword1: { value } , ... }`. */
  sendTemplate(
    token: string,
    openid: string,
    templateId: string,
    data: Record<string, { value: string; color?: string }>,
    url?: string,
  ): Promise<WechatResult<{ msgid?: number | string }>>;
  /** One mass send to a list of at least two OpenIDs. `clientMsgId` makes a repeated call a no-op on WeChat's side. */
  massSend(
    token: string,
    openids: readonly string[],
    message: WechatMessage,
    clientMsgId?: string,
  ): Promise<WechatResult<{ msg_id?: number | string }>>;
  /** One mass send to every follower (`is_to_all`) or to a tag (`tag_id`). */
  massSendAll(
    token: string,
    filter: { is_to_all: true } | { is_to_all: false; tag_id: number },
    message: WechatMessage,
    clientMsgId?: string,
  ): Promise<WechatResult<{ msg_id?: number | string }>>;
  getUserInfo(token: string, openid: string): Promise<WechatResult<WechatUserInfo>>;
  /** A temporary media id (valid about three days) for a file we send. */
  uploadMedia(
    token: string,
    type: WechatUploadType,
    bytes: Uint8Array,
    filename: string,
  ): Promise<WechatResult<{ media_id?: string }>>;
  /** The bytes of a file a follower sent, or null (WeChat answers JSON on an error). */
  getMedia(token: string, mediaId: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
}
export const WECHAT_API = Symbol('WECHAT_API');
