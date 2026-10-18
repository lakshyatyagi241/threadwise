import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { forEachGzipLine, gzipAsync } from '../../common/async-zlib';
import {
  MESSAGE_LOG_EXPORT_MAX_ROWS,
  MESSAGE_LOG_EXPORT_TTL_DAYS,
  type MessageLogEvent,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  MAIL_PORT,
  type MailPort,
} from '../../infra/providers/auth-registration-security/mail.port';
import {
  HISTORY_CSV_HEAD,
  exportContext,
  historyCsvLine,
  selectionOfStored,
} from './message-history-export';
import { decodeCursor, type HistoryCursor } from './message-history-rules';
import { MessageHistoryRepository } from './message-history.repository';
import { MessageLogRepository, type ExportRow } from './message-log.repository';
import {
  CSV_BOM,
  CSV_HEADER,
  DAY_MS,
  addDays,
  csvCell,
  csvLine,
  dayStart,
  daysBetween,
  retryUserId,
  toLogEvent,
  type StoredEvent,
} from './message-log-rules';

/** Events handled per round trip: one lookup of the messages they name, one gzip member of the file. */
const BATCH = 5_000;

type Pending = StoredEvent & { messageId: number; messageCreatedAt: string };

class ExportTooLarge extends Error {}

/**
 * Builds one export of the message log (worker side): the live events and the archived days of the asked range, oldest first, as a CSV
 * with the recipient, channel and template next to each event; stored gzipped on the export row for a week; the requester is mailed a
 * link to the page that offers it. Records its own failure on the row (and mails that too), so the queue never retries it.
 *
 * The file is built in memory as gzip members (a few MB for a busy year), never as one big string, and stops at
 * MESSAGE_LOG_EXPORT_MAX_ROWS: past that the person narrows the dates.
 */
@Injectable()
export class MessageLogExportRunner {
  private readonly logger = new Logger(MessageLogExportRunner.name);
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MessageLogRepository,
    private readonly history: MessageHistoryRepository,
    config: ConfigService<Env, true>,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {
    this.webUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  async run(
    orgId: number,
    exportUuid: string,
    now: Date = new Date(),
  ): Promise<'done' | 'skipped' | 'failed'> {
    const claimed = await this.db.txAs({ orgId }, async (tx) => {
      const row = await this.repo.exportByUuid(tx, orgId, exportUuid);
      if (!row || row.status !== 'queued') return null;
      return (await this.repo.claimExport(tx, orgId, row.id)) ? row : null;
    });
    if (!claimed) return 'skipped';

    try {
      const messages = claimed.kind === 'messages';
      const built = messages
        ? await this.buildMessages(orgId, claimed)
        : await this.build(orgId, claimed);
      const fileName = `${messages ? 'message-history' : 'message-log'}-${claimed.rangeFrom}_${claimed.rangeTo}.csv`;
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.finishExport(tx, orgId, claimed.id, {
          fileName,
          file: built.file,
          rowCount: built.rows,
          expiresAt: new Date(now.getTime() + MESSAGE_LOG_EXPORT_TTL_DAYS * DAY_MS),
        }),
      );
      await this.notify(orgId, claimed, 'ready', built.rows);
      return 'done';
    } catch (err) {
      const message =
        err instanceof ExportTooLarge
          ? `The export has more than ${MESSAGE_LOG_EXPORT_MAX_ROWS.toLocaleString('en-US')} lines. Choose fewer days or narrow the filters.`
          : 'The export could not be built. Request it again.';
      if (!(err instanceof ExportTooLarge)) {
        this.logger.error(
          { orgId, exportUuid, err: (err as Error).message },
          'message log export failed',
        );
      }
      await this.db.txAs({ orgId }, (tx) => this.repo.failExport(tx, orgId, claimed.id, message));
      await this.notify(orgId, claimed, 'failed', 0, message);
      return 'failed';
    }
  }

  /** The Message History feed with the filters of the request, newest first, as one gzip member per page. */
  private async buildMessages(
    orgId: number,
    row: ExportRow,
  ): Promise<{ file: Buffer; rows: number }> {
    const sel = selectionOfStored(row.filters);
    const ctx = exportContext(orgId);
    const members: Buffer[] = [await gzipAsync(`${CSV_BOM}${HISTORY_CSV_HEAD}`)];
    let rows = 0;
    let cursor: HistoryCursor | null = null;
    for (;;) {
      const at: HistoryCursor | null = cursor;
      const page: { rows: Array<Record<string, unknown>>; next: string | null } =
        await this.db.txAs({ orgId }, (tx) => this.history.page(tx, ctx, sel, at, BATCH));
      if (page.rows.length === 0) break;
      rows += page.rows.length;
      if (rows > MESSAGE_LOG_EXPORT_MAX_ROWS) throw new ExportTooLarge();
      members.push(await gzipAsync(`${page.rows.map(historyCsvLine).join('\r\n')}\r\n`));
      if (page.next === null) break;
      cursor = decodeCursor(page.next);
      if (cursor === null) break;
    }
    return { file: Buffer.concat(members), rows };
  }

