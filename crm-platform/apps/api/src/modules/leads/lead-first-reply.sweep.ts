import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LeadFirstReplyService } from './lead-first-reply.service';

/**
 * The clock of speed-to-lead: every few seconds it takes the first messages that have come due (a delay that passed, a quiet-hours or
 * business-hours hold that ended, a retry) and works on them. A message with no delay is tried by the consumer at once; this is what
 * makes the delayed and the held ones go, and what frees a claim a dead worker left behind. Imported by the worker module only.
 */
@Injectable()
export class LeadFirstReplySweepService {
  private readonly logger = new Logger(LeadFirstReplySweepService.name);
  private running = false;

  constructor(private readonly service: LeadFirstReplyService) {}

  @Interval(10_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.service.processDue();
      if (n > 0) this.logger.log({ taken: n }, 'lead first messages worked on');
    } catch (err) {
      this.logger.error({ err }, 'lead first message sweep failed');
    } finally {
      this.running = false;
    }
  }
}
