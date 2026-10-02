import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createRoleSchema,
  paginationQuerySchema,
  updateRoleSchema,
  type CreateRoleInput,
  type PaginationQuery,
  type UpdateRoleInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { RolesService } from './roles.service';

@ApiTags('roles')
// Phase 2 (docs/phase-plan.md) — same exclusion reason as users.controller.ts.
@ApiExcludeController()
@ActorKinds('user')
@Controller({ path: 'roles', version: '2' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  // The members screen reads the list to offer the roles a person can be given, so the people managers read it too.
  @Get()
  @RequirePermission('admin.role.manage', 'admin.user.manage')
  @ApiOperation({ summary: 'List roles, each with its resolved grant set' })
  async list(@Query(zodPipe(paginationQuerySchema)) query: PaginationQuery) {
    return this.roles.list(query);
  }

  @Get(':id')
  @RequirePermission('admin.role.manage')
  @ApiOperation({ summary: 'Get one role by uuid' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.getByUuid(id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('admin.role.manage')
  @ApiOperation({ summary: 'Create a role with an initial grant set' })
  async create(@Body(zodPipe(createRoleSchema)) body: CreateRoleInput) {
    return this.roles.create(body);
  }

  @Patch(':id')
  @RequirePermission('admin.role.manage')
  @ApiOperation({
    summary: 'Update a role',
    description:
      'Requires the rowVersion you read. grants, when present, fully replaces the grant set. ' +
      'System roles (isLocked) reject this with a validation error.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateRoleSchema)) body: UpdateRoleInput,
  ) {
    return this.roles.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('admin.role.manage')
  @ApiOperation({ summary: 'Delete a role (rejected for system roles)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.roles.remove(id);
  }
}
