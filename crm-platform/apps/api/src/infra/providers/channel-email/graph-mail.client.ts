import { Injectable } from '@nestjs/common';
import { channelEmailEnv } from '../../../config/domains/channel-email.env';
import { microsoftBytes, microsoftSend, microsoftStatus } from './microsoft-http';
import { classifyGraphError, MicrosoftMailError } from './microsoft-mail.errors';
import type {
  GraphAttachment,
  GraphDeltaPage,
  GraphDraft,
  GraphDraftInput,
  GraphMessage,
} from './graph.types';

type Json = Record<string, unknown>;
const enc = encodeURIComponent;
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Graph's inline JSON attachment limit; a bigger file goes through an upload session (learn.microsoft.com, attach large files). */
export const GRAPH_INLINE_ATTACHMENT_MAX = 3 * 1024 * 1024;
/** Upload-session chunks must be a multiple of 320 KiB. */
const CHUNK = 327_680 * 9;

const SELECT_LIST = 'id,conversationId,receivedDateTime,isDraft,from';
const SELECT_ONE = [
  'id',
  'conversationId',
  'internetMessageId',
  'subject',
  'from',
  'sender',
  'toRecipients',
  'ccRecipients',
  'bccRecipients',
  'replyTo',
  'receivedDateTime',
  'sentDateTime',
  'body',
  'hasAttachments',
  'isDraft',
  'isRead',
  'categories',
  'internetMessageHeaders',
  'parentFolderId',
].join(',');

/**
 * The Microsoft Graph mail API (v1.0) the Email channel uses, one method per call (TW-MAIL-034). Plain HTTP with a timeout: no tenant, no
 * database, no secret of its own; every access token is an argument and every failure is a `MicrosoftMailError`. Message ids are
 * immutable ids (`Prefer: IdType="ImmutableId"`), so an id survives a move between folders and is a safe ledger key. The base address comes
 * from the environment so a test can aim it at a local stand-in. Not verified against a live Microsoft tenant in this repository.
 */
@Injectable()
export class GraphMailClient {
  private get base(): string {
    return channelEmailEnv().MICROSOFT_GRAPH_URL.replace(/\/$/, '');
  }
  private get timeoutMs(): number {
    return channelEmailEnv().MICROSOFT_MAIL_HTTP_TIMEOUT_MS;
  }

