import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  MICROSOFT_MAIL_REQUIRED_SCOPES,
  MICROSOFT_MAIL_SCOPES,
} from '../../../config/domains/channel-email.env';
import {
  GraphMailClient,
  MicrosoftMailError,
  MicrosoftMailOAuthClient,
  graphSkip,
  normaliseGraphMessage,
  resolveThreadKey,
  type GraphAttachment,
  type GraphDraftInput,
  type GraphMessage,
  type MailAccountProfile,
  type NormalisedMail,
  type OutgoingMail,
} from '../../../infra/providers/channel-email';
import {
  GRAPH_SUBSCRIPTION_KIND,
  GRAPH_SUBSCRIPTION_MINUTES,
  GRAPH_SUBSCRIPTION_RESOURCE,
} from '../graph-push-rules';
import { MicrosoftMailConfig } from '../microsoft-mail-config.service';
import {
  MailDriverError,
  type MailCursor,
  type MailDriverContext,
  type MailHealthResult,
  type MailOAuthGrant,
  type MailOAuthRefreshed,
  type MailPushState,
  type MailPushSupport,
  type MailSendResult,
  type MailSyncBatch,
  type MailSyncMode,
  type MailSyncOptions,
  type OAuthMailDriver,
  sendMayHaveCommitted,
  sendOutcomeUnknown,
} from './mail-driver';
import { MailDriverRegistry } from './mail-driver.registry';

const token = (ctx: MailDriverContext): string => {
  if (ctx.access.kind !== 'oauth') {
    throw new MailDriverError('bad_request', 'No Microsoft access.');
  }
  return ctx.access.accessToken;
};

/**
 * The Microsoft Graph cursor. `deltaLink`: a finished delta round (the next run asks for what changed). `nextLink` + `phase`: a round that
 * was not read to its end (more pages than one run reads): the next run continues it, in the same mode.
 */
interface GraphCursor {
  deltaLink: string | null;
  nextLink: string | null;
  phase: MailSyncMode;
}

function readCursor(cursor: MailCursor | null): GraphCursor {
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const phase = cursor?.phase;
  return {
    deltaLink: text(cursor?.deltaLink),
    nextLink: text(cursor?.nextLink),
    phase: phase === 'backfill' || phase === 'repair' || phase === 'history' ? phase : 'backfill',
  };
}

const MS_PER_DAY = 86_400_000;
const bracket = (id: string) => `<${id.replace(/^<|>$/g, '')}>`;

/** Scope names as Microsoft returns them (any case, sometimes with the Graph address in front) in the names we ask for. */
export function canonicalScopes(scope: string): string[] {
  const known = new Map<string, string>(MICROSOFT_MAIL_SCOPES.map((s) => [s.toLowerCase(), s]));
  return scope
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, ''))
    .map((s) => known.get(s.toLowerCase()) ?? s);
}

/**
 * Microsoft 365 / Outlook.com behind the mail-driver port (TW-MAIL-034), through Microsoft Graph. OAuth 2.0 authorization-code flow on the
 * Microsoft identity platform; the Inbox is read with delta queries (`deltaLink` cursor); a reply is sent as a Graph draft (a reply draft
 * of the stored original, so Exchange writes In-Reply-To and References) that is then sent. Thread key = `resolveThreadKey` with Graph's
 * `conversationId`. Microsoft's own errors never leave this class: they leave as {@link MailDriverError} with our words.
 */
@Injectable()
export class MicrosoftMailDriver implements OAuthMailDriver, OnModuleInit {
  readonly provider = 'microsoft' as const;
  readonly authKind = 'oauth' as const;
  readonly label = 'Microsoft 365 / Outlook';
  readonly requiredScopes: readonly string[] = MICROSOFT_MAIL_REQUIRED_SCOPES;
  private readonly logger = new Logger(MicrosoftMailDriver.name);

