import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GmailMessage, GmailPart } from '../../../src/infra/providers/channel-email';

/**
 * A stand-in for Google's OAuth endpoints and the Gmail v1 API, local to a test. It keeps real state per Google account (a mailbox of
 * messages with labels, a growing history, the access and refresh tokens) so the real clients, the real sync and the real send are exercised
 * against something that answers like Google does: `history.list` returns what was added after a cursor and 404s for a cursor it no longer
 * keeps, `messages.list` answers newest first and pages, `messages.send` stores a SENT message and finds it again by `rfc822msgid:`,
 * `invalid_grant` for a revoked refresh token, 401 for an access token that stopped working.
 *
 * It is written from Google's documentation, not recorded from Google: it proves our code against that description, and says nothing about
 * what a live Gmail account would answer.
 */

export interface FakeAccount {
  sub: string;
  email: string;
  name: string;
}

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  auth: string | null;
  body: Record<string, unknown>;
}

export interface FakeAttachment {
  name: string;
  mime: string;
  data: Buffer;
  /** Served through attachments.get (the default) or carried inside the message part. */
  inline?: boolean;
  contentId?: string;
}

export interface Delivery {
  threadId?: string;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  text?: string | null;
  html?: string | null;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  labels?: string[];
  headers?: Array<[string, string]>;
  attachments?: FakeAttachment[];
  /** Extra top-level parts after the body (a delivery-status report's `message/delivery-status`, `text/rfc822-headers`). */
  extraParts?: GmailPart[];
  /** Replaces the top-level `Content-Type` header (default `multipart/mixed`). */
  contentType?: string;
  /** Epoch ms; default now. */
  at?: number;
}

interface StoredMessage {
  message: GmailMessage;
  attachments: Map<string, Buffer>;
  /** `rfc822msgid:` search key. */
  rfcId: string;
}

interface Mailbox {
  messages: Map<string, StoredMessage>;
  /** Messages in the order they arrived. */
  order: string[];
  history: Array<{
    id: number;
    added: Array<{ id: string; threadId: string; labelIds: string[] }>;
  }>;
  historyId: number;
  /** Cursors below this answer 404 (Google keeps history for about a week). */
  earliestHistory: number;
}

export interface SentMail {
  id: string;
  threadId: string | null;
  raw: string;
  account: string;
}

interface Failure {
  method: string;
  path: RegExp;
  status: number;
  body: unknown;
  times: number;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export const GMAIL_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

export class FakeGmail {
  private server!: Server;
  url = '';
  clientId = 'mail-client';
  clientSecret = 'mail-secret';
  requests: FakeRequest[] = [];

  codes = new Map<string, { account: FakeAccount; scope?: string; refresh?: boolean }>();
  refreshTokens = new Map<string, { account: FakeAccount; valid: boolean }>();
  accessTokens = new Map<string, { account: FakeAccount; valid: boolean }>();
  revoked: string[] = [];
  mailboxes = new Map<string, Mailbox>();
  sent: SentMail[] = [];
  /** Gmail watches set through users.watch, by account. */
  watches = new Map<string, { topicName: string; expiration: number }>();
  /** How long a watch the fake grants lasts (Gmail: about 7 days). */
  watchTtlMs = 7 * 86_400_000;
  private failures: Failure[] = [];
  private seq = 0;

