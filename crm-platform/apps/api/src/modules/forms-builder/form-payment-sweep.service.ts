import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { FormPaymentsRepository } from './form-payments.repository';

const BATCH = 500;
const MAX_BATCHES = 20;

/**
 * Marks payment attempts whose link lapsed (`FORM_PAYMENT_TTL_HOURS`, 48) as `expired` (docs/specs/forms-builder-app.md 10.6). The
 * submission stays `awaiting_payment`: staff see it and can get a fresh link. A late notification for an expired attempt still settles it
 * (money that arrived is never dropped). Privileged so one statement covers every workspace; rows are picked with SKIP LOCKED. Worker only.
 */
@Injectable()
export class FormPaymentSweepService {
  private readonly logger = new Logger(FormPaymentSweepService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FormPaymentsRepository,
  ) {}

  @Cron('*/30 * * * *')
  async run(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let total = 0;
    try {
      for (let i = 0; i < MAX_BATCHES; i++) {
        const n = await this.db.privileged((tx) => this.repo.expireDue(tx, BATCH));
        total += n;
        if (n < BATCH) break;
      }
      if (total > 0) this.logger.log({ expired: total }, 'form payment sweep');
    } catch (err) {
      this.logger.error({ err }, 'form payment sweep failed');
    } finally {
      this.running = false;
    }
    return total;
  }
}