  constructor(
    private readonly graph: GraphMailClient,
    private readonly oauthClient: MicrosoftMailOAuthClient,
    private readonly config: MicrosoftMailConfig,
    private readonly registry: MailDriverRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async readiness(): Promise<{ ready: boolean; notReadyReason: string | null }> {
    const ready = await this.config.ready();
    return {
      ready,
      notReadyReason: ready ? null : 'The platform has no Microsoft app for mail yet.',
    };
  }

  // --- oauth ---------------------------------------------------------------------------------------------------------------------

  async authorizeUrl(input: { state: string; loginHint: string | null }): Promise<string> {
    const creds = await this.config.credentials();
    if (!creds) {
      throw new MailDriverError(
        'not_configured',
        'Microsoft 365 is not set up for this platform. Ask your platform administrator to add the Microsoft app.',
      );
    }
    return this.oauthClient.authorizeUrl(creds, input.state, input.loginHint ?? undefined);
  }

  async exchange(code: string): Promise<MailOAuthGrant> {
    const creds = await this.credentials();
    try {
      const grant = await this.oauthClient.exchangeCode(creds, code);
      return {
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken,
        expiresInSeconds: grant.expiresInSeconds,
        scopes: canonicalScopes(grant.scope),
      };
    } catch (err) {
      throw this.fail(err, 'auth');
    }
  }

  async refresh(refreshToken: string): Promise<MailOAuthRefreshed> {
    const creds = await this.credentials();
    try {
      const tokens = await this.oauthClient.refresh(creds, refreshToken);
      return {
        accessToken: tokens.accessToken,
        expiresInSeconds: tokens.expiresInSeconds,
        refreshToken: tokens.refreshToken,
      };
    } catch (err) {
      throw this.fail(err, 'auth');
    }
  }

  /**
   * Microsoft has no endpoint that withdraws one refresh token (only one that signs the person out everywhere, which this must not do).
   * The grant ends when the person removes the app at myapps.microsoft.com or account.microsoft.com, or after 90 days unused: so a
   * disconnect forgets the tokens here and does not call Microsoft.
   */
  async revoke(): Promise<void> {
    return;
  }

  async profile(accessToken: string): Promise<MailAccountProfile> {
    try {
      const account = await this.oauthClient.me(accessToken);
      return { address: account.address ?? '', sub: account.id, name: account.name };
    } catch (err) {
      throw this.fail(err, 'auth');
    }
  }

  // --- push (E-17) ---------------------------------------------------------------------------------------------------------------

  private pushSupport: MailPushSupport | null = null;

  /**
   * Graph change notifications: a subscription on new Inbox mail, renewed before it ends (Graph keeps one for under three days).
   * A notification only says "something arrived": the sync then reads the Inbox through the delta cursor. The notification's own message
   * id is NOT used to fetch the message: Graph sends mutable ids, while the ledger key is the immutable id, and reading around the
   * cursor could store a message twice or out of order.
   */
  get push(): MailPushSupport {
    this.pushSupport ??= {
      available: async () => (await this.config.push()) !== null,
      start: async (ctx): Promise<MailPushState | null> => {
        const cfg = await this.config.push();
        if (!cfg) return null;
        const accessToken = token(ctx);
        const expirationDateTime = new Date(
          Date.now() + GRAPH_SUBSCRIPTION_MINUTES * 60_000,
        ).toISOString();
        const stateOf = (id: string, expiresAt: string): MailPushState => ({
          kind: GRAPH_SUBSCRIPTION_KIND,
          id,
          expiresAt: new Date(expiresAt).toISOString(),
        });
        try {
          const existing = ctx.mailbox.pushState;
          const knownId =
            existing?.kind === GRAPH_SUBSCRIPTION_KIND && typeof existing.id === 'string'
              ? existing.id
              : null;
          if (knownId) {
            // Renew in place. A subscription Graph no longer has (it lapsed, or was removed) is replaced by a new one.
            try {
              const renewed = await this.graph.renewSubscription(
                accessToken,
                knownId,
                expirationDateTime,
              );
              return stateOf(renewed.id, renewed.expirationDateTime);
            } catch (err) {
              if (!(err instanceof MicrosoftMailError && err.kind === 'not_found')) throw err;
            }
          }
          const created = await this.graph.createSubscription(accessToken, {
            notificationUrl: cfg.notificationUrl,
            lifecycleNotificationUrl: cfg.notificationUrl,
            resource: GRAPH_SUBSCRIPTION_RESOURCE,
            expirationDateTime,
            clientState: cfg.clientStateFor(ctx.orgId, ctx.mailbox.uuid),
          });
          return stateOf(created.id, created.expirationDateTime);
        } catch (err) {
          throw this.fail(err, 'sync');
        }
      },
      stop: async (ctx) => {
        const id = ctx.mailbox.pushState?.id;
        if (typeof id !== 'string' || !id) return;
        try {
          await this.graph.deleteSubscription(token(ctx), id);
        } catch (err) {
          // A grant that is already dead has nothing left to withdraw.
          if (err instanceof MicrosoftMailError && err.kind === 'invalid_grant') return;
          throw this.fail(err, 'sync');
        }
      },
    };
    return this.pushSupport;
  }

  // --- sync ----------------------------------------------------------------------------------------------------------------------

  /**
   * First run (no cursor): a delta round over the Inbox limited to the last `backfillDays` days, stored quietly. Normal run: the stored
   * `deltaLink` (what was added or changed since). A delta token Graph no longer keeps (410) is repaired by a new bounded round (quiet).
   * Mail already stored is skipped before anything is downloaded; at most `maxMessages` new messages per run, the rest wait with the
   * cursor left where it is. Junk, deleted and sent items are never in the Inbox delta; drafts and mail the mailbox sent itself are skipped.
   */
  async sync(
    ctx: MailDriverContext,
    cursor: MailCursor | null,
    opts: MailSyncOptions,
  ): Promise<MailSyncBatch> {
    const accessToken = token(ctx);
    try {
      return await this.run(accessToken, ctx.mailbox.address, readCursor(cursor), opts);
    } catch (err) {
      throw this.fail(err, 'sync');
    }
  }

  private async run(
    accessToken: string,
    mailboxAddress: string,
    stored: GraphCursor,
    opts: MailSyncOptions,
  ): Promise<MailSyncBatch> {
    let mode: MailSyncMode = stored.deltaLink && !stored.nextLink ? 'history' : stored.phase;
    let link = stored.nextLink ?? stored.deltaLink;
    const since = () => new Date(Date.now() - opts.backfillDays * MS_PER_DAY);

    let round = await this.readRound(accessToken, link, link ? undefined : since(), opts.maxPages);
    if (round === 'gone') {
      mode = 'repair';
      link = null;
      round = await this.readRound(accessToken, null, since(), opts.maxPages);
      if (round === 'gone') throw new MicrosoftMailError('server', 410, 'gone_twice');
    }

    const byId = new Map<string, GraphMessage>();
    for (const m of round.messages) {
      if (m['@removed']) byId.delete(m.id);
      else byId.set(m.id, m);
    }
    let duplicates = 0;
    let skipped = 0;
    const unseen: GraphMessage[] = [];
    for (const m of byId.values()) {
      if (graphSkip(m, mailboxAddress)) {
        skipped += 1;
        continue;
      }
      if (await opts.isKnown(m.id)) duplicates += 1;
      else unseen.push(m);
    }
    // Delta pages come in no particular order, and a thread reads oldest first.
    unseen.sort(
      (a, b) =>
        Date.parse(a.receivedDateTime ?? '') - Date.parse(b.receivedDateTime ?? '') ||
        a.id.localeCompare(b.id),
    );
    const batch = unseen.slice(0, opts.maxMessages);
    const leftover = unseen.length > batch.length;

    const messages: NormalisedMail[] = [];
    let failed = 0;
    for (const candidate of batch) {
      try {
        messages.push(await this.read(accessToken, candidate.id));
      } catch (err) {
        // A message deleted since it was listed is simply gone; a Microsoft-side failure ends the run (it is retried as a whole).
        if (err instanceof MicrosoftMailError && err.kind === 'not_found') {
          skipped += 1;
          continue;
        }
        if (err instanceof MicrosoftMailError) throw err;
        failed += 1;
        this.logger.error(
          { message: candidate.id, err: (err as Error).message },
          'a mail could not be read',
        );
      }
    }

    let nextCursor: MailCursor | null = null;
    if (!leftover) {
      if (round.deltaLink) nextCursor = { deltaLink: round.deltaLink };
      else if (round.nextLink) nextCursor = { nextLink: round.nextLink, phase: mode };
    }
    return {
      messages,
      nextCursor,
      hasMore: leftover || (!round.deltaLink && Boolean(round.nextLink)),
      mode,
      quiet: mode !== 'history',
      duplicates,
      skipped,
      failed,
    };
  }

  /** Reads delta pages from `link` (or a new round since `since`) until the round ends or `maxPages` were read. 'gone' = the token is dead. */
  private async readRound(
    accessToken: string,
    link: string | null,
    since: Date | undefined,
    maxPages: number,
  ): Promise<
    { messages: GraphMessage[]; nextLink: string | null; deltaLink: string | null } | 'gone'
  > {
    const messages: GraphMessage[] = [];
    let next: string | null = link;
    let deltaLink: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      let got;
      try {
        got = await this.graph.inboxDelta(accessToken, { link: next, since });
      } catch (err) {
        if (err instanceof MicrosoftMailError && err.kind === 'gone') return 'gone';
        // A link that no longer exists answers 404 / 400 as well on some tenants: only a stored link can be dead.
        if (link && err instanceof MicrosoftMailError && err.kind === 'not_found') return 'gone';
        throw err;
      }
      messages.push(...got.messages);
      if (got.deltaLink) {
        deltaLink = got.deltaLink;
        next = null;
        break;
      }
      next = got.nextLink;
      if (!next) break;
    }
    return { messages, nextLink: deltaLink ? null : next, deltaLink };
  }

