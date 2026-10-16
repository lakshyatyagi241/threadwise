import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MinorDetectionService } from './minor-detection.service';

/**
 * The nightly birthday sweep (BL-211, spec 11.10; worker only): lifts the minor flags that came from a date of birth or an age and whose day
 * has come, and flags the under-age contacts that no write evaluated. A flag a person set is never touched. At 03:35, away from the other
 * nightly sweeps (the forms retention at 03:17, the consent export keeper at 02:41).
 */
@Injectable()
export class MinorSweepService {
  private readonly logger = new Logger(MinorSweepService.name);
  private running = false;

  constructor(private readonly detection: MinorDetectionService) {}

  @Cron('35 3 * * *')
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.detection.sweep();
    } catch (err) {
      this.logger.error({ err }, '[MINOR] birthday sweep failed');
    } finally {
      this.running = false;
    }
  }
}
