import { HttpStatus, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { forEachGzipLine } from '../../common/async-zlib';
import {
  ERROR_CODES,
  type CreateMessageLogExportInput,
  type MessageLogExport,
  type MessageLogExportKind,
  type MessageLogExportList,
  type MessageStatus,
  type MessageLogResponse,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { MessageLogExportPublisher } from './message-log-export.publisher';
import { MessageLogRepository, type ExportRow } from './message-log.repository';
import {
  ARCHIVE_LOOKAHEAD_DAYS,
  addDays,
  dayOf,
  exportRangeProblem,
  hotCutoff,
  retentionCutoff,
  retryUserId,
  toLogEvent,
  type StoredEvent,
} from './message-log-rules';
import { MESSAGE_LOG_MIN_HOT_DAYS, messageLogWindows } from './message-log-windows';
import type { HistoryExportRequest, MessageLogFacade } from './message-log.facade';
import { MessagesRepository } from './messages.repository';

const LIST_LIMIT = 20;

const RANGE_MESSAGES = {
  order: 'The start date must not be after the end date.',
  future: 'The end date cannot be in the future.',
  too_old: 'Logs are kept for one year. Choose dates within the last 365 days.',
} as const;

/** The refusal text for a range; the "too old" line names the window the platform currently keeps. */
function rangeMessage(problem: keyof typeof RANGE_MESSAGES, retentionDays: number | null): string {
  if (problem === 'too_old' && retentionDays !== null && retentionDays !== 365) {
    return `Logs are kept for ${retentionDays} days. Choose dates within the last ${retentionDays} days.`;
  }
  return RANGE_MESSAGES[problem];
}

/** The archive's lines of one message: every line of the day objects that names it. */
export async function archivedEventsOf(
  payloads: Buffer[],
  message: { id: number; createdAtText: string },
): Promise<Array<StoredEvent & { sortId: number }>> {
  const out: Array<StoredEvent & { sortId: number }> = [];
  for (const payload of payloads) {
    // A day's object for one workspace is tens of MB at volume: streamed through gunzip, a chunk at a time, never as one string.
    await forEachGzipLine(payload, (line) => {
      const e = JSON.parse(line) as {
        id: number;
        messageId: number;
        messageCreatedAt: string;
        event: string;
        detail: Record<string, unknown>;
        at: string;
      };
      if (e.messageId !== message.id) return;
      if (e.messageCreatedAt !== message.createdAtText) return;
      out.push({ event: e.event, detail: e.detail ?? {}, at: new Date(e.at), sortId: e.id });
    });
  }
  return out;
}

/**
 * The message delivery log as the inbox serves it: one message's timeline (live events plus the archive) and the export of a date range
 * to a CSV by email. The build of an export is the worker's (`MessageLogExportRunner`); this side validates, records and enqueues.
 */
@Injectable()
export class MessageLogService implements MessageLogFacade {
  constructor(
    private readonly db: DatabaseService,
    private readonly messages: MessagesRepository,
    private readonly repo: MessageLogRepository,
    private readonly publisher: MessageLogExportPublisher,
  ) {}

  async messageLog(messageUuid: string, now: Date = new Date()): Promise<MessageLogResponse> {
    const ctx = RequestContextStore.require();
    // The windows the platform retention settings give the log now (the tenant session cannot read the policy table).
    const windows = await this.db.privileged((ptx) => messageLogWindows(ptx));
    return this.db.tx(async (tx) => {
      const row = await this.messages.byUuid(tx, ctx.orgId, messageUuid);
      if (!row) {
        throw new AppError(
          ERROR_CODES.MESSAGE_NOT_FOUND,
          'Message not found',
          HttpStatus.NOT_FOUND,
        );
      }
      const ref = { id: row.id, createdAt: row.createdAtText };
      const live = (await this.messages.events(tx, ctx.orgId, ref)).map((e, i) => ({
        ...e,
        sortId: Number.MAX_SAFE_INTEGER - 1_000_000 + i,
      }));

      // Events older than the live window are in the archive: only a message that is itself older than the cut can have any. The
      // live window can have been longer or shorter on the days the sweep ran, so the archive is searched from the shortest window the
      // settings allow up to yesterday; a day with nothing archived costs one empty lookup.
      const cut = hotCutoff(now, Math.min(windows.hotDays, MESSAGE_LOG_MIN_HOT_DAYS));
      let archived: Array<StoredEvent & { sortId: number }> = [];
      if (row.createdAt.getTime() < cut.getTime()) {
        const from = dayOf(row.createdAt);
        const lastArchivedDay = addDays(dayOf(now), -1);
        const to =
          addDays(from, ARCHIVE_LOOKAHEAD_DAYS) < lastArchivedDay
            ? addDays(from, ARCHIVE_LOOKAHEAD_DAYS)
            : lastArchivedDay;
        const objects = await this.repo.archivesBetween(tx, ctx.orgId, from, to);
        archived = await archivedEventsOf(
          objects.map((o) => o.payload),
          row,
        );
      }

      const events = [...archived, ...live].sort(
        (a, b) => a.at.getTime() - b.at.getTime() || a.sortId - b.sortId,
      );
      const byIds = [...new Set(events.map(retryUserId).filter((v): v is number => v !== null))];
      const uuids = await this.repo.userUuids(tx, ctx.orgId, byIds);
      return {
        messageId: row.uuid,
        kind: row.kind,
        status: row.status,
        providerMessageId: row.providerMessageId,
        failureCode: row.failureCode,
        failureReason: row.failureReason,
        createdAt: row.createdAt.toISOString(),
        events: events.map((e) => {
          const by = retryUserId(e);
          return toLogEvent(e, by === null ? null : (uuids.get(by) ?? null));
        }),
        fromArchive: archived.length > 0,
        expired:
          row.createdAt.getTime() < retentionCutoff(now, windows.retentionDays).getTime() &&
          events.length === 0,
      };
    });
  }

  async requestExport(
    input: CreateMessageLogExportInput,
    now: Date = new Date(),
  ): Promise<MessageLogExport> {
    const windows = await this.db.privileged((tx) => messageLogWindows(tx));
    const problem = exportRangeProblem(input.from, input.to, now, windows.retentionDays);
    if (problem) {
      throw new AppError(
        ERROR_CODES.MESSAGE_LOG_EXPORT_RANGE_INVALID,
        rangeMessage(problem, windows.retentionDays),
        HttpStatus.UNPROCESSABLE_ENTITY,
        [
          {
            path: problem === 'order' ? 'from' : 'to',
            message: rangeMessage(problem, windows.retentionDays),
          },
        ],
      );
    }
    return this.queueExport({
      from: input.from,
      to: input.to,
      messageStatus: input.messageStatus ?? null,
      kind: 'events',
      filters: null,
    });
  }

  /**
   * The export of the Message History feed (one line per message) with the screen's filters, already resolved to a window of absolute
   * instants by the caller. Built and announced like the delivery log export; only one export of either kind runs at a time.
   */
  async requestHistoryExport(input: HistoryExportRequest): Promise<MessageLogExport> {
    return this.queueExport({
      from: input.from,
      to: input.to,
      messageStatus: null,
      kind: 'messages',
      filters: input.filters,
    });
  }

  private async queueExport(input: {
    from: string;
    to: string;
    messageStatus: MessageStatus | null;
    kind: MessageLogExportKind;
    filters: Record<string, unknown> | null;
  }): Promise<MessageLogExport> {
    const ctx = RequestContextStore.require();
    if (ctx.userId === null) throw AppError.forbidden('inbox.logs.export');
    const userId = ctx.userId;

    const created = await this.db.tx(async (tx) => {
      if (await this.repo.activeExport(tx, ctx.orgId)) {
        throw new AppError(
          ERROR_CODES.MESSAGE_LOG_EXPORT_IN_PROGRESS,
          'An export is already being prepared. Wait for its email, then request another.',
          HttpStatus.CONFLICT,
        );
      }
      const who = await this.repo.userContact(tx, ctx.orgId, userId);
      return this.repo.createExport(tx, ctx.orgId, {
        requestedBy: userId,
        emailedTo: who?.email ?? null,
        from: input.from,
        to: input.to,
        messageStatus: input.messageStatus,
        kind: input.kind,
        filters: input.filters,
      });
    });

    try {
      await this.publisher.enqueue(ctx.orgId, created.uuid);
    } catch (err) {
      // Redis is down: the row must not sit `queued` forever, blocking every later request.
      await this.db.tx((tx) =>
        this.repo.failExport(
          tx,
          ctx.orgId,
          created.id,
          'The export could not be started. Try again.',
        ),
      );
      throw err;
    }
    return toExportResponse(created);
  }

  async listExports(kind: MessageLogExportKind = 'events'): Promise<MessageLogExportList> {
    const ctx = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.repo.listExports(tx, ctx.orgId, LIST_LIMIT, kind));
    return { data: rows.map(toExportResponse) };
  }

  async downloadExport(exportUuid: string): Promise<{ stream: Readable; fileName: string }> {
    const ctx = RequestContextStore.require();
    const found = await this.db.tx(async (tx) => {
      const row = await this.repo.exportByUuid(tx, ctx.orgId, exportUuid);
      if (!row) return { row: null, file: null };
      return { row, file: await this.repo.exportFile(tx, ctx.orgId, row.id) };
    });
    if (!found.row) {
      throw new AppError(
        ERROR_CODES.MESSAGE_LOG_EXPORT_NOT_FOUND,
        'Export not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (!found.file) {
      throw new AppError(
        ERROR_CODES.MESSAGE_LOG_EXPORT_NOT_READY,
        found.row.status === 'expired'
          ? 'This export has expired. Request it again.'
          : 'This export is not ready yet.',
        HttpStatus.CONFLICT,
      );
    }
    const stream = Readable.from(found.file).pipe(createGunzip());
    return { stream, fileName: found.row.fileName ?? `message-log-${found.row.rangeFrom}.csv` };
  }
}

export function toExportResponse(r: ExportRow): MessageLogExport {
  return {
    id: r.uuid,
    kind: r.kind,
    status: r.status,
    from: r.rangeFrom,
    to: r.rangeTo,
    messageStatus: r.messageStatus,
    rowCount: r.rowCount,
    fileBytes: r.fileBytes,
    error: r.error,
    requestedAt: r.requestedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    emailedTo: r.emailedTo,
  };
}
