import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { META_LEAD_SWEEP_JOB, metaLeadSweepJobSchema } from '@crm/contracts';
import { QUEUES } from '../../infra/queue/queues';
import { LeadgenService, type SweepResult } from './leadgen.service';

/** One Page's reconciliation sweep (worker process only). Idempotent: the pipeline stores every lead once, under Meta's lead id. */
@Processor(QUEUES.META_LEAD_SWEEP, { concurrency: 2 })
export class LeadSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadSweepProcessor.name);

  constructor(private readonly leads: LeadgenService) {
    super();
  }

  async process(job: Job<unknown>): Promise<SweepResult | null> {
    if (job.name !== META_LEAD_SWEEP_JOB) return null;
    const parsed = metaLeadSweepJobSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.warn({ id: job.id }, 'lead sweep job has an unreadable payload; dropped');
      return null;
    }
    try {
      return await this.leads.sweepPage(parsed.data.orgId, parsed.data.pageId);
    } catch (err) {
      this.logger.error(
        { orgId: parsed.data.orgId, page: parsed.data.pageId, err },
        '[MLA] lead sweep crashed',
      );
      throw err;
    }
  }
}
