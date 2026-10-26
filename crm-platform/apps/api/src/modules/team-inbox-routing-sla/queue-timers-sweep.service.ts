import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { QueueTimersService } from './queue-timers.service';

/**
 * Runs the waiting queue's timers once every 30 seconds (the same cadence as the escalation sweep). All the rules live in
 * `QueueTimersService`; this only keeps the schedule and makes sure two ticks never overlap in one process.
 */
@Injectable()
export class QueueTimersSweep {
  private readonly logger = new Logger(QueueTimersSweep.name);
  private running = false;

  constructor(private readonly timers: QueueTimersService) {}

  @Interval(30_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const acted = await this.timers.sweep();
      if (acted > 0) this.logger.log({ acted }, 'queue timers ran');
    } catch (err) {
      this.logger.error({ err }, 'queue timer sweep failed');
    } finally {
      this.running = false;
    }
  }
}
