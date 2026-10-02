import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';

/**
 * The only door through which this module reaches across tenants.
 *
 * A support ticket belongs to the organization of the user who filed it (its RLS tenant), but the platform's staff
 * work every organization's tickets from one inbox. Those operator-side reads and writes run privileged; the
 * customer-side ones never do (they use DatabaseService.tx(), so RLS plus the `user_id` filter confine them). A grep
 * for `.privileged(` in this module must find this file and nothing else (unit-tested), the same rule PlanStore and
 * PlatformStore follow.
 */
@Injectable()
export class SupportStore {
  constructor(private readonly db: DatabaseService) {}

  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.privileged(fn);
  }
}
