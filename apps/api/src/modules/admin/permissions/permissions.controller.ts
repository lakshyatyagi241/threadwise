import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { schema } from '@crm/db';
import type { PermissionDefResponse } from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../../common/decorators';
import { DatabaseService } from '../../../infra/db/database.service';

/**
 * The platform's capability registry — read-only. Roles & Permissions UI uses
 * this to render "what can a role be granted", not to enforce anything itself.
 */
@ApiTags('permissions')
@ActorKinds('user')
@Controller({ path: 'permissions', version: '1' })
export class PermissionsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @RequirePermission('admin.role.manage')
  @ApiOperation({ summary: 'List every permission key the platform knows about' })
  async list(): Promise<{ data: PermissionDefResponse[] }> {
    const rows = await this.db.tx((tx) =>
      tx
        .select({
          key: schema.permissionDefs.key,
          label: schema.permissionDefs.label,
          category: schema.permissionDefs.category,
          supportsScope: schema.permissionDefs.supportsScope,
        })
        .from(schema.permissionDefs),
    );
    return { data: rows };
  }
}
