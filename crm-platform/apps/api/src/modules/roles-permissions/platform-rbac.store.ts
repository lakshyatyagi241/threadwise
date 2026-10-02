import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';

/**
 * The only door through which this module reaches the platform-layer RBAC tables (platform_roles, platform_permissions,
 * platform_role_permissions, platform_operator_roles). Their RLS policy is satisfied only by the privileged flag; every
 * caller is behind OperatorGuard. A grep for `.privileged(` in this module must find this file and nothing else
 * (unit-tested), the same rule PlatformStore and SupportStore follow.
 */
@Injectable()
export class PlatformRbacStore {
  constructor(private readonly db: DatabaseService) {}

  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.privileged(fn);
  }
}