  private api(
    token: string,
    method: string,
    pathOrUrl: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Json> {
    const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${this.base}${pathOrUrl}`;
    return microsoftSend(url, {
      method,
      token,
      headers: {
        prefer: 'IdType="ImmutableId"',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs: this.timeoutMs,
      classify: classifyGraphError,
    });
  }

  /**
   * One page of the Inbox delta. `link` is a `nextLink` / `deltaLink` to continue; without it a new round starts, limited to mail received
   * since `since` (a filter on `receivedDateTime`, the one a delta query supports). A delta token Graph no longer keeps answers 410
   * (`MicrosoftMailError('gone')`): the caller starts a new round.
   */
  async inboxDelta(
    token: string,
    opts: { link?: string | null; since?: Date; pageSize?: number },
  ): Promise<GraphDeltaPage> {
    const url =
      opts.link ??
      `/me/mailFolders/inbox/messages/delta?$select=${SELECT_LIST}${
        opts.since ? `&$filter=${enc(`receivedDateTime ge ${opts.since.toISOString()}`)}` : ''
      }`;
    const body = await this.api(token, 'GET', url, undefined, {
      prefer: `IdType="ImmutableId", odata.maxpagesize=${opts.pageSize ?? 50}`,
    });
    return {
      messages: ((body.value as GraphMessage[] | undefined) ?? []).filter(
        (m) => m && typeof m.id === 'string',
      ),
      nextLink: str(body['@odata.nextLink']),
      deltaLink: str(body['@odata.deltaLink']),
    };
  }

  async getMessage(token: string, id: string): Promise<GraphMessage> {
    return (await this.api(
      token,
      'GET',
      `/me/messages/${enc(id)}?$select=${SELECT_ONE}`,
    )) as unknown as GraphMessage;
  }

  /** File and item attachments of a message, metadata only (no bytes). */
  async listAttachments(token: string, id: string): Promise<GraphAttachment[]> {
    const body = await this.api(
      token,
      'GET',
      `/me/messages/${enc(id)}/attachments?$select=id,name,contentType,size,isInline,contentId`,
    );
    return ((body.value as GraphAttachment[] | undefined) ?? []).filter((a) => a && a.id);
  }

  /** The bytes of an attachment (`$value`: the file, or the raw MIME of an attached message). */
  attachmentBytes(token: string, messageId: string, attachmentId: string): Promise<Buffer> {
    return microsoftBytes(
      `${this.base}/me/messages/${enc(messageId)}/attachments/${enc(attachmentId)}/$value`,
      {
        token,
        headers: { prefer: 'IdType="ImmutableId"', accept: '*/*' },
        timeoutMs: this.timeoutMs,
        classify: classifyGraphError,
      },
    );
  }

  /** A message by its RFC 5322 Message-ID (with brackets), in any folder of the mailbox, or null. */
  async findByInternetId(token: string, internetId: string): Promise<GraphDraft | null> {
    return this.firstMatch(token, '/me/messages', internetId);
  }

  async findSent(token: string, internetId: string): Promise<GraphDraft | null> {
    return this.firstMatch(token, '/me/mailFolders/sentitems/messages', internetId);
  }

  async findDraft(token: string, internetId: string): Promise<GraphDraft | null> {
    return this.firstMatch(token, '/me/mailFolders/drafts/messages', internetId);
  }

  private async firstMatch(
    token: string,
    path: string,
    internetId: string,
  ): Promise<GraphDraft | null> {
    const filter = `internetMessageId eq '${internetId.replace(/'/g, "''")}'`;
    const body = await this.api(
      token,
      'GET',
      `${path}?$filter=${enc(filter)}&$select=id,conversationId,internetMessageId&$top=1`,
    );
    const first = (body.value as Json[] | undefined)?.[0];
    return first ? draftOf(first) : null;
  }

  /** A reply draft of a stored message: Graph fills In-Reply-To, References and the conversation. */
  async createReply(token: string, messageId: string): Promise<GraphDraft> {
    return draftOf(await this.api(token, 'POST', `/me/messages/${enc(messageId)}/createReply`, {}));
  }

  async createDraft(token: string, input: GraphDraftInput): Promise<GraphDraft> {
    const headers = Object.entries(input.headers).map(([name, value]) => ({ name, value }));
    return draftOf(
      await this.api(token, 'POST', '/me/messages', {
        ...this.draftBody(input),
        ...(headers.length ? { internetMessageHeaders: headers } : {}),
      }),
    );
  }

  /** Replaces the draft's subject, body, recipients and Message-ID with ours (a reply draft arrives with a quoted body). */
  async updateDraft(token: string, id: string, input: GraphDraftInput): Promise<GraphDraft> {
    return draftOf(
      await this.api(token, 'PATCH', `/me/messages/${enc(id)}`, this.draftBody(input)),
    );
  }

  private draftBody(input: GraphDraftInput): Json {
    const who = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
    return {
      subject: input.subject,
      body: { contentType: input.bodyType, content: input.body },
      toRecipients: who(input.to),
      ccRecipients: who(input.cc),
      bccRecipients: who(input.bcc),
      internetMessageId: input.internetMessageId,
    };
  }

  /** Attaches a file: inline JSON up to 3 MB, an upload session above. */
  async attach(
    token: string,
    draftId: string,
    file: { name: string; mime: string; bytes: Buffer },
  ): Promise<void> {
    if (file.bytes.length <= GRAPH_INLINE_ATTACHMENT_MAX) {
      await this.api(token, 'POST', `/me/messages/${enc(draftId)}/attachments`, {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: file.name,
        contentType: file.mime,
        contentBytes: file.bytes.toString('base64'),
      });
      return;
    }
    const session = await this.api(
      token,
      'POST',
      `/me/messages/${enc(draftId)}/attachments/createUploadSession`,
      {
        AttachmentItem: {
          attachmentType: 'file',
          name: file.name,
          size: file.bytes.length,
          contentType: file.mime,
        },
      },
    );
    const uploadUrl = str(session.uploadUrl);
    if (!uploadUrl) throw new MicrosoftMailError('server', 200, 'no_upload_url');
    for (let start = 0; start < file.bytes.length; start += CHUNK) {
      const end = Math.min(start + CHUNK, file.bytes.length);
      // The upload URL carries its own authorisation: no bearer token.
      await microsoftStatus(uploadUrl, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'content-range': `bytes ${start}-${end - 1}/${file.bytes.length}`,
        },
        body: file.bytes.subarray(start, end),
        timeoutMs: this.timeoutMs,
        classify: classifyGraphError,
      });
    }
  }

  async sendDraft(token: string, id: string): Promise<void> {
    await this.api(token, 'POST', `/me/messages/${enc(id)}/send`);
  }

  async deleteMessage(token: string, id: string): Promise<void> {
    try {
      await this.api(token, 'DELETE', `/me/messages/${enc(id)}`);
    } catch (err) {
      if (!(err instanceof MicrosoftMailError) || err.kind !== 'not_found') throw err;
    }
  }

  /**
   * A change-notification subscription on new Inbox mail. Graph validates `notificationUrl` before answering (it POSTs the
   * `validationToken` and expects it back), so this call also proves the public address is reachable. Throws `MicrosoftMailError`
   * (`bad_request` when the validation failed, `forbidden` when the permission is missing).
   */
  async createSubscription(
    token: string,
    input: {
      notificationUrl: string;
      lifecycleNotificationUrl: string;
      resource: string;
      expirationDateTime: string;
      clientState: string;
    },
  ): Promise<{ id: string; expirationDateTime: string }> {
    const body = await this.api(token, 'POST', '/subscriptions', {
      changeType: 'created',
      ...input,
    });
    return subscriptionOf(body);
  }

  /** Moves the end of a subscription. `MicrosoftMailError('not_found')` when Graph no longer has it. */
  async renewSubscription(
    token: string,
    id: string,
    expirationDateTime: string,
  ): Promise<{ id: string; expirationDateTime: string }> {
    const body = await this.api(token, 'PATCH', `/subscriptions/${enc(id)}`, {
      expirationDateTime,
    });
    return subscriptionOf({ id, ...body });
  }

  /** Withdraws a subscription; already gone is fine. */
  async deleteSubscription(token: string, id: string): Promise<void> {
    try {
      await this.api(token, 'DELETE', `/subscriptions/${enc(id)}`);
    } catch (err) {
      if (!(err instanceof MicrosoftMailError) || err.kind !== 'not_found') throw err;
    }
  }

  /** A cheap authenticated call: the account's address. */
  async mailboxAddress(token: string): Promise<string | null> {
    const body = await this.api(token, 'GET', '/me?$select=mail,userPrincipalName');
    return str(body.mail) ?? str(body.userPrincipalName);
  }
}

function subscriptionOf(b: Json): { id: string; expirationDateTime: string } {
  const id = str(b.id);
  const expirationDateTime = str(b.expirationDateTime);
  if (!id || !expirationDateTime) throw new MicrosoftMailError('server', 200, 'bad_subscription');
  return { id, expirationDateTime };
}

function draftOf(b: Json): GraphDraft {
  return {
    id: String(b.id ?? ''),
    conversationId: str(b.conversationId),
    internetMessageId: str(b.internetMessageId),
  };
}
