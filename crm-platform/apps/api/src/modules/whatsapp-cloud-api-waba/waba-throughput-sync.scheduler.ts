import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { WabaThroughputService } from './waba-throughput.service';

const TICK_MS = 5 * 60_000;

/**
 * Keeps the send limits fresh (worker process only). Every tick republishes every number's limits to Redis, so a flushed Redis or an
 * expired key heals within five minutes, and re-reads from Meta the numbers whose last reading is older than the console's sync interval.
 * One worker runs a tick at a time (a short Redis lock); a second worker that wakes up meanwhile does nothing.
 */
@Injectable()
export class WabaThroughputSyncScheduler {
  private readonly logger = new Logger(WabaThroughputSyncScheduler.name);
  private running = false;

  constructor(private readonly throughput: WabaThroughputService) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.throughput.tick();
      if (r.published > 0 || r.synced > 0)
        this.logger.log(r, '[WABA] send limits published and synced');
    } catch (err) {
      this.logger.error({ err: String(err) }, '[WABA] send limits sync failed');
    } finally {
      this.running = false;
    }
  }
}
