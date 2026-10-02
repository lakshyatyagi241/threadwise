import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import {
  FB_SUBSCRIBED_FIELDS,
  type AttachmentType,
  type FacebookAppApi,
  type FacebookGraphFactory,
  type FacebookPageApi,
  type GraphComment,
  type GraphConversation,
  type GraphMessage,
  type GraphPage,
  type GraphResult,
  type GraphSenderProfile,
  type MessengerButton,
  type MetaAppSettings,
  type TokenDebug,
} from './facebook.port';

const HOST = 'https://graph.facebook.com';
const TIMEOUT_MS = 20_000;
/** Meta caps a Messenger text at 2000 characters. */
export const TEXT_LIMIT = 2000;
const COMMENT_LIMIT = 8000;
/** Meta cuts a button template's text at 640 characters. */
const BUTTON_TEXT_LIMIT = 640;
/** `/me/accounts` is followed at most this many pages of 100 (Reference's guard). */
const MAX_PAGES = 10;

type Json = Record<string, unknown>;

const obj = (x: unknown): Json => (typeof x === 'object' && x !== null ? (x as Json) : {});
const str = (x: unknown): string | undefined =>
  typeof x === 'string' || typeof x === 'number' ? String(x) : undefined;

/** One request to the Graph. Tokens go in the Authorization header, never in the URL, so no error text can carry one. */
async function call(
  version: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  o: {
    token?: string;
    query?: Record<string, string>;
    json?: Json;
    form?: Record<string, string>;
  } = {},
): Promise<GraphResult<Json>> {
  const url = new URL(path.startsWith('http') ? path : `${HOST}/${version}/${path}`);
  for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  let body: string | undefined;
  if (o.json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(o.json);
  } else if (o.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(o.form).toString();
  }
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const parsed = obj(await res.json().catch(() => ({})));
    if (res.ok) return { ok: true, data: parsed };
    const err = obj(parsed.error);
    return {
      ok: false,
      error: str(err.message) ?? `Facebook answered ${res.status}`,
      code: typeof err.code === 'number' ? err.code : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Facebook could not be reached' };
  }
}

const clip = (s: string, n: number) => s.slice(0, n);

class AppApi implements FacebookAppApi {
  constructor(private readonly s: MetaAppSettings) {}

  async exchangeCode(code: string, redirectUri: string) {
    if (!this.s.appId || !this.s.appSecret || code === '') {
      return { ok: false, error: 'Facebook Meta app credentials are not configured.' };
    }
    const r = await call(this.s.graphVersion, 'GET', 'oauth/access_token', {
      query: {
        client_id: this.s.appId,
        client_secret: this.s.appSecret,
        code,
        ...(redirectUri !== '' ? { redirect_uri: redirectUri } : {}),
      },
    });
    const token = str(r.data?.access_token);
    return r.ok && token
      ? { ok: true, data: { accessToken: token } }
      : { ok: false, error: r.error ?? 'token exchange failed', code: r.code };
  }

  async extendUserToken(token: string) {
    if (!this.s.appId || !this.s.appSecret || token === '') {
      return { ok: false, error: 'missing app credentials or token' };
    }
    const r = await call(this.s.graphVersion, 'GET', 'oauth/access_token', {
      query: {
        grant_type: 'fb_exchange_token',
        client_id: this.s.appId,
        client_secret: this.s.appSecret,
        fb_exchange_token: token,
      },
    });
    const long = str(r.data?.access_token);
    return r.ok && long
      ? { ok: true, data: { accessToken: long } }
      : { ok: false, error: r.error ?? 'long-lived exchange failed', code: r.code };
  }