  static async start(): Promise<FakeGmail> {
    const g = new FakeGmail();
    g.server = createServer((req, res) => void g.handle(req, res));
    await new Promise<void>((resolve) => g.server.listen(0, '127.0.0.1', resolve));
    g.url = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`;
    return g;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Points the app at this server (the clients read these at call time). */
  env(): Record<string, string> {
    return {
      GOOGLE_OAUTH_AUTH_URL: `${this.url}/auth`,
      GOOGLE_OAUTH_TOKEN_URL: `${this.url}/token`,
      GOOGLE_OAUTH_REVOKE_URL: `${this.url}/revoke`,
      GOOGLE_USERINFO_URL: `${this.url}/userinfo`,
      GMAIL_API_URL: `${this.url}/gmail/v1`,
      GOOGLE_MAIL_CLIENT_ID: this.clientId,
      GOOGLE_MAIL_CLIENT_SECRET: this.clientSecret,
    };
  }

  account(email: string, name = ''): FakeAccount {
    const acc = { sub: `sub-${email}`, email, name: name || email.split('@')[0]! };
    if (!this.mailboxes.has(email)) {
      this.mailboxes.set(email, {
        messages: new Map(),
        order: [],
        history: [],
        historyId: 1000,
        earliestHistory: 0,
      });
    }
    return acc;
  }

  /** A consent the person is about to complete: the callback gets this `code`. */
  grant(
    code: string,
    account: FakeAccount,
    opts: { scope?: string; refresh?: boolean } = {},
  ): string {
    this.codes.set(code, { account, ...opts });
    return code;
  }

  count(method: string, path: RegExp): number {
    return this.requests.filter((r) => r.method === method && path.test(r.path)).length;
  }

  failNext(
    method: string,
    path: RegExp,
    status: number,
    opts: { times?: number; body?: unknown } = {},
  ): void {
    this.failures.push({
      method,
      path,
      status,
      body: opts.body ?? {
        error: { code: status, message: 'injected', errors: [{ reason: 'backendError' }] },
      },
      times: opts.times ?? 1,
    });
  }

  /** The token-endpoint calls of one grant type, in order. */
  forms(grantType: string): FakeRequest[] {
    return this.requests.filter((r) => r.path === '/token' && r.body.grant_type === grantType);
  }

  clearFailures(): void {
    this.failures = [];
  }

  /** Google revokes the grant: the refresh token answers `invalid_grant`, and the access tokens stop working. */
  revokeGrant(email: string): void {
    for (const t of this.refreshTokens.values()) if (t.account.email === email) t.valid = false;
    this.killAccessTokens(email);
  }

  killAccessTokens(email?: string): void {
    for (const t of this.accessTokens.values())
      if (!email || t.account.email === email) t.valid = false;
  }

  /** The mailbox's history before now is gone: a stored cursor answers 404. */
  expireHistory(email: string): void {
    const mb = this.box(email);
    mb.earliestHistory = mb.historyId + 1;
  }

  box(email: string): Mailbox {
    const mb = this.mailboxes.get(email);
    if (!mb) throw new Error(`no fake mailbox ${email}`);
    return mb;
  }

  /** Mail arrives in the mailbox (INBOX unless `labels` says otherwise). Returns the Gmail message id. */
  deliver(email: string, d: Delivery = {}): string {
    const mb = this.box(email);
    const id = `g${++this.seq}`;
    const threadId = d.threadId ?? `th${this.seq}`;
    const labels = d.labels ?? ['INBOX', 'UNREAD'];
    const attachments = new Map<string, Buffer>();
    const parts: GmailPart[] = [];
    const bodyParts: GmailPart[] = [];
    if (d.text !== null) {
      const text = d.text ?? 'Hello';
      bodyParts.push({
        partId: '0.0',
        mimeType: 'text/plain',
        filename: '',
        headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }],
        body: { size: text.length, data: b64(text) },
      });
    }
    if (d.html) {
      bodyParts.push({
        partId: '0.1',
        mimeType: 'text/html',
        filename: '',
        headers: [{ name: 'Content-Type', value: 'text/html; charset="UTF-8"' }],
        body: { size: d.html.length, data: b64(d.html) },
      });
    }
    parts.push({
      partId: '0',
      mimeType: 'multipart/alternative',
      filename: '',
      headers: [{ name: 'Content-Type', value: 'multipart/alternative' }],
      body: { size: 0 },
      parts: bodyParts,
    });
    (d.attachments ?? []).forEach((a, i) => {
      const attId = `att-${id}-${i}`;
      attachments.set(attId, a.data);
      parts.push({
        partId: String(i + 1),
        mimeType: a.mime,
        filename: a.name,
        headers: [
          { name: 'Content-Type', value: `${a.mime}; name="${a.name}"` },
          {
            name: 'Content-Disposition',
            value: `${a.contentId ? 'inline' : 'attachment'}; filename="${a.name}"`,
          },
          ...(a.contentId ? [{ name: 'Content-ID', value: `<${a.contentId}>` }] : []),
        ],
        body: a.inline
          ? { size: a.data.length, data: b64(a.data) }
          : { size: a.data.length, attachmentId: attId },
      });
    });
    parts.push(...(d.extraParts ?? []));
    const messageId = d.messageId ?? `${id}@sender.example`;
    const message: GmailMessage = {
      id,
      threadId,
      labelIds: labels,
      snippet: (d.text ?? '').slice(0, 80),
      internalDate: String(d.at ?? Date.now()),
      sizeEstimate: 2000,
      payload: {
        partId: '',
        mimeType: 'multipart/mixed',
        filename: '',
        headers: [
          { name: 'From', value: d.from ?? 'Ana Customer <ana@example.com>' },
          { name: 'To', value: d.to ?? email },
          ...(d.cc ? [{ name: 'Cc', value: d.cc }] : []),
          { name: 'Subject', value: d.subject ?? 'Order question' },
          { name: 'Message-ID', value: `<${messageId}>` },
          ...(d.inReplyTo ? [{ name: 'In-Reply-To', value: `<${d.inReplyTo}>` }] : []),
          ...(d.references ? [{ name: 'References', value: d.references }] : []),
          { name: 'Date', value: new Date(d.at ?? Date.now()).toUTCString() },
          { name: 'Content-Type', value: d.contentType ?? 'multipart/mixed' },
          ...(d.headers ?? []).map(([name, value]) => ({ name, value })),
        ],
        body: { size: 0 },
        parts,
      },
    };
    mb.messages.set(id, { message, attachments, rfcId: messageId });
    mb.order.push(id);
    mb.historyId += 1;
    mb.history.push({ id: mb.historyId, added: [{ id, threadId, labelIds: labels }] });
    return id;
  }

  sentTo(email: string): SentMail[] {
    return this.sent.filter((s) => s.account === email);
  }

  // --- the server ------------------------------------------------------------------------------------------------------

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const raw = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => resolve(data));
    });
    let body: Record<string, unknown> = {};
    if (raw) {
      if ((req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) {
        body = Object.fromEntries(new URLSearchParams(raw));
      } else {
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
    }
    const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '') || null;
    const method = req.method ?? 'GET';
    this.requests.push({ method, path: url.pathname, query: url.searchParams, auth, body });
    const failure = this.failures.find(
      (f) => f.method === method && f.path.test(url.pathname) && f.times > 0,
    );
    if (failure) {
      failure.times -= 1;
      return json(res, failure.status, failure.body);
    }
    const out = this.route(method, url, body, auth);
    json(res, out.status, out.body);
  }

  private route(
    method: string,
    url: URL,
    body: Record<string, unknown>,
    token: string | null,
  ): { status: number; body: unknown } {
    const path = url.pathname;
    if (path === '/token' && method === 'POST') return this.token(body);
    if (path === '/revoke' && method === 'POST') {
      this.revoked.push(String(body.token));
      const rt = this.refreshTokens.get(String(body.token));
      if (rt) rt.valid = false;
      return { status: 200, body: {} };
    }
    const live = token ? this.accessTokens.get(token) : undefined;
    if (!live?.valid) {
      return {
        status: 401,
        body: { error: { code: 401, status: 'UNAUTHENTICATED', message: 'Invalid Credentials' } },
      };
    }
    if (path === '/userinfo') {
      return {
        status: 200,
        body: {
          sub: live.account.sub,
          email: live.account.email,
          email_verified: true,
          name: live.account.name,
        },
      };
    }
    const api = path.replace(/^\/gmail\/v1/, '');
    const mb = this.mailboxes.get(live.account.email);
    if (!mb) return this.notFound();
    if (api === '/users/me/profile' && method === 'GET') {
      return {
        status: 200,
        body: {
          emailAddress: live.account.email,
          messagesTotal: mb.order.length,
          historyId: String(mb.historyId),
        },
      };
    }
    if (api === '/users/me/watch' && method === 'POST') {
      // users.watch: the answer carries the mailbox's current history id and when the watch ends (epoch ms).
      const expiration = Date.now() + this.watchTtlMs;
      this.watches.set(live.account.email, { topicName: String(body.topicName), expiration });
      return {
        status: 200,
        body: { historyId: String(mb.historyId), expiration: String(expiration) },
      };
    }
    if (api === '/users/me/stop' && method === 'POST') {
      this.watches.delete(live.account.email);
      return { status: 204, body: undefined };
    }
    if (api === '/users/me/history' && method === 'GET') return this.historyList(mb, url);
    if (api === '/users/me/messages' && method === 'GET') return this.messagesList(mb, url);
    if (api === '/users/me/messages/send' && method === 'POST')
      return this.send(mb, live.account.email, body);
    const att = /^\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(api);
    if (att && method === 'GET') {
      const data = mb.messages
        .get(decodeURIComponent(att[1]!))
        ?.attachments.get(decodeURIComponent(att[2]!));
      return data ? { status: 200, body: { size: data.length, data: b64(data) } } : this.notFound();
    }
    const one = /^\/users\/me\/messages\/([^/]+)$/.exec(api);
    if (one && method === 'GET') {
      const m = mb.messages.get(decodeURIComponent(one[1]!));
      return m ? { status: 200, body: m.message } : this.notFound();
    }
    return this.notFound();
  }

  private notFound() {
    return {
      status: 404,
      body: { error: { code: 404, message: 'Not Found', errors: [{ reason: 'notFound' }] } },
    };
  }

  private historyList(mb: Mailbox, url: URL) {
    const start = Number(url.searchParams.get('startHistoryId'));
    if (!Number.isFinite(start) || start < mb.earliestHistory) return this.notFound();
    const label = url.searchParams.get('labelId');
    const max = Number(url.searchParams.get('maxResults') ?? 100);
    const offset = Number(url.searchParams.get('pageToken') ?? 0);
    const all = mb.history.filter(
      (h) => h.id > start && (!label || h.added.some((a) => a.labelIds.includes(label))),
    );
    const page = all.slice(offset, offset + max);
    const out: Record<string, unknown> = { historyId: String(mb.historyId) };
    if (page.length) {
      out.history = page.map((h) => ({
        id: String(h.id),
        messagesAdded: h.added
          .filter((a) => !label || a.labelIds.includes(label))
          .map((a) => ({ message: { id: a.id, threadId: a.threadId, labelIds: a.labelIds } })),
      }));
    }
    if (offset + max < all.length) out.nextPageToken = String(offset + max);
    return { status: 200, body: out };
  }

  private messagesList(mb: Mailbox, url: URL) {
    const labels = url.searchParams.getAll('labelIds');
    const q = url.searchParams.get('q') ?? '';
    const max = Number(url.searchParams.get('maxResults') ?? 100);
    const offset = Number(url.searchParams.get('pageToken') ?? 0);
    const rfc = /^rfc822msgid:(.+)$/.exec(q)?.[1];
    const days = /newer_than:(\d+)d/.exec(q)?.[1];
    const cutoff = days ? Date.now() - Number(days) * 86_400_000 : 0;
    const matching = [...mb.order]
      .reverse()
      .map((id) => mb.messages.get(id)!)
      .filter((m) => labels.every((l) => m.message.labelIds?.includes(l)))
      .filter((m) => (rfc ? m.rfcId === rfc : true))
      .filter((m) => Number(m.message.internalDate) >= cutoff);
    const page = matching.slice(offset, offset + max);
    const out: Record<string, unknown> = { resultSizeEstimate: matching.length };
    if (page.length)
      out.messages = page.map((m) => ({ id: m.message.id, threadId: m.message.threadId }));
    if (offset + max < matching.length) out.nextPageToken = String(offset + max);
    return { status: 200, body: out };
  }

  private send(mb: Mailbox, email: string, body: Record<string, unknown>) {
    const raw = Buffer.from(String(body.raw ?? ''), 'base64url').toString('utf8');
    if (!raw)
      return {
        status: 400,
        body: {
          error: { code: 400, message: 'Invalid raw', errors: [{ reason: 'invalidArgument' }] },
        },
      };
    const id = `s${++this.seq}`;
    const threadId = typeof body.threadId === 'string' ? body.threadId : `th-${id}`;
    const messageId = /^message-id:\s*<([^>]+)>/im.exec(raw)?.[1] ?? `${id}@fake`;
    const message: GmailMessage = {
      id,
      threadId,
      labelIds: ['SENT'],
      internalDate: String(Date.now()),
      payload: { headers: [] },
    };
    mb.messages.set(id, { message, attachments: new Map(), rfcId: messageId });
    mb.order.push(id);
    mb.historyId += 1;
    // Sent mail is not an INBOX addition, so a history call filtered on INBOX never lists it.
    mb.history.push({ id: mb.historyId, added: [{ id, threadId, labelIds: ['SENT'] }] });
    this.sent.push({
      id,
      threadId: typeof body.threadId === 'string' ? body.threadId : null,
      raw,
      account: email,
    });
    return { status: 200, body: { id, threadId, labelIds: ['SENT'] } };
  }

  private token(form: Record<string, unknown>) {
    if (form.client_id !== this.clientId || form.client_secret !== this.clientSecret) {
      return {
        status: 401,
        body: { error: 'invalid_client', error_description: 'The OAuth client was not found.' },
      };
    }
    const newAccess = (account: FakeAccount) => {
      const t = `at-${++this.seq}`;
      this.accessTokens.set(t, { account, valid: true });
      return t;
    };
    if (form.grant_type === 'authorization_code') {
      const grant = this.codes.get(String(form.code));
      this.codes.delete(String(form.code));
      if (!grant)
        return { status: 400, body: { error: 'invalid_grant', error_description: 'Bad Request' } };
      const out: Record<string, unknown> = {
        access_token: newAccess(grant.account),
        expires_in: 3599,
        scope: grant.scope ?? GMAIL_SCOPES,
        token_type: 'Bearer',
      };
      if (grant.refresh !== false) {
        const rt = `rt-${String(form.code)}-${++this.seq}`;
        this.refreshTokens.set(rt, { account: grant.account, valid: true });
        out.refresh_token = rt;
      }
      return { status: 200, body: out };
    }
    if (form.grant_type === 'refresh_token') {
      const rt = this.refreshTokens.get(String(form.refresh_token));
      if (!rt?.valid)
        return {
          status: 400,
          body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
        };
      return {
        status: 200,
        body: { access_token: newAccess(rt.account), expires_in: 3599, token_type: 'Bearer' },
      };
    }
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }
}
