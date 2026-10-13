import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MailPushService, type PushSweepResult } from './mail-push.service';

export const MAIL_PUSH_SWEEP_INTERVAL_MS = 120_000;

/** Every two minutes: start, renew and (when lapsed) stop the Gmail watches (TW-MAIL-033). Registered only in the worker process. */
@Injectable()
export class MailPushSweep {
  private readonly logger = new Logger(MailPushSweep.name);

  constructor(private readonly push: MailPushService) {}

  @Interval(MAIL_PUSH_SWEEP_INTERVAL_MS)
  async tick(): Promise<PushSweepResult | null> {
    try {
      return await this.push.sweep();
    } catch (err) {
      this.logger.error({ err }, 'mail push sweep failed');
      return null;
    }
  }
}
