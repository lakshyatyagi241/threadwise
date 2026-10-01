import { HttpStatus, Injectable } from '@nestjs/common';
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
  constructor(private readonly db: DatabaseService) {}

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