  async listPages(userToken: string): Promise<GraphPage[]> {
    if (userToken === '') return [];
    const out: GraphPage[] = [];
    let next: string | null = `${HOST}/${this.s.graphVersion}/me/accounts`;
    let query: Record<string, string> | undefined = {
      fields: 'id,name,category,access_token,tasks,fan_count,username,picture.type(large){url}',
      limit: '100',
    };
    for (let guard = 0; guard < MAX_PAGES && next; guard++) {
      const r = await call(this.s.graphVersion, 'GET', next, { token: userToken, query });
      if (!r.ok) break;
      const rows = r.data?.data;
      if (Array.isArray(rows)) out.push(...(rows as GraphPage[]));
      next = str(obj(r.data?.paging).next) ?? null;
      query = undefined; // the `next` address already carries its query string
    }
    return out;
  }

  async pageFromToken(pageToken: string): Promise<GraphPage | null> {
    if (pageToken === '') return null;
    const r = await call(this.s.graphVersion, 'GET', 'me', {
      token: pageToken,
      query: { fields: 'id,name,category,username,fan_count,tasks,picture.type(large){url}' },
    });
    return r.ok && r.data?.id ? (r.data as unknown as GraphPage) : null;
  }

  async debugToken(token: string): Promise<TokenDebug | null> {
    if (token === '' || !this.s.appId || !this.s.appSecret) return null;
    const r = await call(this.s.graphVersion, 'GET', 'debug_token', {
      query: { input_token: token, access_token: `${this.s.appId}|${this.s.appSecret}` },
    });
    return r.ok ? (obj(r.data?.data) as TokenDebug) : null;
  }
}

class PageApi implements FacebookPageApi {
  constructor(
    private readonly version: string,
    private readonly token: string,
    private readonly pageId: string,
  ) {}

  private get(path: string, query: Record<string, string> = {}) {
    return call(this.version, 'GET', path, { token: this.token, query });
  }

  async getProfile(): Promise<GraphResult<GraphPage>> {
    const r = await this.get(this.pageId, {
      fields: 'id,name,category,username,fan_count,followers_count,picture.type(large){url}',
    });
    return r.ok
      ? { ok: true, data: r.data as unknown as GraphPage }
      : { ok: false, error: r.error, code: r.code };
  }

  subscribeWebhooks(): Promise<GraphResult> {
    return call(this.version, 'POST', `${this.pageId}/subscribed_apps`, {
      token: this.token,
      form: { subscribed_fields: FB_SUBSCRIBED_FIELDS },
    });
  }

  unsubscribeWebhooks(): Promise<GraphResult> {
    return call(this.version, 'DELETE', `${this.pageId}/subscribed_apps`, { token: this.token });
  }

  private async send(body: Json): Promise<GraphResult<{ messageId: string }>> {
    const r = await call(this.version, 'POST', `${this.pageId}/messages`, {
      token: this.token,
      json: body,
    });
    return r.ok
      ? { ok: true, data: { messageId: str(r.data?.message_id) ?? '' } }
      : { ok: false, error: r.error ?? 'send failed', code: r.code };
  }

  sendText(psid: string, text: string) {
    return this.send({
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: { text: clip(text, TEXT_LIMIT) },
    });
  }

  sendAttachment(psid: string, type: AttachmentType, url: string) {
    return this.send({
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: { attachment: { type, payload: { url, is_reusable: false } } },
    });
  }

