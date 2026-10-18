import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { gzipAsync } from '../../../common/async-zlib';
import {
  REVENUE_EXPORT_MAX_ROWS,
  REVENUE_EXPORT_TTL_DAYS,
  type RevenueReportQuery,
} from '@crm/contracts';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  MAIL_PORT,
  type MailPort,
} from '../../../infra/providers/auth-registration-security/mail.port';
import { ledgerCsvLine, ledgerCsvStart, renderRevenuePdf, summaryCsv } from './revenue-files';
import { RevenueExportRepository, type RevenueExportRow } from './revenue-export.repository';
import type { FrozenPeriod } from './revenue-report-rules';
import { RevenueReportRepository, type LedgerRow } from './revenue-report.repository';
import { RevenueReportService, type RevenueBuildInput } from './revenue-report.service';

/** Ledger lines read per round trip, and written as one gzip member of the file. */
const BATCH = 5_000;
const DAY_MS = 86_400_000;

class ExportTooLarge extends Error {}

/** The report the stored filters describe, for the person who asked and with the scope they had then. */
export function inputOf(row: RevenueExportRow, now: Date): RevenueBuildInput {
  const f = row.filters;
  const frozen: FrozenPeriod = {
    range: f.range,
    fromDate: f.fromDate,
    toDate: f.toDate,
    compare: f.compare,
  };
  const query: RevenueReportQuery = {
    range: f.range,
    compare: f.compare?.mode ?? 'none',
    groupBy: f.groupBy,
    ownerId: f.ownerId ?? undefined,
    teamId: f.teamId ?? undefined,
    currency: f.currency ?? undefined,
    convertTo: f.convertTo ?? undefined,
  };
  return {
    orgId: row.orgId,
    userId: row.requestedBy,
    scope: row.scope,
    query,
    timezone: f.timezone,
    frozen,
    now,
  };
}

/**
 * Builds one file of the revenue report (worker side): the PDF, the summary CSV or the ledger CSV, for the person and the record scope
 * recorded on the export row; stored gzipped for REVENUE_EXPORT_TTL_DAYS days; the requester is mailed a link to the page that offers
 * it. Records its own failure on the row (and mails that too), so the queue never retries it.
 *
 * The ledger is read in keyset pages, each its own short transaction, so a long export never holds a snapshot open. Cells that start
 * like a formula are defused.
 */
