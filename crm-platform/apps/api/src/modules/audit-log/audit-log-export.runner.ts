import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { gzipAsync } from '../../common/async-zlib';
import {
  AUDIT_LOG_EXPORT_MAX_ROWS,
  AUDIT_LOG_EXPORT_TTL_DAYS,
  type AuditLogFilters,
} from '@crm/contracts';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  MAIL_PORT,
  type MailPort,
} from '../../infra/providers/auth-registration-security/mail.port';
import { renderDelta } from './audit-pii';
import {
  CSV_BOM,
  CSV_HEADER,
  DAY_MS,
  archivedLineMatches,
  csvLine,
  resolveWindow,
  type ArchivedAuditLine,
  type RowPosition,
} from './audit-log.rules';
import { ArchiveReader, loadPolicy, monthBounds, partitionSizes } from '../data-retention';
import { AuditLogRepository, type AuditRow, type ExportRow } from './audit-log.repository';

/** Rows read per round trip, and written as one gzip member of the file. */
const BATCH = 5_000;

class ExportTooLarge extends Error {}

/** An archived line as the same shape a live row has, so one renderer writes both. `fromArchive` marks the names still to look up. */
function fromArchive(r: ArchivedAuditLine): AuditRow {
  const delta =
    r.delta && typeof r.delta === 'object' && !Array.isArray(r.delta)
      ? (r.delta as Record<string, unknown>)
      : null;
  const stamp = delta?._impersonatedBy as { new?: { sessionId?: unknown } } | undefined;
  const at = new Date(r.at);
  return {
    id: Number(r.id),
    atText: at.toISOString(),
    at,
    actorId: r.actor_id === null || r.actor_id === undefined ? null : Number(r.actor_id),
    actorType: r.actor_type,
    module: r.module,
    recordId: String(r.record_id),
    action: r.action,
    requestId: r.request_id ?? null,
    changedFields: delta
      ? Object.keys(delta)
          .filter((k) => k !== '_impersonatedBy')
          .sort()
      : [],
    sessionUuid: typeof stamp?.new?.sessionId === 'string' ? stamp.new.sessionId : null,
    userUuid: null,
    userName: null,
    keyName: null,
    delta: r.delta,
    fromArchive: true,
  };
}

/** `[from, to)` cut into UTC months, newest month first. */
function monthsNewestFirst(from: Date, to: Date): Array<{ from: Date; to: Date }> {
  const out: Array<{ from: Date; to: Date }> = [];
  let start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (start < to) {
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    out.push({
      from: new Date(Math.max(start.getTime(), from.getTime())),
      to: new Date(Math.min(end.getTime(), to.getTime())),
    });
    start = end;
  }
  return out.reverse();
}

/**
 * Builds one export of the audit log (worker side): the filtered window, newest first, as a CSV; stored gzipped on the export row for
 * AUDIT_LOG_EXPORT_TTL_DAYS days; the requester is mailed a link to the page that offers it. Records its own failure on the row (and
 * mails that too), so the queue never retries it.
 *
 * Field values in the file pass through the same PII-safe renderer as the screen and are ALWAYS masked, whoever asked: a file leaves
 * the system and cannot be watched. Cells that start like a formula are defused. Read in keyset pages, each its own short
 * transaction, so a long export never holds a snapshot open.
 */
