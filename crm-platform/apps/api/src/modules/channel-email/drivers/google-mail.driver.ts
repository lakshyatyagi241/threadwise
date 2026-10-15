import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { GOOGLE_MAIL_REQUIRED_SCOPES } from '../../../config/domains/channel-email.env';
import {
  buildMime,
  GmailClient,
  GoogleMailError,
  GoogleMailOAuthClient,
  normaliseGmailMessage,
  parseGmailMessage,
  type MailAccountProfile,
  type NormalisedMail,
  type OutgoingMail,
} from '../../../infra/providers/channel-email';
import { GoogleMailConfig } from '../mail-config.service';
import {
  backfillQuery,
  isQuiet,
  planBatch,
  planFailure,
  skippableByLabels,
  type Candidate,
} from '../mail-sync-rules';
import {
  MailDriverError,
  type MailCursor,
  type MailDriverContext,
  type MailHealthResult,
  type MailPushState,
  type MailPushSupport,
  type MailOAuthGrant,
  type MailOAuthRefreshed,
  type MailSendResult,
  type MailSyncBatch,
  type MailSyncMode,
  type MailSyncOptions,
  type OAuthMailDriver,
} from './mail-driver';
import { MailDriverRegistry } from './mail-driver.registry';

const token = (ctx: MailDriverContext): string => {
  if (ctx.access.kind !== 'oauth') throw new MailDriverError('bad_request', 'No Google access.');
  return ctx.access.accessToken;
};

/** The Gmail cursor: Gmail's mailbox history id. */
const historyIdOf = (cursor: MailCursor | null): string | null =>
  typeof cursor?.historyId === 'string' && cursor.historyId ? cursor.historyId : null;

/**
 * Gmail / Google Workspace behind the mail-driver port (Phase 2 seams). Everything that used to branch on 'google' in the sync, the
 * adapter and the connect flow lives here: the OAuth round trip, the history / list sync, and `users.messages.send`. Thread key = Gmail's
 * `threadId`, verbatim. Google's own errors never leave this class: they leave as {@link MailDriverError} with our words.
 */
@Injectable()
export class GoogleMailDriver implements OAuthMailDriver, OnModuleInit {
  readonly provider = 'google' as const;
  readonly authKind = 'oauth' as const;
  readonly label = 'Gmail / Google Workspace';
  readonly requiredScopes: readonly string[] = GOOGLE_MAIL_REQUIRED_SCOPES;
  private readonly logger = new Logger(GoogleMailDriver.name);

