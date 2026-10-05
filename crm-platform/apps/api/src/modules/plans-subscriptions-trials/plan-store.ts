import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';

/**
 * The only door through which this module writes the platform catalogue.
 *
 * `plans` and `org_plan_state` accept writes only when the privileged flag is
 * on (the catalogue is the operator's, not a tenant's), so every operator
 * mutation and every cross-tenant count goes through here. A grep for
 * `.privileged(` in this module must find this file and nothing else
 * (unit-tested), the same rule the auth module follows.
 *
 * A unique violation (two operators creating the same slug, or flagging two
 * defaults at the same instant) is the one failure two correct requests can
 * cause together; it becomes a 409 the console can show, not a 500.
 */
@Injectable()
export class PlanStore {
  private grace: { at: number; days: number } | null = null;

  constructor(private readonly db: DatabaseService) {}

  /**
   * `billing.grace_days` (default 7, 0 to 30): how long autopay keeps a lapsed paid plan or add-on active while it retries.
   * `platform_settings` is readable only under the privileged flag, so it is read here, and kept for 30 seconds because the
   * entitlement resolver asks on a hot path (only for a workspace with a live autopay subscription).
   */
  async graceDays(): Promise<number> {
    if (this.grace && Date.now() - this.grace.at < 30_000) return this.grace.days;
    const res = await this.tx((tx) =>
      tx.execute(sql`SELECT value FROM platform_settings WHERE key = 'billing.grace_days'`),
    );
    const v = (res.rows[0] as { value: unknown } | undefined)?.value;
    const days = typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 30 ? v : 7;
    this.grace = { at: Date.now(), days };
    return days;
  }

  /** Forgets the cached grace days (a settings save, a test that writes the setting directly). */
  forgetGrace(): void {
    this.grace = null;
  }

  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.privileged(fn);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'Another change to the plan catalogue was saved at the same time. Reload and try again.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }
}
