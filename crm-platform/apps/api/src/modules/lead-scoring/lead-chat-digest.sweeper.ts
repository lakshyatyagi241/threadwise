import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LeadChatDigestService } from './lead-chat-digest.service';

/**
 * Every few minutes: find the contacts whose conversation went quiet since they were last read and queue one job each. Worker process
 * only. Idle time is the trigger on purpose: a customer typing in bursts is one reading, and a message that arrives later brings the
 * contact back on the next pass. The jobs re-check everything in their own workspace, so this only has to be cheap.
 */
@Injectable()
export class LeadChatDigestSweeper {
  private readonly logger = new Logger(LeadChatDigestSweeper.name);
  private running = false;

  constructor(private readonly digests: LeadChatDigestService) {}

  @Cron('*/3 * * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const queued = await this.digests.queueIdle();
      if (queued > 0) this.logger.log({ queued }, 'chat digests queued');
    } catch (err) {
      this.logger.error({ err }, 'chat digest sweep failed');
    } finally {
      this.running = false;
    }
  }
}