  private async build(orgId: number, row: ExportRow): Promise<{ file: Buffer; rows: number }> {
    const members: Buffer[] = [
      await gzipAsync(`${CSV_BOM}${CSV_HEADER.map((h) => csvCell(h)).join(',')}\r\n`),
    ];
    let rows = 0;

    const emit = async (events: Pending[]): Promise<void> => {
      for (let i = 0; i < events.length; i += BATCH) {
        const slice = events.slice(i, i + BATCH);
        const lines = await this.db.txAs({ orgId }, (tx) => this.lines(tx, orgId, row, slice));
        if (lines.length === 0) continue;
        rows += lines.length;
        if (rows > MESSAGE_LOG_EXPORT_MAX_ROWS) throw new ExportTooLarge();
        members.push(await gzipAsync(`${lines.join('\r\n')}\r\n`));
      }
    };

    for (const day of daysBetween(row.rangeFrom, row.rangeTo)) {
      const from = dayStart(day);
      const to = dayStart(addDays(day, 1));

      // The day's archived object, if the sweep already took it.
      const archives = await this.db.txAs({ orgId }, (tx) =>
        this.repo.archivesBetween(tx, orgId, day, day),
      );
      for (const a of archives) {
        const events: Pending[] = [];
        // Streamed through gunzip a chunk at a time: a day's object can be tens of MB.
        await forEachGzipLine(a.payload, (line) => {
          const e = JSON.parse(line) as {
            messageId: number;
            messageCreatedAt: string;
            event: string;
            detail: Record<string, unknown>;
            at: string;
          };
          events.push({
            event: e.event,
            detail: e.detail ?? {},
            at: new Date(e.at),
            messageId: e.messageId,
            messageCreatedAt: e.messageCreatedAt,
          });
        });
        await emit(events);
      }

      // And what is still in the live table for that day (all of it for a recent day, nothing for an archived one).
      let after: { at: string; id: number } | null = null;
      for (;;) {
        const page = await this.db.txAs({ orgId }, (tx) =>
          this.repo.liveEventsPage(tx, orgId, from, to, after, BATCH),
        );
        if (page.length === 0) break;
        await emit(page);
        const last = page[page.length - 1]!;
        after = { at: last.atText, id: last.id };
        if (page.length < BATCH) break;
      }
    }
    return { file: Buffer.concat(members), rows };
  }

  /** The CSV lines of one slice of events: what the message is (recipient, template, status now) next to each event. */
  private async lines(tx: Tx, orgId: number, row: ExportRow, slice: Pending[]): Promise<string[]> {
    const infos = await this.repo.messageInfos(
      tx,
      orgId,
      slice.map((e) => ({ messageId: e.messageId, messageCreatedAt: e.messageCreatedAt })),
    );
    const retryIds = [...new Set(slice.map(retryUserId).filter((v): v is number => v !== null))];
    const names = await this.repo.userNames(tx, orgId, retryIds);
    const out: string[] = [];
    for (const e of slice) {
      const info = infos.get(`${e.messageId}|${e.messageCreatedAt}`);
      // A status filter keeps the events of messages that now have that status; a message that is gone cannot be matched.
      if (row.messageStatus && info?.status !== row.messageStatus) continue;
      const by = retryUserId(e);
      const event: MessageLogEvent = toLogEvent(e, null);
      out.push(csvLine(event, info, by === null ? null : (names.get(by) ?? null)));
    }
    return out;
  }

  /** Tells the requester, by email, that the file is ready (or why it is not). A mail that cannot go never fails the export. */
  private async notify(
    orgId: number,
    row: ExportRow,
    outcome: 'ready' | 'failed',
    rows: number,
    reason?: string,
  ): Promise<void> {
    if (!this.mail) return;
    try {
      const to = await this.db.txAs({ orgId }, async (tx) => {
        const who = await this.repo.userContact(tx, orgId, row.requestedBy);
        return who?.email ?? row.emailedTo;
      });
      if (!to) return;
      const history = row.kind === 'messages';
      const what = history ? 'message history' : 'message log';
      const link = history
        ? `${this.webUrl}/message-history?export=${row.uuid}`
        : `${this.webUrl}/inbox/message-logs?export=${row.uuid}`;
      const range = `${row.rangeFrom} to ${row.rangeTo}`;
      const text =
        outcome === 'ready'
          ? `Your ${what} export for ${range} is ready (${rows.toLocaleString('en-US')} lines).\n\nDownload it here while you are signed in:\n${link}\n\nThe file is kept for ${MESSAGE_LOG_EXPORT_TTL_DAYS} days.`
          : `Your ${what} export for ${range} could not be completed.\n\n${reason ?? ''}\n\nYou can request it again here:\n${link}`;
      await this.mail.send({
        to,
        subject:
          outcome === 'ready'
            ? `Your ${what} export is ready`
            : `Your ${what} export could not be completed`,
        text,
      });
    } catch (err) {
      this.logger.warn(
        { orgId, exportUuid: row.uuid, err: (err as Error).message },
        'export mail not sent',
      );
    }
  }
}
