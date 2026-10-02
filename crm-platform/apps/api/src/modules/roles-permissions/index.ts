/**
 * Public surface of the roles-permissions domain. Other modules import from here, never from the files behind it.
 */
export { RolesPermissionsModule } from './roles-permissions.module';
export { PlatformPermission, PlatformPermissionGuard } from './platform-permission.guard';
export { PlatformRbacService } from './platform-rbac.service';
export { WorkspaceRoleRulesService, PRESET_RANK } from './workspace-role-rules.service';