@Injectable()
export class RevenueExportRunner {
  private readonly logger = new Logger(RevenueExportRunner.name);
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly exports: RevenueExportRepository,
    private readonly reports: RevenueReportService,
    private readonly reportRepo: RevenueReportRepository,
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
      const row = await this.exports.byUuid(tx, orgId, exportUuid, null);
      if (!row || row.status !== 'queued') return null;
      return (await this.exports.claim(tx, orgId, row.id)) ? row : null;
    });
    if (!claimed) return 'skipped';

    try {
      const built = await this.build(claimed, now);
      const stored = await this.db.txAs({ orgId }, (tx) =>
        this.exports.finish(tx, orgId, claimed.id, {
          fileName: built.fileName,
          file: built.file,
          rowCount: built.rows,
          expiresAt: new Date(now.getTime() + REVENUE_EXPORT_TTL_DAYS * DAY_MS),
        }),
      );
      // An erasure deleted the row while the file was being built: nothing was stored, and nobody is told a file is ready.
      if (!stored) return 'skipped';
      await this.notify(claimed, 'ready', built.rows);
      return 'done';
    } catch (err) {
      const message =
        err instanceof ExportTooLarge
          ? `The export has more than ${REVENUE_EXPORT_MAX_ROWS.toLocaleString('en-US')} payments. Choose a shorter period.`
          : 'The export could not be built. Request it again.';
      if (!(err instanceof ExportTooLarge)) {
        this.logger.error(
          { orgId, exportUuid, err: (err as Error).message },
          'revenue report export failed',
        );
      }
      await this.db.txAs({ orgId }, (tx) => this.exports.fail(tx, orgId, claimed.id, message));
      await this.notify(claimed, 'failed', 0, message);
      return 'failed';
    }
  }

  private async build(
    row: RevenueExportRow,
    now: Date,
  ): Promise<{ file: Buffer; rows: number; fileName: string }> {
    const input = inputOf(row, now);
    const { fromDate, toDate, timezone } = row.filters;
    const span = `${fromDate}_${toDate}`;

    if (row.format === 'csv' && row.csvKind === 'payments') {
      const { file, rows } = await this.ledger(row, input);
      return { file, rows, fileName: `revenue-payments-${span}.csv` };
    }

    const { report, brand } = await this.db.txAs({ orgId: row.orgId }, async (tx) => ({
      report: await this.reports.build(tx, input),
      brand: await this.exports.orgName(tx, row.orgId),
    }));
    if (row.format === 'csv') {
      return {
        file: await gzipAsync(summaryCsv(report)),
        rows: report.rows.items.length,
        fileName: `revenue-summary-${span}.csv`,
      };
    }
    const generatedAt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now);
    return {
      file: await gzipAsync(renderRevenuePdf({ report, brand, generatedAt })),
      rows: report.rows.items.length,
      fileName: `revenue-report-${span}.pdf`,
    };
  }

  private async ledger(
    row: RevenueExportRow,
    input: RevenueBuildInput,
  ): Promise<{ file: Buffer; rows: number }> {
    const orgId = row.orgId;
    const resolved = await this.db.txAs({ orgId }, (tx) => this.reports.resolve(tx, input));
    const span = { from: resolved.period.from, to: resolved.period.toExclusive };
    const members: Buffer[] = [await gzipAsync(ledgerCsvStart())];
    let rows = 0;
    let after: { paidAtText: string; id: number } | null = null;

    for (;;) {
      const cursor: { paidAtText: string; id: number } | null = after;
      const page: LedgerRow[] = await this.db.txAs({ orgId }, (tx) =>
        this.reportRepo.ledgerPage(
          tx,
          resolved.filter,
          resolved.scopes.payments,
          span,
          resolved.tz,
          cursor,
          BATCH,
        ),
      );
      if (page.length === 0) break;
      rows += page.length;
      if (rows > REVENUE_EXPORT_MAX_ROWS) throw new ExportTooLarge();
      members.push(await gzipAsync(page.map(ledgerCsvLine).join('')));
      const last = page[page.length - 1]!;
      after = { paidAtText: last.paidAtText, id: last.id };
      if (page.length < BATCH) break;
    }
    return { file: Buffer.concat(members), rows };
  }

  /** Tells the requester, by email, that the file is ready (or why it is not). A mail that cannot go never fails the export. */
  private async notify(
    row: RevenueExportRow,
    outcome: 'ready' | 'failed',
    rows: number,
    reason?: string,
  ): Promise<void> {
    if (!this.mail) return;
    try {
      const to = await this.db.txAs({ orgId: row.orgId }, async (tx) => {
        const who = await this.exports.userContact(tx, row.orgId, row.requestedBy);
        return who?.email ?? row.emailedTo;
      });
      if (!to) return;
      const link = `${this.webUrl}/crm/revenue?export=${row.uuid}`;
      const what = row.format === 'pdf' ? 'PDF' : 'CSV';
      const text =
        outcome === 'ready'
          ? `Your revenue report ${what} is ready (${rows.toLocaleString('en-US')} ${row.csvKind === 'payments' ? 'payments' : 'rows'}).\n\nDownload it here while you are signed in:\n${link}\n\nThe file is kept for ${REVENUE_EXPORT_TTL_DAYS} days.`
          : `Your revenue report ${what} could not be completed.\n\n${reason ?? ''}\n\nYou can request it again here:\n${link}`;
      await this.mail.send({
        to,
        subject:
          outcome === 'ready'
            ? `Your revenue report ${what} is ready`
            : `Your revenue report ${what} could not be completed`,
        text,
      });
    } catch (err) {
      this.logger.warn(
        { orgId: row.orgId, exportUuid: row.uuid, err: (err as Error).message },
        'revenue report export mail not sent',
      );
    }
  }
}
