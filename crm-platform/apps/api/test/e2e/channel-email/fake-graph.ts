import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for the Microsoft identity platform (v2.0 token endpoint) and the Microsoft Graph v1.0 mail API, local to a test. It keeps real
 * state per account (a mailbox of messages in folders, a delta log, the access and refresh tokens, rotating refresh tokens like Microsoft's)
 * so the real clients, the real sync and the real send run against something that answers the way the documentation says: `delta` pages with
 * `@odata.nextLink` and ends with `@odata.deltaLink`, a dead delta token answers 410, `createReply` copies In-Reply-To / References and the
 * conversation, `PATCH` is allowed on drafts, `send` moves the draft to Sent Items, large attachments go through an upload session, a header that
 * does not start with `x-` on a new message is refused, `AADSTS` errors on the token endpoint, 429 with Retry-After.
 *
 * Written from Microsoft's documentation, not recorded from Microsoft: it proves our code against that description, and says nothing about
 * what a live tenant would answer.
 */
export interface GraphAccount {
  id: string;
  mail: string;
  name: string;
}

export interface GraphAttachmentSpec {
  name: string;
  mime: string;
  data: Buffer;
  inline?: boolean;
  contentId?: string;
  /** `item`: an attached message (served as raw MIME). */
  kind?: 'file' | 'item';
}

export interface GraphDelivery {
  conversationId?: string;
  from?: string;
  fromName?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  html?: string | null;
  text?: string | null;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  headers?: Array<[string, string]>;
  attachments?: GraphAttachmentSpec[];
  folder?: 'inbox' | 'junkemail' | 'deleteditems';
  isDraft?: boolean;
  at?: number;
}

interface Stored {
  id: string;
  conversationId: string;
  internetMessageId: string;
  subject: string;
  from: { name: string; address: string };
  to: string[];
  cc: string[];
  bcc: string[];
  bodyType: 'html' | 'text';
  body: string;
  headers: Array<{ name: string; value: string }>;
  received: number;
  folder: string;
  isDraft: boolean;
  attachments: Array<GraphAttachmentSpec & { id: string }>;
}

export interface GraphSent {
  id: string;
  account: string;
  message: Stored;
}

interface Box {
  messages: Map<string, Stored>;
  /** Inbox changes in order: seq, message id, removed. */
  log: Array<{ seq: number; id: string; removed: boolean }>;
  seq: number;
  /** Delta tokens older than this answer 410. */
  earliest: number;
}

export interface FakeGraphRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  auth: string | null;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  raw: Buffer;
}

interface Failure {
  method: string;
  path: RegExp;
  status: number;
  body: unknown;
  times: number;
  headers: Record<string, string>;
}

const json = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const graphError = (status: number, code: string, message = 'injected') => ({
  status,
  body: { error: { code, message } },
});

export interface FakeSubscription {
  id: string;
  account: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  lifecycleNotificationUrl: string;
  clientState: string;
  /** Epoch ms. */
  expires: number;
}

/** Graph's longest subscription on mail, in minutes (learn.microsoft.com, subscription resource type: Outlook message 4230). */
export const SUBSCRIPTION_MAX_MINUTES = 4230;

export const MS_SCOPES = 'Mail.Read Mail.Send User.Read email openid profile';

