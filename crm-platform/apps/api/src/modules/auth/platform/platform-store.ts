import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../../infra/db/database.service';

/**
 * The only door to the platform-wide tables: platform_settings,
 * platform_operators, platform_sessions and the read side of security_events.
 *
 * Their RLS policies are satisfied only by the privileged flag, so every access
 * goes through here and a grep for `.privileged(` in the auth module must find
 * this file and tenant-directory.ts and nothing else (unit-tested).
 *
 * It never touches a tenant table.
 */
@Injectable()
export class PlatformStore {
  constructor(private readonly db: DatabaseService) {}

  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.privileged(fn);
  }
}
