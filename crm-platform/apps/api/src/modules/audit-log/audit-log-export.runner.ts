import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { gzipSync } from 'node:zlib';
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
  csvLine,
  resolveWindow,
  type RowPosition,
} from './audit-log.rules';
import { AuditLogRepository, type AuditRow, type ExportRow } from './audit-log.repository';

/** Rows read per round trip, and written as one gzip member of the file. */
const BATCH = 5_000;

class ExportTooLarge extends Error {}

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
      const stamp = now.toISOString().slice(0, 10);
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.finishExport(tx, orgId, claimed.id, {
          fileName: `audit-log-${stamp}.csv`,
          file: built.file,
          rowCount: built.rows,
          expiresAt: new Date(now.getTime() + AUDIT_LOG_EXPORT_TTL_DAYS * DAY_MS),
        }),
      );
      await this.notify(orgId, claimed, 'ready', built.rows);
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

  private async build(
    orgId: number,
    filters: AuditLogFilters,
  ): Promise<{ file: Buffer; rows: number }> {
    const window = resolveWindow(filters);
    const members: Buffer[] = [gzipSync(`${CSV_BOM}${csvLine([...CSV_HEADER])}\r\n`)];
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

      const sessionIds = [
        ...new Set(page.map((r) => r.sessionUuid).filter((v): v is string => !!v)),
      ];
      const sessions = sessionIds.length
        ? await this.db.privileged((tx) => this.repo.impersonationSessions(tx, orgId, sessionIds))
        : new Map<string, { reason: string }>();
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
      members.push(gzipSync(`${lines.join('\r\n')}\r\n`));
      const last = page[page.length - 1]!;
      after = { atText: last.atText, id: last.id };
      if (page.length < BATCH) break;
    }
    return { file: Buffer.concat(members), rows };
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
      const link = `${this.webUrl}/activity-log?export=${row.uuid}`;
      const text =
        outcome === 'ready'
          ? `Your audit log export is ready (${rows.toLocaleString('en-US')} entries).\n\nDownload it here while you are signed in:\n${link}\n\nThe file is kept for ${AUDIT_LOG_EXPORT_TTL_DAYS} days.`
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
