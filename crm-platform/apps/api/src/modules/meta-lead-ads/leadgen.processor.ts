import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { META_LEADGEN_JOB, metaLeadgenJobSchema } from '@crm/contracts';
import { QUEUES } from '../../infra/queue/queues';
import { LeadgenService, type LeadgenOutcome } from './leadgen.service';

/**
 * One `leadgen` event of a Page's webhook: fetches the lead from Meta and hands it to the lead pipeline. Registered only in the worker
 * process (MetaLeadAdsWorkerModule, imported by WorkersModule): the HTTP app queues the job and never runs it. A retry is safe because the
 * pipeline stores every lead once, under Meta's lead id. A job that cannot be read is dropped (a retry cannot fix a bad payload).
 */
@Processor(QUEUES.META_LEADGEN, { concurrency: 4 })
export class LeadgenProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadgenProcessor.name);

  constructor(private readonly leads: LeadgenService) {
    super();
  }

  async process(job: Job<unknown>): Promise<LeadgenOutcome | null> {
    if (job.name !== META_LEADGEN_JOB) {
      this.logger.warn({ name: job.name }, 'unknown job on the lead ads queue');
      return null;
    }
    const parsed = metaLeadgenJobSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.warn({ id: job.id }, 'leadgen job has an unreadable payload; dropped');
      return null;
    }
    try {
      return await this.leads.handleWebhook(parsed.data);
    } catch (err) {
      this.logger.warn(
        { orgId: parsed.data.orgId, page: parsed.data.pageId, err },
        '[MLA] leadgen job failed; the queue retries it and the sweep is the backstop',
      );
      throw err;
    }
  }
}
