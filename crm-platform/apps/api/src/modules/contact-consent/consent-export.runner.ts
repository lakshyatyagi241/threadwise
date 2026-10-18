import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { gzipAsync } from '../../common/async-zlib';
import { CONSENT_EXPORT_MAX_ROWS, CONSENT_EXPORT_TTL_DAYS } from '@crm/contracts';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  MAIL_PORT,
  type MailPort,
} from '../../infra/providers/auth-registration-security/mail.port';
import { ConsentExportRepository, type ConsentExportRow } from './consent-export.repository';
import { ConsentRepository, type EventRow } from './consent.repository';
import { CONSENT_CSV_HEADER, proofCsvLine } from './consent.rules';

/** Events read per round trip, and written as one gzip member of the file. */
const BATCH = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;

class ExportTooLarge extends Error {}

/**
 * Builds one asynchronous export of the consent proof (worker side): the whole ledger, newest first, in the same CSV the direct download
 * produces (`proofCsvLine`), stored gzipped on the export row for CONSENT_EXPORT_TTL_DAYS days; the requester is mailed a link to the
 * page that offers it. Records its own failure on the row (and mails that too), so the queue never retries it.
 *
 * The file is built as gzip members in memory (a few MB for a million events), never as one big string, and stops at
 * CONSENT_EXPORT_MAX_ROWS. Read in keyset pages by event id, each page its own short transaction, so a long export never holds a
 * snapshot open.
 */
@Injectable()
export class ConsentExportRunner {
  private readonly logger = new Logger(ConsentExportRunner.name);
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConsentExportRepository,
    private readonly ledger: ConsentRepository,
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
      const row = await this.repo.byUuid(tx, orgId, exportUuid);
      if (!row || row.status !== 'queued') return null;
      return (await this.repo.claim(tx, orgId, row.id)) ? row : null;
    });
    if (!claimed) return 'skipped';

    try {
      const built = await this.build(orgId);
      const stamp = now.toISOString().slice(0, 10);
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.finish(tx, orgId, claimed.id, {
          fileName: `consent-proof-${stamp}.csv`,
          file: built.file,
          rowCount: built.rows,
          expiresAt: new Date(now.getTime() + CONSENT_EXPORT_TTL_DAYS * DAY_MS),
        }),
      );
      await this.notify(orgId, claimed, 'ready', built.rows);
      return 'done';
    } catch (err) {
      const message =
        err instanceof ExportTooLarge
          ? `The ledger has more than ${CONSENT_EXPORT_MAX_ROWS.toLocaleString('en-US')} events. Contact support for a database export.`
          : 'The export could not be built. Request it again.';
      if (!(err instanceof ExportTooLarge)) {
        this.logger.error(
          { orgId, exportUuid, err: (err as Error).message },
          'consent export failed',
        );
      }
      await this.db.txAs({ orgId }, (tx) => this.repo.fail(tx, orgId, claimed.id, message));
      await this.notify(orgId, claimed, 'failed', 0, message);
      return 'failed';
    }
  }

  private async build(orgId: number): Promise<{ file: Buffer; rows: number }> {
    const members: Buffer[] = [await gzipAsync(`${CONSENT_CSV_HEADER.join(',')}\r\n`)];
    let rows = 0;
    let after: number | null = null;
    for (;;) {
      const cursor: number | null = after;
      const page: EventRow[] = await this.db.txAs({ orgId }, (tx) =>
        this.ledger.listEvents(tx, orgId, { after: cursor, limit: BATCH }),
      );
      if (page.length === 0) break;
      rows += page.length;
      if (rows > CONSENT_EXPORT_MAX_ROWS) throw new ExportTooLarge();
      members.push(await gzipAsync(`${page.map(proofCsvLine).join('\r\n')}\r\n`));
      after = page[page.length - 1]!.id;
      if (page.length < BATCH) break;
    }
    return { file: Buffer.concat(members), rows };
  }

  /** Tells the requester, by email, that the file is ready (or why it is not). A mail that cannot go never fails the export. */
  private async notify(
    orgId: number,
    row: ConsentExportRow,
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
      const link = `${this.webUrl}/contact-consent?export=${row.uuid}`;
      const text =
        outcome === 'ready'
          ? `Your consent proof export is ready (${rows.toLocaleString('en-US')} events).\n\nDownload it here while you are signed in:\n${link}\n\nThe file is kept for ${CONSENT_EXPORT_TTL_DAYS} days.`
          : `Your consent proof export could not be completed.\n\n${reason ?? ''}\n\nYou can request it again here:\n${link}`;
      await this.mail.send({
        to,
        subject:
          outcome === 'ready'
            ? 'Your consent proof export is ready'
            : 'Your consent proof export could not be completed',
        text,
      });
    } catch (err) {
      this.logger.warn(
        { orgId, exportUuid: row.uuid, err: (err as Error).message },
        'consent export mail not sent',
      );
    }
  }
}