  /** One message with its headers, its body and the list of its files (bytes are fetched lazily). */
  private async read(accessToken: string, id: string): Promise<NormalisedMail> {
    const msg = await this.graph.getMessage(accessToken, id);
    // `hasAttachments` leaves inline images out: a body that points at `cid:` needs the list too.
    const needList =
      msg.hasAttachments === true || /cid:/i.test(msg.body?.content ? msg.body.content : '');
    const files: GraphAttachment[] = needList
      ? await this.graph.listAttachments(accessToken, id)
      : [];
    return normaliseGraphMessage(msg, files, (messageId, attachmentId) =>
      this.graph.attachmentBytes(accessToken, messageId, attachmentId),
    );
  }

  // --- send / health -------------------------------------------------------------------------------------------------------------

  async send(ctx: MailDriverContext, mail: OutgoingMail): Promise<MailSendResult> {
    const accessToken = token(ctx);
    const ours = bracket(mail.messageId);
    let draftId: string | null = null;
    let sending = false;
    try {
      // A retry: an earlier try may have reached Microsoft and lost the answer. The same Message-ID finds it in Sent Items; a draft
      // left behind by a try that never sent is removed before a clean one is made.
      if (mail.attempt > 1) {
        const found = await this.graph.findSent(accessToken, ours);
        if (found)
          return { providerMessageId: found.id, threadKey: this.keyOf(found.conversationId) };
        const stale = await this.graph.findDraft(accessToken, ours);
        if (stale) await this.graph.deleteMessage(accessToken, stale.id);
      }

      // Graph refuses any header that does not start with `x-` on a new message; In-Reply-To and References come from a reply draft of the
      // stored original instead. Without the original (deleted since) the mail still goes out, as a new message of its own.
      const original = mail.inReplyTo
        ? await this.graph.findByInternetId(accessToken, bracket(mail.inReplyTo)).catch((err) => {
            if (err instanceof MicrosoftMailError && err.kind === 'not_found') return null;
            throw err;
          })
        : null;
      const input: GraphDraftInput = {
        subject: mail.subject.replace(/[\r\n]+/g, ' ').trim(),
        bodyType: mail.html ? 'html' : 'text',
        body: mail.html ?? mail.text,
        to: mail.to,
        cc: mail.cc,
        bcc: mail.bcc,
        internetMessageId: ours,
        headers: Object.fromEntries(
          Object.entries(mail.headers).filter(([name]) => /^x-/i.test(name)),
        ),
      };
      const draft = original
        ? await this.graph.createReply(accessToken, original.id)
        : await this.graph.createDraft(accessToken, input);
      draftId = draft.id;
      const updated = original ? await this.graph.updateDraft(accessToken, draft.id, input) : draft;
      for (const file of mail.attachments) {
        if (file.bytes) {
          await this.graph.attach(accessToken, draft.id, {
            name: file.name,
            mime: file.mime,
            bytes: file.bytes,
          });
        }
      }
      sending = true;
      await this.graph.sendDraft(accessToken, draft.id);
      return {
        providerMessageId: draft.id,
        threadKey: this.keyOf(updated.conversationId ?? draft.conversationId),
      };
    } catch (err) {
      // A draft that was never sent is not left in the person's Drafts folder; one whose send was attempted may have gone out.
      if (draftId && !sending) {
        await this.graph.deleteMessage(accessToken, draftId).catch(() => undefined);
      }
      throw this.fail(err, 'send');
    }
  }

