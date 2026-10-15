import { Injectable } from '@nestjs/common';
import {
  type WechatAccessToken,
  type WechatApi,
  type WechatMessage,
  type WechatResult,
  type WechatUploadType,
  type WechatUserInfo,
} from './wechat.port';

const BASE = 'https://api.weixin.qq.com';
const TIMEOUT_MS = 20_000;
const TOKEN_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** The largest file taken from a follower (WeChat's own ceiling for temporary media is 10 MB). */
const DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** The access token and the AppSecret travel in WeChat's query string: nothing that mentions them may leave this file. */
const scrub = (s: string): string =>
  s.replace(/(access_token|secret|appid)=[^&\s"']+/gi, '$1=…').slice(0, 300);

const failure = <T>(error: string, data = {} as T): WechatResult<T> => ({
  ok: false,
  data,
  errcode: null,
  error: scrub(error),
});

interface Reply {
  errcode?: number;
  errmsg?: string;
}

/** WeChat answers `{ errcode: 0 }` (or no errcode at all) on success. */
function result<T extends object>(status: number, body: (Reply & T) | null): WechatResult<T> {
  if (!body) return failure(`WeChat returned a non-JSON response (HTTP ${status}).`);
  const code = typeof body.errcode === 'number' ? body.errcode : 0;
  if (status >= 200 && status < 300 && code === 0) {
    return { ok: true, data: body, errcode: null, error: null };
  }
  return {
    ok: false,
    data: body,
    errcode: code === 0 ? null : code,
    error: scrub(`${code === 0 ? '' : code} ${body.errmsg ?? `HTTP ${status}`}`.trim()),
  };
}

/** Plain HTTPS to `api.weixin.qq.com`. JSON bodies keep their Unicode as it is, as WeChat requires for Chinese text. */
@Injectable()
export class WechatApiClient implements WechatApi {
  private async json<T extends object>(
    method: 'GET' | 'POST',
    path: string,
    query: Record<string, string>,
    body?: object,
    timeoutMs = TIMEOUT_MS,
  ): Promise<WechatResult<T>> {
    try {
      const url = `${BASE}${path}?${new URLSearchParams(query).toString()}`;
      const res = await fetch(url, {
        method,
        ...(body
          ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
          : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const parsed = (await res.json().catch(() => null)) as (Reply & T) | null;
      return result<T>(res.status, parsed);
    } catch (err) {
      return failure<T>(err instanceof Error ? err.message : 'WeChat could not be reached.');
    }
  }

  async fetchAccessToken(
    appId: string,
    appSecret: string,
  ): Promise<WechatResult<WechatAccessToken>> {
    const res = await this.json<{ access_token?: string; expires_in?: number }>(
      'GET',
      '/cgi-bin/token',
      { grant_type: 'client_credential', appid: appId, secret: appSecret },
      undefined,
      TOKEN_TIMEOUT_MS,
    );
    const token = res.data.access_token;
    if (!res.ok || !token) {
      return {
        ok: false,
        data: { accessToken: '', expiresIn: 0 },
        errcode: res.errcode,
        error: res.error ?? 'WeChat did not return an access token.',
      };
    }
    return {
      ok: true,
      data: { accessToken: token, expiresIn: Number(res.data.expires_in ?? 7200) },
      errcode: null,
      error: null,
    };
  }

  sendCustomMessage(token: string, openid: string, message: WechatMessage) {
    return this.json<Record<string, unknown>>(
      'POST',
      '/cgi-bin/message/custom/send',
      { access_token: token },
      { touser: openid, ...message },
    );
  }

  sendTemplate(
    token: string,
    openid: string,
    templateId: string,
    data: Record<string, { value: string; color?: string }>,
    url?: string,
  ) {
    return this.json<{ msgid?: number | string }>(
      'POST',
      '/cgi-bin/message/template/send',
      { access_token: token },
      { touser: openid, template_id: templateId, ...(url ? { url } : {}), data },
    );
  }

  massSend(
    token: string,
    openids: readonly string[],
    message: WechatMessage,
    clientMsgId?: string,
  ) {
    return this.json<{ msg_id?: number | string }>(
      'POST',
      '/cgi-bin/message/mass/send',
      { access_token: token },
      {
        touser: openids.slice(0, 10_000),
        ...message,
        ...(clientMsgId ? { clientmsgid: clientMsgId } : {}),
      },
    );
  }

  massSendAll(
    token: string,
    filter: { is_to_all: true } | { is_to_all: false; tag_id: number },
    message: WechatMessage,
    clientMsgId?: string,
  ) {
    return this.json<{ msg_id?: number | string }>(
      'POST',
      '/cgi-bin/message/mass/sendall',
      { access_token: token },
      { filter, ...message, ...(clientMsgId ? { clientmsgid: clientMsgId } : {}) },
    );
  }

  getUserInfo(token: string, openid: string) {
    return this.json<WechatUserInfo>('GET', '/cgi-bin/user/info', {
      access_token: token,
      openid,
      lang: 'en',
    });
  }

  async uploadMedia(token: string, type: WechatUploadType, bytes: Uint8Array, filename: string) {
    try {
      const form = new FormData();
      form.set('media', new Blob([new Uint8Array(bytes)]), filename || 'file');
      const res = await fetch(
        `${BASE}/cgi-bin/media/upload?${new URLSearchParams({ access_token: token, type })}`,
        { method: 'POST', body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) },
      );
      const parsed = (await res.json().catch(() => null)) as (Reply & { media_id?: string }) | null;
      return result<{ media_id?: string }>(res.status, parsed);
    } catch (err) {
      return failure<{ media_id?: string }>(
        err instanceof Error ? err.message : 'WeChat could not be reached.',
      );
    }
  }

  async getMedia(token: string, mediaId: string) {
    try {
      const res = await fetch(
        `${BASE}/cgi-bin/media/get?${new URLSearchParams({ access_token: token, media_id: mediaId })}`,
        { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) },
      );
      const mime =
        (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      // An error comes back as JSON (or text) with a 200.
      if (!res.ok || mime === '' || mime === 'application/json' || mime === 'text/plain') {
        return null;
      }
      if (Number(res.headers.get('content-length') ?? 0) > DOWNLOAD_MAX_BYTES) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return bytes.length > DOWNLOAD_MAX_BYTES ? null : { bytes, mime };
    } catch {
      return null;
    }
  }
}
