import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { AppError } from '../../common/errors/app-error';
import { QUEUES } from '../../infra/queue/queues';
import { WabaIngestService } from './waba-ingest.service';
import type { WabaIngestJob } from './waba-webhook.service';

/** Works the WhatsApp webhook queue. Registered only in the worker process (WabaWorkerModule). */
@Processor(QUEUES.WABA_INGEST, { concurrency: 8 })
export class WabaIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(WabaIngestProcessor.name);

  constructor(private readonly ingest: WabaIngestService) {
    super();
  }

  async process(job: Job<WabaIngestJob>): Promise<{ handled: number; dropped: number }> {
    try {
      return await this.ingest.process(job.data.changes);
    } catch (err) {
      // A rule the data broke will break again; anything else (database, redis) retries with backoff.
      if (err instanceof AppError) throw new UnrecoverableError(err.message);
      this.logger.error({ jobId: job.id, err }, '[WABA] ingest job failed');
      throw err;
    }
  }
}