export class FakeGraph {
  private server!: Server;
  url = '';
  clientId = 'ms-client';
  clientSecret = 'ms-secret';
  requests: FakeGraphRequest[] = [];
  codes = new Map<string, { account: GraphAccount; scope?: string; refresh?: boolean }>();
  /** Valid refresh tokens; every refresh issues a NEW one and keeps the old valid (Microsoft's rotation). */
  refreshTokens = new Map<string, { account: GraphAccount; valid: boolean }>();
  accessTokens = new Map<string, { account: GraphAccount; valid: boolean }>();
  boxes = new Map<string, Box>();
  sent: GraphSent[] = [];
  private failures: Failure[] = [];
  /** Change-notification subscriptions, by id. */
  subscriptions = new Map<string, FakeSubscription>();
  /**
   * What Graph does when it validates a notification URL: it POSTs `?validationToken=<token>` and wants the token back as text within 10 s.
   * A test points this at the real API route; without one the validation fails (Graph cannot reach the address).
   */
  validator: ((url: string, token: string) => Promise<{ status: number; text: string }>) | null =
    null;
  private uploads = new Map<
    string,
    { draft: string; email: string; name: string; mime: string; chunks: Buffer[] }
  >();
  private seq = 0;
  /** How many requests carry a `$filter` on a folder lookup (a retry looks in Sent Items). */
  pageSize = 50;