  private keyOf(conversationId: string | null): string | null {
    return conversationId ? resolveThreadKey({ conversationId, messageId: '' }) : null;
  }

  async health(ctx: MailDriverContext): Promise<MailHealthResult> {
    try {
      return { displayName: await this.graph.mailboxAddress(token(ctx)) };
    } catch (err) {
      throw this.fail(err, 'health');
    }
  }

  // --- errors --------------------------------------------------------------------------------------------------------------------

  private async credentials() {
    const creds = await this.config.credentials();
    if (!creds) {
      throw new MailDriverError('not_configured', 'Microsoft 365 is not set up for this platform.');
    }
    return creds;
  }

  /** Microsoft's failure in the port's vocabulary, with our words. `op` picks the wording (a sync failure reads differently from a send). */
  private fail(err: unknown, op: 'sync' | 'send' | 'auth' | 'health'): MailDriverError {
    if (err instanceof MailDriverError) return err;
    if (!(err instanceof MicrosoftMailError)) {
      return new MailDriverError(
        'transient',
        op === 'send' ? 'The reply could not be sent.' : 'The sync failed. It will be retried.',
        { retryable: true },
      );
    }
    const meta = {
      providerCode: err.reason || null,
      status: err.status,
      retryAfterSeconds: err.retryAfterSeconds,
    };
    switch (err.kind) {
      case 'invalid_grant':
        return new MailDriverError(
          'reauth',
          `Microsoft no longer allows access to this mailbox (${err.reason || 'revoked'}). Reconnect it.`,
          meta,
        );
      case 'invalid_client':
        return new MailDriverError(
          'not_configured',
          'Microsoft refused the platform credentials. Contact your platform administrator.',
          { ...meta, retryable: false },
        );
      case 'auth':
        return new MailDriverError(
          'token_rejected',
          'Microsoft did not answer. Syncing will retry shortly.',
          meta,
        );
      case 'not_found':
        return new MailDriverError('not_found', 'Not found.', meta);
      case 'gone':
        return new MailDriverError(
          'transient',
          'The sync position was lost. It will start again.',
          {
            ...meta,
            retryable: true,
          },
        );
      case 'rate_limit':
        return new MailDriverError(
          'rate_limit',
          op === 'send'
            ? 'Microsoft is limiting sends right now. It will be tried again.'
            : 'Microsoft is limiting requests right now. Syncing will retry shortly.',
          meta,
        );
      case 'server':
      case 'network':
      case 'timeout':
        if (op === 'send' && err.kind !== 'server' && sendMayHaveCommitted(meta.providerCode)) {
          return sendOutcomeUnknown('Microsoft did not answer in time.', meta.providerCode);
        }
        return new MailDriverError(
          'transient',
          op === 'send'
            ? 'Microsoft did not accept the reply yet. It will be tried again.'
            : 'Microsoft did not answer. Syncing will retry shortly.',
          meta,
        );
      case 'too_large':
        return new MailDriverError('too_large', 'The reply is too large for Microsoft to send.', {
          ...meta,
          retryable: false,
        });
      case 'forbidden': {
        const noMailbox = /MailboxNotEnabled|MailboxNotSupported|ErrorInvalidUser/.test(err.reason);
        return new MailDriverError(
          'forbidden',
          noMailbox
            ? 'This Microsoft account has no Exchange Online mailbox (it may need a licence).'
            : op === 'send'
              ? 'This mailbox may no longer send mail. Reconnect it and allow sending mail.'
              : 'Microsoft denied access to this mailbox. Reconnect it and allow reading and sending mail.',
          { ...meta, retryable: false, needsReauth: !noMailbox },
        );
      }
      default:
        return new MailDriverError(
          'bad_request',
          op === 'send'
            ? 'Microsoft refused to send this reply.'
            : 'Microsoft rejected the request.',
          { ...meta, retryable: false },
        );
    }
  }
}