@Injectable()
export class AuditLogExportRunner {
  private readonly logger = new Logger(AuditLogExportRunner.name);
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AuditLogRepository,
    config: ConfigService<Env, true>,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
    @Optional() private readonly archive?: ArchiveReader,
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
      const built = await this.build(orgId, claimed.filters);
      const ttlDays = await this.fileTtlDays();
      const stamp = now.toISOString().slice(0, 10);
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.finishExport(tx, orgId, claimed.id, {
          fileName: `audit-log-${stamp}.csv`,
          file: built.file,
          rowCount: built.rows,
          expiresAt: new Date(now.getTime() + ttlDays * DAY_MS),
        }),
      );
      await this.notify(orgId, claimed, 'ready', built.rows, undefined, ttlDays);
      return 'done';
    } catch (err) {
      const message =
        err instanceof ExportTooLarge
          ? `The export has more than ${AUDIT_LOG_EXPORT_MAX_ROWS.toLocaleString('en-US')} entries. Choose a shorter range.`
          : 'The export could not be built. Request it again.';
      if (!(err instanceof ExportTooLarge)) {
        this.logger.error(
          { orgId, exportUuid, err: (err as Error).message },
          'audit log export failed',
        );
      }
      await this.db.txAs({ orgId }, (tx) => this.repo.failExport(tx, orgId, claimed.id, message));
      await this.notify(orgId, claimed, 'failed', 0, message);
      return 'failed';
    }
  }

  /** How long a finished file is kept: the lifetime a super admin saved on the retention dashboard, else the built-in 7 days. */
  private async fileTtlDays(): Promise<number> {
    try {
      const saved = await this.db.privileged((tx) => loadPolicy(tx, 'audit_log_exports'));
      return saved?.liveDays ?? AUDIT_LOG_EXPORT_TTL_DAYS;
    } catch {
      return AUDIT_LOG_EXPORT_TTL_DAYS;
    }
  }

  private async build(
    orgId: number,
    filters: AuditLogFilters,
  ): Promise<{ file: Buffer; rows: number }> {
    const window = resolveWindow(filters);
    const members: Buffer[] = [await gzipAsync(`${CSV_BOM}${csvLine([...CSV_HEADER])}\r\n`)];
    let rows = 0;
    let after: RowPosition | null = null;

    let actorDbId: number | undefined;
    if (filters.actorId) {
      const found = await this.db.txAs({ orgId }, (tx) =>
        this.repo.userId(tx, orgId, filters.actorId!),
      );
      if (found === null) return { file: Buffer.concat(members), rows: 0 };
      actorDbId = found;
    }

    for (;;) {
      const cursor: RowPosition | null = after;
      const page: AuditRow[] = await this.db.txAs({ orgId }, (tx) =>
        this.repo.page(tx, filters, { orgId, window, actorDbId, after: cursor }, BATCH, true),
      );
      if (page.length === 0) break;
      rows += page.length;
      if (rows > AUDIT_LOG_EXPORT_MAX_ROWS) throw new ExportTooLarge();
      members.push(await this.render(orgId, page));
      const last = page[page.length - 1]!;
      after = { atText: last.atText, id: last.id };
      if (page.length < BATCH) break;
    }

    // Months an admin's retention policy has moved to the cold archive are no longer in the table: read them back, after the live rows.
    // Inside a month the archive is in id order (oldest first), so the file is newest-first by month and not strictly within one.
    const archivedUntil = await this.archivedUntil(window.from);
    if (archivedUntil && this.archive) {
      const to = new Date(Math.min(window.to.getTime(), archivedUntil.getTime()));
      let batch: AuditRow[] = [];
      const flush = async () => {
        if (batch.length === 0) return;
        members.push(await this.render(orgId, batch));
        batch = [];
      };
      for (const month of monthsNewestFirst(window.from, to)) {
        for await (const line of this.archive.stream('audit_log', orgId, month.from, month.to, {
          trusted: true,
        })) {
          const row = line as unknown as ArchivedAuditLine;
          if (!archivedLineMatches(filters, { actorDbId }, row)) continue;
          rows += 1;
          if (rows > AUDIT_LOG_EXPORT_MAX_ROWS) throw new ExportTooLarge();
          batch.push(fromArchive(row));
          if (batch.length >= BATCH) await flush();
        }
        await flush();
      }
    }
    return { file: Buffer.concat(members), rows };
  }

  /**
   * The instant before which the table no longer holds rows because their month was archived and dropped: the start of the oldest
   * partition that still exists. Null when the archive does not apply (no archive reader, no saved audit log policy, or the window
   * starts inside the table's own months).
   */
  private async archivedUntil(windowFrom: Date): Promise<Date | null> {
    if (!this.archive) return null;
    try {
      return await this.db.privileged(async (tx) => {
        if (!(await loadPolicy(tx, 'audit_log'))) return null;
        const oldest = (await partitionSizes(tx, 'audit_log'))[0]?.month;
        if (!oldest) return null;
        const until = monthBounds(oldest).from;
        return windowFrom < until ? until : null;
      });
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        'could not tell which audit months are archived',
      );
      return null;
    }
  }

  /** Turns rows into the CSV lines of one gzip member. Values pass through the PII-safe renderer and are always masked. */
  private async render(orgId: number, page: AuditRow[]): Promise<Buffer> {
    const sessionIds = [...new Set(page.map((r) => r.sessionUuid).filter((v): v is string => !!v))];
    const sessions = sessionIds.length
      ? await this.db.privileged((tx) => this.repo.impersonationSessions(tx, orgId, sessionIds))
      : new Map<string, { reason: string }>();
    // Archived lines carry only ids; give them the names a live row gets from its join.
    const missing = page.filter((r) => r.fromArchive);
    if (missing.length > 0) {
      const userIds = [
        ...new Set(
          missing
            .filter((r) => r.actorType === 'user' && r.actorId !== null)
            .map((r) => r.actorId!),
        ),
      ];
      const keyIds = [
        ...new Set(
          missing
            .filter((r) => r.actorType === 'api_key' && r.actorId !== null)
            .map((r) => r.actorId!),
        ),
      ];
      const names = await this.db.txAs({ orgId }, (tx) =>
        this.repo.actorNames(tx, orgId, userIds, keyIds),
      );
      for (const r of missing) {
        if (r.actorId === null) continue;
        if (r.actorType === 'user') r.userName = names.users.get(r.actorId) ?? null;
        if (r.actorType === 'api_key') r.keyName = names.keys.get(r.actorId) ?? null;
      }
    }
    const lines = page.map((r) => {
      const session = r.sessionUuid ? sessions.get(r.sessionUuid) : undefined;
      const changes = renderDelta(r.delta, { module: r.module, reveal: false });
      return csvLine([
        r.at.toISOString(),
        r.actorType,
        r.actorType === 'user' ? r.userName : r.actorType === 'api_key' ? r.keyName : '',
        r.sessionUuid ? 'yes' : 'no',
        session?.reason ?? '',
        r.module,
        r.action,
        r.recordId,
        r.requestId ?? '',
        r.changedFields.join(';'),
        Object.keys(changes).length > 0 ? JSON.stringify(changes) : '',
      ]);
    });
    return gzipAsync(`${lines.join('\r\n')}\r\n`);
  }

  /** Tells the requester, by email, that the file is ready (or why it is not). A mail that cannot go never fails the export. */
  private async notify(
    orgId: number,
    row: ExportRow,
    outcome: 'ready' | 'failed',
    rows: number,
    reason?: string,
    ttlDays: number = AUDIT_LOG_EXPORT_TTL_DAYS,
  ): Promise<void> {
    if (!this.mail) return;
    try {
      const to = await this.db.txAs({ orgId }, async (tx) => {
        const who = await this.repo.userContact(tx, orgId, row.requestedBy);
        return who?.email ?? row.emailedTo;
      });
      if (!to) return;
      const link = `${this.webUrl}/activity-log?export=${row.uuid}`;
      const text =
        outcome === 'ready'
          ? `Your audit log export is ready (${rows.toLocaleString('en-US')} entries).\n\nDownload it here while you are signed in:\n${link}\n\nThe file is kept for ${ttlDays} days.`
          : `Your audit log export could not be completed.\n\n${reason ?? ''}\n\nYou can request it again here:\n${link}`;
      await this.mail.send({
        to,
        subject:
          outcome === 'ready'
            ? 'Your audit log export is ready'
            : 'Your audit log export could not be completed',
        text,
      });
    } catch (err) {
      this.logger.warn(
        { orgId, exportUuid: row.uuid, err: (err as Error).message },
        'audit log export mail not sent',
      );
    }
  }
}