  static async start(): Promise<FakeGraph> {
    const g = new FakeGraph();
    g.server = createServer((req, res) => void g.handle(req, res));
    await new Promise<void>((resolve) => g.server.listen(0, '127.0.0.1', resolve));
    g.url = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`;
    return g;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  env(): Record<string, string> {
    return {
      MICROSOFT_LOGIN_URL: `${this.url}/login`,
      MICROSOFT_GRAPH_URL: `${this.url}/v1.0`,
      MICROSOFT_MAIL_CLIENT_ID: this.clientId,
      MICROSOFT_MAIL_CLIENT_SECRET: this.clientSecret,
    };
  }

  account(mail: string, name = ''): GraphAccount {
    const acc = { id: `oid-${mail}`, mail, name: name || mail.split('@')[0]! };
    if (!this.boxes.has(mail)) {
      this.boxes.set(mail, { messages: new Map(), log: [], seq: 0, earliest: 0 });
    }
    return acc;
  }

  grant(
    code: string,
    account: GraphAccount,
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
    opts: { times?: number; body?: unknown; headers?: Record<string, string> } = {},
  ): void {
    this.failures.push({
      method,
      path,
      status,
      body: opts.body ?? { error: { code: 'InternalServerError', message: 'injected' } },
      times: opts.times ?? 1,
      headers: opts.headers ?? {},
    });
  }

  clearFailures(): void {
    this.failures = [];
  }

  forms(grantType: string): FakeGraphRequest[] {
    return this.requests.filter(
      (r) => r.path.endsWith('/token') && r.body.grant_type === grantType,
    );
  }

  revokeGrant(mail: string): void {
    for (const t of this.refreshTokens.values()) if (t.account.mail === mail) t.valid = false;
    this.killAccessTokens(mail);
  }

  killAccessTokens(mail?: string): void {
    for (const t of this.accessTokens.values())
      if (!mail || t.account.mail === mail) t.valid = false;
  }

  /** The delta tokens handed out so far no longer work (410). */
  expireDelta(mail: string): void {
    const box = this.box(mail);
    box.earliest = box.seq + 1;
  }

  box(mail: string): Box {
    const b = this.boxes.get(mail);
    if (!b) throw new Error(`no fake mailbox ${mail}`);
    return b;
  }

  sentTo(mail: string): GraphSent[] {
    return this.sent.filter((s) => s.account === mail);
  }

  /** Mail arrives (Inbox unless `folder` says otherwise). Returns the Graph (immutable) id. */
  deliver(mail: string, d: GraphDelivery = {}): string {
    const box = this.box(mail);
    const id = `AAMk${++this.seq}`;
    const messageId = d.messageId ?? `${id}@sender.example`;
    const headers: Array<{ name: string; value: string }> = [
      { name: 'Message-ID', value: `<${messageId}>` },
      ...(d.inReplyTo ? [{ name: 'In-Reply-To', value: `<${d.inReplyTo}>` }] : []),
      ...(d.references ? [{ name: 'References', value: d.references }] : []),
      ...(d.headers ?? []).map(([name, value]) => ({ name, value })),
    ];
    const m: Stored = {
      id,
      conversationId: d.conversationId ?? `conv-${id}`,
      internetMessageId: `<${messageId}>`,
      subject: d.subject ?? 'Order question',
      from: { name: d.fromName ?? 'Ana Customer', address: d.from ?? 'ana@example.com' },
      to: d.to ?? [mail],
      cc: d.cc ?? [],
      bcc: [],
      bodyType: d.html === null ? 'text' : 'html',
      body: d.html === null ? (d.text ?? 'Hello') : (d.html ?? `<p>${d.text ?? 'Hello'}</p>`),
      headers,
      received: d.at ?? Date.now(),
      folder: d.folder ?? 'inbox',
      isDraft: d.isDraft ?? false,
      attachments: (d.attachments ?? []).map((a, i) => ({ ...a, id: `att-${id}-${i}` })),
    };
    box.messages.set(id, m);
    if (m.folder === 'inbox') this.log(box, id, false);
    return id;
  }

  /** The mail leaves the Inbox (junk, deleted): delta reports it as removed. */
  moveOut(mail: string, id: string, folder = 'deleteditems'): void {
    const box = this.box(mail);
    const m = box.messages.get(id)!;
    m.folder = folder;
    this.log(box, id, true);
  }

  private log(box: Box, id: string, removed: boolean) {
    box.seq += 1;
    box.log.push({ seq: box.seq, id, removed });
  }

  // --- the server ------------------------------------------------------------------------------------------------------

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve) => {
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve());
    });
    const raw = Buffer.concat(chunks);
    const ctype = String(req.headers['content-type'] ?? '');
    let body: Record<string, unknown> = {};
    if (raw.length && ctype.includes('application/x-www-form-urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(raw.toString()));
    } else if (raw.length && ctype.includes('json')) {
      try {
        body = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '') || null;
    const method = req.method ?? 'GET';
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.join(',') : String(v ?? ''),
      ]),
    );
    this.requests.push({
      method,
      path: url.pathname,
      query: url.searchParams,
      auth,
      headers,
      body,
      raw,
    });
    const failure = this.failures.find(
      (f) => f.method === method && f.path.test(url.pathname) && f.times > 0,
    );
    if (failure) {
      failure.times -= 1;
      return json(res, failure.status, failure.body, failure.headers);
    }
    if (/^\/v1\.0\/subscriptions(\/|$)/.test(url.pathname)) {
      const sub = await this.subscriptionRoute(method, url.pathname, body, auth);
      return json(res, sub.status, sub.body);
    }
    const out = this.route(method, url, body, auth, raw, headers);
    if (out.bytes) {
      res.writeHead(out.status, { 'content-type': 'application/octet-stream' });
      res.end(out.bytes);
      return;
    }
    json(res, out.status, out.body);
  }

  // --- change notifications ----------------------------------------------------------------------------------------------------

  /** `subscriptions`: create (with the validation handshake), renew (PATCH) and delete, the way the documentation describes them. */
  private async subscriptionRoute(
    method: string,
    path: string,
    body: Record<string, unknown>,
    token: string | null,
  ): Promise<{ status: number; body?: unknown }> {
    const live = token ? this.accessTokens.get(token) : undefined;
    if (!live?.valid) {
      return graphError(
        401,
        'InvalidAuthenticationToken',
        'Access token has expired or is not yet valid.',
      );
    }
    const one = /^\/v1\.0\/subscriptions\/([^/]+)$/.exec(path);
    const shape = (x: FakeSubscription) => ({
      id: x.id,
      resource: x.resource,
      changeType: x.changeType,
      notificationUrl: x.notificationUrl,
      lifecycleNotificationUrl: x.lifecycleNotificationUrl,
      clientState: x.clientState,
      expirationDateTime: new Date(x.expires).toISOString(),
    });
    const checkExpiry = (value: unknown): number | null => {
      const t = Date.parse(String(value ?? ''));
      if (!Number.isFinite(t) || t <= Date.now()) return null;
      return Math.min(t, Date.now() + SUBSCRIPTION_MAX_MINUTES * 60_000) === t ? t : null;
    };
    if (!one && method === 'POST') {
      const notificationUrl = String(body.notificationUrl ?? '');
      const expires = checkExpiry(body.expirationDateTime);
      if (!notificationUrl || !body.resource || !body.clientState || expires === null) {
        return graphError(400, 'ValidationError', 'The subscription request is not valid.');
      }
      if (String(body.clientState).length > 128) {
        return graphError(400, 'ValidationError', 'clientState is longer than 128 characters.');
      }
      const token0 = `vt-${++this.seq}-${Math.random().toString(36).slice(2)}`;
      const checked = this.validator
        ? await this.validator(notificationUrl, token0).catch(() => null)
        : null;
      if (!checked || checked.status !== 200 || checked.text !== token0) {
        return graphError(
          400,
          'ValidationError',
          'Subscription validation request failed. Notification endpoint must respond with 200 OK to validation request.',
        );
      }
      const sub: FakeSubscription = {
        id: `sub-${++this.seq}`,
        account: live.account.mail,
        resource: String(body.resource),
        changeType: String(body.changeType ?? 'created'),
        notificationUrl,
        lifecycleNotificationUrl: String(body.lifecycleNotificationUrl ?? ''),
        clientState: String(body.clientState),
        expires,
      };
      this.subscriptions.set(sub.id, sub);
      return { status: 201, body: shape(sub) };
    }
    const sub = one ? this.subscriptions.get(decodeURIComponent(one[1]!)) : undefined;
    if (one && (!sub || sub.account !== live.account.mail || sub.expires <= Date.now())) {
      return graphError(404, 'ResourceNotFound', 'The object was not found.');
    }
    if (one && method === 'PATCH') {
      const expires = checkExpiry(body.expirationDateTime);
      if (expires === null)
        return graphError(400, 'ValidationError', 'The expiration is not valid.');
      sub!.expires = expires;
      return { status: 200, body: shape(sub!) };
    }
    if (one && method === 'DELETE') {
      this.subscriptions.delete(sub!.id);
      return { status: 204 };
    }
    return graphError(404, 'ErrorItemNotFound');
  }

  subscriptionsOf(mail: string): FakeSubscription[] {
    return [...this.subscriptions.values()].filter((x) => x.account === mail);
  }

  /** Graph drops a subscription (it lapsed): the next renewal answers 404. */
  dropSubscription(id: string): void {
    this.subscriptions.delete(id);
  }

  /** The body Graph posts for new mail on a subscription (the ids are mutable ids, as in Microsoft's notifications). */
  notification(
    sub: FakeSubscription,
    extra: { lifecycleEvent?: string; clientState?: string; subscriptionId?: string } = {},
  ): Record<string, unknown> {
    return {
      value: [
        {
          subscriptionId: extra.subscriptionId ?? sub.id,
          subscriptionExpirationDateTime: new Date(sub.expires).toISOString(),
          clientState: extra.clientState ?? sub.clientState,
          resource: 'Users/oid/Messages/mutable-id',
          resourceData: { '@odata.type': '#Microsoft.Graph.Message', id: 'mutable-id' },
          ...(extra.lifecycleEvent
            ? { lifecycleEvent: extra.lifecycleEvent }
            : { changeType: sub.changeType }),
          tenantId: 'tenant',
        },
      ],
    };
  }

  private route(
    method: string,
    url: URL,
    body: Record<string, unknown>,
    token: string | null,
    raw: Buffer,
    headers: Record<string, string>,
  ): { status: number; body?: unknown; bytes?: Buffer } {
    const path = url.pathname;
    if (/^\/login\/[^/]+\/oauth2\/v2\.0\/token$/.test(path) && method === 'POST')
      return this.token(body);
    // An upload session carries its own authorisation (no bearer).
    const up = /^\/upload\/([^/]+)$/.exec(path);
    if (up && method === 'PUT')
      return this.uploadChunk(up[1]!, raw, headers['content-range'] ?? '');

    const live = token ? this.accessTokens.get(token) : undefined;
    if (!live?.valid) {
      return graphError(
        401,
        'InvalidAuthenticationToken',
        'Access token has expired or is not yet valid.',
      );
    }
    const api = path.replace(/^\/v1\.0/, '');
    const box = this.boxes.get(live.account.mail);
    if (!box) return graphError(404, 'MailboxNotEnabledForRESTAPI');
    if (api === '/me' && method === 'GET') {
      return {
        status: 200,
        body: {
          id: live.account.id,
          displayName: live.account.name,
          mail: live.account.mail,
          userPrincipalName: live.account.mail,
        },
      };
    }
    if (api === '/me/mailFolders/inbox/messages/delta' && method === 'GET')
      return this.delta(box, url, headers);
    const folderList = /^\/me\/mailFolders\/(sentitems|drafts)\/messages$/.exec(api);
    if (folderList && method === 'GET') return this.listFolder(box, folderList[1]!, url);
    if (api === '/me/messages' && method === 'GET') return this.listFolder(box, null, url);
    if (api === '/me/messages' && method === 'POST') return this.createDraft(box, body);

    const att = /^\/me\/messages\/([^/]+)\/attachments\/([^/]+)\/\$value$/.exec(api);
    if (att && method === 'GET') {
      const a = box.messages
        .get(decodeURIComponent(att[1]!))
        ?.attachments.find((x) => x.id === decodeURIComponent(att[2]!));
      return a ? { status: 200, bytes: a.data } : graphError(404, 'ErrorItemNotFound');
    }
    const attList = /^\/me\/messages\/([^/]+)\/attachments$/.exec(api);
    if (attList && method === 'GET') {
      const m = box.messages.get(decodeURIComponent(attList[1]!));
      if (!m) return graphError(404, 'ErrorItemNotFound');
      return {
        status: 200,
        body: {
          value: m.attachments.map((a) => ({
            '@odata.type':
              a.kind === 'item'
                ? '#microsoft.graph.itemAttachment'
                : '#microsoft.graph.fileAttachment',
            id: a.id,
            name: a.name,
            contentType: a.mime,
            size: a.data.length,
            isInline: a.inline ?? false,
            contentId: a.contentId ?? null,
          })),
        },
      };
    }
    if (attList && method === 'POST') {
      const m = box.messages.get(decodeURIComponent(attList[1]!));
      if (!m?.isDraft) return graphError(404, 'ErrorItemNotFound');
      const size = Buffer.from(String(body.contentBytes ?? ''), 'base64').length;
      if (size > 3 * 1024 * 1024)
        return graphError(413, 'ErrorMessageSizeExceeded', 'use an upload session');
      m.attachments.push({
        id: `att-${m.id}-${m.attachments.length}`,
        name: String(body.name),
        mime: String(body.contentType),
        data: Buffer.from(String(body.contentBytes), 'base64'),
      });
      return { status: 201, body: { id: m.attachments.at(-1)!.id } };
    }
    const session = /^\/me\/messages\/([^/]+)\/attachments\/createUploadSession$/.exec(api);
    if (session && method === 'POST') {
      const id = decodeURIComponent(session[1]!);
      const item = (body.AttachmentItem ?? {}) as Record<string, unknown>;
      const key = `u${++this.seq}`;
      this.uploads.set(key, {
        draft: id,
        email: live.account.mail,
        name: String(item.name),
        mime: String(item.contentType),
        chunks: [],
      });
      return {
        status: 200,
        body: {
          uploadUrl: `${this.url}/upload/${key}`,
          expirationDateTime: new Date().toISOString(),
        },
      };
    }
    const reply = /^\/me\/messages\/([^/]+)\/createReply$/.exec(api);
    if (reply && method === 'POST') return this.createReply(box, decodeURIComponent(reply[1]!));
    const send = /^\/me\/messages\/([^/]+)\/send$/.exec(api);
    if (send && method === 'POST')
      return this.sendDraft(box, live.account.mail, decodeURIComponent(send[1]!));
    const one = /^\/me\/messages\/([^/]+)$/.exec(api);
    if (one) {
      const m = box.messages.get(decodeURIComponent(one[1]!));
      if (!m)
        return graphError(
          404,
          'ErrorItemNotFound',
          'The specified object was not found in the store.',
        );
      if (method === 'GET') return { status: 200, body: this.shape(m) };
      if (method === 'DELETE') {
        box.messages.delete(m.id);
        if (m.folder === 'inbox') this.log(box, m.id, true);
        return { status: 204 };
      }
      if (method === 'PATCH') {
        if (!m.isDraft)
          return graphError(400, 'ErrorInvalidMessage', 'Only drafts can be changed.');
        this.apply(m, body);
        return { status: 200, body: this.shape(m) };
      }
    }
    return graphError(404, 'ErrorItemNotFound');
  }

  private shape(m: Stored) {
    const who = (list: string[]) =>
      list.map((address) => ({ emailAddress: { address, name: address } }));
    return {
      id: m.id,
      conversationId: m.conversationId,
      internetMessageId: m.internetMessageId,
      subject: m.subject,
      from: { emailAddress: { name: m.from.name, address: m.from.address } },
      sender: { emailAddress: { name: m.from.name, address: m.from.address } },
      toRecipients: who(m.to),
      ccRecipients: who(m.cc),
      bccRecipients: who(m.bcc),
      replyTo: [],
      receivedDateTime: new Date(m.received).toISOString(),
      sentDateTime: new Date(m.received).toISOString(),
      body: { contentType: m.bodyType, content: m.body },
      hasAttachments: m.attachments.some((a) => !a.inline),
      isDraft: m.isDraft,
      isRead: false,
      categories: [],
      internetMessageHeaders: m.headers,
      parentFolderId: m.folder,
    };
  }

  private apply(m: Stored, body: Record<string, unknown>) {
    const addrs = (v: unknown) =>
      ((v as Array<{ emailAddress?: { address?: string } }> | undefined) ?? []).map(
        (r) => r.emailAddress?.address ?? '',
      );
    if (typeof body.subject === 'string') m.subject = body.subject;
    const b = body.body as { contentType?: string; content?: string } | undefined;
    if (b) {
      m.bodyType = b.contentType === 'text' ? 'text' : 'html';
      m.body = b.content ?? '';
    }
    if (body.toRecipients) m.to = addrs(body.toRecipients);
    if (body.ccRecipients) m.cc = addrs(body.ccRecipients);
    if (body.bccRecipients) m.bcc = addrs(body.bccRecipients);
    if (typeof body.internetMessageId === 'string') {
      m.internetMessageId = body.internetMessageId;
      m.headers = m.headers.filter((h) => h.name.toLowerCase() !== 'message-id');
      m.headers.push({ name: 'Message-ID', value: body.internetMessageId });
    }
  }

  private createDraft(box: Box, body: Record<string, unknown>) {
    const hdrs =
      (body.internetMessageHeaders as Array<{ name: string; value: string }> | undefined) ?? [];
    const bad = hdrs.find((h) => !/^x-/i.test(h.name));
    if (bad) {
      return graphError(
        400,
        'InvalidInternetMessageHeader',
        `The internet message header name '${bad.name}' should start with 'x-' or 'X-'.`,
      );
    }
    const id = `AAMk${++this.seq}`;
    const m: Stored = {
      id,
      conversationId: `conv-${id}`,
      internetMessageId: `<${id}@fake.outlook>`,
      subject: '',
      from: { name: '', address: '' },
      to: [],
      cc: [],
      bcc: [],
      bodyType: 'html',
      body: '',
      headers: [...hdrs],
      received: Date.now(),
      folder: 'drafts',
      isDraft: true,
      attachments: [],
    };
    this.apply(m, body);
    box.messages.set(id, m);
    return { status: 201, body: this.shape(m) };
  }

  private createReply(box: Box, originalId: string) {
    const orig = box.messages.get(originalId);
    if (!orig) return graphError(404, 'ErrorItemNotFound');
    const id = `AAMk${++this.seq}`;
    const refs = orig.headers.find((h) => h.name.toLowerCase() === 'references')?.value ?? '';
    const m: Stored = {
      id,
      conversationId: orig.conversationId,
      internetMessageId: `<${id}@fake.outlook>`,
      subject: `RE: ${orig.subject}`,
      from: { name: '', address: '' },
      to: [orig.from.address],
      cc: [],
      bcc: [],
      bodyType: 'html',
      body: `<hr>quoted: ${orig.body}`,
      headers: [
        { name: 'In-Reply-To', value: orig.internetMessageId },
        { name: 'References', value: `${refs} ${orig.internetMessageId}`.trim() },
      ],
      received: Date.now(),
      folder: 'drafts',
      isDraft: true,
      attachments: [],
    };
    box.messages.set(id, m);
    return { status: 201, body: this.shape(m) };
  }

  private uploadChunk(key: string, bytes: Buffer, range: string) {
    const u = this.uploads.get(key);
    if (!u) return graphError(404, 'ErrorItemNotFound');
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (!m) return graphError(400, 'invalidRange');
    u.chunks.push(bytes);
    if (Number(m[2]) + 1 === Number(m[3])) {
      const draft = this.boxes.get(u.email)?.messages.get(u.draft);
      draft?.attachments.push({
        id: `att-${u.draft}-${draft.attachments.length}`,
        name: u.name,
        mime: u.mime,
        data: Buffer.concat(u.chunks),
      });
      return { status: 201, body: {} };
    }
    return {
      status: 200,
      body: { nextExpectedRanges: [`${Number(m[2]) + 1}-${Number(m[3]) - 1}`] },
    };
  }

  private sendDraft(box: Box, email: string, id: string) {
    const m = box.messages.get(id);
    if (!m?.isDraft) return graphError(404, 'ErrorItemNotFound');
    if (m.to.length + m.cc.length + m.bcc.length === 0)
      return graphError(400, 'ErrorMissingRecipients');
    m.isDraft = false;
    m.folder = 'sentitems';
    m.from = { name: email, address: email };
    m.received = Date.now();
    this.sent.push({ id, account: email, message: m });
    return { status: 202 };
  }

  private listFolder(box: Box, folder: string | null, url: URL) {
    const filter = url.searchParams.get('$filter') ?? '';
    const wanted = /internetMessageId eq '((?:[^']|'')*)'/.exec(filter)?.[1]?.replace(/''/g, "'");
    const value = [...box.messages.values()]
      .filter((m) => (folder ? m.folder === folder : true))
      .filter((m) => (wanted ? m.internetMessageId === wanted : true))
      .slice(0, Number(url.searchParams.get('$top') ?? 50))
      .map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        internetMessageId: m.internetMessageId,
      }));
    return { status: 200, body: { value } };
  }

  /** Inbox delta. `$deltatoken` = changes after that point; none = a new round (all Inbox mail passing the filter). Pages by `$skiptoken`. */
  private delta(box: Box, url: URL, headers: Record<string, string>) {
    const q = url.searchParams;
    const prefer = /odata\.maxpagesize=(\d+)/.exec(headers.prefer ?? '')?.[1];
    const size = prefer ? Number(prefer) : this.pageSize;
    const tokenParam = q.get('$deltatoken');
    const base = q.get('$base');
    const skip = Number(q.get('$skiptoken') ?? 0);
    let items: Array<{ id: string; removed: boolean }>;
    if (tokenParam !== null) {
      const from = Number(tokenParam);
      if (from < box.earliest)
        return graphError(410, 'syncStateNotFound', 'The sync state generation is not found.');
      const seen = new Map<string, boolean>();
      for (const e of box.log) if (e.seq > from) seen.set(e.id, e.removed);
      items = [...seen].map(([id, removed]) => ({ id, removed }));
    } else {
      const since = /receivedDateTime ge (\S+)/.exec(q.get('$filter') ?? '')?.[1];
      const floor = since ? Date.parse(since) : 0;
      items = [...box.messages.values()]
        .filter((m) => m.folder === 'inbox' && m.received >= floor)
        .map((m) => ({ id: m.id, removed: false }));
    }
    const snapshot = base !== null ? Number(base) : box.seq;
    const page = items.slice(skip, skip + size);
    const value = page.map((i) => {
      if (i.removed) return { id: i.id, '@removed': { reason: 'deleted' } };
      const m = box.messages.get(i.id);
      if (!m) return { id: i.id, '@removed': { reason: 'deleted' } };
      return {
        id: m.id,
        conversationId: m.conversationId,
        receivedDateTime: new Date(m.received).toISOString(),
        isDraft: m.isDraft,
        from: { emailAddress: { name: m.from.name, address: m.from.address } },
      };
    });
    const out: Record<string, unknown> = { value };
    const common = `${this.url}/v1.0/me/mailFolders/inbox/messages/delta`;
    if (skip + size < items.length) {
      const next = new URLSearchParams();
      if (tokenParam !== null) next.set('$deltatoken', tokenParam);
      else if (q.get('$filter')) next.set('$filter', q.get('$filter')!);
      next.set('$base', String(snapshot));
      next.set('$skiptoken', String(skip + size));
      out['@odata.nextLink'] = `${common}?${next.toString()}`;
    } else {
      out['@odata.deltaLink'] = `${common}?$deltatoken=${snapshot}`;
    }
    return { status: 200, body: out };
  }

  private token(form: Record<string, unknown>) {
    if (form.client_id !== this.clientId || form.client_secret !== this.clientSecret) {
      return {
        status: 401,
        body: {
          error: 'invalid_client',
          error_description: 'AADSTS7000215: Invalid client secret provided.',
          error_codes: [7000215],
        },
      };
    }
    const newAccess = (account: GraphAccount) => {
      const t = `at-${++this.seq}`;
      this.accessTokens.set(t, { account, valid: true });
      return t;
    };
    const newRefresh = (account: GraphAccount) => {
      const rt = `rt-${++this.seq}`;
      this.refreshTokens.set(rt, { account, valid: true });
      return rt;
    };
    if (form.grant_type === 'authorization_code') {
      const grant = this.codes.get(String(form.code));
      this.codes.delete(String(form.code));
      if (!grant) {
        return {
          status: 400,
          body: {
            error: 'invalid_grant',
            error_description: 'AADSTS70008: The provided authorization code has expired.',
            error_codes: [70008],
          },
        };
      }
      const out: Record<string, unknown> = {
        access_token: newAccess(grant.account),
        expires_in: 3599,
        scope: grant.scope ?? MS_SCOPES,
        token_type: 'Bearer',
      };
      if (grant.refresh !== false) out.refresh_token = newRefresh(grant.account);
      return { status: 200, body: out };
    }
    if (form.grant_type === 'refresh_token') {
      const rt = this.refreshTokens.get(String(form.refresh_token));
      if (!rt?.valid) {
        return {
          status: 400,
          body: {
            error: 'invalid_grant',
            error_description: 'AADSTS700082: The refresh token has expired due to inactivity.',
            error_codes: [700082],
          },
        };
      }
      return {
        status: 200,
        body: {
          access_token: newAccess(rt.account),
          refresh_token: newRefresh(rt.account),
          expires_in: 3599,
          scope: MS_SCOPES,
          token_type: 'Bearer',
        },
      };
    }
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }
}
