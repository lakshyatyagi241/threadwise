import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MailOutboundAttachments } from './mail-outbound-attachments.service';

export const MAIL_ATTACHMENT_SWEEP_INTERVAL_MS = 15 * 60_000;

/** Every 15 minutes: staged composer uploads that were never sent are deleted once they expired (object and row). Worker process only. */
@Injectable()
export class MailOutboundAttachmentsSweep {
  private readonly logger = new Logger(MailOutboundAttachmentsSweep.name);

  constructor(private readonly attachments: MailOutboundAttachments) {}

  @Interval(MAIL_ATTACHMENT_SWEEP_INTERVAL_MS)
  async tick(): Promise<number> {
    try {
      return await this.run();
    } catch (err) {
      this.logger.error({ err }, 'staged attachment sweep failed');
      return 0;
    }
  }

  async run(): Promise<number> {
    let total = 0;
    for (let i = 0; i < 20; i += 1) {
      const n = await this.attachments.sweepExpired(200);
      total += n;
      if (n < 200) break;
    }
    return total;
  }
}
