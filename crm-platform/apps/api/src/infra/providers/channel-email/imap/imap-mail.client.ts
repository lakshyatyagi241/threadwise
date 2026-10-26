import { Injectable } from '@nestjs/common';
import type { FetchMessageObject, ImapFlow } from 'imapflow';
import { channelEmailEnv } from '../../../../config/domains/channel-email.env';
import type { MailServerLogin } from '../mail-types';
import { resolveSafeTarget } from './host-guard';

/** What the driver needs to know about one message before it downloads it. */
export interface ImapMessageInfo {
  uid: number;
  /** Lower-cased flags without the backslash (`seen`, `draft`, `$junk`). */
  flags: string[];
  size: number;
  internalDate: Date | null;
  /** The Message-ID without brackets, or null. */
  messageId: string | null;
  from: string;
  subject: string;
  date: Date | null;
}

export interface ImapFolder {
  path: string;
  specialUse: string | null;
}

/** An open, authenticated IMAP connection. Always `close()` it. */
export class ImapSession {
  constructor(private readonly client: ImapFlow) {}

  /** Opens the INBOX read-only (nothing is marked seen). */
  async openInbox(): Promise<{ uidValidity: string; uidNext: number; exists: number }> {
    const box = await this.client.mailboxOpen('INBOX', { readOnly: true });
    return { uidValidity: String(box.uidValidity), uidNext: box.uidNext, exists: box.exists };
  }

  /** UIDs of the opened folder: those received since a date, or those above a UID (ascending). */
  async search(query: { since: Date } | { afterUid: number }): Promise<number[]> {
    const found =
      'since' in query
        ? await this.client.search({ since: query.since }, { uid: true })
        : await this.client.search({ uid: `${query.afterUid + 1}:*` }, { uid: true });
    const uids = Array.isArray(found) ? found : [];
    const above = 'afterUid' in query ? query.afterUid : 0;
    return [...new Set(uids)].filter((u) => u > above).sort((a, b) => a - b);
  }

  /** Flags, size and envelope of some UIDs (one round trip). */
  async info(uids: number[]): Promise<ImapMessageInfo[]> {
    if (uids.length === 0) return [];
    const out: ImapMessageInfo[] = [];
    for await (const m of this.client.fetch(
      uids.join(','),
      { uid: true, flags: true, size: true, internalDate: true, envelope: true },
      { uid: true },
    )) {
      out.push(infoOf(m));
    }
    return out.sort((a, b) => a.uid - b.uid);
  }

  /** The whole message, or null when it is gone or larger than `maxBytes`. */
  async source(uid: number, maxBytes: number): Promise<Buffer | null> {
    const m = await this.client.fetchOne(String(uid), { uid: true, size: true }, { uid: true });
    if (!m || (m.size ?? 0) > maxBytes) return null;
    const full = await this.client.fetchOne(
      String(uid),
      { uid: true, source: true },
      { uid: true },
    );
    return full && full.source ? full.source : null;
  }

  async folders(): Promise<ImapFolder[]> {
    const list = await this.client.list();
    return list.map((f) => ({ path: f.path, specialUse: f.specialUse ?? null }));
  }

  /** Whether the folder holds a message with this Message-ID. */
  async hasMessageId(folder: string, messageId: string): Promise<boolean> {
    const lock = await this.client.getMailboxLock(folder, { readOnly: true });
    try {
      const found = await this.client.search(
        { header: { 'message-id': messageId } },
        { uid: true },
      );
      return Array.isArray(found) && found.length > 0;
    } finally {
      lock.release();
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    }
  }
}

function infoOf(m: FetchMessageObject): ImapMessageInfo {
  const env = m.envelope;
  const date = env?.date ? new Date(env.date) : null;
  const internal = m.internalDate ? new Date(m.internalDate) : null;
  const id = env?.messageId?.trim().replace(/^<|>$/g, '') || null;
  return {
    uid: m.uid,
    flags: [...(m.flags ?? [])].map((f) => f.replace(/^\\/, '').toLowerCase()),
    size: m.size ?? 0,
    internalDate: internal && !Number.isNaN(internal.getTime()) ? internal : null,
    messageId: id,
    from: env?.from?.[0]?.address?.toLowerCase() ?? '',
    subject: (env?.subject ?? '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 998),
    date: date && !Number.isNaN(date.getTime()) ? date : null,
  };
}

/**
 * Opens IMAP connections (TW-MAIL-031): TLS ssl / starttls (required, never silently downgraded) / none, certificate validation always on,
 * the SSRF guard (`resolveSafeTarget`), timeouts. imapflow's own logging is off: a log line could carry a password.
 */
@Injectable()
export class ImapMailClient {
  async connect(login: MailServerLogin): Promise<ImapSession> {
    const env = channelEmailEnv();
    const target = await resolveSafeTarget(login.host, env.MAIL_IMAP_ALLOW_PRIVATE_HOSTS);
    // loaded on first use: imapflow adds about 27 MB and 120 ms to every process that imports this file, and only mail sync needs it
    const { ImapFlow: ImapFlowClient } = await import('imapflow');
    const client = new ImapFlowClient({
      host: target.connectHost,
      port: login.port,
      secure: login.security === 'ssl',
      doSTARTTLS:
        login.security === 'starttls' ? true : login.security === 'none' ? false : undefined,
      ...(target.servername ? { servername: target.servername } : {}),
      tls: { rejectUnauthorized: true },
      auth: { user: login.username, pass: login.password },
      logger: false,
      disableAutoIdle: true,
      disableCompression: true,
      connectionTimeout: env.MAIL_IMAP_TIMEOUT_MS,
      greetingTimeout: env.MAIL_IMAP_TIMEOUT_MS,
      socketTimeout: Math.max(env.MAIL_IMAP_TIMEOUT_MS * 3, 60_000),
    });
    // A socket error after connect must never become an unhandled 'error' event.
    client.on('error', () => undefined);
    try {
      await client.connect();
    } catch (err) {
      client.close();
      throw err;
    }
    return new ImapSession(client);
  }
}
