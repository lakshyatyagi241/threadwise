import { Injectable, Logger } from '@nestjs/common';
import { PRIVACY_EXPORT_TTL_DAYS } from '@crm/contracts';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { DatabaseService } from '../../../infra/db/database.service';
import { ExportBuilder } from '../engine/export-builder';
import { SubjectResolver } from '../engine/subject-resolver';
import { referenceOf } from './privacy-requests.mapper';
import { PrivacyRequestsRepository } from './privacy-requests.repository';
import { storedSubjectOf } from './request-subject';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds one export (worker side): claims the row `queued -> running`, reads everything the workspace holds about the person in one
 * transaction (a consistent snapshot of one moment), stores the ZIP on the export row for PRIVACY_EXPORT_TTL_DAYS days and records its
 * own failure on the row, so the queue never retries it. Nothing is emailed: the workspace admin downloads the file from the request.
 * No log line carries a value, only ids and counts.
 */
@Injectable()
export class PrivacyExportRunner {
  private readonly logger = new Logger(PrivacyExportRunner.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PrivacyRequestsRepository,
    private readonly resolver: SubjectResolver,
    private readonly builder: ExportBuilder,
    private readonly crypto: CryptoService,
  ) {}

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
      const built = await this.db.txAs({ orgId }, async (tx) => {
        const request = await this.repo.byId(tx, orgId, claimed.requestId);
        if (!request) throw new Error('request gone');
        const stored = storedSubjectOf(request, this.crypto);
        if (!stored) throw new Error('subject gone');
        const subject = await this.resolver.resolve(tx, orgId, stored);
        const result = await this.builder.build(tx, {
          orgId,
          requestId: request.id,
          reference: referenceOf(request.uuid),
          requestType: request.requestType,
          linkUserId: claimed.requestedBy,
          subject,
          now,
        });
        return { result, reference: referenceOf(request.uuid) };
      });
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.finishExport(tx, orgId, claimed.id, {
          fileName: `${built.reference}-data-export.zip`,
          zip: built.result.zip,
          sections: built.result.sections,
          expiresAt: new Date(now.getTime() + PRIVACY_EXPORT_TTL_DAYS * DAY_MS),
        }),
      );
      return 'done';
    } catch (err) {
      this.logger.error({ orgId, exportUuid, err: (err as Error).message }, 'privacy export failed');
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.failExport(tx, orgId, claimed.id, 'The export could not be built. Request it again.'),
      );
      return 'failed';
    }
  }
}
