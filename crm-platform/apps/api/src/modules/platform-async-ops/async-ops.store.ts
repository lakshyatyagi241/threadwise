import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';

/**
 * The only door through which this module reaches across tenants.
 *
 * The outbox spans every organization and its RLS only lets a privileged connection see it, so the operator tools that list and
 * replay dead events run privileged. Nothing a customer can call reaches this module (every route is `platform_operator` plus
 * OperatorGuard). A grep for `.privileged(` in this module must find this file and nothing else, the same rule SupportStore follows.
 */
@Injectable()
export class AsyncOpsStore {
  constructor(private readonly db: DatabaseService) {}

  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.privileged(fn);
  }
}