  sendButtonTemplate(psid: string, text: string, buttons: readonly MessengerButton[]) {
    return this.send({
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: clip(text, BUTTON_TEXT_LIMIT),
            buttons: buttons.slice(0, 3),
          },
        },
      },
    });
  }

  async getMessengerProfile(): Promise<Record<string, unknown>> {
    const r = await this.get(`${this.pageId}/messenger_profile`, {
      fields:
        'get_started,greeting,ice_breakers,persistent_menu,whitelisted_domains,account_linking_url,commands,subject_to_new_eu_privacy_rules',
    });
    // Meta answers `data: [{greeting: [...]}, {get_started: {...}}, ...]`: one property per object, merged here.
    const merged: Record<string, unknown> = {};
    if (r.ok && Array.isArray(r.data?.data)) {
      for (const row of r.data.data) Object.assign(merged, obj(row));
    }
    return merged;
  }

  setMessengerProfile(
    payload: Record<string, unknown>,
    graphVersion?: string,
  ): Promise<GraphResult> {
    return call(
      graphVersion?.replace(/^\/+/, '') || this.version,
      'POST',
      `${this.pageId}/messenger_profile`,
      {
        token: this.token,
        json: payload,
      },
    );
  }

  deleteMessengerProfile(fields: readonly string[], graphVersion?: string): Promise<GraphResult> {
    return call(
      graphVersion?.replace(/^\/+/, '') || this.version,
      'DELETE',
      `${this.pageId}/messenger_profile`,
      {
        token: this.token,
        json: { fields: [...fields] },
      },
    );
  }

  async replyComment(objectId: string, text: string): Promise<GraphResult<{ id: string }>> {
    const r = await call(this.version, 'POST', `${objectId}/comments`, {
      token: this.token,
      form: { message: clip(text, COMMENT_LIMIT) },
    });
    return r.ok
      ? { ok: true, data: { id: str(r.data?.id) ?? '' } }
      : { ok: false, error: r.error ?? 'reply failed', code: r.code };
  }

  async getSenderProfile(psid: string): Promise<GraphSenderProfile | null> {
    const r = await this.get(psid, { fields: 'name,first_name,last_name,profile_pic' });
    return r.ok ? (r.data as GraphSenderProfile) : null;
  }

  async getComment(commentId: string): Promise<GraphComment | null> {
    const r = await this.get(commentId, {
      fields: 'id,message,from{id,name,picture},created_time,parent{id},attachment',
    });
    return r.ok ? (r.data as GraphComment) : null;
  }

  async listConversations(limit: number): Promise<GraphConversation[]> {
    const r = await this.get(`${this.pageId}/conversations`, {
      fields: 'id,participants,updated_time',
      limit: String(limit),
      platform: 'messenger',
    });
    return r.ok && Array.isArray(r.data?.data) ? (r.data.data as GraphConversation[]) : [];
  }

  async getConversationMessages(conversationId: string, limit: number): Promise<GraphMessage[]> {
    const r = await this.get(`${conversationId}/messages`, {
      fields: 'id,message,created_time,from,attachments{mime_type,file_url,image_data,video_data}',
      limit: String(limit),
    });
    return r.ok && Array.isArray(r.data?.data) ? (r.data.data as GraphMessage[]) : [];
  }
}

/**
 * Resolves the Meta app the way Reference did: Facebook has its own settings, and each falls back to the WhatsApp app's, so most
 * installs configure one Meta app and use it for both channels.
 */
@Injectable()
export class FacebookGraphClients implements FacebookGraphFactory {
  readonly settings: MetaAppSettings;

  constructor(config: ConfigService<Env, true>) {
    const get = (k: keyof Env) => (config.get(k, { infer: true }) as string | undefined) || null;
    const fbSecret = get('FB_APP_SECRET');
    const waSecret = get('WHATSAPP_APP_SECRET');
    this.settings = {
      appId: get('FB_APP_ID') ?? get('META_APP_ID'),
      appSecret: fbSecret ?? waSecret,
      configId: get('FB_CONFIG_ID'),
      graphVersion:
        get('FB_GRAPH_VERSION') ?? (config.get('META_GRAPH_VERSION', { infer: true }) as string),
      greetingFallbackVersion: config.get('FB_GREETING_GRAPH_VERSION', { infer: true }),
      verifyToken: get('FB_WEBHOOK_VERIFY_TOKEN') ?? get('WHATSAPP_VERIFY_TOKEN'),
      signingSecrets: [
        ...new Set([fbSecret, waSecret].filter((s): s is string => Boolean(s?.trim()))),
      ],
    };
  }

  app(): FacebookAppApi {
    return new AppApi(this.settings);
  }

  forPage(token: string, pageId: string): FacebookPageApi {
    return new PageApi(this.settings.graphVersion, token, pageId);
  }
}
