import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { CryptoService } from '../../common/crypto/crypto.service';
import { openJson } from '../../common/crypto/sealed-json';
import { AppError } from '../../common/errors/app-error';
import { QUEUES } from '../../infra/queue/queues';
import { WabaIngestService } from './waba-ingest.service';
import type { WabaIngestJob } from './waba-webhook.service';
import type { WebhookChange } from './waba-rules';

/** Works the WhatsApp webhook queue. Registered only in the worker process (WabaWorkerModule). */
@Processor(QUEUES.WABA_INGEST, { concurrency: 8 })
export class WabaIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(WabaIngestProcessor.name);

  constructor(
    private readonly ingest: WabaIngestService,
    private readonly crypto: CryptoService,
  ) {
    super();
  }

  async process(job: Job<WabaIngestJob>): Promise<{ handled: number; dropped: number }> {
    try {
      return await this.ingest.process(this.changesOf(job.data));
    } catch (err) {
      // A rule the data broke will break again; anything else (database, redis) retries with backoff.
      if (err instanceof AppError) throw new UnrecoverableError(err.message);
      this.logger.error({ jobId: job.id, err }, '[WABA] ingest job failed');
      // A database error arrives wrapped ("Failed query: ..."), so the failed job's reason hid the cause (permission denied, a lock).
      const cause = (err as { cause?: unknown }).cause;
      if (cause instanceof Error && !(err as Error).message.includes(cause.message))
        throw new Error(`${(err as Error).message.split('\n')[0]} -- ${cause.message}`, { cause });
      throw err;
    }
  }

  /** The changes of a job: opened from the sealed payload, or read as they are from a job queued before sealing. */
  private changesOf(data: WabaIngestJob): WebhookChange[] {
    if (data.sealed === undefined) return data.changes ?? [];
    try {
      return openJson<{ changes: WebhookChange[] }>(this.crypto, data.sealed).changes;
    } catch {
      // A blob that does not open (a key rotated away, a corrupt value) opens no better on the next attempt.
      throw new UnrecoverableError('WhatsApp ingest payload could not be opened');
    }
  }
}
