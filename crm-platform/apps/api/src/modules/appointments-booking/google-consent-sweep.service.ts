import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { GoogleConsentService } from './google-consent.service';

/**
 * Forgets the Google consents that ran out of time (TW-GACC-010): a consent nobody confirmed holds sealed tokens for at most ten minutes
 * and is then withdrawn at Google (where that is safe) and wiped. Worker only; one pass a minute. Several workers may list the same request; the
 * atomic end of each request (`GoogleConsentRepository.end`) lets exactly one of them withdraw it.
 */
@Injectable()
export class GoogleConsentSweepService {
  private readonly logger = new Logger(GoogleConsentSweepService.name);
  private running = false;

  constructor(private readonly consent: GoogleConsentService) {}

  @Interval(60_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.consent.sweepExpired();
      if (n > 0) this.logger.debug({ expired: n }, 'google consents expired');
    } catch (err) {
      this.logger.error({ err }, 'google consent sweep failed');
    } finally {
      this.running = false;
    }
  }
}
