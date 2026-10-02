import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createPlatformPermissionSchema,
  createPlatformRoleSchema,
  platformRoleListQuerySchema,
  reassignRoleSchema,
  setStaffRolesSchema,
  updatePlatformRoleSchema,
  uuidSchema,
  type CreatePlatformPermissionInput,
  type CreatePlatformRoleInput,
  type PlatformRoleListQuery,
  type ReassignRoleInput,
  type SetStaffRolesInput,
  type UpdatePlatformRoleInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard } from '../auth';
import { PlatformPermissionGuard, PlatformPermission } from './platform-permission.guard';
import { PlatformPermissionsService } from './platform-permissions.service';
import { PlatformRbacService } from './platform-rbac.service';
import { PlatformRolesService } from './platform-roles.service';
import { PlatformStaffService } from './platform-staff.service';

/**
 * The operator console's roles, permission catalogue and staff assignment (WD-RBAC-005..013, 021). WaDesk guarded these
 * routes with the admin gate only and never consulted its own `platform.role.manage` / `platform.permission.manage` keys; here
 * those keys are what the routes demand, so the matrix means something (WD-RBAC-003 port note).
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard, PlatformPermissionGuard)
@Controller({ path: 'platform', version: '2' })
export class PlatformRbacController {
  constructor(
    private readonly roles: PlatformRolesService,
    private readonly permissions: PlatformPermissionsService,
    private readonly staff: PlatformStaffService,
    private readonly rbac: PlatformRbacService,
  ) {}

  /** The caller's own map, open to every active operator: the console hides what the server would refuse. */
  @Get('me/permissions')
  @ApiOperation({
    summary: 'The 16 platform permissions, true where the caller holds them, plus their roles',
  })
  async myPermissions() {
    return this.rbac.myPermissions(RequestContextStore.require().actorId!);
  }

  @Get('roles')
  @PlatformPermission('platform.role.manage')
  @ApiOperation({ summary: 'Roles with user and permission counts and the KPI strip' })
  async listRoles(@Query(zodPipe(platformRoleListQuerySchema)) query: PlatformRoleListQuery) {
    return this.roles.list(query);
  }

  @Post('roles')
  @PlatformPermission('platform.role.manage')
  @ApiOperation({ summary: 'Create a role with exactly the ticked permissions' })
  async createRole(@Body(zodPipe(createPlatformRoleSchema)) body: CreatePlatformRoleInput) {
    return this.roles.create(body);
  }

  @Get('roles/:id')
  @PlatformPermission('platform.role.manage')
  @ApiOperation({ summary: 'One role with its permission names' })
  async getRole(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.roles.get(id);
  }

  @Put('roles/:id')
  @PlatformPermission('platform.role.manage')
  @ApiOperation({
    summary: 'Rename a role and replace its permission set (needs the rowVersion you read)',
  })
  async updateRole(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updatePlatformRoleSchema)) body: UpdatePlatformRoleInput,
  ) {
    return this.roles.update(id, body);
  }

  @Post('roles/:id/duplicate')
  @PlatformPermission('platform.role.manage')
  @ApiOperation({ summary: 'Clone a role (name, description, permissions) as "<name> (copy)"' })
  async duplicateRole(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.roles.duplicate(id);
  }

  @Post('roles/:id/reassign')
  @PlatformPermission('platform.role.manage')
  @ApiOperation({ summary: 'Move every operator holding this role onto another role' })
  async reassignRole(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(reassignRoleSchema)) body: ReassignRoleInput,
  ) {
    return this.roles.reassign(id, body);
  }

  @Delete('roles/:id')
  @PlatformPermission('platform.role.manage')
  @ApiOperation({ summary: 'Delete a role (never Super Admin); holders lose it' })
  async deleteRole(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.roles.remove(id);
  }

  @Get('permissions')
  @PlatformPermission('platform.permission.manage')
  @ApiOperation({
    summary: 'Every permission with its module, role count and orphan state, plus the KPI strip',
  })
  async listPermissions() {
    return this.permissions.list();
  }

  @Post('permissions')
  @PlatformPermission('platform.permission.manage')
  @ApiOperation({ summary: 'Add a permission to the catalogue (granted to nobody)' })
  async createPermission(
    @Body(zodPipe(createPlatformPermissionSchema)) body: CreatePlatformPermissionInput,
  ) {
    return this.permissions.create(body);
  }

  @Delete('permissions/:id')
  @PlatformPermission('platform.permission.manage')
  @ApiOperation({
    summary: 'Delete a permission; every role that held it loses it (never the platform.* keys)',
  })
  async deletePermission(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.permissions.remove(id);
  }

  @Get('staff')
  @PlatformPermission('platform.role.manage')
  @ApiOperation({
    summary: 'Operators with the platform roles they hold, and every role to pick from',
  })
  async listStaff() {
    return this.staff.list();
  }

  @Put('staff/:id/roles')
  @HttpCode(HttpStatus.OK)
  @PlatformPermission('platform.role.manage')
  @ApiOperation({ summary: 'Set exactly these platform roles for an operator' })
  async setStaffRoles(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setStaffRolesSchema)) body: SetStaffRolesInput,
  ) {
    return this.staff.setRoles(id, body);
  }
}
