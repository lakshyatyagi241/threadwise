import { Injectable } from '@nestjs/common';
import { channelEmailEnv } from '../../../config/domains/channel-email.env';
import { googleSend } from './google-http';
import { classifyApiError, GoogleMailError } from './google-mail.errors';
import type {
  GmailHistoryPage,
  GmailListPage,
  GmailMessage,
  GmailProfile,
  GmailSendResult,
} from './gmail.types';

type Json = Record<string, unknown>;
const enc = encodeURIComponent;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * The Gmail REST API (v1) the Email channel uses, one method per call (TW-MAIL-021, 022). Plain HTTP with a timeout: it holds no tenant,
 * no database and no secret of its own, every access token is an argument, and every failure is a `GoogleMailError` whose `kind` the
 * caller switches on. The base address comes from the environment so a test can aim it at a local stand-in.
 *
 * Endpoints and parameters were taken from developers.google.com (Gmail API reference) and are not verified against a live Gmail account
 * in this repository.
 */
@Injectable()
export class GmailClient {
  async getProfile(token: string): Promise<GmailProfile> {
    const body = await this.api(token, 'GET', '/users/me/profile');
    return {
      emailAddress: str(body.emailAddress) ?? '',
      historyId: str(body.historyId) ?? '',
      messagesTotal: Number(body.messagesTotal) || 0,
    };
  }

  /**
   * Messages added to the INBOX since `startHistoryId`. A cursor Google no longer keeps (older than about a week, or invalid) answers
   * 404: that is `GoogleMailError('not_found')`, and the caller falls back to {@link listMessages}.
   */
  async listHistory(
    token: string,
    opts: { startHistoryId: string; pageToken?: string | null; maxResults?: number },
  ): Promise<GmailHistoryPage> {
    const q = new URLSearchParams({
      startHistoryId: opts.startHistoryId,
      historyTypes: 'messageAdded',
      labelId: 'INBOX',
      maxResults: String(opts.maxResults ?? 100),
    });
    if (opts.pageToken) q.set('pageToken', opts.pageToken);
    const body = await this.api(token, 'GET', `/users/me/history?${q}`);
    const added: GmailHistoryPage['added'] = [];
    let lastRecordId: string | null = null;
    for (const h of (body.history as Json[] | undefined) ?? []) {
      const recordId = str(h.id);
      if (
        recordId &&
        /^\d+$/.test(recordId) &&
        (lastRecordId === null || BigInt(recordId) > BigInt(lastRecordId))
      )
        lastRecordId = recordId;
      for (const entry of (h.messagesAdded as Json[] | undefined) ?? []) {
        const m = entry.message as Json | undefined;
        const id = str(m?.id);
        if (!m || !id) continue;
        added.push({
          id,
          threadId: str(m.threadId) ?? id,
          labelIds: Array.isArray(m.labelIds)
            ? (m.labelIds as unknown[]).filter((l): l is string => typeof l === 'string')
            : [],
        });
      }
    }
    return {
      added,
      historyId: str(body.historyId),
      lastRecordId,
      nextPageToken: str(body.nextPageToken),
    };
  }

  /** Message ids matching a Gmail search, newest first. `labelIds` narrows by label (INBOX). */
  async listMessages(
    token: string,
    opts: { q?: string; labelIds?: string[]; pageToken?: string | null; maxResults?: number },
  ): Promise<GmailListPage> {
    const q = new URLSearchParams({ maxResults: String(opts.maxResults ?? 100) });
    if (opts.q) q.set('q', opts.q);
    for (const l of opts.labelIds ?? []) q.append('labelIds', l);
    if (opts.pageToken) q.set('pageToken', opts.pageToken);
    const body = await this.api(token, 'GET', `/users/me/messages?${q}`);
    const messages: GmailListPage['messages'] = [];
    for (const m of (body.messages as Json[] | undefined) ?? []) {
      const id = str(m.id);
      if (id) messages.push({ id, threadId: str(m.threadId) ?? id });
    }
    return { messages, nextPageToken: str(body.nextPageToken) };
  }

  /** One message with its full MIME tree (`format=full`). 404 (deleted since it was listed) is `not_found`. */
  async getMessage(token: string, id: string): Promise<GmailMessage> {
    const body = await this.api(token, 'GET', `/users/me/messages/${enc(id)}?format=full`);
    if (!str(body.id)) throw new GoogleMailError('server', 200, 'no_message_id');
    return body as unknown as GmailMessage;
  }

  /** The bytes of an attachment the message part did not carry inline. */
  async getAttachment(token: string, messageId: string, attachmentId: string): Promise<Buffer> {
    const body = await this.api(
      token,
      'GET',
      `/users/me/messages/${enc(messageId)}/attachments/${enc(attachmentId)}`,
    );
    return Buffer.from(typeof body.data === 'string' ? body.data : '', 'base64url');
  }

  /** Sends a complete RFC 5322 message; `threadId` keeps it in the conversation it answers. */
  async sendMessage(
    token: string,
    input: { raw: Buffer; threadId?: string | null },
  ): Promise<GmailSendResult> {
    const body = await this.api(token, 'POST', '/users/me/messages/send', {
      raw: input.raw.toString('base64url'),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    });
    const id = str(body.id);
    if (!id) throw new GoogleMailError('server', 200, 'no_message_id');
    return { id, threadId: str(body.threadId) ?? input.threadId ?? id };
  }

  /** The message of this mailbox with that RFC 5322 Message-ID (how a retried send recognises what an earlier try already sent). */
  async findByMessageId(
    token: string,
    messageId: string,
  ): Promise<{ id: string; threadId: string } | null> {
    const page = await this.listMessages(token, {
      q: `rfc822msgid:${messageId.replace(/^<|>$/g, '')}`,
      maxResults: 1,
    });
    return page.messages[0] ?? null;
  }

  /**
   * `users.watch`: asks Gmail to publish a Pub/Sub message to `topicName` when the INBOX changes. The watch lasts about 7 days
   * (`expiration`, epoch ms) and must be renewed by calling this again; `historyId` is the mailbox's position when it was set.
   */
  async watch(
    token: string,
    input: { topicName: string },
  ): Promise<{ historyId: string; expiration: string | null }> {
    const body = await this.api(token, 'POST', '/users/me/watch', {
      topicName: input.topicName,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE',
    });
    return { historyId: str(body.historyId) ?? '', expiration: str(body.expiration) };
  }

  /** `users.stop`: withdraws the watch. Gmail answers 204 whether or not one was set. */
  async stopWatch(token: string): Promise<void> {
    await this.api(token, 'POST', '/users/me/stop');
  }

  private api(token: string, method: string, path: string, body?: unknown): Promise<Json> {
    const env = channelEmailEnv();
    return googleSend(`${env.GMAIL_API_URL}${path}`, {
      method,
      token,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs: env.GOOGLE_MAIL_HTTP_TIMEOUT_MS,
      classify: classifyApiError,
    });
  }
}
