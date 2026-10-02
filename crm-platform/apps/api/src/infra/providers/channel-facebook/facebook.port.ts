/**
 * The Facebook Graph API as this app needs it (WD-FB). Every call returns a plain result and never throws: Meta being down or
 * refusing a send is an expected outcome, not an exception. Bound to a token, never to a concrete class, so tests use a fake.
 */

export interface GraphResult<T = unknown> {
  ok: boolean;
  data?: T;
  /** Meta's own message, or the transport error. Never contains a token (they travel in a header). */
  error?: string;
  /** Meta's error code; 190 means the token is revoked, expired or the password changed. */
  code?: number;
}

/** The Page row Meta returns from `/me/accounts` and `/me` of a Page token. */
export interface GraphPage {
  id: string;
  name?: string;
  category?: string;
  username?: string;
  fan_count?: number;
  followers_count?: number;
  tasks?: string[];
  /** Present on `/me/accounts` only: the Page's own token. */
  access_token?: string;
  picture?: { data?: { url?: string } };
}

export interface TokenDebug {
  is_valid?: boolean;
  scopes?: string[];
  data_access_expires_at?: number;
  expires_at?: number;
}

export interface GraphConversation {
  id: string;
  participants?: { data?: Array<{ id?: string }> };
  updated_time?: string;
}

export interface GraphMessage {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id?: string };
  attachments?: {
    data?: Array<{
      mime_type?: string;
      file_url?: string;
      image_data?: { url?: string };
      video_data?: { url?: string };
    }>;
  };
}

export interface GraphSenderProfile {
  name?: string;
  first_name?: string;
  last_name?: string;
  profile_pic?: string;
}

export interface GraphComment {
  id?: string;
  message?: string;
  from?: { id?: string; name?: string };
}

export type AttachmentType = 'image' | 'video' | 'audio' | 'file';

/** A button as Messenger's Send API takes it (a template message carries at most three). */
export type MessengerButton =
  | { type: 'web_url'; title: string; url: string }
  | { type: 'phone_number'; title: string; payload: string }
  | { type: 'postback'; title: string; payload: string };

/** What the Meta app resolves to on this install (the Facebook override, else the WhatsApp app's values). */
export interface MetaAppSettings {
  appId: string | null;
  appSecret: string | null;
  configId: string | null;
  graphVersion: string;
  verifyToken: string | null;
  /** Every secret a webhook may be signed with: the Facebook one and the WhatsApp one, without duplicates. */
  signingSecrets: string[];
}

/** Calls made with the app's own credentials, before any Page exists. */
export interface FacebookAppApi {
  /** A short-lived user token. The popup exchanges without a redirect address (pass an empty string). */
  exchangeCode(code: string, redirectUri: string): Promise<GraphResult<{ accessToken: string }>>;
  /** Short to long-lived user token. Must run BEFORE `listPages`, or the derived Page tokens expire. */
  extendUserToken(token: string): Promise<GraphResult<{ accessToken: string }>>;
  /** Every Page the user manages, each with its own token; follows Meta's paging. */
  listPages(userToken: string): Promise<GraphPage[]>;
  /** A pasted Page token resolves through `/me` to the Page itself. */
  pageFromToken(pageToken: string): Promise<GraphPage | null>;
  /** Validity, granted scopes and the data-access expiry of any token; `null` when the check could not run. */
  debugToken(token: string): Promise<TokenDebug | null>;
}

/** Calls made as one Page, with its token. */
export interface FacebookPageApi {
  getProfile(): Promise<GraphResult<GraphPage>>;
  /** Binds the Page to this app's webhook for messages, postbacks and the feed. */
  subscribeWebhooks(): Promise<GraphResult>;
  unsubscribeWebhooks(): Promise<GraphResult>;
  /** Text to a PSID inside the 24 hour window (`messaging_type = RESPONSE`), cut to 2000. */
  sendText(psid: string, text: string): Promise<GraphResult<{ messageId: string }>>;
  sendAttachment(
    psid: string,
    type: AttachmentType,
    url: string,
  ): Promise<GraphResult<{ messageId: string }>>;
  /** Text with up to three buttons as a button template, inside the 24 hour window. The text is cut to 640. */
  sendButtonTemplate(
    psid: string,
    text: string,
    buttons: readonly MessengerButton[],
  ): Promise<GraphResult<{ messageId: string }>>;
  /** A public reply under a comment (or a post) as the Page. */
  replyComment(objectId: string, text: string): Promise<GraphResult<{ id: string }>>;
  getSenderProfile(psid: string): Promise<GraphSenderProfile | null>;
  getComment(commentId: string): Promise<GraphComment | null>;
  listConversations(limit: number): Promise<GraphConversation[]>;
  getConversationMessages(conversationId: string, limit: number): Promise<GraphMessage[]>;
}

export interface FacebookGraphFactory {
  readonly settings: MetaAppSettings;
  app(): FacebookAppApi;
  forPage(token: string, pageId: string): FacebookPageApi;
}
export const FACEBOOK_GRAPH = Symbol('FACEBOOK_GRAPH');

/** The permissions requested at login (WD-FB-002). */
export const FB_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'pages_read_user_content',
  'pages_manage_metadata',
  'pages_messaging',
  'read_insights',
  'business_management',
] as const;

/** The Page webhook fields the subscription asks for (WD-FB-003). */
export const FB_SUBSCRIBED_FIELDS =
  'feed,mention,messages,messaging_postbacks,message_reactions,messaging_optins,messaging_referrals';
