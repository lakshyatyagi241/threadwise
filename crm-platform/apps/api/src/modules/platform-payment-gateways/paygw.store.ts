import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';

/**
 * The only door through which this module reaches platform-wide data: `payment_gateways` (credentials; its policy admits the
 * privileged flag only) and, for the unauthenticated return and webhook receivers, an `orders` row found across tenants by its
 * own return token or its provider id. Same shape as PlanStore and PlatformStore: a grep for `.privileged(` in this module must
 * find this file and nothing else (unit-tested).
 *
 * Every method that uses it names what it does with the tenant, and a tenant's checkout writes its own order through the
 * normal `tx()`, never through here.
 *
 * Two correct requests colliding on a unique key (the same order number, the same idempotency key) become a 409 the client can
 * handle, not a 500.
 */
@Injectable()
export class PaygwStore {
  constructor(private readonly db: DatabaseService) {}

  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.privileged(fn);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'This change collided with another one saved at the same time. Reload and try again.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }
}
