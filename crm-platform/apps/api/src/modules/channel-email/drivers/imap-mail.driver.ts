import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { MailConnectionTestResponse, MailTestSide } from '@crm/contracts';
import { channelEmailEnv } from '../../../config/domains/channel-email.env';
import { buildMime } from '../../../infra/providers/channel-email';
import { BlockedHostError } from '../../../infra/providers/channel-email/imap/host-guard';
import {
  ImapMailClient,
  type ImapMessageInfo,
  type ImapSession,
} from '../../../infra/providers/channel-email/imap/imap-mail.client';
import {
  attachmentBytes,
  imapProviderMessageId,
  normaliseImapMessage,
  syntheticMessageId,
} from '../../../infra/providers/channel-email/imap/imap-normalise';
import { SmtpMailClient } from '../../../infra/providers/channel-email/imap/smtp-mail.client';
import type {
  MailAccountProfile,
  MailServerLogin,
  NormalisedMail,
  OutgoingMail,
  PasswordConnection,
} from '../../../infra/providers/channel-email';
import {
  MailDriverError,
  type MailCursor,
  type MailDriverContext,
  type MailHealthResult,
  type MailSendResult,
  type MailSyncBatch,
  type MailSyncMode,
  type MailSyncOptions,
  type PasswordMailDriver,
} from './mail-driver';
import { MailDriverRegistry } from './mail-driver.registry';
import {
  INBOX_FAILED,
  failedSide,
  imapStepOf,
  okSide,
  smtpStepOf,
  testResult,
} from '../mail-test-rules';

/** Messages whose metadata is read in one round trip. */
const INFO_CHUNK = 200;

/**
 * The IMAP INBOX cursor. `lastUid`: every UID up to it was dealt with. `quietUntil`: while `lastUid` is below it the run is still reading
 * history (a backfill or a repair) and stores quietly; mail above it is live.
 */
interface ImapCursor {
  uidValidity: string;
  lastUid: number;
  quietUntil?: number;
  quietMode?: 'backfill' | 'repair';
}

function cursorOf(c: MailCursor | null): ImapCursor | null {
  if (!c || typeof c.uidValidity !== 'string' || typeof c.lastUid !== 'number') return null;
  return {
    uidValidity: c.uidValidity,
    lastUid: c.lastUid,
    ...(typeof c.quietUntil === 'number' ? { quietUntil: c.quietUntil } : {}),
    ...(c.quietMode === 'backfill' || c.quietMode === 'repair' ? { quietMode: c.quietMode } : {}),
  };
}

/** What the server's flags say about a mail in the INBOX that is not worth storing. */
export function skipByFlags(flags: readonly string[]): 'draft' | 'spam' | 'trash' | null {
  if (flags.includes('draft')) return 'draft';
  if (flags.includes('deleted')) return 'trash';
  if (flags.some((f) => ['$junk', 'junk', '$spam', 'spam'].includes(f))) return 'spam';
  return null;
}

const login = (ctx: MailDriverContext): PasswordConnection => {
  if (ctx.access.kind !== 'password') throw new MailDriverError('bad_request', 'No IMAP login.');
  return ctx.access.connection;
};

const TLS_CODES = /CERT|SELF_SIGNED|SSL|TLS|UNABLE_TO_VERIFY|HOSTNAME_MISMATCH|WRONG_VERSION/i;
const NET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
  'ESOCKET',
  'ECONNECTION',
  'ETIMEOUT',
  'EDNS',
  'CONNECT_TIMEOUT',
  'GREETING_TIMEOUT',
  'NoConnection',
  'ETLS',
]);

/**
 * Any IMAP + SMTP server behind the mail-driver port (TW-MAIL-031). Sync reads the INBOX by UID (cursor `{uidValidity,lastUid}`; a
 * UIDVALIDITY change is repaired by reading the last days again, quietly, and the Message-ID-derived ledger key makes that harmless);
 * send goes through SMTP with the same MIME the Gmail driver builds. A server is reached only over validated TLS (or none when the
 * admin chose it), never on a private address (SSRF guard), and a password never leaves a driver: errors carry OUR words.
 */
@Injectable()
export class ImapMailDriver implements PasswordMailDriver, OnModuleInit {
  readonly provider = 'imap' as const;
  readonly authKind = 'password' as const;
  readonly label = 'IMAP / SMTP';
  private readonly logger = new Logger(ImapMailDriver.name);