  constructor(
    private readonly gmail: GmailClient,
    private readonly oauthClient: GoogleMailOAuthClient,
    private readonly config: GoogleMailConfig,
    private readonly registry: MailDriverRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  // --- push (TW-MAIL-033) --------------------------------------------------------------------------------------------------------

  private pushSupport: MailPushSupport | null = null;

  /** Gmail push through Pub/Sub: `users.watch` on the INBOX, renewed before its 7 days run out; `users.stop` withdraws it. */
  get push(): MailPushSupport {
    this.pushSupport ??= {
      available: async () => (await this.config.push()) !== null,
      start: async (ctx): Promise<MailPushState | null> => {
        const cfg = await this.config.push();
        if (!cfg) return null;
        try {
          const watch = await this.gmail.watch(token(ctx), { topicName: cfg.topic });
          const expiresMs = Number(watch.expiration);
          return {
            kind: 'gmail-watch',
            id: null,
            historyId: watch.historyId,
            // Gmail answers the expiry in epoch ms; without one assume the documented 7 days, less a day.
            expiresAt: new Date(
              Number.isFinite(expiresMs) && expiresMs > 0 ? expiresMs : Date.now() + 6 * 86_400_000,
            ).toISOString(),
          };
        } catch (err) {
          throw this.fail(err, 'sync');
        }
      },
      stop: async (ctx) => {
        try {
          await this.gmail.stopWatch(token(ctx));
        } catch (err) {
          // Gone already (revoked grant, deleted mailbox) is the state we want.
          if (
            err instanceof GoogleMailError &&
            (err.kind === 'not_found' || err.kind === 'invalid_grant')
          )
            return;
          throw this.fail(err, 'sync');
        }
      },
    };
    return this.pushSupport;
  }

  async readiness(): Promise<{ ready: boolean; notReadyReason: string | null }> {
    const ready = await this.config.ready();
    return {
      ready,
      notReadyReason: ready ? null : 'The platform has no Google OAuth client for mail yet.',
    };
  }

  // --- oauth ---------------------------------------------------------------------------------------------------------------------

  async authorizeUrl(input: { state: string; loginHint: string | null }): Promise<string> {
    const creds = await this.config.credentials();
    if (!creds) {
      throw new MailDriverError(
        'not_configured',
        'Gmail is not set up for this platform. Ask your platform administrator to add the Google OAuth client.',
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
        scopes: grant.scope.split(/\s+/).filter(Boolean),
      };
    } catch (err) {
      throw this.fail(err, 'auth');
    }
  }

  async refresh(refreshToken: string): Promise<MailOAuthRefreshed> {
    const creds = await this.credentials();
    try {
      const tokens = await this.oauthClient.refresh(creds, refreshToken);
      return { accessToken: tokens.accessToken, expiresInSeconds: tokens.expiresInSeconds };
    } catch (err) {
      throw this.fail(err, 'auth');
    }
  }

  async revoke(tokenToRevoke: string): Promise<void> {
    try {
      await this.oauthClient.revoke(tokenToRevoke);
    } catch (err) {
      throw this.fail(err, 'auth');
    }
  }

  async profile(accessToken: string): Promise<MailAccountProfile> {
    try {
      const account = await this.oauthClient.userinfo(accessToken);
      return { address: account.email ?? '', sub: account.sub, name: account.name };
    } catch (err) {
      throw this.fail(err, 'auth');
    }
  }

  // --- sync ----------------------------------------------------------------------------------------------------------------------

  /**
   * First run (no cursor): the last `backfillDays` days of the INBOX, quiet. Normal run: `users.history.list` from the stored history id.
   * A cursor Gmail no longer keeps (404) is repaired by listing the last days again (quiet) and taking a new cursor. Mail already stored
   * is skipped before anything is downloaded. At most `maxMessages` new messages per run: when more wait, the cursor stays put.
   */
  async sync(
    ctx: MailDriverContext,
    cursor: MailCursor | null,
    opts: MailSyncOptions,
  ): Promise<MailSyncBatch> {
    const accessToken = token(ctx);
    try {
      return await this.run(accessToken, ctx.mailbox.address, cursor, opts);
    } catch (err) {
      throw this.fail(err, 'sync');
    }
  }

  private async run(
    accessToken: string,
    mailboxAddress: string,
    cursor: MailCursor | null,
    opts: MailSyncOptions,
  ): Promise<MailSyncBatch> {
    const stored = historyIdOf(cursor);
    let mode: MailSyncMode = stored ? 'history' : 'backfill';
    let candidates: Candidate[] = [];
    // Where the cursor goes when everything read was dealt with.
    let nextHistory: string | null = null;
    let readAll = true;

    if (mode === 'history') {
      try {
        const got = await this.readHistory(accessToken, stored!, opts.maxPages);
        candidates = got.candidates;
        readAll = got.complete;
        nextHistory = got.complete ? got.currentHistoryId : got.resumeAfter;
      } catch (err) {
        if (!(err instanceof GoogleMailError) || err.kind !== 'not_found') throw err;
        mode = 'repair';
      }
    }
    if (mode !== 'history') {
      // The cursor is taken BEFORE listing: mail that arrives while the list is read is then found by the next history run.
      const profile = await this.gmail.getProfile(accessToken);
      nextHistory = profile.historyId || null;
      candidates = await this.listRecent(accessToken, opts.backfillDays, opts.maxPages);
    }

    const unseen: Candidate[] = [];
    let duplicates = 0;
    let skipped = 0;
    const seenIds = new Set<string>();
    for (const c of candidates) {
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      if (skippableByLabels(c.labelIds)) {
        skipped += 1;
        continue;
      }
      if (await opts.isKnown(c.id)) duplicates += 1;
      else unseen.push(c);
    }

    const { batch, leftover } = planBatch(unseen, opts.maxMessages);
    const messages: NormalisedMail[] = [];
    let failed = 0;
    for (const c of batch) {
      try {
        const raw = await this.gmail.getMessage(accessToken, c.id);
        const parsed = parseGmailMessage(raw, mailboxAddress);
        messages.push(
          normaliseGmailMessage(raw, parsed, (messageId, attachmentId) =>
            this.gmail.getAttachment(accessToken, messageId, attachmentId),
          ),
        );
      } catch (err) {
        // A message deleted since it was listed is simply gone; a Google-side failure ends the run (it is retried as a whole).
        if (err instanceof GoogleMailError && err.kind === 'not_found') {
          skipped += 1;
          continue;
        }
        if (err instanceof GoogleMailError) throw err;
        failed += 1;
        this.logger.error(
          { message: c.id, err: (err as Error).message },
          'a mail could not be read',
        );
      }
    }

    const advance = !leftover && (readAll || nextHistory !== null);
    return {
      messages,
      nextCursor: advance && nextHistory ? { historyId: nextHistory } : null,
      hasMore: leftover,
      mode,
      quiet: isQuiet(mode),
      duplicates,
      skipped,
      failed,
    };
  }

  /** Reads history pages: what was added to the INBOX since `cursor` (newest first, like a list), and where to continue. */
  private async readHistory(accessToken: string, cursor: string, maxPages: number) {
    const candidates: Candidate[] = [];
    let pageToken: string | null = null;
    let current: string | null = null;
    let lastRecord: string | null = null;
    let complete = false;
    for (let page = 0; page < maxPages; page += 1) {
      const got = await this.gmail.listHistory(accessToken, {
        startHistoryId: cursor,
        pageToken,
      });
      for (const a of got.added)
        candidates.push({ id: a.id, threadId: a.threadId, labelIds: a.labelIds });
      current = got.historyId ?? current;
      lastRecord = got.lastRecordId ?? lastRecord;
      pageToken = got.nextPageToken;
      if (!pageToken) {
        complete = true;
        break;
      }
    }
    // History runs oldest to newest; the batch planner takes newest first (the order of a Gmail list) and reverses it once.
    candidates.reverse();
    return { candidates, complete, currentHistoryId: current, resumeAfter: lastRecord ?? cursor };
  }

  /** The newest mail of the INBOX within the last days (Gmail's order: newest first). */
  private async listRecent(
    accessToken: string,
    days: number,
    maxPages: number,
  ): Promise<Candidate[]> {
    const out: Candidate[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const got = await this.gmail.listMessages(accessToken, {
        q: backfillQuery(days),
        labelIds: ['INBOX'],
        pageToken,
      });
      for (const m of got.messages) out.push({ id: m.id, threadId: m.threadId, labelIds: null });
      pageToken = got.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  // --- send / health -------------------------------------------------------------------------------------------------------------

  async send(ctx: MailDriverContext, mail: OutgoingMail): Promise<MailSendResult> {
    const accessToken = token(ctx);
    try {
      // A retry: an earlier try may have reached Gmail and lost the answer. The same Message-ID finds it.
      if (mail.attempt > 1) {
        const found = await this.gmail
          .findByMessageId(accessToken, mail.messageId)
          .catch(() => null);
        if (found) return { providerMessageId: found.id, threadKey: found.threadId };
      }
      const raw = await buildMime({
        from: mail.from,
        to: mail.to,
        cc: mail.cc,
        bcc: mail.bcc,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        messageId: mail.messageId,
        inReplyTo: mail.inReplyTo,
        references: mail.references,
        headers: mail.headers,
        attachments: mail.attachments.flatMap((a) =>
          a.bytes ? [{ name: a.name, mime: a.mime, bytes: a.bytes }] : [],
        ),
      });
      const sent = await this.gmail.sendMessage(accessToken, {
        raw,
        threadId: mail.threadKey,
      });
      return { providerMessageId: sent.id, threadKey: sent.threadId };
    } catch (err) {
      throw this.fail(err, 'send');
    }
  }

  async health(ctx: MailDriverContext): Promise<MailHealthResult> {
    try {
      const profile = await this.gmail.getProfile(token(ctx));
      return { displayName: profile.emailAddress || null };
    } catch (err) {
      throw this.fail(err, 'health');
    }
  }

  // --- errors --------------------------------------------------------------------------------------------------------------------

  private async credentials() {
    const creds = await this.config.credentials();
    if (!creds) {
      throw new MailDriverError('not_configured', 'Gmail is not set up for this platform.');
    }
    return creds;
  }

  /** Google's failure in the port's vocabulary, with our words. `op` picks the wording (a sync failure reads differently from a send). */
  private fail(err: unknown, op: 'sync' | 'send' | 'auth' | 'health'): MailDriverError {
    if (err instanceof MailDriverError) return err;
    if (!(err instanceof GoogleMailError)) {
      return new MailDriverError(
        'transient',
        op === 'send' ? 'The reply could not be sent.' : 'The sync failed. It will be retried.',
        { retryable: true },
      );
    }
    const meta = { providerCode: err.reason || null, status: err.status };
    if (err.kind === 'invalid_grant') {
      return new MailDriverError(
        'reauth',
        `Google no longer allows access to this mailbox (${err.reason || 'revoked'}). Reconnect it.`,
        meta,
      );
    }
    if (err.kind === 'auth') {
      return new MailDriverError(
        'token_rejected',
        'Google did not answer. Syncing will retry shortly.',
        meta,
      );
    }
    if (err.kind === 'not_found') return new MailDriverError('not_found', 'Not found.', meta);
    if (op === 'send') {
      if (err.retryable) {
        return new MailDriverError(
          err.kind === 'rate_limit' ? 'rate_limit' : 'transient',
          'Google did not accept the reply yet. It will be tried again.',
          meta,
        );
      }
      const needsReauth = err.kind === 'forbidden' && err.reason === 'insufficientPermissions';
      return new MailDriverError(
        err.kind === 'too_large'
          ? 'too_large'
          : err.kind === 'forbidden'
            ? 'forbidden'
            : 'bad_request',
        err.kind === 'too_large'
          ? 'The reply is too large for Gmail to send.'
          : needsReauth
            ? 'This mailbox may no longer send mail. Reconnect it.'
            : 'Google refused to send this reply.',
        { ...meta, retryable: false, needsReauth },
      );
    }
    const plan = planFailure(err);
    const kind =
      err.kind === 'invalid_client'
        ? 'not_configured'
        : err.kind === 'forbidden'
          ? 'forbidden'
          : err.kind === 'bad_request'
            ? 'bad_request'
            : err.kind === 'too_large'
              ? 'too_large'
              : err.kind === 'rate_limit'
                ? 'rate_limit'
                : 'transient';
    return new MailDriverError(kind, plan.message, { ...meta, retryable: plan.retry });
  }
}
