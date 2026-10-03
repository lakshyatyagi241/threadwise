import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { ImportService, type ImportJob, type ImportStats } from './import.service';

/**
 * Imports one store (WD-ECOM-011). Registered only in the worker process (ShopifyWoocommerceWorkerModule, imported by WorkersModule):
 * the HTTP app queues the job and never runs it. A run again is safe because every row is keyed by the store's id.
 */
@Processor(QUEUES.ECOM_IMPORT, { concurrency: 2 })
export class EcomImportProcessor extends WorkerHost {
  private readonly logger = new Logger(EcomImportProcessor.name);

  constructor(private readonly imports: ImportService) {
    super();
  }

  process(job: Job<ImportJob>): Promise<ImportStats> {
    const { orgId, kind, id } = job.data;
    return RequestContextStore.run(
      {
        requestId: `ecom-import-${kind}-${id}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          return await this.imports.run(orgId, kind, id);
        } catch (err) {
          this.logger.error({ orgId, kind, id, err }, '[ECOM] import job crashed');
          throw err;
        }
      },
    );
  }
}