  constructor(
    private readonly imap: ImapMailClient,
    private readonly smtp: SmtpMailClient,
    private readonly registry: MailDriverRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async readiness(): Promise<{ ready: boolean; notReadyReason: string | null }> {
    return { ready: true, notReadyReason: null };
  }

  // --- connect -------------------------------------------------------------------------------------------------------------------

  /** Both logins, before anything is stored: the IMAP one (and the INBOX opens), then the SMTP one. */
  async verify(connection: PasswordConnection): Promise<MailAccountProfile> {
    let session: ImapSession | null = null;
    try {
      session = await this.imap.connect(connection.imap);
      await session.openInbox();
    } catch (err) {
      throw this.fail(err, 'imap', 'verify');
    } finally {
      await session?.close();
    }
    try {
      await this.smtp.verify(connection.smtp);
    } catch (err) {
      throw this.fail(err, 'smtp', 'verify');
    }
    const user = connection.imap.username;
    return { address: user.includes('@') ? user.toLowerCase() : '', sub: null, name: null };
  }

  /** Both servers, each on its own: a refused IMAP password does not hide a wrong SMTP port. */
  async test(connection: PasswordConnection): Promise<MailConnectionTestResponse> {
    return testResult(await this.testImap(connection), await this.testSmtp(connection));
  }

  private async testImap(connection: PasswordConnection): Promise<MailTestSide> {
    let session: ImapSession | null = null;
    let signedIn = false;
    try {
      session = await this.imap.connect(connection.imap);
      signedIn = true;
      const box = await session.openInbox();
      return okSide(box.exists);
    } catch (err) {
      const failure = this.fail(err, 'imap', 'verify');
      const step = imapStepOf(failure, signedIn);
      // A good sign-in that cannot open the INBOX is not the server's connection or password: it gets its own sentence.
      return failedSide(
        step,
        step === 'inbox' ? { ...failureParts(failure), message: INBOX_FAILED } : failure,
      );
    } finally {
      await session?.close().catch(() => undefined);
    }
  }

  private async testSmtp(connection: PasswordConnection): Promise<MailTestSide> {
    try {
      await this.smtp.verify(connection.smtp);
      return okSide();
    } catch (err) {
      const failure = this.fail(err, 'smtp', 'verify');
      return failedSide(smtpStepOf(failure), failure);
    }
  }

  // --- sync ----------------------------------------------------------------------------------------------------------------------

  async sync(
    ctx: MailDriverContext,
    cursor: MailCursor | null,
    opts: MailSyncOptions,
  ): Promise<MailSyncBatch> {
    const conn = login(ctx);
    let session: ImapSession | null = null;
    try {
      session = await this.imap.connect(conn.imap);
      return await this.run(session, conn.imap, cursor, opts);
    } catch (err) {
      throw this.fail(err, 'imap', 'sync');
    } finally {
      await session?.close();
    }
  }

  private async run(
    session: ImapSession,
    server: MailServerLogin,
    stored: MailCursor | null,
    opts: MailSyncOptions,
  ): Promise<MailSyncBatch> {
    const env = channelEmailEnv();
    const box = await session.openInbox();
    let cursor = cursorOf(stored);
    let mode: MailSyncMode = 'history';
    let changed = false;

    if (!cursor || cursor.uidValidity !== box.uidValidity) {
      // First run, or the server renumbered the folder: read the last days again, quietly.
      mode = cursor ? 'repair' : 'backfill';
      const since = new Date(Date.now() - opts.backfillDays * 86_400_000);
      const recent = await session.search({ since });
      const quietUntil = box.uidNext - 1;
      cursor = {
        uidValidity: box.uidValidity,
        lastUid: recent.length > 0 ? recent[0]! - 1 : quietUntil,
        quietUntil,
        quietMode: mode,
      };
      changed = true;
    } else if (cursor.quietUntil !== undefined && cursor.lastUid < cursor.quietUntil) {
      mode = cursor.quietMode ?? 'backfill';
    }
    const quiet = mode !== 'history';
    const ceiling = quiet ? cursor.quietUntil! : Number.POSITIVE_INFINITY;

    const waiting = (await session.search({ afterUid: cursor.lastUid })).filter(
      (u) => u <= ceiling,
    );
    const behind = quiet ? (await session.search({ afterUid: ceiling })).length > 0 : false;

    const picked: ImapMessageInfo[] = [];
    let duplicates = 0;
    let skipped = 0;
    let lastUid = cursor.lastUid;
    let leftover = false;
    let pages = 0;
    scan: for (let i = 0; i < waiting.length; i += INFO_CHUNK) {
      if (pages >= opts.maxPages) {
        leftover = true;
        break;
      }
      pages += 1;
      for (const info of await session.info(waiting.slice(i, i + INFO_CHUNK))) {
        if (picked.length >= opts.maxMessages) {
          leftover = true;
          break scan;
        }
        lastUid = info.uid;
        if (skipByFlags(info.flags)) {
          skipped += 1;
          continue;
        }
        if (await opts.isKnown(imapProviderMessageId(idOf(info)))) duplicates += 1;
        else picked.push(info);
      }
    }
    // Everything read was dealt with when nothing waits beyond the page; otherwise the cursor stops at the last mail looked at.
    if (!leftover && waiting.length > 0) lastUid = Math.max(lastUid, waiting[waiting.length - 1]!);

    const messages: NormalisedMail[] = [];
    let failed = 0;
    for (const info of picked) {
      const source = await session.source(info.uid, env.MAIL_IMAP_MAX_MESSAGE_BYTES);
      if (!source) {
        // Gone since it was listed, or too large to read.
        if (info.size > env.MAIL_IMAP_MAX_MESSAGE_BYTES) failed += 1;
        else skipped += 1;
        continue;
      }
      try {
        messages.push(
          await normaliseImapMessage({
            source,
            flags: info.flags,
            folder: 'INBOX',
            internalDate: info.internalDate,
            size: info.size,
            fallbackMessageId: idOf(info),
            known: await this.knownFor(source, opts),
            refetch: (partId) => this.refetch(server, box.uidValidity, info.uid, partId),
          }),
        );
      } catch (err) {
        failed += 1;
        this.logger.error(
          { uid: info.uid, err: (err as Error).message },
          'a mail could not be read',
        );
      }
    }

    const done = !leftover;
    const next: ImapCursor = { ...cursor, lastUid };
    // The history is read through: from here on the mail is live.
    if (done && next.quietUntil !== undefined && lastUid >= next.quietUntil) {
      delete next.quietUntil;
      delete next.quietMode;
    }
    const moved =
      next.lastUid !== cursor.lastUid || changed || next.quietUntil !== cursor.quietUntil;
    return {
      messages,
      nextCursor: moved ? { ...next } : null,
      hasMore: leftover || behind,
      mode,
      quiet,
      duplicates,
      skipped,
      failed,
    };
  }

  /** The stored thread keys of the ancestors a mail names (only a mail that has some is looked up). */
  private async knownFor(
    source: Buffer,
    opts: MailSyncOptions,
  ): Promise<Map<string, string> | undefined> {
    const head = source.subarray(0, 64 * 1024).toString('latin1');
    const ids = [
      ...head.matchAll(/^(?:in-reply-to|references):([^\r\n]*(?:\r?\n[ \t][^\r\n]*)*)/gim),
    ]
      .flatMap((m) => [...(m[1] ?? '').matchAll(/<([^<>\s]+)>/g)].map((x) => x[1]!))
      .slice(0, 50);
    return ids.length ? opts.knownThreadKeys(ids) : undefined;
  }

  /** Downloads one attachment again (the batch carried only the small ones): a new connection, the same folder and UIDVALIDITY. */
  private async refetch(
    server: MailServerLogin,
    uidValidity: string,
    uid: number,
    partId: string,
  ): Promise<Buffer> {
    const session = await this.imap.connect(server);
    try {
      const box = await session.openInbox();
      if (box.uidValidity !== uidValidity) throw new Error('the folder was renumbered');
      const source = await session.source(uid, channelEmailEnv().MAIL_IMAP_MAX_MESSAGE_BYTES);
      if (!source) throw new Error('the message is gone');
      return await attachmentBytes(source, partId);
    } finally {
      await session.close();
    }
  }

  // --- send / health -------------------------------------------------------------------------------------------------------------

  async send(ctx: MailDriverContext, mail: OutgoingMail): Promise<MailSendResult> {
    const conn = login(ctx);
    const providerMessageId = imapProviderMessageId(mail.messageId);
    // A retry: an earlier try may have reached the server and lost the answer. Look in the Sent folder, when the server keeps one.
    if (mail.attempt > 1 && (await this.alreadySent(conn.imap, mail.messageId))) {
      return { providerMessageId, threadKey: null };
    }
    let raw: Buffer;
    try {
      raw = await buildMime({
        from: mail.from,
        to: mail.to,
        cc: mail.cc,
        // SMTP carries Bcc in the envelope only; a Bcc header would show the recipients to everybody.
        bcc: [],
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
    } catch {
      throw new MailDriverError('bad_request', 'The reply could not be built.', {
        retryable: false,
      });
    }
    try {
      await this.smtp.send(
        conn.smtp,
        { from: mail.from.address, to: [...mail.to, ...mail.cc, ...mail.bcc] },
        raw,
      );
    } catch (err) {
      throw this.fail(err, 'smtp', 'send');
    }
    return { providerMessageId, threadKey: null };
  }

  private async alreadySent(server: MailServerLogin, messageId: string): Promise<boolean> {
    let session: ImapSession | null = null;
    try {
      session = await this.imap.connect(server);
      const sent = (await session.folders()).find((f) => f.specialUse === '\\Sent');
      return sent ? await session.hasMessageId(sent.path, `<${messageId}>`) : false;
    } catch {
      return false;
    } finally {
      await session?.close();
    }
  }

  async health(ctx: MailDriverContext): Promise<MailHealthResult> {
    const conn = login(ctx);
    let session: ImapSession | null = null;
    try {
      session = await this.imap.connect(conn.imap);
      await session.openInbox();
    } catch (err) {
      throw this.fail(err, 'imap', 'health');
    } finally {
      await session?.close();
    }
    try {
      await this.smtp.verify(conn.smtp);
    } catch (err) {
      throw this.fail(err, 'smtp', 'health');
    }
    return { displayName: ctx.mailbox.address };
  }

  // --- errors --------------------------------------------------------------------------------------------------------------------

  /** A server's failure in the port's vocabulary, with our words (never the server's text, a host or a password). */
  private fail(
    err: unknown,
    side: 'imap' | 'smtp',
    op: 'verify' | 'sync' | 'send' | 'health',
  ): MailDriverError {
    if (err instanceof MailDriverError) return err;
    const name = side === 'imap' ? 'IMAP' : 'SMTP';
    if (err instanceof BlockedHostError) {
      return new MailDriverError('unreachable', `The ${name} server address is not allowed.`, {
        providerCode: 'blocked_address',
        retryable: false,
      });
    }
    const e = err as {
      code?: string;
      authenticationFailed?: boolean;
      responseCode?: number;
      response?: string;
      message?: string;
    };
    const code = String(e.code ?? '');
    const authRefused =
      e.authenticationFailed === true ||
      code === 'EAUTH' ||
      code === 'AUTHENTICATIONFAILED' ||
      (e.responseCode !== undefined && [534, 535, 538].includes(e.responseCode));
    if (authRefused) {
      return new MailDriverError(
        'auth_failed',
        `The ${name} server refused the username or password.`,
        { providerCode: side, retryable: false },
      );
    }
    if (
      TLS_CODES.test(code) ||
      /certificate|self.signed|handshake|wrong version|tls/i.test(e.message ?? '')
    ) {
      return new MailDriverError(
        'unreachable',
        `The ${name} server's secure connection could not be verified. Check the host name and the security setting.`,
        { providerCode: `${side}_tls`, retryable: op !== 'verify' },
      );
    }
    if (NET_CODES.has(code) || /timed? ?out|connect|closed/i.test(e.message ?? '')) {
      return new MailDriverError('unreachable', `The ${name} server could not be reached.`, {
        providerCode: `${side}_${code || 'network'}`.toLowerCase(),
        retryable: op !== 'verify',
      });
    }
    if (side === 'smtp' && op === 'send') {
      const status = e.responseCode ?? 0;
      if (status === 552) {
        return new MailDriverError('too_large', 'The mail server says the reply is too large.', {
          providerCode: 'smtp_552',
          retryable: false,
        });
      }
      if (status >= 400 && status < 500) {
        return new MailDriverError(
          'transient',
          'The mail server did not accept the reply yet. It will be tried again.',
          {
            providerCode: `smtp_${status}`,
            retryable: true,
          },
        );
      }
      return new MailDriverError('bad_request', 'The mail server refused to send this reply.', {
        providerCode: `smtp_${status || 'refused'}`,
        retryable: false,
      });
    }
    return new MailDriverError(
      'transient',
      op === 'verify'
        ? `The ${name} server did not answer as expected.`
        : op === 'send'
          ? 'The reply could not be sent.'
          : 'The sync failed. It will be retried.',
      { retryable: op !== 'verify', providerCode: `${side}_error` },
    );
  }
}

const failureParts = (e: MailDriverError) => ({
  kind: e.kind,
  providerCode: e.providerCode,
  message: e.message,
});

/** The Message-ID a message is keyed by: its own, or the synthetic one from its envelope. */
function idOf(info: ImapMessageInfo): string {
  return (
    info.messageId ??
    syntheticMessageId({
      from: info.from,
      date: (info.date ?? info.internalDate ?? new Date(0)).toISOString(),
      subject: info.subject,
      size: info.size,
    })
  );
}
