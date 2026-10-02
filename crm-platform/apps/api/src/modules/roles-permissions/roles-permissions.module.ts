import { Module } from '@nestjs/common';
import { PlatformPermissionGuard } from './platform-permission.guard';
import { PlatformPermissionsService } from './platform-permissions.service';
import { PlatformRbacController } from './platform-rbac.controller';
import { PlatformRbacService } from './platform-rbac.service';
import { PlatformRbacStore } from './platform-rbac.store';
import { PlatformRolesService } from './platform-roles.service';
import { PlatformStaffService } from './platform-staff.service';
import { WorkspaceRoleRulesService } from './workspace-role-rules.service';

/**
 * Roles and permissions (RBAC), platform layer: the operator console's roles, permission catalogue and staff assignment,
 * and the guard other `/v2/platform/*` controllers use to demand a platform permission. The workspace layer's grant rules
 * (who may hand out which role) live here too; the per-org roles and members screens stay in the admin module.
 */
@Module({
  controllers: [PlatformRbacController],
  providers: [
    PlatformRbacStore,
    PlatformRbacService,
    PlatformRolesService,
    PlatformPermissionsService,
    PlatformStaffService,
    PlatformPermissionGuard,
    WorkspaceRoleRulesService,
  ],
  exports: [PlatformRbacService, PlatformPermissionGuard, WorkspaceRoleRulesService],
})
export class RolesPermissionsModule {}
