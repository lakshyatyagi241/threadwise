import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InboxTriageService } from './inbox-triage.service';

/**
 * Wakes snoozed conversations whose time has come, every 30 seconds. One pass handles up to 100 threads; a bigger backlog drains over the
 * next ticks. Overlapping ticks are skipped. Imported by the worker only (TeamInboxConversationsWorkerModule).
 */
@Injectable()
export class InboxSnoozeWakeService {
  private readonly logger = new Logger(InboxSnoozeWakeService.name);
  private running = false;

  constructor(private readonly triage: InboxTriageService) {}

  @Interval(30_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.triage.wakeDue();
    } catch (err) {
      this.logger.error({ err }, 'snooze wake-up sweep failed');
    } finally {
      this.running = false;
    }
  }
}
